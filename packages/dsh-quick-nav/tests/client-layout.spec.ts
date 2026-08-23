/**
 * dsh-quick-nav client 测试：布局配置 topbar.visible=false 时不注册入口。
 */

import { describe, expect, it } from 'vitest'
import { apply } from '../src/client/index.ts'

/** mock ClientContext（apply 需要 settingsScope + slots）。 */
function makeCtx(layout: { topbar?: { visible?: boolean } }) {
  let registered = 0
  const scope = {
    bind() {
      return {
        getSnapshot: () => ({ value: { layout } }),
      }
    },
  }
  const ctx = {
    settingsScope: scope,
    slots: {
      inject(_slot: string, cb: () => void): void {
        registered++
        cb()
      },
      register(): () => void {
        return () => {}
      },
    },
  } as never
  return { ctx, registered: () => registered }
}

describe('dsh-quick-nav client 布局注册', () => {
  it('topbar.visible=true（默认）：注册会话头部入口', () => {
    const { ctx, registered } = makeCtx({ topbar: { visible: true } })
    apply(ctx)
    expect(registered()).toBe(1)
  })

  it('topbar.visible=false：不注册', () => {
    const { ctx, registered } = makeCtx({ topbar: { visible: false } })
    apply(ctx)
    expect(registered()).toBe(0)
  })

  it('layout 配置缺席：默认注册', () => {
    const { ctx, registered } = makeCtx({})
    apply(ctx)
    expect(registered()).toBe(1)
  })
})
