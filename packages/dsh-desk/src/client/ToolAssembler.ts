/**
 * dsh-desk 组装器：把全家桶 `data-dsh-*-entry` 注入型插件（task-board / ssh /
 * skill-explorer）的侧边栏入口行，从官方默认落点（logoRow 之后、工作区浏览区
 * 之前）re-parent 到侧边栏底部 footArea 顶部（ConsoleBadge「控制台」上方）。
 *
 * 机制（源码确认，2026-08-22）：这些 vendored 插件不注册官方 sidebar 插槽，
 * 而是各打包同一套 `mountSidebarEntry`（MutationObserver + 直接 DOM 注入）——
 * 等官方侧边栏渲染后把 `<button data-dsh-xxx-entry>` 插进 sidebar root
 * （`sidebarRoot()` = logoRow 的 parentElement），位置写死、无 Config。
 *
 * 组装器接管摆位（通用性，2026-08-23）：**运行时发现**全部 `[data-dsh-part="sidebar-entry"]`
 * 元素（全家桶 entry 统一标记，不限三家）——替代显式选择器列表；配置可排除
 * （`assembler.tools.<id>.visible=false` 跳过该工具摆位）。自愈兼容（源码验证）：
 * - 插件 rootObserver 只在 `!root.contains(entry)` 时重插——footArea 是 root 的
 *   子元素，re-parent 后 entry 仍在 root 内 → 不拉回；
 * - 插件 waitObserver 的 tryPlace 在 `document.body.contains(entry)` 为真时直接
 *   return——entry 仍在 body 内 → 不重插。
 *
 * CSS 回退（②）：覆盖不生效时**静默回退默认摆位**——re-parent 失败 = 保持
 * 插件原位置（logoRow 后），不抛错；本模块所有 DOM 查询失败均静默返回。
 *
 * 目标 DOM（官方 SidebarRoot.module.css，css-modules hash 类名）：
 *   .root (flex column)
 *   ├── .logoRow / .newSession
 *   ├── .regionArea            (sidebar.workspaces 插槽 = 工作区/会话浏览)
 *   └── .footArea (flex none, column)
 *       ├── .footerActions     (sidebar.footer.action 插槽 = ConsoleBadge「控制台」)
 *       └── .settingsArea      (sidebar.settings 插槽 = 设置)
 * 摆位后：entry 显示在 footArea 顶部、footerActions（控制台）之前，纵向堆叠，
 * 保持发现顺序。
 */

import type { AssembledToolId, AssemblerConfig } from '../index'

/** 全家桶 entry 统一标记（mountSidebarEntry createEntry 写入）。 */
const ENTRY_SELECTOR = '[data-dsh-part="sidebar-entry"]'

/**
 * foot 区内 entry 的样式覆盖：对齐官方侧边栏 foot 按钮契约
 * （ui-settings-general SettingsRoot.module.css `.trigger`——设置/控制台同款）：
 * 42px 行、12px 圆角、14px 字号、primary 文字、interactive-bg-hover 悬停。
 * 全家桶 entry 自带样式（32~36px/8px/13px/secondary）是为「工作区上面」的行
 * 设计的，re-parent 到 foot 区后须与同区按钮统一。选择器限定 footArea 内 +
 * data-dsh-part（全家桶 entry 统一标记），特异性高于插件 css-modules 类。
 * Rail（折叠）态对齐官方 `.trigger.rail`：36px 圆、仅图标。
 *
 * 间距（③ 配置化）：foot 区各行（entry/控制台/设置）统一为
 * `margin: {footSpacing}px -2px`（行间 2×footSpacing，默认 2px = 行间 4px，
 * 用户反馈官方 4px 上下边距间隔过大）；折叠态恢复官方 rail 的
 * `margin: 8px 0 10px`（覆盖规则在后面、特异性更高，折叠态优先）。
 */
function footCss(footSpacing: number): string {
  const spacing = Number.isFinite(footSpacing) && footSpacing >= 0 ? footSpacing : 2
  return [
    `[class*="footArea"] [data-dsh-part="sidebar-entry"]{box-sizing:border-box;flex:none;display:flex;align-items:center;gap:8px;width:calc(100% + 4px);height:42px;margin:${spacing}px -2px;padding:0 10px 0 8px;border:none;border-radius:12px;background:transparent;cursor:pointer;overflow:hidden;color:var(--dsw-alias-label-primary);font-family:inherit;font-size:14px;line-height:22px}`,
    '[class*="footArea"] [data-dsh-part="sidebar-entry"]:hover{background:var(--dsw-alias-interactive-bg-hover)}',
    `[class*="footArea"] [class*="trigger"]{margin:${spacing}px -2px}`,
    '[class*="collapsed"] [data-dsh-part="sidebar-entry"]{width:36px;height:36px;margin:8px 0 10px;justify-content:center;gap:0;padding:0;border-radius:50%}',
    '[class*="collapsed"] [data-dsh-part="sidebar-entry"] [class*="entryLabel"]{display:none}',
    '[class*="collapsed"] [class*="footArea"] [class*="trigger"]{margin:8px 0 10px}',
  ].join('')
}

