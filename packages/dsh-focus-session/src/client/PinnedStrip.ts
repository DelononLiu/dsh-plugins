/**
 * dsh-focus-session 左侧栏「置顶」区（client 半区，DOM 注入）——官方左侧栏「会话/
 * 工作区列表」之上的固定会话区。定位 = 钉子集的**管理面**：拖拽排序 + 行尾 ×
 * 取消钉都写回 settings，行序即钉序。
 *
 * 数据/交互契约（见 index.ts）：
 * - 固定列表 = 本插件 Config 的 `pinned` 字段（本区行尾 × 取消钉 + 拖拽排序是
 *   钉住的唯一管理面）。
 * - 只显示仍存在的会话（按当前会话快照的 ids 过滤）＋ 标题取 byId.displayTitle。
 * - 行可见文本带 `N.` 编号前缀（钉序第 N；行增删自动
 *   重编号）；tooltip/aria-label 保持纯标题。
 * - 点击行 = 打开该会话（官方 `uiWorkspace.openSession`，与官方左侧栏会话行同一入口）。
 * - 拖拽排序：整行 HTML5 拖拽，drop 时把可见钉序写回 settings；行内不实时搬移
 *   DOM（避免与 sync 的重排打架）。
 * - 行选中态 = 当前会话（读官方侧栏 DOM 反推，见 currentSession.ts；内核未经公开
 *   client 服务暴露当前选择）。
 *
 * 行带官方同款状态圆点（运行/子代理/完成/pending），槽 16px 保位。
 *
 * 挂载机制（官方侧栏没有这个 seat，故用 DOM 注入）：MutationObserver + 直接 DOM
 * 注入——等官方侧边栏渲染后把本区插到 sidebar root 的 regionArea 之前
 * （列表区上方）；React 重挂/重排导致丢失时自愈重插。折叠（rail）态由
 * frame 的 `data-sidebar-collapsed` 属性经 CSS 隐藏，不干扰窄列图标。
 */

