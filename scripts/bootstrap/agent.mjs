#!/usr/bin/env node
/**
 * dsh bootstrap：远程主机引导脚本（SSH 一次性引导 → 装最小 agent）。
 *
 * 部署链路（已定）：SSH（仅一次性引导）→ 装最小 agent → 之后全走
 * agent/channel。最小 agent = 发行包 headless host 实例（agent 组件集：
 * dsh-base + dsh-channel + dsh-user，无 console/UI——执行面）。
 *
 * 本脚本在控制面侧生成 agent 部署物（profile 模板 + 实例令牌 + SSH
 * 引导命令序列），供 console/运维执行：
 *   1. 生成实例令牌（32 hex，bootstrap 时注入 agent，注册/心跳校验）
 *   2. 生成 agent profile（headless 最小集 + 令牌配置 + patch 层）
 *   3. 输出 SSH 引导命令（推发行包 → 起 headless 实例 → agent 注册）
 *
 * 用法：node scripts/bootstrap/agent.mjs --instance-id <id> --host <user@host> [--version <v>]
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { randomBytes } from 'node:crypto'

const AGENT_BUNDLES = ['@deepseek-ai/dsh-base', 'dsh-channel', 'dsh-user']

function parseArgs(argv) {
  const args = {}
  for (let i = 2; i < argv.length; i++) {
    const m = /^--([a-z-]+)(?:=(.*))?$/.exec(argv[i])
    if (!m) continue
    args[m[1]] = m[2] ?? argv[++i]
  }
  if (!args['instance-id'] || !args.host) {
    console.error('用法: node scripts/bootstrap/agent.mjs --instance-id <id> --host <user@host> [--version <v>]')
    process.exit(2)
  }
  return args
}

/** 生成实例令牌（32 hex，bootstrap 注入 agent）。 */
export function generateToken() {
  return randomBytes(16).toString('hex')
}

/**
 * 生成 agent profile 目录（发行包最小集 + 令牌配置）。
 * @param instanceId - 实例 id。
 * @param token - 实例令牌。
 * @param version - 发行包版本（lock 引用）。
 * @returns 生成的目录路径。
 */
export async function buildAgentProfile(instanceId, token, version = '0.0.0') {
  const dir = resolve(`agent-${instanceId}`)
  await mkdir(dir, { recursive: true })
  await writeFile(resolve(dir, 'package.json'), JSON.stringify({
    name: `dsh-agent-${instanceId}`,
    private: true,
    version,
    dsh: { profile: { bundles: AGENT_BUNDLES } },
  }, null, 2) + '\n')
  await writeFile(resolve(dir, 'cordis.yml'), '[]\n')
  await writeFile(resolve(dir, 'cordis.patch.yml'), [
    '# agent 最小集补丁层：实例令牌注入（注册/心跳校验）。',
    `- { "id": "dsh-channel", "config": { "tokens": { "${instanceId}": "${token}" } } }`,
  ].join('\n') + '\n')
  return dir
}

/**
 * 生成 SSH 引导命令序列（一次性引导：推发行包最小集 → 起 headless 实例）。
 * @param host - SSH 目标（user@host）。
 * @param instanceId - 实例 id。
 * @param version - 发行包版本。
 * @returns 命令数组。
 */
export function buildSshCommands(host, instanceId, version) {
  const dir = `agent-${instanceId}`
  return [
    `scp -r ${dir} ${host}:~/.dsh-agent-${instanceId}`,
    `ssh ${host} 'cd ~/.dsh-agent-${instanceId} && dsh bootstrap --profile agent-${instanceId} --version ${version}'`,
    `ssh ${host} 'echo "agent ${instanceId} 引导完成；已启动 headless host 实例，将向 console 注册"'`,
  ]
}

async function main() {
  const args = parseArgs(process.argv)
  const token = generateToken()
  const dir = await buildAgentProfile(args['instance-id'], token, args.version)
  const commands = buildSshCommands(args.host, args['instance-id'], args.version ?? '0.0.0')
  console.log(`[bootstrap] 实例令牌（保存至 agent profile，勿外泄）: ${token}`)
  console.log(`[bootstrap] agent profile 已生成: ${dir}`)
  console.log('[bootstrap] SSH 引导命令序列:')
  for (const cmd of commands) console.log(`  $ ${cmd}`)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main()
}
