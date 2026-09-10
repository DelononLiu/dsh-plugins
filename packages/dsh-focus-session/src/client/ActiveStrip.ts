/**
 * dsh-focus-session 左侧栏「活跃」区（client 半区，DOM 注入）——插在「置顶」区
 * 之下，按最近活跃时间（`updatedAt` 降序）列出会话，作为**自动**的第二处常驻
 * 入口（置顶区 = 手动钉住，本区 = 最近在看/在跑的）。
 *
 * 数据/交互契约：
 * - 数据源 = 会话列表快照的 `updatedAt`（官方 `SessionSummary.updatedAt`，
 *   用户消息推进的耐久时间；会话 list 本身即按它排序）。本区不改写任何
 *   settings——它是纯派生视图。
 * - 剔除已在「置顶」区的会话（两区不重复显示同一会话）、子代理会话
 *   （`origin === 'subagent'`，它们挂在祖先行下）与空白会话（`blank`）。
 * - 上限 `ACTIVE_LIMIT` 条（默认 5），超出不显示。
 * - 点击行 = 打开该会话（`ctx.sessions.open`，与侧栏点击同路径）。
 * - 行带官方同款状态圆点（运行/子代理/完成/pending），与置顶区一致。
 *
 * 挂载机制（与置顶区同款，抄 dsh-desk 工具入口组装器先例）：MutationObserver
 * + 直接 DOM 注入——插到「置顶」区之后（无置顶区时插到 regionArea 之前）；
 * React 重挂/重排导致丢失时自愈重插。折叠（rail）态由 frame 的
 * `data-sidebar-collapsed` 属性经 CSS 隐藏。
 *
 * 幂等收敛：sync 在状态/内容未变时零 DOM 写——否则「sync 写 DOM → observer →
 * sync」的微任务自触发会饿死渲染主线程（置顶区曾现网发生，见
 * [session-pin-status-sync-convergence]）。
 */

import { resolveRowStatus, indexRunningSubagents } from './session-status'
import type { SummaryRow, PendingInteractionKind } from './session-status'
import { sidebarSeat, syncStatusSlot, PINNED_STRIP_ATTR } from './PinnedStrip'
import {
  TAG_EDITOR_ATTR, TAG_LIST_ATTR, closeTagEditor, injectTagCss, openTagEditor, renderTagPills,
} from './tags'
import {
  MENU_ATTR, MENU_BUTTON_ATTR, closeRowMenu, injectMenuCss, makeMenuButton, openRowMenu,
} from './menu'
import type { SessionTag } from './tags'

/** 活跃区根标记（幂等定位 + 自愈锚点）。 */
export const ACTIVE_STRIP_ATTR = 'data-dsh-active-strip'
/** 活跃区标题。 */
const ACTIVE_LABEL = '活跃区'
/** 行按钮标记。 */
const ACTIVE_ROW_ATTR = 'data-dsh-active-row'
/** 当前会话行标记。 */
const ACTIVE_CURRENT_ATTR = 'data-dsh-active-current'
/** 幂等样式标签标记（同 dsh-desk `data-plugin-css` 约定）。 */
const CSS_TAG_SELECTOR = 'style[data-plugin-css="@dsh-focus-session/active-strip"]'

/** 活跃区默认条数上限。 */
export const ACTIVE_LIMIT = 5

/** 活跃区需要的最小会话列表快照（与置顶区同构）。 */
export interface ActiveListSnapshot {
  current?: string | undefined
  ids: readonly string[]
  byId: Record<string, SummaryRow>
}

/** 会话列表最小契约。 */
export interface ActiveList {
  getSnapshot(): ActiveListSnapshot
  subscribe(fn: () => void): () => void
}

/** 一条活跃行（派生结果，纯数据）。 */
export interface ActiveRow {
  id: string
  title: string
  current: boolean
}

