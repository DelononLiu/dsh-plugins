/**
 * console 端到端验收（手动运行，不进 CI）：真实代码路径 + 真实文件系统 + 真实进程。
 *
 * 为什么要有它：单元测试把文件系统与 spawn 都 mock 掉了，掩盖了实机才会暴露的问题
 * （实测踩到三个：模板不带 node_modules/cordis.yml → 建出来的实例起不来；重复删除返回成功；
 * 静默失败把守护的拒绝当"已下发"）。这个脚本用**真池、真模板、真安装、真 spawn** 跑一遍
 * R7（版本池/创建引用/删除恢复）与 R1（创建/删除）。
 *
 * 用法：node packages/dsh-console/tests/e2e-acceptance.mjs
 * 副作用（明确列出）：向真实 `~/.dsh-runtimes/` 导入一个版本（硬链接，不额外占盘）；
 * 在临时 DSH_HOME 下建实例目录并真的拉起一个实例进程（端口 3099），跑完删除该实例；
 * 临时 DSH_HOME 保留在 /tmp 供排查（脚本末尾打印路径）。
 */
import { Context } from '@deepseek-ai/cordis'
import { execFileSync } from 'node:child_process'
import { existsSync, lstatSync, mkdtempSync, readFileSync, readlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { createConnection } from 'node:net'
import { fileURLToPath } from 'node:url'

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const home = mkdtempSync(join(tmpdir(), 'e2e-home-'))
process.env.DSH_HOME = home
process.env.DSH_REGISTRY = join(home, 'registry.json')
process.env.DSH_RUNTIMES = join(process.env.HOME, '.dsh-runtimes')
process.env.DSH_HOST_ID = 'master'
delete process.env.DSH_SESSION_ID
delete process.env.DSH_CHANNEL_ID

const { default: ConsoleService } = await import(join(REPO, 'packages/dsh-console/lib/index.js'))
const { default: ChannelService } = await import(join(REPO, 'packages/dsh-channel/lib/index.js'))

const ctx = new Context()
await ctx.plugin(ChannelService, { tokens: {}, heartbeatTimeoutMs: 30_000 })
await ctx.plugin(ConsoleService, { role: 'daemon', hostId: 'master', templateHome: join(REPO, 'profiles') })
const c = ctx.console
let failed = 0
const step = (n, ok, extra = '') => {
  if (!ok) failed += 1
  console.log(`${ok ? '✓' : '✗'} ${n}${extra ? ' — ' + extra : ''}`)
}

// 先确保版本在池（首次运行会真导入；已存在则跳过——不能用 || 让两种结果都算通过）
if (!c.listRuntimePool().versions.some((v) => v.version === '0.1.2-rc.1')) {
  const imported = c.importRuntimeVersion('0.1.2-rc.1')
  step('首次运行：导入 runtime 0.1.2-rc.1', imported.ok, imported.error ?? '')
}
step('池内有 0.1.2-rc.1 且自检通过', c.listRuntimePool().versions.some((v) => v.version === '0.1.2-rc.1' && v.ok))
step('重复导入被拒（池不可变）', c.importRuntimeVersion('0.1.2-rc.1').ok === false)
const pool = c.listRuntimePool()
step('池内版本自检通过', pool.versions.every((v) => v.ok), JSON.stringify(pool.versions))
step('模板清单来自仓库 profiles/', JSON.stringify(c.listTemplates()) === JSON.stringify(['dev', 'explorer', 'master', 'minimal']), JSON.stringify(c.listTemplates()))

const dshHome = join(home, 'instance-e2e')
const t0 = Date.now()
const dep = c.deployInstance({ host: 'host-master', instanceId: 'e2e-a', version: '0.1.2-rc.1', profile: 'dev', dshHome, port: 3099, token: 'e2e-token' })
step('创建实例（模板 dev + 内核 0.1.2-rc.1）', dep.ok, `${dep.error ?? dep.detail ?? ''}（${((Date.now() - t0) / 1000).toFixed(1)}s）`)
const profileDir = join(dshHome, 'profiles', 'dev')
step('profile 三件套 + cordis.yml 就位', ['package.json', 'cordis.yml', 'cordis.patch.yml'].every((f) => existsSync(join(profileDir, f))))
const dshLink = join(profileDir, 'node_modules', '@deepseek-ai', 'dsh')
const isLink = existsSync(dshLink) && lstatSync(dshLink).isSymbolicLink()
step('官方包软链到池（引用建立）', isLink, isLink ? readlinkSync(dshLink) : '（非软链）')
const entry = JSON.parse(readFileSync(process.env.DSH_REGISTRY, 'utf8')).instances['master/e2e-a']
step('注册表登记 version/layout/template', entry?.version === '0.1.2-rc.1' && entry?.layout === 'home', JSON.stringify({ v: entry?.version, layout: entry?.layout, port: entry?.port }))
const denied = c.removeRuntimeVersion('0.1.2-rc.1')
step('被实例引用的版本禁止删除', denied.ok === false, denied.error ?? '')

await new Promise((r) => setTimeout(r, 8000))
// 确定性判据：只看**本次验收实例**的端口是否被监听（全局 pgrep 会被机器上同名进程假绿——review 指出）
const portUp = await new Promise((resolve) => { const s = createConnection({ host: '127.0.0.1', port: 3099 }); s.on('connect', () => { s.end(); resolve(true) }); s.on('error', () => resolve(false)); setTimeout(() => { s.destroy(); resolve(false) }, 2000) })
step('验收实例端口 3099 被监听（真拉起）', portUp, portUp ? 'port=3099' : `（未监听；实例日志：${join(home, 'logs', 'e2e-a.log')}）`)
const pid = portUp ? execFileSync('bash', ['-lc', "ss -tlnp 2>/dev/null | grep ':3099 ' | grep -oE 'pid=[0-9]+' | head -1"], { encoding: 'utf8' }).trim() : ''
if (pid !== '') { try { process.kill(Number(pid.replace('pid=', '')), 'SIGTERM'); console.log(`  · 已停止验收实例 ${pid}`) } catch { /* 已退出 */ } }

const del = await c.deleteInstance('e2e-a')
step('删除 = 归档 + 墓碑', del.ok && !existsSync(dshHome), del.error ?? `${del.detail ?? ''}`)
const tombstones = c.listDeletedInstances()
step('墓碑可查（含归档路径）', tombstones.length === 1 && (tombstones[0].archivePath ?? '').includes('.archive/'), JSON.stringify(tombstones))
const res = c.restoreInstance('e2e-a')
step('恢复（与 CLI 同一实现）', res.ok && existsSync(join(profileDir, 'package.json')), res.error ?? `${res.detail ?? ''}`)

console.log(`\n${failed === 0 ? '端到端验收：全部通过' : `端到端验收：${failed} 项失败`}`)
console.log(`临时 DSH_HOME=${home}｜真实池=${process.env.DSH_RUNTIMES}`)
process.exitCode = failed === 0 ? 0 : 1
