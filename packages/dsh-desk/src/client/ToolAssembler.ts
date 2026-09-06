/**
 * dsh-desk 组装器：把全家桶 `data-dsh-*-entry` 注入型插件（task-board / ssh /
 * skill-explorer）的入口，从官方默认落点（logoRow 之后、工作区浏览区之前）
 * re-parent 到侧边栏底部 footArea 顶部（ConsoleBadge「控制台」上方）。
 *
 * 摆位目标（2026 分段）：
 * - **任务看板**（task-board）→ **顶部会话头 ⚙快捷导航 右侧**（footArea 不进、
 *   原始入口 `display:none` 隐藏、新建顶部按钮转发点击）；无可用顶部目标
 *   （quick-nav 未装 / 无会话头）时回退 → footArea 顶部。
 * - **SSH / 技能中心 / 其它 data-dsh-part entry** → footArea 顶部（控制台上方），不变。
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
 * **任务看板顶部摆位为何不移动插件原始节点**（2026，插件自愈冲突）：task-board
 * 入口由它自己的 `mountSidebarEntry` 维护，MutationObserver 自愈——一旦发现入口
 * `!root.contains(entry)` 就 re-insert 回侧边栏根；若把入口 DOM 移出侧边栏根
 * （如移进会话头），插件拉回 + 组装器再搬会互相打架（无限 DOM 抖动）。故顶部
 * 摆位 = **隐藏插件原始入口**（保留在侧边栏根内、`display:none`，自愈不触发）+
 * **新建一个顶部按钮**（非插件节点，插到 quick-nav root span 之后）；点击顶部按钮
 * 对隐藏原始入口 `.click()` 转发（原始入口的 click 监听照旧打开看板）。
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
 * 顶部目标 DOM（会话头）：dsh-quick-nav QuickNav 渲染 root
 * `<span data-dsh-quicknav>`，其 parentElement（headerActions 容器、display:contents）
 * 即顶部按钮落点；按钮插在 quick-nav root span 之后（其右侧）。
 */

import type { AssembledToolId, AssemblerConfig } from '../index'

/** 全家桶 entry 统一标记（mountSidebarEntry createEntry 写入）。 */
const ENTRY_SELECTOR = '[data-dsh-part="sidebar-entry"]'

/** 快捷导航组件本体锚点（dsh-quick-nav QuickNav root span 带此属性）。 */
const QUICKNAV_SELECTOR = '[data-dsh-quicknav]'

/** 任务看板顶部按钮标记（自建非插件节点，防止 discovery 再处理）。 */
const TOP_BUTTON_SELECTOR = '[data-dsh-desk-top-taskboard]'

/** 任务看板插件原始入口（隐藏后作为点击转发目标）。 */
const TASKBOARD_SELECTOR = '[data-dsh-taskboard-entry]'

/**
 * foot 区内 entry 的样式覆盖：对齐官方侧边栏 foot 按钮契约
 * （ui-settings-general SettingsRoot.module.css `.trigger`——设置/控制台同款）：
 * 42px 行、12px 圆角、14px 字号、primary 文字、interactive-bg-hover 悬停。
 * 全家桶 entry 自带样式（32~36px/8px/13px/secondary）是为「工作区上面」的行
 * 设计的，re-parent 到 foot 区后须与同区按钮统一。选择器限定 footArea 内 +
 * data-dsh-part（全家桶 entry 统一标记），特异性高于插件 css-modules 类。
 * Rail（折叠）态对齐官方 `.trigger.rail`：36px 圆、仅图标。
 *
 * 间距：foot 区各行（entry/控制台/设置）统一为 `margin: 2px -2px`
 * （行间 4px，用户反馈官方 4px 上下边距间隔过大）；折叠态恢复官方 rail
 * 的 `margin: 8px 0 10px`（覆盖规则在后面、特异性更高，折叠态优先）。
 */
function footCss(): string {
  return [
    '[class*="footArea"] [data-dsh-part="sidebar-entry"]{box-sizing:border-box;flex:none;display:flex;align-items:center;gap:8px;width:calc(100% + 4px);height:42px;margin:2px -2px;padding:0 10px 0 8px;border:none;border-radius:12px;background:transparent;cursor:pointer;overflow:hidden;color:var(--dsw-alias-label-primary);font-family:inherit;font-size:14px;line-height:22px}',
    '[class*="footArea"] [data-dsh-part="sidebar-entry"]:hover{background:var(--dsw-alias-interactive-bg-hover)}',
    '[class*="footArea"] [class*="trigger"]{margin:2px -2px}',
    '[class*="collapsed"] [data-dsh-part="sidebar-entry"]{width:36px;height:36px;margin:8px 0 10px;justify-content:center;gap:0;padding:0;border-radius:50%}',
    '[class*="collapsed"] [data-dsh-part="sidebar-entry"] [class*="entryLabel"]{display:none}',
    '[class*="collapsed"] [class*="footArea"] [class*="trigger"]{margin:8px 0 10px}',
  ].join('')
}