/** 活跃区依赖（全部注入以便测试；DOM 仅在 start 后使用）。 */
export interface ActiveStripDeps {
  /** 会话列表（快照 + 变更订阅）。 */
  sessions: ActiveList
  /** 打开会话（点击活跃条目 = ctx.sessions.open）。 */
  open(id: string): void
  /** 读取钉住列表（用于剔除置顶区已显示的会话）。 */
  getPinned(): readonly string[]
  /** 订阅钉住列表变更（钉住/取消钉后本区剔除集变化）。 */
  subscribeSettings(fn: () => void): () => void
  /** 写回钉住列表（行菜单「添加到置顶区」）。 */
  setPinned(ids: readonly string[]): void
  /** 会话 pending 交互 kind（无则 undefined）。 */
  pendingKindOf(id: string): PendingInteractionKind | undefined
  /** 订阅 pending 交互变更。 */
  subscribePending(fn: () => void): () => void
  /** 读某会话的胶囊标签（settings `dsh-focus-tags`）。 */
  getTags(sessionId: string): readonly SessionTag[]
  /** 写某会话的胶囊标签。 */
  setTags(sessionId: string, tags: readonly SessionTag[]): void
  /** 订阅标签变更。 */
  subscribeTags(fn: () => void): () => void
  /** 条数上限（缺省 {@link ACTIVE_LIMIT}）。 */
  limit?: number
}

/**
 * 从会话快照派生活跃行：按 `updatedAt` 降序、剔除置顶区已显示/子代理/空白
 * 会话，取前 `limit` 条。纯函数，便于单测。
 * @param pinned - 钉住列表（置顶区显示的会话，本区剔除）。
 * @param list - 会话列表快照。
 * @param limit - 条数上限。
 * @returns 派生活跃行（时间序，最新在前）。
 */
export function deriveActiveRows(
  pinned: readonly string[],
  list: ActiveListSnapshot,
  limit: number = ACTIVE_LIMIT,
): ActiveRow[] {
  const current = list.current === undefined ? undefined : String(list.current)
  const pinnedSet = new Set(pinned.map((id) => String(id)))
  const candidates: Array<{ id: string; updatedAt: number }> = []
  for (const raw of list.ids) {
    const id = String(raw)
    if (pinnedSet.has(id)) continue
    const summary = list.byId[id]
    if (summary === undefined) continue
    if (summary.origin === 'subagent') continue
    if (summary.blank === true) continue
    candidates.push({ id, updatedAt: typeof summary.updatedAt === 'number' ? summary.updatedAt : 0 })
  }
  // 稳定排序：updatedAt 相同时保持快照顺序（官方 list 本身已按活跃排序）。
  candidates.sort((a, b) => b.updatedAt - a.updatedAt)
  return candidates.slice(0, Math.max(0, limit)).map((candidate) => ({
    id: candidate.id,
    title: list.byId[candidate.id]?.displayTitle ?? candidate.id,
    current: candidate.id === current,
  }))
}

