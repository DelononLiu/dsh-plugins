/**
 * dsh-profile.sh 进程定位与就绪判定（2026-10-04「假重启」修复）的机械验收。
 *
 * 三条被锁死的行为（都是真事故里出现过的误报面）：
 *  1. 扫候选 pid 时进程已退出（ENOENT）→ 跳过继续扫，不报错、不误报「未在运行」；
 *  2. 端口占用者经 home+profile 核对就是本实例 → 必须认定在运行（pgrep 漏了也认）；
 *  3. 就绪绑本次 spawn 的 pid：spawn 退出即失败（打印日志尾部、非零退出），
 *     端口上别人答 200/401 不算自己的就绪。
 *
 * 用假 dsh（按实例 patch 的 port 起 HTTP 服务，被占用则打 EADDRINUSE 退出）与假 pgrep
 * 控制变量；不碰任何真实实例端口。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { createServer } from 'node:http'
import { createServer as netServer } from 'node:net'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const ROOT = new URL('../..', import.meta.url).pathname
const PROFILE = join(ROOT, 'scripts/dsh-profile.sh')
const REGISTRY_CLI = join(ROOT, 'scripts/dsh-registry.mjs')

const FAKE_DSH = `#!/usr/bin/env node
// 测试替身：按实例 cordis.patch.yml 的 port 起 HTTP 服务（401=正常未登录应答）；
// 端口被占则打印 EADDRINUSE 并退出 1——复刻真 dsh 的 bind 失败路径。
const { readFileSync } = require('node:fs')
const { createServer } = require('node:http')
const args = process.argv.slice(2)
const pi = args.indexOf('--profile')
const profile = pi >= 0 ? args[pi + 1] : 'web'
let port = null
try {
  const yml = readFileSync(\`\${process.env.DSH_HOME}/profiles/\${profile}/cordis.patch.yml\`, 'utf8')
  const m = yml.match(/^[ \\t]*port:[ \\t]*(\\d+)[ \\t]*$/m)
  if (m) port = Number(m[1])
} catch {}
if (!port) { console.error('fake-dsh: no port'); process.exit(1) }
const srv = createServer((_q, res) => { res.writeHead(401); res.end('unauthorized') })
srv.on('error', (e) => {
  if (e && e.code === 'EADDRINUSE') console.error(\`dsh: startup failed: webserver (required) is not reachable: listen EADDRINUSE: address already in use 127.0.0.1:\${port}\`)
  else console.error(\`dsh: startup failed: \${e && e.message}\`)
  process.exit(1)
})
srv.listen(port, '127.0.0.1', () => console.log(\`dsh web: open http://127.0.0.1:\${port}/?token=FAKETOKEN123\`))
`

const FAKE_PGREP = `#!/usr/bin/env bash
# 测试替身：按 FAKE_PGREP_OUT 逐行输出候选 pid（默认空 = 「pgrep 看不到任何 dsh」）。
printf '%s' "\${FAKE_PGREP_OUT:-}" | grep -E '^[0-9]+$' || true
`

/** 建一个隔离沙箱：临时 HOME + 注册表 + 假 dsh/pgrep。 */
function sandbox() {
  const root = mkdtempSync(join(tmpdir(), 'dsh-profile-test-'))
  const home = join(root, 'home')
  const binDir = join(root, 'bin')
  const registry = join(root, 'registry.json')
  mkdirSync(home, { recursive: true })
  mkdirSync(binDir, { recursive: true })
  writeFileSync(join(binDir, 'dsh'), FAKE_DSH, { mode: 0o755 })
  writeFileSync(join(binDir, 'pgrep'), FAKE_PGREP, { mode: 0o755 })
  return { root, home, binDir, registry, dshBin: join(binDir, 'dsh') }
}

