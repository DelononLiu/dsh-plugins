/**
 * dsh-quick-nav client 测试：topbar.visible 实时控制入口注册/注销。
 */

import { describe, expect, it } from 'vitest'
import { apply } from '../src/client/index.ts'

/** mock ClientContext（apply 需要 settingsScope + slots）。 */
function makeCtx(initial: { topbar?: { visible?: boolean } }) {
  let value = { layout: initial }
  const listeners: Array<() => void> = []
  const registered: string[] = []
  const scope = {
    bind() {
      return {
        getSnapshot: () => ({ value }),
        subscribe: (fn: () => void) => { listeners.push(fn); return () => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1) } },
      }
    },
  }
  const ctx = {
    settingsScope: scope,
    slots: {
      inject(_slot: string, cb: () => void): void {
        const dispose = cb()
        // inject 返回 disposer（注册/注销组合）——这里记录调用
        registered.push('inject')
        // 让 disposer 可被测试驱动（记录到外部）
        ;(ctx as never as { __dispose?: () => void }).__dispose = dispose
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
    setLayout: (layout: { topbar?: { visible?: boolean } }) => { value = { layout }; for (const fn of [...listeners]) fn() },
  }
}

describe('dsh-quick-nav client 布局注册', () => {
  it('topbar.visible=true（默认）：注册会话头部入口', () => {
    const { ctx, registered } = makeCtx({ topbar: { visible: true } })
    apply(ctx)
    expect(registered()).toContain('register')
  })

  it('topbar.visible=false：不注册（初始即隐藏）', () => {
    const { ctx, registered } = makeCtx({ topbar: { visible: false } })
    apply(ctx)
    // inject 回调执行但 sync 判断 visible=false → 不 register
    expect(registered()).toBe('inject')
  })

  it('layout 配置缺席：默认注册', () => {
    const { ctx, registered } = makeCtx({})
    apply(ctx)
    expect(registered()).toContain('register')
  })

  it('配置切换：true→false 注销、false→true 重新注册（实时）', () => {
    const { ctx, registered, setLayout } = makeCtx({ topbar: { visible: true } })
    apply(ctx)
    expect(registered()).toBe('register,inject')

    setLayout({ topbar: { visible: false } })
    expect(registered()).toBe('register,inject,unregister')

    setLayout({ topbar: { visible: true } })
    expect(registered()).toBe('register,inject,unregister,register')
  })
})