/** 活跃区样式（行契约与置顶区一致：32px/圆角 8/悬停底）。 */
function activeCss(): string {
  return [
    `[${ACTIVE_STRIP_ATTR}]{flex:none;display:flex;flex-direction:column;gap:2px;min-width:0;box-sizing:border-box;margin:0 2px 6px;user-select:none}`,
    `[${ACTIVE_STRIP_ATTR}] [data-dsh-active-label]{padding:4px 8px 0;font-size:12px;line-height:20px;color:var(--dsw-alias-label-tertiary)}`,
    `[${ACTIVE_STRIP_ATTR}] [${ACTIVE_ROW_ATTR}]{display:flex;align-items:center;gap:0;box-sizing:border-box;width:100%;height:32px;padding:0 8px;border:none;border-radius:8px;background:transparent;cursor:pointer;overflow:hidden;color:var(--dsw-alias-label-primary);font-family:inherit;font-size:14px;line-height:20px;text-align:left}`,
    `[${ACTIVE_STRIP_ATTR}] [${ACTIVE_ROW_ATTR}]:hover{background:var(--dsw-alias-interactive-bg-hover)}`,
    `[${ACTIVE_STRIP_ATTR}] [${ACTIVE_ROW_ATTR}][${ACTIVE_CURRENT_ATTR}]{background:var(--dsw-alias-interactive-bg-hover)}`,
    `[${ACTIVE_STRIP_ATTR}] [${ACTIVE_ROW_ATTR}][${ACTIVE_CURRENT_ATTR}] [data-dsh-active-title]{color:var(--dsw-alias-state-business-primary)}`,
    `[${ACTIVE_STRIP_ATTR}] [data-dsh-active-title]{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}`,
    `[${ACTIVE_STRIP_ATTR}] [data-dsh-active-status]{flex:none;width:16px;height:20px;display:inline-flex;align-items:center;justify-content:center}`,
    `[${ACTIVE_STRIP_ATTR}] .dsh-pinned-dot{position:relative;display:inline-block;flex:none;width:10px;height:10px;color:var(--dsw-alias-state-success-primary)}`,
    `[${ACTIVE_STRIP_ATTR}] .dsh-pinned-dot::before{content:'';position:absolute;inset:0;border-radius:50%;background:currentColor;opacity:.1}`,
    `[${ACTIVE_STRIP_ATTR}] .dsh-pinned-dot::after{content:'';position:absolute;inset:20%;border-radius:50%;background:currentColor}`,
    `[${ACTIVE_STRIP_ATTR}] .dsh-pinned-dot[data-state='warning']{color:var(--dsw-alias-state-warn-primary)}`,
    `[${ACTIVE_STRIP_ATTR}] .dsh-pinned-dot[data-state='done']{color:var(--dsw-alias-state-success-primary)}`,
    `[${ACTIVE_STRIP_ATTR}] .dsh-pinned-matrix{flex:none;width:10px;height:10px;color:var(--dsw-static-deepseek-450)}`,
    `[${ACTIVE_STRIP_ATTR}] .dsh-pinned-matrix .cell{fill:currentColor;opacity:.15;animation:dsh-focus-dot-chase 1s infinite}`,
    // 官方折叠（rail）：整区隐藏（不干扰窄列图标）。
    `[data-sidebar-collapsed] [${ACTIVE_STRIP_ATTR}]{display:none}`,
  ].join('')
}

/** 幂等注入样式（已注入则跳过）。返回移除函数。 */
function injectCss(): () => void {
  if (typeof document === 'undefined') return () => {}
  if (document.querySelector(CSS_TAG_SELECTOR) !== null) return () => {}
  const tag = document.createElement('style')
  tag.dataset.plugin = 'dsh-focus-session'
  tag.dataset.pluginCss = '@dsh-focus-session/active-strip'
  tag.textContent = activeCss()
  document.head.appendChild(tag)
  return () => tag.remove()
}

/** 活跃区根元素（首次构建：标题 + 行列表容器）。 */
function makeStrip(doc: Document): HTMLElement {
  const el = doc.createElement('div')
  el.setAttribute(ACTIVE_STRIP_ATTR, '')
  el.setAttribute('role', 'group')
  el.setAttribute('aria-label', ACTIVE_LABEL)
  const label = doc.createElement('div')
  label.setAttribute('data-dsh-active-label', '')
  label.textContent = ACTIVE_LABEL
  el.appendChild(label)
  const list = doc.createElement('div')
  list.setAttribute('data-dsh-active-list', '')
  el.appendChild(list)
  return el
}

/** 行元素（首次创建；标题/状态由后续 sync 更新；点击走容器级委托）。 */
function makeRow(doc: Document, row: ActiveRow): HTMLElement {
  const el = doc.createElement('div')
  el.setAttribute(ACTIVE_ROW_ATTR, '')
  el.dataset.sessionId = row.id
  el.setAttribute('role', 'button')
  el.setAttribute('tabindex', '0')
  const statusSlot = doc.createElement('span')
  statusSlot.setAttribute('data-dsh-active-status', '')
  el.appendChild(statusSlot)
  // 行首胶囊标签容器（状态点之后、标题之前——`#功能 会话标题` 形态）。
  const tagList = doc.createElement('span')
  tagList.setAttribute(TAG_LIST_ATTR, '')
  el.appendChild(tagList)
  const title = doc.createElement('span')
  title.setAttribute('data-dsh-active-title', '')
  el.appendChild(title)
  // 行尾「⋯」菜单入口（与置顶区行同契约）。
  el.appendChild(makeMenuButton(doc))
  return el
}