/** 造一个 legacy 实例目录（`$HOME/.dsh-<名>/profiles/<名>`）并登记进注册表。 */
function registerInstance(sb, name, port) {
  const dir = join(sb.home, `.dsh-${name}`, 'profiles', name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'cordis.patch.yml'), `- id: webserver\n  config:\n    port: ${port}\n`)
  const r = spawnSync('node', [REGISTRY_CLI, 'import'], { env: scriptEnv(sb), encoding: 'utf8' })
  assert.equal(r.status, 0, `注册表 import 失败：${r.stderr}`)
  return { name, home: join(sb.home, `.dsh-${name}`), port }
}

function scriptEnv(sb, extra = {}) {
  return {
    ...process.env,
    HOME: sb.home,
    DSH_REGISTRY: sb.registry,
    DSH_HOST_ID: 'testhost',
    DSH_BIN: sb.dshBin,
    READY_TIMEOUT: '8',
    PATH: `${sb.binDir}:${process.env.PATH}`,
    DSH_HOME: '',
    FAKE_PGREP_OUT: '',
    ...extra,
  }
}

function runProfile(sb, args, extra = {}) {
  return spawnSync('bash', [PROFILE, ...args], { env: scriptEnv(sb, extra), encoding: 'utf8' })
}

/** 取一个空闲高端口（避免固定端口与残留测试进程/真实实例相撞）。 */
async function freePort() {
  return await new Promise((resolve, reject) => {
    const s = netServer()
    s.on('error', reject)
    s.listen(0, '127.0.0.1', () => {
      const p = s.address().port
      s.close(() => resolve(p))
    })
  })
}

/** 当前端口的 LISTEN 占用 pid（无则 null）。 */
function portOwner(port) {
  const r = spawnSync('ss', ['-ltnp'], { encoding: 'utf8' })
  const line = r.stdout.split('\n').find((l) => l.includes(`:${port} `))
  if (!line) return null
  const m = line.match(/pid=(\d+)/)
  return m ? Number(m[1]) : null
}

/** 取一个已退出（并被回收）的 pid 充当「扫到一半消失的候选」。 */
function deadPid() {
  return spawnSync('true').pid
}

function stopPid(pid) {
  if (!pid) return
  try { process.kill(pid, 'SIGKILL') } catch {}
}

test('候选 pid 消失（ENOENT）不报错、跳过继续扫，仍能认出真实实例', async () => {
  const sb = sandbox()
  const inst = registerInstance(sb, 'web2', await freePort())
  const vanished = deadPid()
  // 真实实例进程：argv 形态 `node …/dsh --profile web2`，带正确 DSH_HOME。
  const child = spawn('bash', ['-c', 'exec -a "node /fake/bin/dsh --profile web2" sleep 60'], {
    env: { ...process.env, DSH_HOME: inst.home },
    stdio: 'ignore',
  })
  try {
    await new Promise((r) => setTimeout(r, 400))
    const res = runProfile(sb, ['status'], { FAKE_PGREP_OUT: `${vanished}\n${child.pid}` })
    assert.ok(res.stdout.includes(`web2: RUNNING pid=${child.pid}`), `应认出真实实例：\n${res.stdout}`)
    assert.ok(!res.stdout.includes('web2: stopped'), `不得误报「未在运行」：\n${res.stdout}`)
    // 旧代码对消失的候选 pid 会打印 shell 级重定向报错（`2>/dev/null` 吞不掉）。
    assert.ok(!res.stderr.includes('cmdline'), `不得打印 /proc 报错：\n${res.stderr}`)
    assert.ok(!res.stderr.includes('No such file or directory'), `不得打印 ENOENT 报错：\n${res.stderr}`)
  } finally {
    stopPid(child.pid)
    rmSync(sb.root, { recursive: true, force: true })
  }
})

