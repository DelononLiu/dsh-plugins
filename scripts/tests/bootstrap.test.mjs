/** bootstrap 脚本测试：令牌生成 / agent profile / SSH 命令序列。 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { generateToken, buildAgentProfile, buildSshCommands } from '../bootstrap/agent.mjs'

test('generateToken 返回 32 hex', () => {
  const token = generateToken()
  assert.match(token, /^[0-9a-f]{32}$/)
})

test('buildAgentProfile 生成最小集 profile（base+channel+user + 令牌 patch）', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-agent-'))
  try {
    const out = await buildAgentProfile('inst1', 'tok', '0.1.0')
    const pkg = JSON.parse(await readFile(join(out, 'package.json'), 'utf8'))
    assert.deepEqual(pkg.dsh.profile.bundles, ['@deepseek-ai/dsh-base', 'dsh-channel', 'dsh-user'])
    const patch = await readFile(join(out, 'cordis.patch.yml'), 'utf8')
    assert.match(patch, /inst1/)
    assert.match(patch, /tok/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('buildSshCommands 输出引导序列（推送 + bootstrap + 确认）', () => {
  const cmds = buildSshCommands('user@10.0.0.1', 'inst1', '0.1.0')
  assert.equal(cmds.length, 3)
  assert.match(cmds[0], /^scp -r agent-inst1 user@10\.0\.0\.1:~/)
  assert.match(cmds[1], /dsh bootstrap --profile agent-inst1 --version 0\.1\.0/)
})
