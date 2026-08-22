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

/**
 * foot 区内 entry 的样式覆盖：对齐官方侧边栏 foot 按钮契约
 * （ui-settings-general SettingsRoot.module.css `.trigger`——设置/控制台同款）：
 * 42px 行、12px 圆角、14px 字号、primary 文字、interactive-bg-hover 悬停。
 * 全家桶 entry 自带样式（32~36px/8px/13px/secondary）是为「工作区上面」的行
 * 设计的，re-parent 到 foot 区后须与同区按钮统一。选择器限定 footArea 内 +
 * data-dsh-part（全家桶 entry 统一标记），特异性高于插件 css-modules 类。
 * Rail（折叠）态对齐官方 `.trigger.rail`：36px 圆、仅图标。
 *
 * 间距：foot 区各行（entry/控制台/设置）统一收紧为 `margin: 2px -2px`
 * （行间 4px，用户反馈官方 4px 上下边距间隔过大）；折叠态恢复官方 rail
 * 的 `margin: 8px 0 10px`（覆盖规则在后面、特异性更高，折叠态优先）。
 */
const TOOL_ENTRY_FOOT_CSS = [
  '[class*="footArea"] [data-dsh-part="sidebar-entry"]{box-sizing:border-box;flex:none;display:flex;align-items:center;gap:8px;width:calc(100% + 4px);height:42px;margin:2px -2px;padding:0 10px 0 8px;border:none;border-radius:12px;background:transparent;cursor:pointer;overflow:hidden;color:var(--dsw-alias-label-primary);font-family:inherit;font-size:14px;line-height:22px}',
  '[class*="footArea"] [data-dsh-part="sidebar-entry"]:hover{background:var(--dsw-alias-interactive-bg-hover)}',
  '[class*="footArea"] [class*="trigger"]{margin:2px -2px}',
  '[class*="collapsed"] [data-dsh-part="sidebar-entry"]{width:36px;height:36px;margin:8px 0 10px;justify-content:center;gap:0;padding:0;border-radius:50%}',
  '[class*="collapsed"] [data-dsh-part="sidebar-entry"] [class*="entryLabel"]{display:none}',
  '[class*="collapsed"] [class*="footArea"] [class*="trigger"]{margin:8px 0 10px}',
].join('')

/** 幂等注入样式（bundle 加载即执行，与 ConsoleBadge 同机制）。 */
function injectEntryFootCss(): void {
  if (typeof document === 'undefined' || document.querySelector('style[data-plugin-css="@dsh-desk/tool-assembler"]')) return
  const tag = document.createElement('style')
  tag.dataset.plugin = 'dsh-desk'
  tag.dataset.pluginCss = '@dsh-desk/tool-assembler'
  tag.textContent = TOOL_ENTRY_FOOT_CSS
  document.head.appendChild(tag)
}

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
  injectEntryFootCss()
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
