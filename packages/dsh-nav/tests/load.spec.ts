/**
 * dsh-nav 加载测试：host 插件可加载（纯 UI 插件，apply 无副作用）。
 */

import { describe, expect, it } from 'vitest'
import { apply } from '../src/index.ts'

describe('dsh-nav host 入口', () => {
  it('apply 可调用且无异常', () => {
    expect(() => apply()).not.toThrow()
  })
})
