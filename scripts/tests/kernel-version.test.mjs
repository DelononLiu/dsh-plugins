/** 内核版本检测脚本测试：版本序、仓库内漂移、报告渲染、闸门退出码（网络全部注入）。 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  EXIT, KERNEL_PACKAGE, buildReport, compareVersions, formatReport, main, newerVersions, parseVersion, readPinned, tagsOf,
} from '../check-kernel-version.mjs'

/** 造一个假仓库：profiles/<名>/dsh.lock.json。locks 形如 { name: { kernel, bundles } }。 */
async function fakeRepo(locks) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-kernel-check-'))
  for (const [name, lock] of Object.entries(locks)) {
    await mkdir(join(root, 'profiles', name), { recursive: true })
    await writeFile(join(root, 'profiles', name, 'dsh.lock.json'), JSON.stringify(lock))
  }
  return root
}

/** 假 registry：versions = 版本数组，distTags = { latest: … }。 */
function fakeFetch(versions, distTags = {}) {
  const body = { 'dist-tags': distTags, versions: Object.fromEntries(versions.map((v) => [v, {}])) }
  return async () => ({ ok: true, status: 200, statusText: 'OK', json: async () => body })
}

/** 收集输出的假流。 */
function sink() {
  const chunks = []
  return { write: (s) => chunks.push(String(s)), text: () => chunks.join(''), stream: { write: (s) => chunks.push(String(s)) } }
}

test('parseVersion：正式版与预发布段', () => {
  assert.deepEqual(parseVersion('0.1.7-rc.2'), { major: 0, minor: 1, patch: 7, pre: ['rc', '2'] })
  assert.deepEqual(parseVersion('1.2.3'), { major: 1, minor: 2, patch: 3, pre: [] })
  assert.equal(parseVersion('not-a-version'), null)
  assert.equal(parseVersion(''), null)
})

test('compareVersions：semver 序（预发布 < 正式，rc.2 < rc.10，alpha < rc）', () => {
  assert.equal(compareVersions('0.1.7-rc.2', '0.1.7-rc.2'), 0)
  assert.equal(compareVersions('0.1.7-rc.2', '0.1.7-rc.10'), -1)
  assert.equal(compareVersions('0.1.7-alpha.2', '0.1.7-rc.1'), -1)
  assert.equal(compareVersions('0.2.0-rc.1', '0.1.7-rc.2'), 1)
  assert.equal(compareVersions('0.1.7', '0.1.7-rc.2'), 1)
  assert.equal(compareVersions('0.1.7-rc.1', '0.1.7'), -1)
  assert.throws(() => compareVersions('x', '1.0.0'), /invalid version/)
})

test('newerVersions：只留严格高于基线者，降序，跳过不可解析项', () => {
  const all = ['0.1.7-rc.2', '0.2.0-rc.1', '0.1.7-rc.1', '0.2.0-rc.2', 'garbage', '0.1.6']
  assert.deepEqual(newerVersions('0.1.7-rc.2', all), ['0.2.0-rc.2', '0.2.0-rc.1'])
  assert.deepEqual(newerVersions('0.1.7-rc.2', ['0.1.7-rc.2']), [])
})

test('tagsOf：一个版本可命中多个 dist-tag', () => {
  assert.deepEqual(tagsOf('0.2.0-rc.2', { latest: '0.2.0-rc.2', next: '0.2.0-rc.2', alpha: '0.1.7-alpha.2' }), ['latest', 'next'])
  assert.deepEqual(tagsOf('0.9.9', { latest: '0.2.0-rc.2' }), [])
})

