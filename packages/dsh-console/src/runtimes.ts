/**
 * runtime 版本池：官方内核（及其官方依赖）的**共享只读母版**。
 *
 * 模型（见 `.agents/notes/proposed/architecture/2026-09-13-console-instance-model.md`）：
 * - 池目录 `~/.dsh-runtimes/<dsh 版本>/`（`$DSH_RUNTIMES` 可覆盖）——**只增不改**：
 *   建成后不可变，需要新版本就导入新目录（就地改会破坏所有引用它的实例）。
 * - 池里**只有官方 runtime**（`@deepseek-ai/*` 及其依赖闭包），不含自研/社区包——那半边随实例安装。
 * - 实例通过**软链**引用池：`<实例 profile>/node_modules/@deepseek-ai/*` → 池内同名目录。
 *   因此**升级 = 切软链**（秒级、可逆），回滚 = 切回旧引用。
 *
 * 导入用硬链接拷贝（`cp -al`）：秒级且不额外占盘；同一版本重复导入被拒绝（不可变）。
 */

import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { hostId, instancesUsingVersion, loadRegistry } from './registry.js'

const MARKER = '.dsh-runtime.json'

/** 池根目录：`$DSH_RUNTIMES` 覆盖，缺省 `~/.dsh-runtimes`。 */
export function poolRoot(env: NodeJS.ProcessEnv = process.env): string {
  return env.DSH_RUNTIMES || join(env.HOME || homedir(), '.dsh-runtimes')
}

/** 某个版本的池目录。 */
export function runtimeDir(version: string, env: NodeJS.ProcessEnv = process.env): string {
  return join(poolRoot(env), version)
}

/** 池内某版本是否已导入（判据 = 标记文件 + 官方内核包在位）。 */
export function runtimeReady(version: string, env: NodeJS.ProcessEnv = process.env): boolean {
  return existsSync(join(runtimeDir(version, env), MARKER))
}

/** 池内已导入的版本（按名排序；只看带标记的目录，池里放别的东西不会被当成版本）。 */
export function listRuntimes(env: NodeJS.ProcessEnv = process.env): string[] {
  const root = poolRoot(env)
  if (!existsSync(root)) return []
  return readdirSync(root)
    .filter((n) => existsSync(join(root, n, MARKER)))
    .sort()
}

/** 读官方内核包版本（`<dir>/node_modules/@deepseek-ai/dsh/package.json`）。 */
function officialKernelVersion(dir: string): string | null {
  const pkg = join(dir, 'node_modules', '@deepseek-ai', 'dsh', 'package.json')
  if (!existsSync(pkg)) return null
  try {
    return (JSON.parse(readFileSync(pkg, 'utf8')) as { version?: string }).version ?? null
  } catch {
    return null
  }
}

/** 池内版本与其来源的版本一致性（机械校验漂移，而不是靠约定）。 */
export function verifyRuntime(version: string, env: NodeJS.ProcessEnv = process.env): { ok: boolean; error?: string } {
  const dir = runtimeDir(version, env)
  if (!runtimeReady(version, env)) return { ok: false, error: `版本未在池：${version}（${dir}）` }
  const actual = officialKernelVersion(dir)
  if (actual === null) return { ok: false, error: `池内版本 ${version} 缺少官方内核包（node_modules/@deepseek-ai/dsh）` }
  if (actual !== version) return { ok: false, error: `池内版本漂移：目录 ${version} 内实际为 ${actual}（池不可变，请重新导入新版本号）` }
  return { ok: true }
}

/**
 * 导入一个版本到池（默认来源 = 现有独立 CLI `~/dsh-alpha5-cli`）。
 * 拒绝：来源版本与版本号不符 / 该版本已存在（池不可变）。
 */
