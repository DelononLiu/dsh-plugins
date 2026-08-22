/**
 * dsh-quick-nav 加载测试：host 插件可加载（webServer 缺席跳过；存在时注册实例数据面）。
 */

import { describe, expect, it } from 'vitest'
import { apply } from '../src/index.ts'

describe('dsh-quick-nav host 入口', () => {
  it('webServer 缺席时 apply 可调用且无异常', () => {
    const ctx = {
      inject(_deps: string[], _cb: (ctx: unknown) => void): void {
        // 可选注入缺席：不调用回调。
      },
    } as never
    expect(() => apply(ctx)).not.toThrow()
  })

  it('webServer 存在时注册实例数据面路由', () => {
    let registered: unknown
    const webServer = {
      register(route: { path: string; handler: (req: unknown, res: unknown) => void }): void {
        registered = route
      },
    }
    const channel = { list: () => [] }
    const ctx = {
      inject(_deps: string[], cb: (c: { webServer: typeof webServer; channel: typeof channel }) => void): void {
        cb({ webServer, channel })
      },
    } as never
    expect(() => apply(ctx)).not.toThrow()
    expect((registered as { path: string }).path).toBe('/api/quick-nav/instances')
  })
})