/** 幂等注入样式（bundle 加载即执行，与 ConsoleBadge 同机制）。返回移除函数。 */
function injectEntryFootCss(): () => void {
  if (typeof document === 'undefined' || document.querySelector('style[data-plugin-css="@dsh-desk/tool-assembler"]')) return () => {}
  const tag = document.createElement('style')
  tag.dataset.plugin = 'dsh-desk'
  tag.dataset.pluginCss = '@dsh-desk/tool-assembler'
  tag.textContent = footCss()
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

/** 收集已连接(connected) quick-nav 的 parentElement（每个容器 = 一个顶部按钮落点）。 */
function topTargets(): HTMLElement[] {
  const seen = new Set<HTMLElement>()
  const out: HTMLElement[] = []
  for (const qnav of Array.from(document.querySelectorAll<HTMLElement>(QUICKNAV_SELECTOR))) {
    if (!qnav.isConnected) continue
    const container = qnav.parentElement
    if (container === null || seen.has(container)) continue
    seen.add(container)
    out.push(container)
  }
  return out
}

/**
 * 把 entry 座位到「侧边栏根默认位」（logoRow 之后、regionArea 之前，与插件默认
 * 落点一致）。用于排除隐藏 / 任务看板顶部隐藏——entry 保留在侧边栏根内
 * （root.contains 为真 → 插件自愈不触发），仅做显示隐藏。
 */
function seatDefault(entry: HTMLElement, root: HTMLElement): void {
  const region = root.querySelector<HTMLElement>('[class*="regionArea"]')
  if (region === null) {
    if (entry.parentElement !== root) root.appendChild(entry)
    return
  }
  if (entry.parentElement !== root || entry.nextElementSibling !== region) {
    root.insertBefore(entry, region)
  }
}

/** 新建任务看板顶部按钮（非插件节点，点击转发到隐藏原始入口）。 */
function makeTopButton(): HTMLButtonElement {
  const btn = document.createElement('button')
  btn.type = 'button'
  btn.dataset.dshDeskTopTaskboard = ''
  btn.dataset.dshPlugin = 'task-board'
  btn.title = '任务看板'
  btn.setAttribute('aria-label', '任务看板')
  btn.textContent = '任务看板'
  // 视觉对齐容器里的快捷导航按钮（QuickNav root button 同款：compact/inline-flex）。
  Object.assign(btn.style, {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '4px',
    padding: '2px 6px',
    borderRadius: '4px',
    border: 'none',
    background: 'transparent',
    color: 'inherit',
    fontFamily: 'inherit',
    fontSize: '12px',
    cursor: 'pointer',
  })
  // 点击转发：对隐藏原始入口 .click()（找不到则 no-op），行为与原生一致。
  btn.addEventListener('click', () => {
    document.querySelector<HTMLElement>(TASKBOARD_SELECTOR)?.click()
  })
  return btn
}

/** 每个 quick-nav 容器维护一个顶部按钮（幂等：重复调用不重复创建）。 */
function syncTopButtons(containers: HTMLElement[]): void {
  // 清掉已失效容器的按钮（容器被 React 重建/移除 / 已不在活动集合）。
  for (const btn of Array.from(document.querySelectorAll<HTMLElement>(TOP_BUTTON_SELECTOR))) {
    const container = btn.parentElement
    if (container === null || !containers.includes(container)) btn.remove()
  }
  // 为尚无按钮的活动容器补建，插在 quick-nav root span 之后（其右侧）。
  for (const container of containers) {
    if (container.querySelector<HTMLElement>(TOP_BUTTON_SELECTOR) !== null) continue
    const qnav = container.querySelector<HTMLElement>(QUICKNAV_SELECTOR)
    const btn = makeTopButton()
    if (qnav !== null) qnav.insertAdjacentElement('afterend', btn)
    else container.appendChild(btn)
  }
}

/** 移除全部顶部按钮（无顶部摆位时清场）。 */
function removeAllTopButtons(): void {
  for (const btn of Array.from(document.querySelectorAll<HTMLElement>(TOP_BUTTON_SELECTOR))) btn.remove()
}

/**
 * 组装器配置读取（③）：settings 快照里的 assembler.tools（工具排除）。
 * settings 缺席/未 ready 时回退默认（全可见）。
 */
function resolveAssembler(snapshot: unknown): AssemblerConfig {
  const value = snapshot as { value?: { assembler?: AssemblerConfig } } | undefined
  const assembler = value?.value?.assembler
  return {
    tools: assembler?.tools ?? {},
    slots: assembler?.slots ?? {},
  }
}

/** 组装器 disposer。 */
export type ToolAssemblerDisposer = () => void

/**
 * 启动工具入口组装器：观察 body，等 entry / footArea / 顶部容器出现后摆位。
 * @param snapshot - 当前 settings 快照（读 assembler 配置；可传 undefined 用默认）。
 * @param subscribe - settings 订阅入口（可选：配置变更时重读并重摆位）。
 * @param getSnapshot - settings 快照读取（配合 subscribe；变更回调里读新配置）。
 * @returns disposer（断开观察器、移除顶部按钮、恢复任务看板原始入口显隐；
 *   entry 留在 footArea / 侧边栏根，由插件自身 dispose 清理）。
 */
export function startToolAssembler(
  snapshot?: unknown,
  subscribe?: (fn: () => void) => () => void,
  getSnapshot?: () => unknown,
): ToolAssemblerDisposer {
  let config = resolveAssembler(snapshot)
  const removeCss = injectEntryFootCss()

  /** 工具是否被配置排除（tools.<id>.visible=false → 彻底隐藏）。 */
  const excluded = (entry: HTMLElement): boolean => {
    const id = toolIdOf(entry)
    return id !== undefined && config.tools[id]?.visible === false
  }

  /** 幂等 reconcile：按当前配置 + 当前 DOM 摆到最终态（重入安全）。 */
  const placeAll = (): void => {
    const root = sidebarRoot()
    if (root === null) return
    const foot = footAreaOf(root)
    const topContainers = topTargets()
    const topMode = topContainers.length > 0

    const entries = Array.from(root.querySelectorAll<HTMLElement>(ENTRY_SELECTOR))
    let taskboard: HTMLElement | null = null
    for (const entry of entries) {
      if (toolIdOf(entry) === 'taskboard') { taskboard = entry; break }
    }
    // 任务看板有可用顶部目标（quick-nav 容器 + 未排除）→ 顶部摆位。
    const tbTop = taskboard !== null && !excluded(taskboard) && topMode

    // 一、逐 entry 定落点：排除 / 任务看板顶部隐藏 → 座位到根默认位 + display:none
    //    （保留在 root 内，插件自愈不触发）；其余 → foot 顶部（taskboard 无顶部目标
    //    时也回 foot，保持发现顺序）。
    const toFoot: HTMLElement[] = []
    for (const entry of entries) {
      const hide = excluded(entry) || (entry === taskboard && tbTop)
      if (hide) {
        entry.style.display = 'none'
        seatDefault(entry, root)
      } else if (foot !== null) {
        toFoot.push(entry)
        if (entry.style.display === 'none') entry.style.display = ''
      }
      // foot === null 且未隐藏：无 footArea 可放，保持现状（异常态静默）。
    }
    if (foot !== null) {
      const anchor = footerActionsOf(foot) ?? foot.firstElementChild
      for (const entry of toFoot) {
        if (entry.parentElement !== foot) {
          if (anchor !== null) foot.insertBefore(entry, anchor)
          else foot.appendChild(entry)
        }
      }
    }

    // 二、顶部按钮自愈：顶部摆位时给每个容器维护按钮；否则清场。
    if (tbTop) syncTopButtons(topContainers)
    else removeAllTopButtons()
  }

  /**
   * 配置变更（设置页改工具显隐）：重读配置 → 重摆位
   * （新排除的移回默认落点隐藏、恢复的重新摆位、顶部按钮增删）。
   */
  const onSettingsChange = (): void => {
    if (getSnapshot === undefined) return
    const next = resolveAssembler(getSnapshot())
    if (JSON.stringify(next.tools) === JSON.stringify(config.tools)) return
    config = next
    placeAll()
  }

  placeAll()
  const observer = new MutationObserver(() => { placeAll() })
  observer.observe(document.body, { childList: true, subtree: true })
  const unsubscribe = subscribe === undefined ? () => {} : subscribe(onSettingsChange)
  return () => {
    observer.disconnect()
    unsubscribe()
    removeAllTopButtons()
    // 对称清理：去掉任务看板原始入口上的 display:none（恢复默认）。
    for (const entry of document.querySelectorAll<HTMLElement>(TASKBOARD_SELECTOR)) {
      if (entry.style.display === 'none') entry.style.display = ''
    }
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
