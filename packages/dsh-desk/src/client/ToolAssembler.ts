/**
 * dsh-desk 组装器：把全家桶 `data-dsh-*-entry` 注入型插件（task-board / ssh /
 * skill-explorer）的侧边栏入口行，从官方默认落点（logoRow 之后、工作区浏览区
 * 之前）re-parent 到侧边栏底部 footArea 顶部（ConsoleBadge「控制台」上方）。
 *
 * 机制（源码确认，2026-08-22）：这三个 vendored 插件不注册官方 sidebar 插槽，
 * 而是各打包同一套 `mountSidebarEntry`（MutationObserver + 直接 DOM 注入）——
 * 等官方侧边栏渲染后把 `<button data-dsh-xxx-entry>` 插进 sidebar root
 * （`sidebarRoot()` = logoRow 的 parentElement），位置写死、无 Config。
 *
 * dsh-desk 作为组装器接管摆位：等 entry 与官方 footArea 都出现后移动元素。
 * 自愈兼容（源码验证）：
 * - 插件 rootObserver 只在 `!root.contains(entry)` 时重插——footArea 是 root 的
 *   子元素，re-parent 后 entry 仍在 root 内 → 不拉回；
 * - 插件 waitObserver 的 tryPlace 在 `document.body.contains(entry)` 为真时直接
 *   return——entry 仍在 body 内 → 不重插。
 *
 * 目标 DOM（官方 SidebarRoot.module.css，css-modules hash 类名）：
 *   .root (flex column)
 *   ├── .logoRow / .newSession
 *   ├── .regionArea            (sidebar.workspaces 插槽 = 工作区/会话浏览)
 *   └── .footArea (flex none, column)
 *       ├── .footerActions     (sidebar.footer.action 插槽 = ConsoleBadge「控制台」)
 *       └── .settingsArea      (sidebar.settings 插槽 = 设置)
 * 摆位后：entry 显示在 footArea 顶部、footerActions（控制台）之前，纵向堆叠，
 * 保持 taskboard → ssh → skill 顺序。
 */

/** 全家桶 entry 行选择器（与各 vendored client.js 的 data 属性一致）。 */
const TOOL_ENTRY_SELECTORS = [
  '[data-dsh-taskboard-entry]',
  '[data-dsh-ssh-entry]',
  '[data-dsh-skill-explorer-entry]',
]

/** 官方侧边栏根（与 vendored sidebarRoot() 同策略：logoRow 的 parentElement）。 */
function sidebarRoot(): HTMLElement | null {
  const column = document.querySelector('[data-pane="sidebar"], [class*="sidebarCol"]')
  if (column === null) return null
  return column.querySelector('[class*="logoRow"]')?.parentElement
    ?? (column.firstElementChild as HTMLElement | null)
}

/** 官方 footArea（SidebarRoot.module.css .footArea）。 */
function footAreaOf(root: HTMLElement): HTMLElement | null {
  return root.querySelector('[class*="footArea"]')
}

/** footerActions 锚点：entry 插到它前面（footArea 内、控制台按钮上方）。 */
function footerActionsOf(foot: HTMLElement): HTMLElement | null {
  return foot.querySelector('[class*="footerActions"]')
}

/** 组装器 disposer。 */
export type ToolAssemblerDisposer = () => void

/**
 * 启动工具入口组装器：观察 body，等 entry + footArea 都出现后摆位。
 * @returns disposer（断开观察器；entry 留在 footArea，由插件自身 dispose 清理）。
 */
export function startToolAssembler(): ToolAssemblerDisposer {
  const tryPlace = (): void => {
    const root = sidebarRoot()
    if (root === null) return
    const foot = footAreaOf(root)
    if (foot === null) return
    // 锚点 = footerActions（或 footArea 首个子元素兜底）；三个 entry 依次插到
    // 锚点前，保持 taskboard → ssh → skill 顺序、都在控制台上方。
    const anchor = footerActionsOf(foot) ?? foot.firstElementChild
    for (const selector of TOOL_ENTRY_SELECTORS) {
      const entry = root.querySelector<HTMLElement>(selector)
      if (entry === null || entry.parentElement === foot) continue
      if (anchor !== null) foot.insertBefore(entry, anchor)
      else foot.appendChild(entry)
    }
  }
  tryPlace()
  const observer = new MutationObserver(() => { tryPlace() })
  observer.observe(document.body, { childList: true, subtree: true })
  return () => observer.disconnect()
}
