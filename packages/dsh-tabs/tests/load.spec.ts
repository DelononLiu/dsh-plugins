/**
 * dsh-tabs 加载测试：host 插件可加载（settings 服务缺席时跳过注册）。
 */

import { describe, expect, it } from 'vitest'
import { apply } from '../src/index.ts'

describe('dsh-tabs host 入口', () => {
  it('settings 服务缺席时 apply 可调用且无异常', () => {
    const ctx = {
      inject(_deps: string[], _cb: (ctx: unknown) => void): void {
        // settings 缺席：不调用回调（等价于 ctx.inject 可选注入的跳过路径）。
      },
    } as never
    expect(() => apply(ctx)).not.toThrow()
  })

  it('settings 服务存在时注册固定会话命名空间', () => {
    let registered: unknown
    const settings = {
      register(ns: unknown, schema: unknown): void {
        registered = { ns, schema }
      },
    }
    const ctx = {
      inject(_deps: string[], cb: (ctx: { settings: typeof settings }) => void): void {
        cb({ settings })
      },
    } as never
    expect(() => apply(ctx)).not.toThrow()
    expect(registered).toBeDefined()
    expect((registered as { ns: unknown }).ns).toMatch(/dsh-tabs-pinned/)
  })
})
