/**
 * dsh-quick-nav client 测试：顶栏入口常驻注册（布局配置面随 dsh-desk 一并移除，
 * 入口不再有条件注册/注销）。
 */

import { describe, expect, it } from 'vitest'
import { apply } from '../src/client/index.ts'

/** mock ClientContext（apply 只需要 slots）。 */
function makeCtx() {
  const registered: string[] = []
  let disposeInject: (() => void) | undefined
  const ctx = {
    slots: {
      inject(_slot: string, cb: () => (() => void) | void): void {
        const dispose = cb()
        registered.push('inject')
        if (typeof dispose === 'function') disposeInject = dispose
      },
      register(): () => void {
        registered.push('register')
        return () => { registered.push('unregister') }
      },
    },
  } as never
  return {
    ctx,
    registered: () => registered.join(','),
    disposeInject: () => disposeInject?.(),
  }
}

describe('dsh-quick-nav client 入口注册', () => {
  it('无条件注册会话头部入口', () => {
    const { ctx, registered } = makeCtx()
    apply(ctx)
    expect(registered()).toBe('register,inject')
  })

  it('inject 的 disposer 同时下线注册', () => {
    const { ctx, registered, disposeInject } = makeCtx()
    apply(ctx)
    disposeInject()
    expect(registered()).toBe('register,inject,unregister')
  })
})
