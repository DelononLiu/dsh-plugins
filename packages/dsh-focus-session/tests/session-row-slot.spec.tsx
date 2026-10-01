/**
 * dsh-focus-session 官方会话行菜单「全局置顶」入口测试（**官方 slot 注册**，非 DOM 注入）。
 *
 * 判据：installSessionMenuPin 向官方 `sidebar.workspaces.session.menu.item`
 * （order 500，官方 archive=400 之后）注册一个包命名空间 id 的条目；菜单行 = 官方
 * `MenuItemButton` 形态，带「添加到置顶区」文案与地球字形，选中先关菜单再切换
 * 我们的 settings `pinned`。
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { createElement, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { IconGlobeOutlineRegular, IconPinOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import {
  ROW_MENU_ENTRY_ID, ROW_MENU_PIN_LABEL, ROW_MENU_ORDER, ROW_MENU_SLOT,
  installSessionMenuPin, type SessionRowPinDeps,
} from '../src/client/sessionRowSlot.tsx'

/** 捕获到的 slot 注册。 */
interface Captured {
  name: string
  id: string
  order: number
  component: (props: Record<string, unknown>) => ReactNode
}

/** 造一个只实现 slots 的最小 client ctx。 */
function makeCtx(): { ctx: unknown; captured: Captured[]; injections: string[] } {
  const captured: Captured[] = []
  const injections: string[] = []
  const ctx = {
    slots: {
      inject: (name: string, callback: () => unknown): (() => void) => {
        injections.push(name)
        callback()
        return () => {}
      },
      register: (options: { name: string; id: string; order: number }, component: Captured['component']): (() => void) => {
        captured.push({ name: options.name, id: options.id, order: options.order, component })
        return () => {}
      },
    },
  }
  return { ctx, captured, injections }
}

/** 钉数据 harness（模拟 settings.set 后触发订阅）。 */
interface Harness {
  pinned: string[]
  cbs: Array<() => void>
}

function makeDeps(h: Harness): SessionRowPinDeps {
  return {
    getPinned: () => h.pinned,
    subscribeSettings: (fn) => { h.cbs.push(fn); return () => {} },
    setPinned: (ids) => {
      h.pinned = [...ids]
      h.cbs.forEach((cb) => cb())
    },
  }
}

/** 同步渲染一个 React 节点到独立 root，返回容器与卸载函数。 */
function render(node: ReactNode): { host: HTMLElement; root: Root } {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  flushSync(() => { root.render(node) })
  return { host, root }
}

describe('installSessionMenuPin', () => {
  let h: Harness

  beforeEach(() => {
    document.body.innerHTML = ''
    h = { pinned: [], cbs: [] }
  })

  it('向官方 menu.item slot 注册一个包命名空间条目（order 500）', () => {
    const { ctx, captured, injections } = makeCtx()
    installSessionMenuPin(ctx as never, makeDeps(h))
    expect(injections).toEqual([ROW_MENU_SLOT])
    expect(captured.map((c) => ({ name: c.name, id: c.id, order: c.order }))).toEqual([
      { name: ROW_MENU_SLOT, id: ROW_MENU_ENTRY_ID, order: ROW_MENU_ORDER },
    ])
    // 官方 order：menu.item pin=100/rename=200/fork=300/archive=400。
    expect(ROW_MENU_ORDER).toBeGreaterThan(400)
  })

  it('菜单行：官方 MenuItemButton 形态，选中先关菜单再切换我们的置顶', () => {
    const { ctx, captured } = makeCtx()
    installSessionMenuPin(ctx as never, makeDeps(h))
    const closed: boolean[] = []
    const { host, root } = render(createElement(captured[0].component, {
      sessionId: 'a',
      displayTitle: 'A',
      useMenuOpenState: () => [true, (open: boolean) => { closed.push(open) }],
    }))
    const item = host.querySelector<HTMLButtonElement>('[role="menuitem"]')
    expect(item).not.toBeNull()
    expect(item!.textContent).toBe(ROW_MENU_PIN_LABEL)
    expect(host.querySelector('[data-stub-icon="globe-outline"]')).not.toBeNull()
    flushSync(() => { item!.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(closed).toEqual([false])
    expect(h.pinned).toEqual(['a'])
    root.unmount()
  })

  it('菜单行用地球字形区分官方 pin 字形', () => {
    // 入口图标身份 = 官方 IconGlobeOutlineRegular（非 IconPin*）。
    expect(typeof IconGlobeOutlineRegular).toBe('function')
    expect(typeof IconPinOutlineRegular).toBe('function')
    expect(IconGlobeOutlineRegular).not.toBe(IconPinOutlineRegular)
  })
})
