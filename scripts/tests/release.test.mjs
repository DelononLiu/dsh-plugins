/** release 脚本测试：lock bump（自研 bump、官方不动、rc 推进）。 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { bumpLock } from '../release/bump.mjs'

const LOCK = {
  schemaVersion: 1,
  id: 'dsh-distro-test',
  name: 'test',
  version: '0.0.0',
  kernel: '@deepseek-ai/dsh@0.1.0-rc.8',
  bundles: {
    '@deepseek-ai/dsh-base': '0.1.0-rc.8',
    'dsh-user': '0.0.0',
    'dsh-channel': '0.1.0-rc.1',
    '@linxin666/dsh-web-ui-all': '0.2.5',
  },
  vendored: {},
}

test('bumpLock patch：自研 bump、官方/社区不动', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-lock-'))
  const file = join(dir, 'dsh.lock.json')
  await writeFile(file, JSON.stringify(LOCK))
  try {
    const { changed } = await bumpLock(file, 'patch')
    assert.deepEqual(changed, ['dsh-user: 0.0.0 → 0.0.1', 'dsh-channel: 0.1.0-rc.1 → 0.1.0-rc.2'])
    const updated = JSON.parse(await readFile(file, 'utf8'))
    assert.equal(updated.bundles['dsh-user'], '0.0.1')
    assert.equal(updated.bundles['@deepseek-ai/dsh-base'], '0.1.0-rc.8')
    assert.equal(updated.bundles['@linxin666/dsh-web-ui-all'], '0.2.5')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('bumpLock minor：次版本推进', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-lock-'))
  const file = join(dir, 'dsh.lock.json')
  await writeFile(file, JSON.stringify(LOCK))
  try {
    const { changed } = await bumpLock(file, 'minor')
    assert.ok(changed.some((c) => c.startsWith('dsh-user: 0.0.0 → 0.1.0')))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
