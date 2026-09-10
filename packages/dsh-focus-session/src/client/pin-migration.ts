/**
 * 钉住数据迁移决策（纯函数，便于单测）——旧命名空间 `dsh-tabs-pinned`
 * → `dsh-focus-pinned`。
 *
 * 为什么是"决策"而不是直接读两次快照：settings scope 的 `value` 在 mirror 完成
 * `settings.describe()`（异步）之前是 `undefined`，所以 apply 时同步读到的两个快照
 * 都可能是空——据此判定"无需迁移"会让用户的钉永久留在旧命名空间。调用方须等到
 * 旧命名空间 `status === 'ready'` 再决策。
 *
 * 清空旧命名空间是必需的一步：迁移后若旧值仍在，"全部取消钉"（新列表为空、旧列表
 * 非空）会在下一次加载时被误判为"尚未迁移"，把旧钉整批复活。
 */

/** 一次迁移决策的结果。 */
export interface PinMigrationPlan {
  /** 决策是否已可落定（true 时调用方落下闩锁，不再重试；false = 快照未就绪）。 */
  done: boolean
  /** 要写入新命名空间的钉列表；空数组 = 不写（含"无需迁移"与"以新值为准"）。 */
  pinned: string[]
  /** 是否清空旧命名空间（搬走之后必须清，否则旧钉可能复活）。 */
  clearLegacy: boolean
}

/**
 * 计算一次迁移动作。
 * @param nextPinned - 新命名空间当前钉列表（非空时以它为准，只清旧值不覆盖）。
 * @param legacyStatus - 旧命名空间的 scope 状态（`'ready'` 才可读）。
 * @param legacyPinned - 旧命名空间当前钉列表。
 * @returns 迁移决策。
 */
export function planPinMigration(
  nextPinned: readonly string[],
  legacyStatus: string | undefined,
  legacyPinned: readonly string[],
): PinMigrationPlan {
  if (legacyStatus !== 'ready') return { done: false, pinned: [], clearLegacy: false }
  if (legacyPinned.length === 0) return { done: true, pinned: [], clearLegacy: false }
  return {
    done: true,
    pinned: nextPinned.length === 0 ? [...legacyPinned] : [],
    clearLegacy: true,
  }
}
