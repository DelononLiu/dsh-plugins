/**
 * Pure functions for session status display (pinned strip & UI rows).
 * Provides status dot logic, pending interaction normalization, and subagent counting.
 */

export type PendingInteractionKind = 'approval' | 'plan-review' | 'question'

/** 从字符串 kind 归一化；非三值返回 undefined。 */
export function normalizePendingKind(kind: unknown): PendingInteractionKind | undefined {
  if (typeof kind !== 'string') return undefined
  if (kind === 'approval' || kind === 'plan-review' || kind === 'question') {
    return kind
  }
  return undefined
}

export interface SummaryRow {
  displayTitle?: string
  running?: boolean
  completed?: boolean
  blank?: boolean
  parentId?: string
  origin?: string
  updatedAt?: number
}

export type DotState = 'warning' | 'ongoing' | 'done'

export interface RowStatusView {
  dot: DotState | undefined
  label: string
}

/** 优先级与官方 sessionStatuses 一致：
 *   pending: approval→'等待审批' / plan-review→'等待 plan 评审' / question→'等待你回复'（dot='warning'）
 *   否则 running→'运行中'（'ongoing'）
 *   否则 子代理运行数>0 → n===1?'1 个子代理运行':`${n} 个子代理运行`（'ongoing'）
 *   否则 completed→'已完成'（'done'）
 *   否则 → dot=undefined、label='空闲' */
export function resolveRowStatus(f: {
  pendingKind?: PendingInteractionKind
  running?: boolean
  runningSubagentCount: number
  completed?: boolean
}): RowStatusView {
  const { pendingKind, running, runningSubagentCount, completed } = f

  // pending has highest priority
  if (pendingKind === 'approval') {
    return { dot: 'warning', label: '等待审批' }
  }
  if (pendingKind === 'plan-review') {
    return { dot: 'warning', label: '等待 plan 评审' }
  }
  if (pendingKind === 'question') {
    return { dot: 'warning', label: '等待你回复' }
  }

  // running
  if (running) {
    return { dot: 'ongoing', label: '运行中' }
  }

  // subagent running count
  if (runningSubagentCount > 0) {
    const label = runningSubagentCount === 1
      ? '1 个子代理运行'
      : `${runningSubagentCount} 个子代理运行`
    return { dot: 'ongoing', label }
  }

  // completed
  if (completed) {
    return { dot: 'done', label: '已完成' }
  }

  // idle/default
  return { dot: undefined, label: '空闲' }
}

/** 照 subagent-lineage.ts：统计每个祖先会话「running 的 subagent 后代数」。返回 Map<祖先id, 数>。只数 running 后代即可（count 不需要）。 */
export function indexRunningSubagents(
  rows: ReadonlyArray<{ id: string; parentId?: string; origin?: string; running?: boolean }>,
): ReadonlyMap<string, number> {
  const byId = new Map(rows.map(r => [r.id, r]))
  const indexed = new Map<string, number>()
  for (const descendant of rows) {
    if (descendant.origin !== 'subagent') continue
    if (!descendant.running) continue
    const seen = new Set<string>()
    let current: { id: string; parentId?: string; origin?: string } | undefined = descendant
    while (current !== undefined && current.origin === 'subagent' && current.parentId !== undefined && !seen.has(current.id)) {
      seen.add(current.id)
      indexed.set(current.parentId, (indexed.get(current.parentId) ?? 0) + 1)
      current = byId.get(current.parentId)
    }
  }
  return indexed
}