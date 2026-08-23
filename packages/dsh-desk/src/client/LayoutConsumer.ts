/**
 * dsh-desk 布局消费方：让「布局显隐」配置真正生效。
 *
 * 机制（2026-08-23，源码确认）：
 * - 官方无 topbar 区域；quick-nav 在 `conversation.session.header.actions`、
 *   tabs 在 `conversation.view`——这两个由各自插件读同一 `my-ui-layout`
 *   配置决定是否注册（跨插件契约 = 共享 settings，见 dsh-tabs / dsh-quick-nav）。
 * - sidebar 是官方 `slots.register('sidebar')` 占位，dsh-desk 不替换官方整列；
 *   官方 `ctx.layout` 仅 `toggleSidebar()`（翻转），AppFrame 折叠时给容器加
 *   `data-sidebar-collapsed` 属性——本模块读该属性对齐翻转语义，避免状态错乱。
 *
 * 职责：订阅 `my-ui-layout` 快照，`sidebar.visible=false` 且当前未折叠 →
 * 调 `ctx.layout.toggleSidebar()` 折叠一次；`visible=true` 且已折叠 → 展开。
 * 配置缺席/未 ready 时不动（保持官方默认展开）。
 */

import type { LayoutRecord } from './LayoutControl'

/** 布局配置读取（缺省全部可见）。 */
function resolveLayout(snapshot: unknown): LayoutRecord | undefined {
  const value = snapshot as { value?: { layout?: LayoutRecord } } | undefined
  return value?.value?.layout
}

/** 官方折叠状态：AppFrame 在折叠时给 sidebar 容器加 data-sidebar-collapsed。 */
function sidebarCollapsed(): boolean {
  return typeof document !== 'undefined'
    && document.querySelector('[data-sidebar-collapsed]') !== null
}

/** 布局消费方 disposer。 */
export type LayoutConsumerDisposer = () => void

/**
 * 启动布局消费方：订阅 settings 变更，按 sidebar.visible 折叠/展开官方侧边栏。
 * @param layout - 官方 ctx.layout（toggleSidebar）。
 * @param subscribe - settings 订阅入口（注入以便测试）。
 * @param getSnapshot - 当前 settings 快照读取。
 * @returns disposer（退订）。
 */
export function startLayoutConsumer(
  layout: { toggleSidebar(): void },
  subscribe: (fn: () => void) => () => void,
  getSnapshot: () => unknown,
): LayoutConsumerDisposer {
  /** 上一次应用的 visible（undefined = 尚未应用）。 */
  let applied: boolean | undefined

  const sync = (): void => {
    const layoutConfig = resolveLayout(getSnapshot())
    if (layoutConfig === undefined) return
    const desired = layoutConfig.sidebar.visible
    if (desired === applied) return
    const collapsed = sidebarCollapsed()
    if (desired && collapsed) layout.toggleSidebar()
    else if (!desired && !collapsed) layout.toggleSidebar()
    applied = desired
  }

  sync()
  const unsubscribe = subscribe(sync)
  return () => {
    unsubscribe()
    applied = undefined
  }
}