export function importRuntime(input: { version: string; source?: string; env?: NodeJS.ProcessEnv }): { ok: boolean; error?: string; dir?: string } {
  const env = input.env ?? process.env
  const source = input.source ?? join(env.HOME || homedir(), 'dsh-alpha5-cli')
  const dir = runtimeDir(input.version, env)
  const sourceVersion = officialKernelVersion(source)
  if (sourceVersion === null) return { ok: false, error: `来源不是官方 runtime 安装（缺 node_modules/@deepseek-ai/dsh）：${source}` }
  if (sourceVersion !== input.version) {
    return { ok: false, error: `来源版本不符：期望 ${input.version}，实际 ${sourceVersion}（来源 ${source}）` }
  }
  if (existsSync(dir)) {
    return { ok: false, error: `版本已存在（池不可变）：${input.version}——请删除该版本或改用新版本号` }
  }
  mkdirSync(poolRoot(env), { recursive: true })
  // 硬链接拷贝（秒级、不额外占盘）；不支持时退回普通拷贝。
  try {
    execFileSync('cp', ['-al', source, dir], { stdio: 'pipe' })
  } catch {
    cpSync(source, dir, { recursive: true })
  }
  writeFileSync(
    join(dir, MARKER),
    `${JSON.stringify({ version: input.version, source, importedAt: new Date().toISOString(), host: hostId(env) }, null, 2)}\n`,
  )
  return { ok: true, dir }
}

/** 删除池内版本；**被实例引用则拒绝**（引用完整性优先于磁盘清理）。 */
export function removeRuntime(version: string, env: NodeJS.ProcessEnv = process.env): { ok: boolean; error?: string } {
  const dir = runtimeDir(version, env)
  if (!existsSync(dir)) return { ok: false, error: `版本未在池：${version}` }
  const users = instancesUsingVersion(loadRegistry(), version)
  if (users.length > 0) {
    return { ok: false, error: `版本被实例引用，拒绝删除：${version}（实例 ${users.join(', ')}）` }
  }
  rmSync(dir, { recursive: true, force: true })
  return { ok: true }
}

/** 官方包作用域（池里只有这一半；自研/社区包随实例安装）。 */
const OFFICIAL_SCOPE = '@deepseek-ai'

/**
 * 把实例 profile 的官方包**软链到池**（= 建立/切换引用）。
 * 只动 `<profileDir>/node_modules/@deepseek-ai` 下的条目；自研/社区包原样保留。
 */
export function linkRuntimeInto(profileDir: string, version: string, env: NodeJS.ProcessEnv = process.env): { ok: boolean; error?: string; linked?: number } {
  const check = verifyRuntime(version, env)
  if (!check.ok) return { ok: false, error: check.error }
  const poolScope = join(runtimeDir(version, env), 'node_modules', OFFICIAL_SCOPE)
  if (!existsSync(poolScope)) return { ok: false, error: `池内版本 ${version} 缺少 ${OFFICIAL_SCOPE} 作用域` }
  const targetScope = join(profileDir, 'node_modules', OFFICIAL_SCOPE)
  mkdirSync(targetScope, { recursive: true })
  let linked = 0
  for (const name of readdirSync(poolScope)) {
    const target = join(targetScope, name)
    // 目标可能是真目录（升级前的自带安装）或旧软链——先摘掉再链当前版本。
    try {
      if (lstatSync(target).isDirectory() && !lstatSync(target).isSymbolicLink()) rmSync(target, { recursive: true, force: true })
      else unlinkSync(target)
    } catch {
      /* 不存在 → 无需清理 */
    }
    symlinkSync(join(poolScope, name), target)
    linked += 1
  }
  return { ok: true, linked }
}

/**
 * 实例当前引用的池版本；实例自带安装（非软链）时返回 null。
 * 判据 = `@deepseek-ai/dsh` 软链目标落在池内哪个版本目录。
 */
export function currentRuntimeVersion(profileDir: string, env: NodeJS.ProcessEnv = process.env): string | null {
  const link = join(profileDir, 'node_modules', OFFICIAL_SCOPE, 'dsh')
  let target: string
  try {
    if (!lstatSync(link).isSymbolicLink()) return null
    target = readlinkSync(link)
  } catch {
    return null
  }
  const m = /^(.+)[/\\]node_modules[/\\]@deepseek-ai[/\\][^/\\]+$/.exec(target)
  if (m === null) return null
  const root = poolRoot(env)
  const version = m[1].slice(root.length + 1)
  return m[1].startsWith(root) && version !== '' ? version : null
}
