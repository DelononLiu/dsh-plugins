/**
 * 钉住数据迁移决策测试：等 scope 就绪才决策、搬走后清旧值（防「全部取消钉」后
 * 旧钉复活）、新值优先不覆盖。
 */

import { describe, expect, it } from 'vitest'
import { planPinMigration } from '../src/client/pin-migration.ts'

describe('planPinMigration', () => {
  it('旧 scope 未就绪时不决策（保持闩锁未落）', () => {
    expect(planPinMigration([], 'loading', ['a'])).toEqual({ done: false, pinned: [], clearLegacy: false })
    expect(planPinMigration([], undefined, ['a']).done).toBe(false)
    expect(planPinMigration([], 'unavailable', ['a']).done).toBe(false)
  })

  it('旧值为空：完成但不写新值、不清旧值', () => {
    expect(planPinMigration([], 'ready', [])).toEqual({ done: true, pinned: [], clearLegacy: false })
  })

  it('新值为空时搬旧钉过来，并清空旧命名空间', () => {
    expect(planPinMigration([], 'ready', ['a', 'b']))
      .toEqual({ done: true, pinned: ['a', 'b'], clearLegacy: true })
  })

  it('新值非空时以新值为准（只清旧值，不覆盖用户新数据）', () => {
    expect(planPinMigration(['x'], 'ready', ['a']))
      .toEqual({ done: true, pinned: [], clearLegacy: true })
  })

  it('「全部取消钉」之后不会被误判为待迁移（旧值已清空）', () => {
    expect(planPinMigration([], 'ready', []).pinned).toEqual([])
    expect(planPinMigration([], 'ready', []).clearLegacy).toBe(false)
  })
})