/** 幂等注入样式（bundle 加载即执行，与 ConsoleBadge 同机制）。返回移除函数。 */
function injectEntryFootCss(footSpacing: number): () => void {
  if (typeof document === 'undefined' || document.querySelector('style[data-plugin-css="@dsh-desk/tool-assembler"]')) return () => {}
  const tag = document.createElement('style')
  tag.dataset.plugin = 'dsh-desk'
  tag.dataset.pluginCss = '@dsh-desk/tool-assembler'
  tag.textContent = footCss(footSpacing)
  document.head.appendChild(tag)
  return () => tag.remove()
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

/**
 * 组装器配置读取（③）：settings 快照里的 assembler（footSpacing + tools 排除）。
 * settings 缺席/未 ready 时回退默认（全可见、2px）。
 */
function resolveAssembler(snapshot: unknown): AssemblerConfig {
  const value = snapshot as { value?: { assembler?: AssemblerConfig } } | undefined
  const assembler = value?.value?.assembler
  return {
    footSpacing: assembler?.footSpacing ?? 2,
    tools: assembler?.tools ?? {},
  }
}

/** 组装器 disposer。 */
export type ToolAssemblerDisposer = () => void

/**
 * 启动工具入口组装器：观察 body，等 entry + footArea 都出现后摆位。
 * @param snapshot - 当前 settings 快照（读 assembler 配置；可传 undefined 用默认）。
 * @param subscribe - settings 订阅入口（可选：配置变更时重读并重摆位/重注入 CSS）。
 * @param getSnapshot - settings 快照读取（配合 subscribe；变更回调里读新配置）。
 * @returns disposer（断开观察器；entry 留在 footArea，由插件自身 dispose 清理）。
 */
export function startToolAssembler(
  snapshot?: unknown,
  subscribe?: (fn: () => void) => () => void,
  getSnapshot?: () => unknown,
): ToolAssemblerDisposer {
  let config = resolveAssembler(snapshot)
  let removeCss = injectEntryFootCss(config.footSpacing)

  /** 工具是否被配置排除（tools.<id>.visible=false → 不摆位）。 */
  const excluded = (entry: HTMLElement): boolean => {
    const id = toolIdOf(entry)
    return id !== undefined && config.tools[id]?.visible === false
  }

  const tryPlace = (): void => {
    const root = sidebarRoot()
    if (root === null) return
    const foot = footAreaOf(root)
    if (foot === null) return
    // 锚点 = footerActions（或 footArea 首个子元素兜底）；发现的 entry 依次插到
    // 锚点前，保持发现顺序、都在控制台上方。配置排除的不摆位（留在插件原位置）。
    const anchor = footerActionsOf(foot) ?? foot.firstElementChild
    const entries = Array.from(root.querySelectorAll<HTMLElement>(ENTRY_SELECTOR))
    for (const entry of entries) {
      if (entry.parentElement === foot || excluded(entry)) continue
      if (anchor !== null) foot.insertBefore(entry, anchor)
      else foot.appendChild(entry)
    }
  }

  /**
   * 配置变更（设置页改间距/工具显隐）：重读配置 → 重注入 CSS（间距变化）+
   * 重摆位（新排除的移回默认落点 logoRow 后、恢复的重新摆位）。
   */
  const onSettingsChange = (): void => {
    if (getSnapshot === undefined) return
    const next = resolveAssembler(getSnapshot())
    const spacingChanged = next.footSpacing !== config.footSpacing
    const toolsChanged = JSON.stringify(next.tools) !== JSON.stringify(config.tools)
    if (!spacingChanged && !toolsChanged) return
    config = next
    if (spacingChanged) {
      removeCss()
      removeCss = injectEntryFootCss(config.footSpacing)
    }
    const root = sidebarRoot()
    if (root === null) return
    const foot = footAreaOf(root)
    if (foot === null) return
    const anchor = footerActionsOf(foot) ?? foot.firstElementChild
    const logoRow = root.querySelector('[class*="logoRow"]')
    const entries = Array.from(root.querySelectorAll<HTMLElement>(ENTRY_SELECTOR))
    for (const entry of entries) {
      if (entry.parentElement !== foot) continue // 未摆位的交给 tryPlace 处理
      if (excluded(entry)) {
        // 新排除：移回插件默认落点（logoRow 后）；找不到则留在 foot（静默回退）。
        if (logoRow !== null && logoRow.nextSibling !== null) root.insertBefore(entry, logoRow.nextSibling)
      } else if (anchor !== null) {
        foot.insertBefore(entry, anchor) // 保持顺序（已在该处的 insertBefore 无副作用）
      }
    }
    tryPlace()
  }

  tryPlace()
  const observer = new MutationObserver(() => { tryPlace() })
  observer.observe(document.body, { childList: true, subtree: true })
  const unsubscribe = subscribe === undefined ? () => {} : subscribe(onSettingsChange)
  return () => {
    observer.disconnect()
    unsubscribe()
    removeCss()
  }
}

/** 从 entry 的 data 属性推断工具 id（data-dsh-taskboard-entry → taskboard）。 */
function toolIdOf(entry: HTMLElement): AssembledToolId | undefined {
  for (const attr of Array.from(entry.attributes)) {
    const m = /^data-dsh-(.+)-entry$/.exec(attr.name)
    if (m === null) continue
    const id = m[1]
    if (id === 'taskboard' || id === 'ssh' || id === 'skill') return id
  }
  return undefined
}
