/** 模板（profiles/）测试：四个模板名齐、三件套一致、minimal = 官方默认、无旧名残留。 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = new URL('../..', import.meta.url).pathname
const PROFILES = join(ROOT, 'profiles')
const NAMES = ['dev', 'explorer', 'master', 'minimal']
const FILES = ['cordis.patch.yml', 'dsh.lock.json', 'package.json']

const json = (p) => JSON.parse(readFileSync(p, 'utf8'))
const text = (p) => readFileSync(p, 'utf8')

/** 改名前的启用清单（master/dev/explorer 分别来自旧 web/web2/web3）——改名不改组合。 */
const EXPECTED_BUNDLES = {
  master: [
    '@deepseek-ai/dsh-base',
    '@deepseek-ai/dsh-web-app',
    'dsh-user',
    'dsh-channel',
    'dsh-console',
    'dsh-quick-nav',
    'dsh-focus-session',
    'dsh-focus-tabs',
    'dsh-desk',
    'dsh-better-sidebar',
    '@linxin666/dsh-client-ui-git-graph',
    '@linxin666/dsh-ssh',
    '@linxin666/dsh-client-ui-task-board',
    '@linxin666/dsh-client-ui-skill-explorer',
  ],
  dev: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'dsh-desk'],
  explorer: [
    '@deepseek-ai/dsh-base',
    '@deepseek-ai/dsh-web-app',
    'dsh-user',
    'dsh-channel',
    'dsh-console',
    'dsh-quick-nav',
    'dsh-focus-session',
    'dsh-focus-tabs',
  ],
}

test('模板集合 = master/dev/explorer/minimal，旧名已不存在', () => {
  const dirs = readdirSync(PROFILES, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort()
  assert.deepEqual(dirs, NAMES)
})

test('每个模板三件套齐', () => {
  for (const n of NAMES) {
    const files = readdirSync(join(PROFILES, n)).sort()
    assert.deepEqual(files, FILES, `${n} 的文件集合不合规`)
  }
})

test('目录名 = package.json name 后缀 = lock id 后缀；lock.name 非空', () => {
  for (const n of NAMES) {
    const pkg = json(join(PROFILES, n, 'package.json'))
    const lock = json(join(PROFILES, n, 'dsh.lock.json'))
    assert.equal(pkg.name, `dsh-profile-${n}`, `${n}: package.json name 与目录名不一致`)
    assert.equal(lock.id, `dsh-distro-${n}`, `${n}: lock id 与目录名不一致`)
    assert.equal(lock.schemaVersion, 1)
    assert.ok(lock.name && lock.name.length > 0, `${n}: lock.name 不能为空`)
    assert.match(lock.kernel, /^@deepseek-ai\/dsh@/, `${n}: lock.kernel 形态不符`)
  }
})

test('启用清单被版本锁覆盖', () => {
  for (const n of NAMES) {
    const bundles = json(join(PROFILES, n, 'package.json')).dsh.profile.bundles
    const locked = Object.keys(json(join(PROFILES, n, 'dsh.lock.json')).bundles)
    for (const b of bundles) assert.ok(locked.includes(b), `${n}: ${b} 未进 dsh.lock.json`)
  }
})

test('改名不改组合：master/dev/explorer 的启用清单与旧模板一致', () => {
  for (const [n, expected] of Object.entries(EXPECTED_BUNDLES)) {
    const bundles = json(join(PROFILES, n, 'package.json')).dsh.profile.bundles
    assert.deepEqual(bundles, expected, `${n} 的启用清单被改动了`)
  }
})

test('minimal = 官方默认（base + web-app），patch 不插入自研插件', () => {
  const pkg = json(join(PROFILES, 'minimal', 'package.json'))
  assert.deepEqual(pkg.dsh.profile.bundles, ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'])
  const locked = Object.keys(json(join(PROFILES, 'minimal', 'dsh.lock.json')).bundles).sort()
  assert.deepEqual(locked, ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'])
  const patch = text(join(PROFILES, 'minimal', 'cordis.patch.yml'))
  assert.ok(!patch.includes('insert:'), 'minimal 的 patch 不得插入任何插件')
})

test('AGENTS.md 与 docs 不再引用旧模板路径', () => {
  const stale = ['profiles/web2', 'profiles/web3', 'profiles/web|', 'profiles/{web']
  for (const f of ['AGENTS.md', 'docs/architecture.md']) {
    const body = text(join(ROOT, f))
    for (const s of stale) assert.ok(!body.includes(s), `${f} 仍引用旧模板路径：${s}`)
  }
})