import { resolveRowStatus, indexRunningSubagents } from './session-status'
import type { SummaryRow, PendingInteractionKind, RowStatusView } from './session-status'
import {
  TAG_EDITOR_ATTR, TAG_LIST_ATTR, closeTagEditor, injectTagCss, openTagEditor, renderTagPills,
} from './tags'
import {
  MENU_ATTR, MENU_BUTTON_ATTR, closeRowMenu, injectMenuCss, makeMenuButton, openRowMenu,
} from './menu'
import { focusSessionPinMenuItem, officialSessionMenuItems } from './sessionActions'
import { createElement } from 'react'
import { IconListPenOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { OfficialSessionActionDeps } from './sessionActions'
import { readCurrentSessionId } from './currentSession'
import type { SessionTag } from './tags'

/** 置顶区根标记（幂等定位 + 自愈锚点）。 */
export const PINNED_STRIP_ATTR = 'data-dsh-pinned-strip'
/**
 * 活跃区容器选择器——座位判定用（ActiveStrip 拥有该属性）。此处写字面量而非
 * import：ActiveStrip 反向 import 本文件的 PINNED_STRIP_ATTR，互相 import 成环。
 */
const ACTIVE_STRIP_SELECTOR = '[data-dsh-active-strip]'
/** 置顶区标题（与会话 tab 同域，中文环境沿用中文文案）。 */
const PINNED_LABEL = '置顶区'
/** 行按钮标记。 */
const PINNED_ROW_ATTR = 'data-dsh-pinned-row'
/** 拖拽源行标记（置灰）。 */
const DRAGGING_ATTR = 'data-dsh-pinned-dragging'
/** 拖放落点标记（值 before/after）。 */
const DROP_ATTR = 'data-dsh-pinned-drop'
/** 当前会话行标记（照官方选中行：底色 `--dsw-alias-interactive-bg-hover`）。 */
const PINNED_CURRENT_ATTR = 'data-dsh-pinned-current'
/** 幂等样式标签标记（沿用本仓 `data-plugin-css` 约定）。 */
const CSS_TAG_SELECTOR = 'style[data-plugin-css="@dsh-focus-session/pinned-strip"]'

/** 置顶区需要的最小会话列表快照（绕开官方 SessionId 品牌类型；官方 `ISessions.list`
 *  快照即结构兼容子集）。 */
export interface PinnedListSnapshot {
  ids: readonly string[]
  byId: Record<string, SummaryRow>
}

/** 会话列表最小契约（index.ts TabsSessionsList 的同构子集）。 */
export interface PinnedList {
  getSnapshot(): PinnedListSnapshot
  subscribe(fn: () => void): () => void
}

/** 一条置顶行（派生结果，纯数据）。 */
export interface PinnedRow {
  id: string
  title: string
  /** 是否当前会话（入参 `current` 来自官方 DOM 反推，非会话快照）。 */
  current: boolean
}

/** 置顶区依赖（全部注入以便测试；DOM 仅在 start 后使用）。 */
export interface PinnedStripDeps {
  /** 读取固定列表（settings `pinned` 快照）。 */
  getPinned(): readonly string[]
  /** 订阅固定列表变更（settings.subscribe）。 */
  subscribeSettings(fn: () => void): () => void
  /** 会话列表（快照 + 变更订阅）。 */
  sessions: PinnedList
  /** 打开会话（点击置顶条目 = 官方 `uiWorkspace.openSession`）。 */
  open(id: string): void
  /** 写回钉顺序/取消钉（settings.set('pinned', …)）。 */
  setPinned(ids: readonly string[]): void
  /** 会话 pending 交互 kind（无则 undefined）；入参会话 id 为 string。 */
  pendingKindOf(id: string): PendingInteractionKind | undefined
  /** 订阅 pending 交互变更。 */
  subscribePending(fn: () => void): () => void
  /** 读某会话的胶囊标签（settings `dsh-focus-tags`）。 */
  getTags(sessionId: string): readonly SessionTag[]
  /** 写某会话的胶囊标签（整份映射由调用方回写 settings）。 */
  setTags(sessionId: string, tags: readonly SessionTag[]): void
  /** 订阅标签变更。 */
  subscribeTags(fn: () => void): () => void
  /** 官方会话动作面（行菜单前置的 rename/fork；由 index.ts 从官方服务装配）。 */
  officialActions: OfficialSessionActionDeps
}

/**
 * 从固定列表 + 会话快照派生置顶行：按钉顺序、去重、剔除已不存在的会话、
 * 标题取 displayTitle（缺省回退 id）、标记当前会话。纯函数，便于单测。
 * @param pinned - settings 里的固定 id 列表。
 * @param list - 会话列表快照。
 * @param current - 当前会话 id（官方 DOM 反推，见 currentSession.ts）；null = 无。
 * @returns 派生置顶行。
 */
export function derivePinnedRows(
  pinned: readonly string[],
  list: PinnedListSnapshot,
  current: string | null = null,
): PinnedRow[] {
  const byId = list.byId
  const existing = new Set(list.ids.map((id) => String(id)))
  const seen = new Set<string>()
  const rows: PinnedRow[] = []
  for (const raw of pinned) {
    const id = String(raw)
    if (seen.has(id) || !existing.has(id)) continue
    seen.add(id)
    rows.push({
      id,
      title: byId[id]?.displayTitle ?? id,
      current: id === current,
    })
  }
  return rows
}

/**
 * 把 moved 移到 over 的 before/after（相对当前可见钉序），返回新顺序
 * （其余保序、moved 已在 over 旁时不重复移动）。纯函数，便于单测。
 * @param ids - 当前可见钉顺序（置顶区行的会话 id 顺序）。
 * @param moved - 被拖拽的会话 id。
 * @param over - 落点会话 id（不在 ids 时移到末尾）。
 * @param half - 落在 over 的上半（before）/下半（after）。
 * @returns 新顺序（去重保序）。
 */
export function moveInOrder(ids: readonly string[], moved: string, over: string, half: 'before' | 'after'): string[] {
  if (moved === over) return [...ids]
  const list = ids.filter((id) => String(id) !== moved)
  const overIdx = list.findIndex((id) => String(id) === over)
  const at = overIdx < 0 ? list.length : overIdx + (half === 'after' ? 1 : 0)
  list.splice(at, 0, moved)
  return list
}

/** 置顶区样式（对齐官方侧边栏契约：行 32px/圆角 8/悬停底；标题 14px）。 */
function pinnedCss(): string {
  return [
    `[${PINNED_STRIP_ATTR}]{flex:none;display:flex;flex-direction:column;gap:2px;min-width:0;box-sizing:border-box;margin:0 2px 6px;user-select:none}`,
    `[${PINNED_STRIP_ATTR}] [data-dsh-pinned-label]{padding:4px 8px 0;font-size:12px;line-height:20px;color:var(--dsw-alias-label-tertiary)}`,
    `[${PINNED_STRIP_ATTR}] [${PINNED_ROW_ATTR}]{display:flex;align-items:center;gap:0;box-sizing:border-box;width:100%;height:32px;padding:0 8px;border:none;border-radius:8px;background:transparent;cursor:pointer;overflow:hidden;color:var(--dsw-alias-label-primary);font-family:inherit;font-size:14px;line-height:20px;text-align:left}`,
    `[${PINNED_STRIP_ATTR}] [${PINNED_ROW_ATTR}]:hover{background:var(--dsw-alias-interactive-bg-hover)}`,
    // 当前会话行：照官方选中态（`.sessionRow._selected` 只改底色，标题不改色）。
    `[${PINNED_STRIP_ATTR}] [${PINNED_ROW_ATTR}][${PINNED_CURRENT_ATTR}]{background:var(--dsw-alias-interactive-bg-hover)}`,
    `[${PINNED_STRIP_ATTR}] [data-dsh-pinned-title]{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}`,
    // 状态槽/圆点（照官方 ui-workspace .slot + ui-primitives StateDot 契约：槽 16×20，
    // dot 10px：currentColor 外晕 10% + 20% inset 实心核；ongoing = 8 格像素追逐）。
    `[${PINNED_STRIP_ATTR}] [data-dsh-pinned-status]{flex:none;width:16px;height:20px;display:inline-flex;align-items:center;justify-content:center}`,
    `[${PINNED_STRIP_ATTR}] .dsh-pinned-dot{position:relative;display:inline-block;flex:none;width:10px;height:10px;color:var(--dsw-alias-state-success-primary)}`,
    `[${PINNED_STRIP_ATTR}] .dsh-pinned-dot::before{content:'';position:absolute;inset:0;border-radius:50%;background:currentColor;opacity:.1}`,
    `[${PINNED_STRIP_ATTR}] .dsh-pinned-dot::after{content:'';position:absolute;inset:20%;border-radius:50%;background:currentColor}`,
    `[${PINNED_STRIP_ATTR}] .dsh-pinned-dot[data-state='warning']{color:var(--dsw-alias-state-warn-primary)}`,
    `[${PINNED_STRIP_ATTR}] .dsh-pinned-dot[data-state='done']{color:var(--dsw-alias-state-success-primary)}`,
    `[${PINNED_STRIP_ATTR}] .dsh-pinned-matrix{flex:none;width:10px;height:10px;color:var(--dsw-static-deepseek-450)}`,
    `[${PINNED_STRIP_ATTR}] .dsh-pinned-matrix .cell{fill:currentColor;opacity:.15;animation:dsh-focus-dot-chase 1s infinite}`,
    `@keyframes dsh-focus-dot-chase{0%,12.4%{opacity:1}12.5%,24.9%{opacity:.6}25%,37.4%{opacity:.35}37.5%,100%{opacity:.15}}`,
    // 行管理控件：× 取消钉（hover/focus-within 显示）+ 拖拽源置灰 + 落点指示线。
    `[${PINNED_STRIP_ATTR}] [${PINNED_ROW_ATTR}][${DRAGGING_ATTR}]{opacity:.45}`,
    `[${PINNED_STRIP_ATTR}] [${PINNED_ROW_ATTR}][${DROP_ATTR}='before']{box-shadow:inset 0 2px 0 0 var(--dsw-alias-state-business-primary)}`,
    `[${PINNED_STRIP_ATTR}] [${PINNED_ROW_ATTR}][${DROP_ATTR}='after']{box-shadow:inset 0 -2px 0 0 var(--dsw-alias-state-business-primary)}`,
    // 官方折叠（rail）：AppFrame 折叠时给 frame 加 data-sidebar-collapsed，整区隐藏。
    `[data-sidebar-collapsed] [${PINNED_STRIP_ATTR}]{display:none}`,
  ].join('')
}

/** 幂等注入样式（bundle 加载即执行；已注入则跳过）。返回移除函数。 */
function injectCss(): () => void {
  if (typeof document === 'undefined') return () => {}
  if (document.querySelector(CSS_TAG_SELECTOR) !== null) return () => {}
  const tag = document.createElement('style')
  tag.dataset.plugin = 'dsh-focus-session'
  tag.dataset.pluginCss = '@dsh-focus-session/pinned-strip'
  tag.textContent = pinnedCss()
  document.head.appendChild(tag)
  return () => tag.remove()
}

/**
 * 官方侧边栏座位：sidebar 列的 root（logoRow 的 parentElement，兜底首个子元素）
 * 与其内 regionArea（会话/工作区浏览区，置顶区插到它之前 = 列表上方）。
 */
export function sidebarSeat(doc: Document): { root: HTMLElement; region: HTMLElement } | null {
  const column = doc.querySelector('[data-pane="sidebar"], [class*="sidebarCol"]')
  if (column === null) return null
  const logoHost = column.querySelector('[class*="logoRow"]')?.parentElement
  const root = logoHost ?? column.firstElementChild
  if (!(root instanceof HTMLElement)) return null
  const region = root.querySelector<HTMLElement>('[class*="regionArea"]')
  if (region === null) return null
  return { root, region }
}

/** 置顶区根元素（首次构建：标题 + 行列表容器）。 */
function makeStrip(doc: Document): HTMLElement {
  const el = doc.createElement('div')
  el.setAttribute(PINNED_STRIP_ATTR, '')
  el.setAttribute('role', 'group')
  el.setAttribute('aria-label', PINNED_LABEL)
  const label = doc.createElement('div')
  label.setAttribute('data-dsh-pinned-label', '')
  label.textContent = PINNED_LABEL
  el.appendChild(label)
  const list = doc.createElement('div')
  list.setAttribute('data-dsh-pinned-list', '')
  el.appendChild(list)
  return el
}

/** 行元素（首次创建；标题/状态/编号由后续 sync 更新；点击/拖拽走 start 里的
 *  容器级事件委托——行本身不加监听，重建即复用）。行 = div[role=button]：
 *  整行可拖（HTML5 draggable），行尾 × 是独立 button（不触发打开）。 */
function makeRow(doc: Document, row: PinnedRow): HTMLElement {
  const el = doc.createElement('div')
  el.setAttribute(PINNED_ROW_ATTR, '')
  el.dataset.sessionId = row.id
  el.setAttribute('role', 'button')
  el.setAttribute('tabindex', '0')
  el.draggable = true
  const statusSlot = doc.createElement('span')
  statusSlot.setAttribute('data-dsh-pinned-status', '')
  el.appendChild(statusSlot)
  // 行首胶囊标签容器（状态点之后、标题之前——`#功能 会话标题` 形态）。
  const tagList = doc.createElement('span')
  tagList.setAttribute(TAG_LIST_ATTR, '')
  el.appendChild(tagList)
  const title = doc.createElement('span')
  title.setAttribute('data-dsh-pinned-title', '')
  el.appendChild(title)
  // 行尾「⋯」菜单入口（官方工作区行尾图标按钮形态；展开项见 onClickDoc）。
  el.appendChild(makeMenuButton(doc))
  return el
}

/** 幂等同步状态槽：期望点/矩阵与槽内现状一致时**不改 DOM**（零变更收敛），
 *  不一致才重建一次。syncRows 由 body 级 MutationObserver 驱动——若每次 sync
 *  都无条件 replaceChildren+新建，自我写入会再触发 observer，形成微任务自触发
 *  死循环，渲染主线程被饿死（整页卡死）。本函数是收敛性的唯一保证点。 */
export function syncStatusSlot(slot: HTMLElement, status: RowStatusView, doc: Document): void {
  const want = status.dot
  const first = slot.firstElementChild
  const settled =
    want === 'done' || want === 'warning'
      ? first instanceof HTMLSpanElement && first.classList.contains('dsh-pinned-dot') && first.dataset.state === want
      : want === 'ongoing'
        ? first instanceof SVGSVGElement && first.classList.contains('dsh-pinned-matrix')
        : first === null
  if (settled) return
  slot.replaceChildren()
  if (want === 'done' || want === 'warning') {
    const dot = doc.createElement('span')
    dot.className = 'dsh-pinned-dot'
    dot.dataset.state = want
    slot.appendChild(dot)
  } else if (want === 'ongoing') {
    // 追逐动画矩阵（照官方 ui-primitives StateDot：10 网格外缘 8 格 2px，1s chase）。
    const matrix = doc.createElementNS('http://www.w3.org/2000/svg', 'svg')
    matrix.classList.add('dsh-pinned-matrix')
    matrix.setAttribute('viewBox', '0 0 10 10')
    matrix.setAttribute('width', '10')
    matrix.setAttribute('height', '10')
    matrix.setAttribute('shape-rendering', 'crispEdges')
    const positions = [
      [0, 0], [4, 0], [8, 0],
      [0, 4], [8, 4],
      [0, 8], [4, 8], [8, 8],
    ]
    positions.forEach(([x, y], idx) => {
      const rect = doc.createElementNS('http://www.w3.org/2000/svg', 'rect')
      rect.classList.add('cell')
      rect.setAttribute('x', String(x))
      rect.setAttribute('y', String(y))
      rect.setAttribute('width', '2')
      rect.setAttribute('height', '2')
      rect.style.animationDelay = `${(idx - positions.length) * 125}ms`
      matrix.appendChild(rect)
    })
    slot.appendChild(matrix)
  }
}

/** 幂等同步：按派生行补齐/删除/更新/排序置顶区 DOM；无钉或座位缺席时移除。 */
function syncRows(deps: PinnedStripDeps, doc: Document, stripRef: { el: HTMLElement | null }): void {
  const snapshot = deps.sessions.getSnapshot()
  const rows = derivePinnedRows(deps.getPinned(), snapshot, readCurrentSessionId(doc))
  if (rows.length === 0) {
    stripRef.el?.remove()
    stripRef.el = null
    return
  }
  const seat = sidebarSeat(doc)
  if (seat === null) {
    stripRef.el?.remove()
    stripRef.el = null
    return
  }
  const strip = stripRef.el ?? makeStrip(doc)
  stripRef.el = strip
  // 座位：插到 regionArea 之前（列表区上方）；活跃区可紧随本区之后——两种落点都算
  // 就位。只认 region 会与活跃区（同样锚 region）互相搬移成死循环（渲染主线程饿死）。
  const activeStrip = seat.root.querySelector(ACTIVE_STRIP_SELECTOR)
  const seated = strip.parentElement === seat.root
    && (strip.nextElementSibling === seat.region || strip.nextElementSibling === activeStrip)
  if (!seated) {
    seat.root.insertBefore(strip, seat.region)
  }
  const listEl = strip.querySelector<HTMLElement>('[data-dsh-pinned-list]')
  if (listEl === null) return
  const existing = new Map<string, HTMLElement>()
  for (const rowEl of Array.from(listEl.querySelectorAll<HTMLElement>(`[${PINNED_ROW_ATTR}]`))) {
    existing.set(rowEl.dataset.sessionId ?? '', rowEl)
  }
  const wanted = new Set(rows.map((row) => row.id))
  for (const [id, rowEl] of existing) {
    if (wanted.has(id)) continue
    rowEl.remove()
    existing.delete(id)
  }
  // 状态数据按当前快照统计一次（行循环内不复算）。
  const byIdNow = snapshot.byId as Record<string, SummaryRow>
  const subagentCounts = indexRunningSubagents(
    Object.entries(byIdNow).map(([id, s]) => ({ id, parentId: s.parentId, origin: s.origin, running: s.running })),
  )
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    let rowEl = existing.get(row.id)
    if (rowEl === undefined || rowEl.parentElement !== listEl) {
      rowEl = makeRow(doc, row)
      listEl.appendChild(rowEl)
      existing.set(row.id, rowEl)
    }
    // 轻量字段同步（标题/当前标记/状态；滚动/悬停不打断——行不重建）。
    // 当前标记幂等：已一致时不碰 DOM（属性写入也会产生 MutationRecord）。
    // ARIA：本行是 `role="button"`——`aria-selected` 在 button 上无效，故用
    // `aria-current="true"`；官方行是 treeitem 才用 `aria-selected`（见 currentSession.ts）。
    const marked = rowEl.hasAttribute(PINNED_CURRENT_ATTR)
    if (row.current !== marked) {
      if (row.current) {
        rowEl.setAttribute(PINNED_CURRENT_ATTR, '')
        rowEl.setAttribute('aria-current', 'true')
      } else {
        rowEl.removeAttribute(PINNED_CURRENT_ATTR)
        rowEl.removeAttribute('aria-current')
      }
    }
    rowEl.setAttribute('aria-label', row.title)
    const statusSlot = rowEl.querySelector<HTMLElement>('[data-dsh-pinned-status]')
    const titleEl = rowEl.querySelector<HTMLElement>('[data-dsh-pinned-title]')
    const summary = byIdNow[row.id]
    const status = resolveRowStatus({
      pendingKind: deps.pendingKindOf(row.id),
      running: summary?.running,
      runningSubagentCount: subagentCounts.get(row.id) ?? 0,
      completed: summary?.completed,
    })
    // tooltip：有状态点 → 「状态 · 标题」；空闲 → 纯标题。aria-label 保持纯标题。
    const tip = status.dot === undefined ? row.title : `${status.label} · ${row.title}`
    if (rowEl.title !== tip) rowEl.title = tip
    // 可见文本带编号前缀（钉序第 N）；tooltip/aria 保持纯标题。
    const label = `${i + 1}. ${row.title}`
    if (titleEl !== null && titleEl.textContent !== label) titleEl.textContent = label
    // 胶囊标签（幂等渲染：同内容零 DOM 写）。
    const tagListEl = rowEl.querySelector<HTMLElement>(`[${TAG_LIST_ATTR}]`)
    if (tagListEl !== null) renderTagPills(tagListEl, deps.getTags(row.id), doc)
    // 状态槽：永远存在（16px 保位对齐）；幂等更新（一致不改 DOM，防 observer 自触发死循环）。
    if (statusSlot !== null) syncStatusSlot(statusSlot, status, doc)
  }
  // 按派生顺序重排（仅乱序时移动，幂等收敛）。
  for (let i = 0; i < rows.length; i++) {
    const node = existing.get(rows[i].id)
    const target = listEl.children[i]
    if (node === undefined || node === target) continue
    listEl.insertBefore(node, target)
  }
}