/** 幂等同步：按派生行补齐/删除/更新/排序活跃区 DOM；无行或座位缺席时移除。 */
function syncRows(deps: ActiveStripDeps, doc: Document, stripRef: { el: HTMLElement | null }): void {
  const snapshot = deps.sessions.getSnapshot()
  const rows = deriveActiveRows(deps.getPinned(), snapshot, deps.limit ?? ACTIVE_LIMIT)
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
  // 座位：置顶区之后（置顶区不存在时在列表区 regionArea 之前）。位置已正确时零
  // DOM 写——`insertBefore` 即使落在相同位置也会产生 childList 记录，body 级
  // observer 会因此自触发（曾现网卡死，见 session-pin-status-sync-convergence）。
  const pinnedStrip = seat.root.querySelector(`[${PINNED_STRIP_ATTR}]`)
  const wantNext: Element | null = pinnedStrip !== null ? pinnedStrip.nextElementSibling : seat.region
  if (strip.parentElement !== seat.root || strip.nextElementSibling !== wantNext) {
    seat.root.insertBefore(strip, wantNext)
  }
  const listEl = strip.querySelector<HTMLElement>('[data-dsh-active-list]')
  if (listEl === null) return
  const existing = new Map<string, HTMLElement>()
  for (const rowEl of Array.from(listEl.querySelectorAll<HTMLElement>(`[${ACTIVE_ROW_ATTR}]`))) {
    existing.set(rowEl.dataset.sessionId ?? '', rowEl)
  }
  const wanted = new Set(rows.map((row) => row.id))
  for (const [id, rowEl] of [...existing]) {
    if (wanted.has(id)) continue
    rowEl.remove()
    existing.delete(id)
  }
  const byIdNow = snapshot.byId as Record<string, SummaryRow>
  const subagentCounts = indexRunningSubagents(
    Object.entries(byIdNow).map(([id, s]) => ({ id, parentId: s.parentId, origin: s.origin, running: s.running })),
  )
  // 按期望顺序摆放（位置已正确时不写 DOM——零变更收敛）。
  let prev: HTMLElement | null = null
  for (const row of rows) {
    let rowEl = existing.get(row.id)
    if (rowEl === undefined) {
      rowEl = makeRow(doc, row)
      existing.set(row.id, rowEl)
    }
    const wantNext: Element | null = prev === null ? listEl.firstElementChild : prev.nextElementSibling
    if (rowEl !== wantNext) listEl.insertBefore(rowEl, wantNext)
    prev = rowEl
    if (row.current) {
      rowEl.setAttribute(ACTIVE_CURRENT_ATTR, '')
      rowEl.setAttribute('aria-current', 'true')
    } else {
      rowEl.removeAttribute(ACTIVE_CURRENT_ATTR)
      rowEl.removeAttribute('aria-current')
    }
    const titleEl = rowEl.querySelector<HTMLElement>('[data-dsh-active-title]')
    if (titleEl !== null && titleEl.textContent !== row.title) titleEl.textContent = row.title
    // 胶囊标签（幂等渲染：同内容零 DOM 写）。
    const tagListEl = rowEl.querySelector<HTMLElement>(`[${TAG_LIST_ATTR}]`)
    if (tagListEl !== null) renderTagPills(tagListEl, deps.getTags(row.id), doc)
    const statusSlot = rowEl.querySelector<HTMLElement>('[data-dsh-active-status]')
    if (statusSlot !== null) {
      syncStatusSlot(statusSlot, resolveRowStatus({
        pendingKind: deps.pendingKindOf(row.id),
        running: byIdNow[row.id]?.running,
        completed: byIdNow[row.id]?.completed,
        runningSubagentCount: subagentCounts.get(row.id) ?? 0,
      }), doc)
    }
  }
}

/**
 * 启动活跃区：注入样式 + 幂等 sync + 订阅会话/钉/pending 变更 + 文档级点击，
 * 返回清理函数。
 * @param deps - 注入的依赖（会话列表/打开/钉读取/pending）。
 * @returns 清理函数。
 */