test('readPinned：四 profile 一致 → 无漂移，baseline = 该版本', async () => {
  const root = await fakeRepo({
    master: { kernel: '@deepseek-ai/dsh@0.1.7-rc.2', bundles: { '@deepseek-ai/dsh-base': '0.1.7-rc.2', 'dsh-user': '0.0.0' } },
    minimal: { kernel: '@deepseek-ai/dsh@0.1.7-rc.2', bundles: { '@deepseek-ai/dsh-base': '0.1.7-rc.2' } },
  })
  try {
    const pinned = await readPinned(root)
    assert.equal(pinned.baseline, '0.1.7-rc.2')
    assert.deepEqual(pinned.kernelDrift, [])
    assert.deepEqual(pinned.bundleDrift, [])
    // 自研包不参与版本轴（dsh-user 0.0.0 不是漂移）
    assert.deepEqual(pinned.profiles.map((p) => p.profile), ['master', 'minimal'])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('readPinned：kernel 不一致 / 官方 bundle 落后 → 两类漂移都被机械检出', async () => {
  const root = await fakeRepo({
    master: { kernel: '@deepseek-ai/dsh@0.1.7-rc.2', bundles: { '@deepseek-ai/dsh-base': '0.1.7-rc.2' } },
    explorer: { kernel: '@deepseek-ai/dsh@0.2.0-rc.1', bundles: { '@deepseek-ai/dsh-base': '0.1.5-rc.3' } },
  })
  try {
    const pinned = await readPinned(root)
    assert.equal(pinned.baseline, '0.2.0-rc.1')
    assert.deepEqual(pinned.kernelDrift, [{ profile: 'master', version: '0.1.7-rc.2' }])
    assert.deepEqual(pinned.bundleDrift, [{ profile: 'explorer', name: '@deepseek-ai/dsh-base', version: '0.1.5-rc.3' }])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('readPinned：kernel 字段无法解析 → 报错（不静默跳过）', async () => {
  const root = await fakeRepo({ master: { kernel: 'nonsense' } })
  try {
    await assert.rejects(() => readPinned(root), /kernel 字段无法解析/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('formatReport：新版本 + dist-tag + 漂移都出现在报告里', async () => {
  const root = await fakeRepo({
    master: { kernel: '@deepseek-ai/dsh@0.1.7-rc.2', bundles: { '@deepseek-ai/dsh-base': '0.1.7-rc.2' } },
    dev: { kernel: '@deepseek-ai/dsh@0.1.7-rc.2', bundles: { '@deepseek-ai/dsh-base': '0.1.6' } },
  })
  try {
    const pinned = await readPinned(root)
    const published = { distTags: { latest: '0.2.0-rc.2', alpha: '0.1.7-alpha.2' }, versions: ['0.1.7-rc.2', '0.2.0-rc.1', '0.2.0-rc.2'] }
    const text = formatReport(buildReport(pinned, published))
    assert.match(text, /仓库基线 0\.1\.7-rc\.2/)
    assert.match(text, /latest=0\.2\.0-rc\.2/)
    assert.match(text, /0\.2\.0-rc\.2 {2}← latest/)
    assert.match(text, /仓库内漂移/)
    assert.match(text, /profiles\/dev：@deepseek-ai\/dsh-base 0\.1\.6/)
    assert.match(text, /dsh-kernel-upgrade/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('main：报告模式发现新版本仍退出 0（报告不拦人）', async () => {
  const root = await fakeRepo({ master: { kernel: `${KERNEL_PACKAGE}@0.1.7-rc.2`, bundles: {} } })
  const out = sink()
  try {
    const code = await main([], { repoRoot: root, fetchImpl: fakeFetch(['0.1.7-rc.2', '0.2.0-rc.2'], { latest: '0.2.0-rc.2' }), stdout: out.stream, stderr: sink().stream })
    assert.equal(code, EXIT.ok)
    assert.match(out.text(), /0\.2\.0-rc\.2/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('main --check：有新版本 → 退出 1（机械闸门）', async () => {
  const root = await fakeRepo({ master: { kernel: `${KERNEL_PACKAGE}@0.1.7-rc.2`, bundles: {} } })
  const err = sink()
  try {
    const code = await main(['--check'], { repoRoot: root, fetchImpl: fakeFetch(['0.1.7-rc.2', '0.2.0-rc.2']), stdout: sink().stream, stderr: err.stream })
    assert.equal(code, EXIT.outdated)
    assert.match(err.text(), /闸门未通过：有新版本 0\.2\.0-rc\.2/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('main --check：仓库内漂移 → 退出 1（即使没有新版本）', async () => {
  const root = await fakeRepo({
    master: { kernel: `${KERNEL_PACKAGE}@0.1.7-rc.2`, bundles: {} },
    dev: { kernel: `${KERNEL_PACKAGE}@0.2.0-rc.1`, bundles: {} },
  })
  const err = sink()
  try {
    const code = await main(['--check'], { repoRoot: root, fetchImpl: fakeFetch(['0.1.7-rc.2', '0.2.0-rc.1']), stdout: sink().stream, stderr: err.stream })
    assert.equal(code, EXIT.outdated)
    assert.match(err.text(), /仓库内版本漂移/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('main --check：无新版本且无漂移 → 退出 0', async () => {
  const root = await fakeRepo({ master: { kernel: `${KERNEL_PACKAGE}@0.1.7-rc.2`, bundles: {} } })
  try {
    const code = await main(['--check'], { repoRoot: root, fetchImpl: fakeFetch(['0.1.7-rc.1', '0.1.7-rc.2'], { latest: '0.1.7-rc.2' }), stdout: sink().stream, stderr: sink().stream })
    assert.equal(code, EXIT.ok)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('main：registry 不可达 → 退出 2，且明确不被当成"没有新版本"', async () => {
  const root = await fakeRepo({ master: { kernel: `${KERNEL_PACKAGE}@0.1.7-rc.2`, bundles: {} } })
  const err = sink()
  const boom = async () => { throw new Error('connect ECONNREFUSED 127.0.0.1:1') }
  try {
    const code = await main(['--check'], { repoRoot: root, fetchImpl: boom, stdout: sink().stream, stderr: err.stream })
    assert.equal(code, EXIT.failed)
    assert.match(err.text(), /检测失败.*ECONNREFUSED/)
    assert.match(err.text(), /不等于"没有新版本"/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('main：参数缺值 / 无法解析的仓库 → 退出 2', async () => {
  const err = sink()
  assert.equal(await main(['--repo'], { fetchImpl: fakeFetch([]), stdout: sink().stream, stderr: err.stream }), EXIT.failed)
  assert.match(err.text(), /--repo 缺少取值/)
  const empty = await mkdtemp(join(tmpdir(), 'dsh-kernel-empty-'))
  try {
    const code = await main(['--check'], { repoRoot: empty, fetchImpl: fakeFetch([]), stdout: sink().stream, stderr: sink().stream })
    assert.equal(code, EXIT.failed)
  } finally {
    await rm(empty, { recursive: true, force: true })
  }
})
