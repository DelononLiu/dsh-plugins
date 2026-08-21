#!/usr/bin/env node
/**
 * dsh release：版本矩阵 bump（发行包整体推进）。
 *
 * 发行包 = 内核 rc.x + 自研插件 x.y + 社区插件 a.b 的锁定组合（已定）。
 * 本脚本读取 profiles/ 下各 profile 的 dsh.lock.json，bump 自研包版本并
 * 同步（跟随 DSH rc 整体升级，不散装）。
 *
 * 用法：node scripts/release/bump.mjs [--patch|--minor|--major] [--rc <n>]
 */

import { readFile, readdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const SELF_PREFIXES = ['dsh-', 'dst-']

function parseVersion(v) {
  const m = /^(\d+)\.(\d+)\.(\d+)(?:-rc\.(\d+))?$/.exec(v)
  if (!m) throw new Error(`invalid version: ${v}`)
  return { major: +m[1], minor: +m[2], patch: +m[3], rc: m[4] ? +m[4] : undefined }
}

function bumpVersion(v, kind) {
  const p = parseVersion(v)
  if (p.rc !== undefined) {
    // rc 阶段：只推进 rc 序号。
    return `${p.major}.${p.minor}.${p.patch}-rc.${p.rc + 1}`
  }
  if (kind === 'major') return `${p.major + 1}.0.0`
  if (kind === 'minor') return `${p.major}.${p.minor + 1}.0`
  return `${p.major}.${p.minor}.${p.patch + 1}`
}

/** 判断是否为自研家族包（dsh- 或 dst- 前缀；@deepseek-ai 官方/社区按 lock 锁定不动）。 */
function isSelf(name) {
  return SELF_PREFIXES.some((p) => name.startsWith(p))
}

/**
 * 对单个 lock 文件执行 bump：自研包版本 +1，官方/社区保持锁定。
 * @param file - profiles/<p>/dsh.lock.json 路径。
 * @param kind - patch|minor|major。
 * @returns 变更摘要。
 */
export async function bumpLock(file, kind) {
  const lock = JSON.parse(await readFile(file, 'utf8'))
  const changed = []
  for (const [name, version] of Object.entries(lock.bundles ?? {})) {
    if (!isSelf(name)) continue
    const next = bumpVersion(version, kind)
    lock.bundles[name] = next
    changed.push(`${name}: ${version} → ${next}`)
  }
  await writeFile(file, JSON.stringify(lock, null, 2) + '\n')
  return { id: lock.id, changed }
}

async function main() {
  const args = process.argv.slice(2)
  const kind = (args.find((a) => /^--(patch|minor|major)$/.test(a)) ?? '--patch').slice(2)
  const profilesDir = resolve('profiles')
  const files = (await readdir(profilesDir)).filter((d) => !d.startsWith('.')).map((d) => resolve(profilesDir, d, 'dsh.lock.json'))
  const summaries = []
  for (const file of files) {
    try {
      const s = await bumpLock(file, kind)
      summaries.push(s)
      console.log(`[release] ${s.id}（${kind}）:`)
      for (const c of s.changed) console.log(`  ${c}`)
    } catch {
      // 非 lock 文件或读取失败跳过
    }
  }
  if (summaries.length === 0) console.error('[release] 未找到 dsh.lock.json')
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main()
}