/**
 * 启动左侧栏「置顶」区：订阅固定列表 + 会话列表变更，MutationObserver 自愈
 * 挂载；返回 disposer（退订 + 断开观察器 + 移除 DOM/样式）。
 * @param deps - 数据/打开注入（getPinned/subscribeSettings/sessions/open、pendingKindOf/subscribePending）。
 * @returns 卸载函数。
 */
export function startPinnedStrip(deps: PinnedStripDeps): () => void {
  if (typeof document === 'undefined') return () => {}
  const doc = document
  const removeCss = injectCss()
  const removeTagCss = injectTagCss()
  const removeMenuCss = injectMenuCss()
  const stripRef: { el: HTMLElement | null } = { el: null }
  const sync = (): void => syncRows(deps, doc, stripRef)
  const unsubSettings = deps.subscribeSettings(sync)
  const unsubSessions = deps.sessions.subscribe(sync)
  const unsubPending = deps.subscribePending(sync)
  const unsubTags = deps.subscribeTags(sync)
  const observer = new MutationObserver((records) => {
    // 只响应置顶区之外的变更（React 重排/会话页流式渲染等）——置顶区内的
    // 写入全是我们自己 sync 产生的，忽略它们。否则「sync 写 DOM → observer
    // → sync」自触发回环会把渲染主线程饿死（整页卡死）；本区内容完全自持，
    // 无他人改动，忽略自身写入不影响 React 重排后的自愈重插。
    // 属性只观察 `aria-selected`：官方会话行的选中态切换（用户切会话）只改这个
    // 属性、不产生 childList；我们自己的行只写 `aria-current`，永不自触发。
    for (const record of records) {
      const target = record.target
      if (!(target instanceof Element) || target.closest(`[${PINNED_STRIP_ATTR}]`) === null) {
        sync()
        return
      }
    }
  })
  observer.observe(doc.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-selected'] })

  // —— 行交互（容器/文档级事件委托：行可被 sync 反复重建，委托在文档级一次挂载）——
  const rowOf = (target: EventTarget | null): HTMLElement | null =>
    target instanceof Element ? target.closest<HTMLElement>(`[${PINNED_ROW_ATTR}]`) : null
  const menuButtonOf = (target: EventTarget | null): HTMLElement | null =>
    target instanceof Element ? target.closest<HTMLElement>(`[${MENU_BUTTON_ATTR}]`) : null
  const insideStrip = (target: EventTarget | null): boolean =>
    target instanceof Element && target.closest(`[${PINNED_STRIP_ATTR}]`) !== null

  /** 打开该行的行菜单（官方 rename/fork 前置，后接编辑标签与我们的置顶项）。 */
  const openMenuFor = (row: HTMLElement, button: HTMLElement | null, id: string): void => {
    openRowMenu({
      anchor: row,
      button,
      items: [
        ...officialSessionMenuItems(id, deps.officialActions),
        {
          id: 'edit-tags',
          label: '编辑标签',
          icon: createElement(IconListPenOutlineRegular, {}),
          onSelect: () => {
            openTagEditor({
              sessionId: id,
              getTags: (sid) => deps.getTags(sid),
              setTags: (sid, tags) => deps.setTags(sid, tags),
            })
          },
        },
        focusSessionPinMenuItem(id, { getPinned: () => deps.getPinned(), setPinned: (ids) => { deps.setPinned(ids) } }),
      ],
    })
  }

  // 点击：行尾「⋯」→ 行菜单；行其它区域 → 打开会话。
  const onClickDoc = (e: MouseEvent): void => {
    if (!insideStrip(e.target)) return
    const row = rowOf(e.target)
    if (row === null) return
    const id = row.dataset.sessionId ?? ''
    if (menuButtonOf(e.target) !== null) {
      e.preventDefault()
      e.stopPropagation()
      if (id !== '') openMenuFor(row, menuButtonOf(e.target), id)
      return
    }
    if (id !== '') deps.open(id)
  }
  // 键盘打开（div[role=button] 无原生激活；× 按钮自身 Enter/Space 走原生 click）。
  const onKeyDownDoc = (e: KeyboardEvent): void => {
    if (e.key !== 'Enter' && e.key !== ' ') return
    if (!insideStrip(e.target)) return
    if (menuButtonOf(e.target) !== null) return
    const row = rowOf(e.target)
    if (row === null) return
    e.preventDefault()
    const id = row.dataset.sessionId ?? ''
    if (id !== '') deps.open(id)
  }

  // —— 拖拽排序（HTML5 DnD）：拖行到另一行上/下半，drop 一次写回 settings ——
  // 行内不实时搬 DOM（避免与 sync 的 settings 顺序重排互相打架）；drop 后
  // settings 订阅触发 sync，DOM 按新序收敛。
  let dragSource: string | null = null
  let dropTarget: HTMLElement | null = null
  const dropHalf = (e: DragEvent, row: HTMLElement): 'before' | 'after' => {
    const rect = row.getBoundingClientRect()
    return e.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
  }
  const clearDrop = (): void => {
    dropTarget?.removeAttribute(DROP_ATTR)
    dropTarget = null
  }
  const onDragStartDoc = (e: DragEvent): void => {
    const row = rowOf(e.target)
    const id = row?.dataset.sessionId
    if (row === null || id === undefined || id === '') return
    dragSource = id
    e.dataTransfer?.setData('text/plain', id)
    if (e.dataTransfer !== null) e.dataTransfer.effectAllowed = 'move'
    row.setAttribute(DRAGGING_ATTR, '')
  }
  const onDragOverDoc = (e: DragEvent): void => {
    if (dragSource === null) return
    const row = rowOf(e.target)
    if (row === null) return
    e.preventDefault() // 声明可 drop
    if (dropTarget !== row) {
      clearDrop()
      dropTarget = row
    }
    dropTarget.setAttribute(DROP_ATTR, dropHalf(e, row))
  }
  const onDropDoc = (e: DragEvent): void => {
    if (dragSource === null) return
    const row = rowOf(e.target)
    if (row === null) return
    e.preventDefault()
    const over = row.dataset.sessionId
    const listEl = stripRef.el?.querySelector<HTMLElement>('[data-dsh-pinned-list]')
    if (over !== undefined && listEl != null) {
      const visible = Array.from(listEl.querySelectorAll<HTMLElement>(`[${PINNED_ROW_ATTR}]`))
        .map((r) => r.dataset.sessionId ?? '')
        .filter((id) => id !== '')
      deps.setPinned(moveInOrder(visible, dragSource, over, dropHalf(e, row)))
    }
    dragSource = null
    clearDrop()
    doc.querySelectorAll<HTMLElement>(`[${DRAGGING_ATTR}]`).forEach((el) => el.removeAttribute(DRAGGING_ATTR))
  }
  const onDragEndDoc = (): void => {
    dragSource = null
    clearDrop()
    doc.querySelectorAll<HTMLElement>(`[${DRAGGING_ATTR}]`).forEach((el) => el.removeAttribute(DRAGGING_ATTR))
  }
  doc.addEventListener('click', onClickDoc)
  doc.addEventListener('keydown', onKeyDownDoc)
  // 点标签面板之外 → 关闭面板。按钮自身的 click 已由 onClickDoc 处理并由本
  // 监听器按 target 排除（同节点监听器不受 stopPropagation 影响，故用 target 判据）。
  const onDocClickCloseEditor = (e: MouseEvent): void => {
    const target = e.target
    if (target instanceof Element
      && (target.closest(`[${TAG_EDITOR_ATTR}]`) !== null
        || target.closest(`[${MENU_ATTR}]`) !== null
        || target.closest(`[${MENU_BUTTON_ATTR}]`) !== null)) return
    closeTagEditor()
    closeRowMenu()
  }
  doc.addEventListener('click', onDocClickCloseEditor)
  doc.addEventListener('dragstart', onDragStartDoc)
  doc.addEventListener('dragover', onDragOverDoc)
  doc.addEventListener('drop', onDropDoc)
  doc.addEventListener('dragend', onDragEndDoc)

  sync()
  return () => {
    unsubSettings()
    unsubSessions()
    unsubPending()
    unsubTags()
    observer.disconnect()
    doc.removeEventListener('click', onClickDoc)
    doc.removeEventListener('click', onDocClickCloseEditor)
    doc.removeEventListener('keydown', onKeyDownDoc)
    doc.removeEventListener('dragstart', onDragStartDoc)
    doc.removeEventListener('dragover', onDragOverDoc)
    doc.removeEventListener('drop', onDropDoc)
    doc.removeEventListener('dragend', onDragEndDoc)
    clearDrop()
    closeTagEditor()
    closeRowMenu()
    stripRef.el?.remove()
    stripRef.el = null
    removeCss()
    removeTagCss()
    removeMenuCss()
  }
}