test('端口占用者就是本实例 → 判为运行中；restart 真的换进程', async () => {
  const sb = sandbox()
  const inst = registerInstance(sb, 'web2', await freePort())
  let first = null
  try {
    // pgrep 失明（返回不存在的 pid），只能靠端口占用者反查。
    const start = runProfile(sb, ['start', 'web2'], { FAKE_PGREP_OUT: '999999' })
    assert.equal(start.status, 0, `start 失败：\n${start.stdout}\n${start.stderr}`)
    const m = start.stdout.match(/就绪 pid=(\d+)/)
    assert.ok(m, `start 应报就绪并给 pid：\n${start.stdout}`)
    first = Number(m[1])
    assert.equal(portOwner(inst.port), first, `端口占用者应是本次 spawn：${portOwner(inst.port)} vs ${first}`)

    // pgrep 仍失明：status 与重复 start 都必须经端口占用者认定「在运行」。
    const status = runProfile(sb, ['status'], { FAKE_PGREP_OUT: '999999' })
    assert.ok(status.stdout.includes(`web2: RUNNING pid=${first}`), `status 应认出：\n${status.stdout}`)
    const again = runProfile(sb, ['start', 'web2'], { FAKE_PGREP_OUT: '999999' })
    assert.equal(again.status, 0)
    assert.ok(again.stdout.includes(`已在运行 pid=${first}`), `重复 start 不应再拉起：\n${again.stdout}`)

    // restart：必须先把占端口的旧进程停掉，再起新 pid（旧代码会假重启/重复拉起）。
    const restart = runProfile(sb, ['restart', 'web2'], { FAKE_PGREP_OUT: '999999' })
    assert.equal(restart.status, 0, `restart 失败：\n${restart.stdout}\n${restart.stderr}`)
    const m2 = restart.stdout.match(/就绪 pid=(\d+)/)
    assert.ok(m2, `restart 应报就绪：\n${restart.stdout}`)
    const second = Number(m2[1])
    assert.notEqual(second, first, `restart 必须换进程（pid 变了）：${first} → ${second}`)
    assert.equal(portOwner(inst.port), second, `端口占用者应是新 pid：${portOwner(inst.port)} vs ${second}`)
    assert.ok(!restart.stdout.includes('EADDRINUSE') && !restart.stderr.includes('EADDRINUSE'),
      `restart 日志不得有 EADDRINUSE：\n${restart.stdout}\n${restart.stderr}`)
    first = second
  } finally {
    // 断言中途失败时也要清干净：按端口占用者收尾，别把假 dsh 留在端口上污染下次运行。
    stopPid(portOwner(inst.port))
    stopPid(first)
    rmSync(sb.root, { recursive: true, force: true })
  }
})

test('spawn 的 pid 死掉 → 不报就绪、非零退出、打印日志尾部（别人答 200 也不算）', async () => {
  const sb = sandbox()
  const inst = registerInstance(sb, 'web3', await freePort())
  // 外来进程占着该端口并答 200——旧判据会被它骗成「就绪」。
  const foreign = createServer((_q, res) => { res.writeHead(200); res.end('old instance') })
  await new Promise((r) => foreign.listen(inst.port, '127.0.0.1', r))
  try {
    const res = runProfile(sb, ['start', 'web3'], { FAKE_PGREP_OUT: '999999' })
    assert.notEqual(res.status, 0, `必须非零退出：\n${res.stdout}\n${res.stderr}`)
    assert.ok(!res.stdout.includes('就绪'), `不得报「就绪」：\n${res.stdout}`)
    const all = res.stdout + res.stderr
    assert.ok(all.includes('启动进程已退出'), `应判 spawn 已退出：\n${all}`)
    assert.ok(all.includes('EADDRINUSE'), `应打印日志尾部（含真因）：\n${all}`)
    assert.ok(all.includes('/tmp/dsh-web3.log'), `应指出日志路径：\n${all}`)
  } finally {
    await new Promise((r) => foreign.close(r))
    stopPid(portOwner(inst.port))
    rmSync(sb.root, { recursive: true, force: true })
  }
})