export function startActiveStrip(deps: ActiveStripDeps): () => void {
  const doc = document
  const removeCss = injectCss()
  const removeTagCss = injectTagCss()
  const removeMenuCss = injectMenuCss()
  const stripRef: { el: HTMLElement | null } = { el: null }
  const sync = (): void => syncRows(deps, doc, stripRef)

  // 只响应活跃区之外的变更（React 重排/会话页流式渲染等）——本区内的写入全是
  // 我们自己的 sync 产生的，忽略它们，避免「sync 写 DOM → observer → sync」自触发
  // 回环（与置顶区同契约，见 session-pin-status-sync-convergence）。
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      const target = record.target
      if (!(target instanceof Element) || target.closest(`[${ACTIVE_STRIP_ATTR}]`) === null) {
        sync()
        return
      }
    }
  })
  observer.observe(doc.body, { childList: true, subtree: true })

  const unsubSessions = deps.sessions.subscribe(sync)
  const unsubSettings = deps.subscribeSettings(sync)
  const unsubPending = deps.subscribePending(sync)
  const unsubTags = deps.subscribeTags(sync)

  const rowOf = (target: EventTarget | null): HTMLElement | null =>
    target instanceof Element ? target.closest<HTMLElement>(`[${ACTIVE_ROW_ATTR}]`) : null
  const menuButtonOf = (target: EventTarget | null): HTMLElement | null =>
    target instanceof Element ? target.closest<HTMLElement>(`[${MENU_BUTTON_ATTR}]`) : null
  const insideStrip = (target: EventTarget | null): boolean =>
    target instanceof Element && target.closest(`[${ACTIVE_STRIP_ATTR}]`) !== null

  /** 打开该行的行菜单（编辑标签 / 添加到置顶区）。 */
  const openMenuFor = (row: HTMLElement, button: HTMLElement | null, id: string): void => {
    openRowMenu({
      anchor: row,
      button,
      items: [
        {
          id: 'edit-tags',
          label: '编辑标签…',
          onSelect: () => {
            openTagEditor({
              sessionId: id,
              anchor: row,
              getTags: (sid) => deps.getTags(sid),
              setTags: (sid, tags) => deps.setTags(sid, tags),
            })
          },
        },
        {
          id: 'pin',
          label: '添加到置顶区',
          onSelect: () => {
            const pinned = [...new Set([...deps.getPinned()].map((x) => String(x)))]
            if (pinned.includes(id)) return
            deps.setPinned([...pinned, id])
          },
        },
      ],
    })
  }

  const onClickDoc = (e: MouseEvent): void => {
    if (!insideStrip(e.target)) return
    const row = rowOf(e.target)
    if (row === null) return
    const id = row.dataset.sessionId ?? ''
    // 行尾「⋯」：打开行菜单（不切换会话）。
    if (menuButtonOf(e.target) !== null) {
      e.preventDefault()
      e.stopPropagation()
      if (id !== '') openMenuFor(row, menuButtonOf(e.target), id)
      return
    }
    if (id !== '') deps.open(id)
  }
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
  // 点标签面板之外 → 关闭面板（按 target 排除，同节点监听器不受 stopPropagation 影响）。
  const onDocClickCloseEditor = (e: MouseEvent): void => {
    const target = e.target
    if (target instanceof Element
      && (target.closest(`[${TAG_EDITOR_ATTR}]`) !== null
        || target.closest(`[${MENU_ATTR}]`) !== null
        || target.closest(`[${MENU_BUTTON_ATTR}]`) !== null)) return
    closeTagEditor()
    closeRowMenu()
  }
  doc.addEventListener('click', onClickDoc)
  doc.addEventListener('click', onDocClickCloseEditor)
  doc.addEventListener('keydown', onKeyDownDoc)

  sync()
  return () => {
    unsubSessions()
    unsubSettings()
    unsubPending()
    unsubTags()
    observer.disconnect()
    doc.removeEventListener('click', onClickDoc)
    doc.removeEventListener('click', onDocClickCloseEditor)
    doc.removeEventListener('keydown', onKeyDownDoc)
    closeTagEditor()
    closeRowMenu()
    stripRef.el?.remove()
    stripRef.el = null
    removeCss()
    removeTagCss()
    removeMenuCss()
  }
}
