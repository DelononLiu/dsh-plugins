/**
 * dsh-desk 布局消费方测试：sidebar.visible 配置 → 折叠/展开官方侧边栏。
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { startLayoutConsumer, type LayoutConsumerDisposer } from '../src/client/LayoutConsumer.ts'

/** 模拟官方侧边栏容器（AppFrame 折叠时加 data-sidebar-collapsed）。 */
function buildSidebarColumn(): HTMLElement {
  const column = document.createElement('div')
  column.dataset.pane = 'sidebar'
  document.body.appendChild(column)
  return column
}

/** 模拟 settings 快照 + 订阅（可编程切换配置）。 */
function makeSettings(initial: unknown) {
  let value = initial
  const listeners: Array<() => void> = []
  return {
    set(v: unknown): void { value = v; for (const fn of listeners) fn() },
    getSnapshot: () => value,
    subscribe: (fn: () => void) => { listeners.push(fn); return () => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1) } },
  }
}

/** 模拟官方 ctx.layout（toggleSidebar 翻转 data-sidebar-collapsed）。 */
function makeLayout() {
  let toggles = 0
  return {
    layout: {
      toggleSidebar(): void {
        toggles++
        const el = document.querySelector('[data-pane="sidebar"]')
        if (el !== null) {
          if (el.hasAttribute('data-sidebar-collapsed')) el.removeAttribute('data-sidebar-collapsed')
          else el.setAttribute('data-sidebar-collapsed', '')
        }
      },
    },
    toggles: () => toggles,
  }
}

const LAYOUT_SHOWN = { value: { layout: { topbar: { visible: true }, tabs: { visible: true }, sidebar: { visible: true }, actions: { visible: true } } } }
const LAYOUT_HIDDEN = { value: { layout: { topbar: { visible: true }, tabs: { visible: true }, sidebar: { visible: false }, actions: { visible: true } } } }

describe('startLayoutConsumer', () => {
  let disposers: Array<LayoutConsumerDisposer>

  beforeEach(() => {
    buildSidebarColumn()
    disposers = []
  })

  afterEach(() => {
    for (const d of disposers) d()
    document.body.innerHTML = ''
  })

  it('sidebar.visible=false：折叠一次（toggleSidebar 被调）', () => {
    const { layout, toggles } = makeLayout()
    const settings = makeSettings(LAYOUT_HIDDEN)
    disposers.push(startLayoutConsumer(layout, settings.subscribe, settings.getSnapshot))
    expect(toggles()).toBe(1)
    expect(document.querySelector('[data-pane="sidebar"]')?.hasAttribute('data-sidebar-collapsed')).toBe(true)
  })

  it('sidebar.visible=true（默认）：不折叠', () => {
    const { layout, toggles } = makeLayout()
    const settings = makeSettings(LAYOUT_SHOWN)
    disposers.push(startLayoutConsumer(layout, settings.subscribe, settings.getSnapshot))
    expect(toggles()).toBe(0)
    expect(document.querySelector('[data-pane="sidebar"]')?.hasAttribute('data-sidebar-collapsed')).toBe(false)
  })

  it('配置从可见切到隐藏：再折叠；切回可见：展开', () => {
    const { layout, toggles } = makeLayout()
    const settings = makeSettings(LAYOUT_SHOWN)
    disposers.push(startLayoutConsumer(layout, settings.subscribe, settings.getSnapshot))
    expect(toggles()).toBe(0)

    settings.set(LAYOUT_HIDDEN)
    expect(toggles()).toBe(1)
    expect(document.querySelector('[data-pane="sidebar"]')?.hasAttribute('data-sidebar-collapsed')).toBe(true)

    settings.set(LAYOUT_SHOWN)
    expect(toggles()).toBe(2)
    expect(document.querySelector('[data-pane="sidebar"]')?.hasAttribute('data-sidebar-collapsed')).toBe(false)
  })

  it('配置缺席（无 layout）：不动侧边栏', () => {
    const { layout, toggles } = makeLayout()
    const settings = makeSettings({ value: {} })
    disposers.push(startLayoutConsumer(layout, settings.subscribe, settings.getSnapshot))
    expect(toggles()).toBe(0)
  })

  it('disposer 退订后配置变更不再作用', () => {
    const { layout, toggles } = makeLayout()
    const settings = makeSettings(LAYOUT_HIDDEN)
    const dispose = startLayoutConsumer(layout, settings.subscribe, settings.getSnapshot)
    expect(toggles()).toBe(1)
    dispose()
    settings.set(LAYOUT_SHOWN)
    expect(toggles()).toBe(1)
  })
})
