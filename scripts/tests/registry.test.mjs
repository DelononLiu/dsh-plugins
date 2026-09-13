/** 注册表（instances registry）测试：导入 / 查询 / 墓碑 / 「注册表是唯一入口」。 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const CLI = new URL('../dsh-registry.mjs', import.meta.url).pathname
const run = promisify(execFile)

/** 跑 CLI，返回 { code, stdout, stderr }（非零不抛）。 */
async function cli(args, env) {
  try {
    const { stdout, stderr } = await run('node', [CLI, ...args], { env: { ...process.env, ...env } })
    return { code: 0, stdout, stderr }
  } catch (e) {
    return { code: e.code ?? 1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' }
  }
}

/** 造一个假 HOME：legacy 实例 = ~/.dsh-<名>/profiles/<名>。 */
async function fakeHome(names = ['web2', 'daemon']) {
  const home = await mkdtemp(join(tmpdir(), 'dsh-reg-'))
  for (const n of names) await mkdir(join(home, `.dsh-${n}`, 'profiles', n), { recursive: true })
  // 新布局根（名字同样匹配 ~/.dsh-* 通配，导入时必须跳过它自己）
  await mkdir(join(home, '.dsh-home'), { recursive: true })
  // 干扰项：匹配通配但没有 per-instance 布局
  await mkdir(join(home, '.dsh-junk', 'profiles', 'other'), { recursive: true })
  return home
}

const env = (home) => ({ HOME: home, DSH_REGISTRY: join(home, '.dsh-home', 'registry.json'), DSH_HOST_ID: 'master' })

test('import：扫描 per-instance 布局并登记 legacy 实例', async () => {
  const home = await fakeHome()
  try {
    const r = await cli(['import'], env(home))
    assert.equal(r.code, 0, r.stderr)
    const reg = JSON.parse(await readFile(join(home, '.dsh-home', 'registry.json'), 'utf8'))
    assert.deepEqual(Object.keys(reg.instances).sort(), ['master/daemon', 'master/web2'])
    const web2 = reg.instances['master/web2']
    assert.equal(web2.home, join(home, '.dsh-web2'))
    assert.equal(web2.profileDir, 'web2')
    assert.equal(web2.layout, 'legacy')
    assert.equal(web2.status, 'active')
    assert.equal(web2.template, null)
    assert.equal(web2.version, null)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('import：跳过 ~/.dsh-home 自身与无 per-instance 布局的目录', async () => {
  const home = await fakeHome(['web3'])
  try {
    await cli(['import'], env(home))
    const reg = JSON.parse(await readFile(join(home, '.dsh-home', 'registry.json'), 'utf8'))
    const ids = Object.values(reg.instances).map((i) => i.id).sort()
    assert.deepEqual(ids, ['web3'])
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('import：幂等，且不覆盖已有（新布局）条目', async () => {
  const home = await fakeHome(['web2'])
  const file = join(home, '.dsh-home', 'registry.json')
  try {
    await cli(['import'], env(home))
    // 手工塞一条新布局实例（批 3 之后由创建流程写入，这里模拟"已有条目"）
    const reg = JSON.parse(await readFile(file, 'utf8'))
    reg.instances['master/instance-a'] = {
      id: 'instance-a',
      name: 'instance-a',
      host: 'master',
      home: join(home, '.dsh-home', 'instance-a'),
      profileDir: 'dev',
      template: 'dev',
      templateFingerprint: 'sha256:deadbeef',
      version: '0.1.2-rc.1',
      port: 3090,
      role: 'instance',
      layout: 'home',
      addr: 'http://127.0.0.1:3090',
      status: 'active',
      createdAt: '2026-09-13T00:00:00.000Z',
      deletedAt: null,
    }
    await writeFile(file, JSON.stringify(reg, null, 2))
    await cli(['import'], env(home))
    const after = JSON.parse(await readFile(file, 'utf8'))
    assert.equal(after.instances['master/instance-a'].template, 'dev')
    assert.equal(after.instances['master/instance-a'].version, '0.1.2-rc.1')
    assert.deepEqual(Object.keys(after.instances).sort(), ['master/instance-a', 'master/web2'])
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('get：tsv 输出字段；未知 id 非零退出', async () => {
  const home = await fakeHome(['web4'])
  try {
    await cli(['import'], env(home))
    const r = await cli(['get', 'web4', '--format', 'tsv'], env(home))
    assert.equal(r.code, 0, r.stderr)
    const [h, prof, host, layout, role, version, port, status] = r.stdout.trim().split('\t')
    assert.equal(h, join(home, '.dsh-web4'))
    assert.equal(prof, 'web4')
    assert.equal(host, 'master')
    assert.equal(layout, 'legacy')
    assert.equal(status, 'active')
    // role 实测自实例 patch 的 `role:` 行；无 patch/无该行 = console 插件默认角色
    assert.equal(role, 'console')
    assert.equal(version, '')
    assert.equal(port, '')
    const miss = await cli(['get', 'nope'], env(home))
    assert.notEqual(miss.code, 0)
    assert.match(miss.stderr, /未在注册表/)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('list：默认排除墓碑，--include-deleted 才列出', async () => {
  const home = await fakeHome(['web2', 'web3'])
  try {
    await cli(['import'], env(home))
    const rm1 = await cli(['remove', 'web3'], env(home))
    assert.equal(rm1.code, 0, rm1.stderr)
    const live = await cli(['list', '--json'], env(home))
    assert.deepEqual(JSON.parse(live.stdout).map((i) => i.id), ['web2'])
    const all = await cli(['list', '--json', '--include-deleted'], env(home))
    assert.deepEqual(JSON.parse(all.stdout).map((i) => i.id).sort(), ['web2', 'web3'])
    const tomb = JSON.parse(await readFile(join(home, '.dsh-home', 'registry.json'), 'utf8')).instances['master/web3']
    assert.equal(tomb.status, 'deleted')
    assert.ok(tomb.deletedAt, '墓碑必须带删除时间')
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('同 id 不同 host 可共存；同 host/id 覆盖更新', async () => {
  const home = await fakeHome(['web2'])
  const base = env(home)
  try {
    await cli(['import'], base)
    await cli(['import'], { ...base, DSH_HOST_ID: 'node-b' })
    const reg = JSON.parse(await readFile(base.DSH_REGISTRY, 'utf8'))
    assert.deepEqual(Object.keys(reg.instances).sort(), ['master/web2', 'node-b/web2'])
    // 同 host/id 重复导入不新增条目，且 home 保持最新
    await cli(['import'], base)
    const after = JSON.parse(await readFile(base.DSH_REGISTRY, 'utf8'))
    assert.equal(Object.keys(after.instances).length, 2)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('注册表路径：DSH_REGISTRY 覆盖，缺省 = ~/.dsh-home/registry.json', async () => {
  const home = await fakeHome(['web2'])
  try {
    const r = await cli(['path'], { HOME: home, DSH_HOST_ID: 'master' })
    assert.equal(r.stdout.trim(), join(home, '.dsh-home', 'registry.json'))
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})
