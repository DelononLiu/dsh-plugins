/**
 * 实例生命周期：删除（停进程 → 档案转墓碑 → 目录**归档**）与恢复（归档移回）。
 *
 * 设计约束（见实例模型 note）：
 * - 删除**可恢复**：目录移动而不是 `rm -rf`（与"管理事件可审计"一致），归档区只保留最近 N 个。
 * - 两条硬守卫：正式 `web`（3080，只读不改）与本机 `daemon`（执行面自身）**禁止删除**——
 *   删了就没有执行面去拉起别的实例了。
 * - 停止进程由调用方注入（console 各个角色停进程的方式不同：daemon 有 children/端口定位，
 *   console 走指令派发），本模块只负责"档案 + 目录"这两件确定的事，便于单测。
 */

import { cpSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { findInstance, loadRegistry, registryPath, removeInstance, saveRegistry, type InstanceEntry } from './registry.js'

/** 归档区目录：与注册表同根（`~/.dsh-home/.archive`）。 */
export function archiveRoot(): string {
  return join(dirname(registryPath()), '.archive')
}

/** 归档保留份数（可配）。 */
export function archiveKeep(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.DSH_ARCHIVE_KEEP
  const n = raw === undefined || raw === '' ? 20 : Number(raw)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 20
}

/** 删除守卫：返回拒绝原因，空 = 允许删除。 */
export function deleteGuard(entry: InstanceEntry): string | null {
  // 正式实例（3080）：DSH_HOME = ~/.dsh，只读不改。
  if (entry.home === join(process.env.HOME ?? '', '.dsh') || entry.id === 'web') {
    return `正式 web（3080）禁止删除（只读不改）`
  }
  if (entry.role === 'daemon') {
    return `本机 daemon（执行面自身）禁止删除——删了就没有执行面拉起其它实例`
  }
  return null
}

/** 归档目录名：`<id>-<ts>`（同一实例多次删除可区分，恢复取最新）。 */
export function archiveName(id: string, ts = Date.now()): string {
  return `${id}-${ts}`
}

/** 归档移入（同盘 rename；跨设备时退回复制+删除）。 */
function moveInto(from: string, to: string): void {
  mkdirSync(dirname(to), { recursive: true })
  try {
    renameSync(from, to)
  } catch {
    cpSync(from, to, { recursive: true })
    rmSync(from, { recursive: true, force: true })
  }
}

/** 删除某实例（调用方先停进程）：档案转墓碑 + 目录归档 + 归档区裁剪。 */
export function archiveInstance(
  entry: InstanceEntry,
  opts: { ts?: number; keep?: number } = {},
): { ok: boolean; error?: string; archivedAt?: string } {
  const denied = deleteGuard(entry)
  if (denied !== null) return { ok: false, error: denied }
  const profileDir = join(entry.home, 'profiles', entry.profileDir)
  const target = join(archiveRoot(), archiveName(entry.id, opts.ts))
  let archived = false
  if (existsSync(entry.home)) {
    try {
      moveInto(entry.home, target)
      archived = true
    } catch (e) {
      return { ok: false, error: `归档失败（目录未动，档案未改）：${e instanceof Error ? e.message : String(e)}` }
    }
  }
  const reg = loadRegistry()
  const live = findInstance(reg, entry.id)
  if (live !== undefined) {
    removeInstance(reg, entry.id) // 墓碑：档案保留，status=deleted + deletedAt
    if (archived) {
      live.archivedAt = target
      live.archivePath = target
    }
    saveRegistry(reg)
  }
  if (archived) pruneArchives(opts.keep)
  return { ok: true, archivedAt: archived ? target : undefined }
}

/** 归档区裁剪：只保留最近 N 个（按目录名里的时间戳排序）。 */
export function pruneArchives(keep = archiveKeep()): string[] {
  const root = archiveRoot()
  if (!existsSync(root)) return []
  const dirs = readdirSync(root)
    .filter((n) => {
      try {
        return statSync(join(root, n)).isDirectory()
      } catch {
        return false
      }
    })
    .sort((a, b) => {
      const ta = Number(a.slice(a.lastIndexOf('-') + 1))
      const tb = Number(b.slice(b.lastIndexOf('-') + 1))
      return tb - ta
    })
  const stale = dirs.slice(keep)
  for (const name of stale) rmSync(join(root, name), { recursive: true, force: true })
  return stale
}

/** 某实例的归档（最新优先；恢复取第一个）。 */
export function listArchives(id: string): string[] {
  const root = archiveRoot()
  if (!existsSync(root)) return []
  return readdirSync(root)
    .filter((n) => n.startsWith(`${id}-`))
    .sort((a, b) => Number(b.slice(b.lastIndexOf('-') + 1)) - Number(a.slice(a.lastIndexOf('-') + 1)))
    .map((n) => join(root, n))
}

/**
 * 恢复某实例（CLI 入口，见 note）：归档目录移回原 home + 档案从墓碑转回 active。
 * 目标目录已存在时拒绝（不覆盖现有实例目录——那可能是另一个活实例）。
 */
export function restoreInstance(id: string): { ok: boolean; error?: string; home?: string } {
  const reg = loadRegistry()
  const entry = findInstance(reg, id)
  if (entry === undefined) return { ok: false, error: `未知实例：${id} 不在注册表` }
  if (entry.status !== 'deleted') return { ok: false, error: `实例 ${id} 不是已删除状态（status=${entry.status}），无需恢复` }
  const archives = listArchives(id)
  if (archives.length === 0) return { ok: false, error: `实例 ${id} 没有归档可恢复（${archiveRoot()}）` }
  if (existsSync(entry.home)) return { ok: false, error: `恢复目标已存在：${entry.home}（不覆盖现有目录）` }
  const src = archives[0]
  try {
    moveInto(src, entry.home)
  } catch (e) {
    return { ok: false, error: `恢复失败：${e instanceof Error ? e.message : String(e)}` }
  }
  entry.status = 'active'
  entry.deletedAt = null
  delete entry.archivedAt
  delete entry.archivePath
  saveRegistry(reg)
  return { ok: true, home: entry.home }
}
