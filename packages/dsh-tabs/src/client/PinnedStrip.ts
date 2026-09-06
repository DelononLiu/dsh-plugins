/**
 * dsh-tabs 左侧栏「置顶」区（client 半区，DOM 注入）——官方左侧栏「会话/
 * 工作区列表」之上的一块只读区，镜像 dsh-tabs 的固定会话列表（同一份
 * `dsh-tabs-pinned` settings 数据，天然两边同步）。
 *
 * 数据/交互契约（与会话 tab 行同源，见 index.ts）：
 * - 固定列表 = settings 命名空间 `dsh-tabs-pinned` 的 `pinned`（Alt+P 钉/取消
 *   钉仍由会话 tab 行负责；本区只读，无钉/取消钉入口）。
 * - 只显示仍存在的会话（按当前会话快照的 ids 过滤）＋ 标题取 byId.displayTitle。
 * - 行可见文本带 `N.` 编号前缀（钉序第 N，与会话 tab 行编号一致；行增删自动
 *   重编号）；tooltip/aria-label 保持纯标题。
 * - 点击条目 = 打开该会话（ctx.sessions.open，与点击左侧会话同路径——切换后
 *   dsh-tabs 自己的 current 订阅会更新 tab 行划线等派生状态）。
 *
 * 挂载机制（抄 dsh-desk 工具入口组装器先例）：MutationObserver + 直接 DOM
 * 注入——等官方侧边栏渲染后把本区插到 sidebar root 的 regionArea 之前
 * （列表区上方）；React 重挂/重排导致丢失时自愈重插。折叠（rail）态由
 * frame 的 `data-sidebar-collapsed` 属性经 CSS 隐藏，不干扰窄列图标。
 */

/** 置顶区根标记（幂等定位 + 自愈锚点）。 */
export const PINNED_STRIP_ATTR = 'data-dsh-pinned-strip'
/** 置顶区标题（与会话 tab 同域，中文环境沿用中文文案）。 */
const PINNED_LABEL = '置顶区'
/** 行按钮标记。 */
const PINNED_ROW_ATTR = 'data-dsh-pinned-row'
/** 当前会话行标记（行内标题着色，对齐会话 tab 的划线色）。 */
const PINNED_CURRENT_ATTR = 'data-dsh-pinned-current'
/** 幂等样式标签标记（同 dsh-desk `data-plugin-css` 约定）。 */
const CSS_TAG_SELECTOR = 'style[data-plugin-css="@dsh-tabs/pinned-strip"]'

/** 置顶区需要的最小会话列表快照（绕开官方 SessionId 品牌类型）。 */
export interface PinnedListSnapshot {
  current?: string | undefined
  ids: readonly string[]
  byId: Record<string, { displayTitle?: string }>
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
  /** 打开会话（点击置顶条目 = ctx.sessions.open）。 */
  open(id: string): void
}

/**
 * 从固定列表 + 会话快照派生置顶行：按钉顺序、去重、剔除已不存在的会话、
 * 标题取 displayTitle（缺省回退 id）、标记当前会话。纯函数，便于单测。
 * @param pinned - settings 里的固定 id 列表。
 * @param list - 会话列表快照。
 * @returns 派生置顶行。
 */
export function derivePinnedRows(pinned: readonly string[], list: PinnedListSnapshot): PinnedRow[] {
  const current = list.current === undefined ? undefined : String(list.current)
  const byId = list.byId as Record<string, { displayTitle?: string }>
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

/** 置顶区样式（对齐官方侧边栏契约：行 32px/圆角 8/悬停底；标题 14px）。 */
function pinnedCss(): string {
  return [
    `[${PINNED_STRIP_ATTR}]{flex:none;display:flex;flex-direction:column;gap:2px;min-width:0;box-sizing:border-box;margin:0 2px 6px;user-select:none}`,
    `[${PINNED_STRIP_ATTR}] [data-dsh-pinned-label]{padding:4px 8px 0;font-size:12px;line-height:20px;color:var(--dsw-alias-label-tertiary)}`,
    `[${PINNED_STRIP_ATTR}] [${PINNED_ROW_ATTR}]{display:flex;align-items:center;gap:0;box-sizing:border-box;width:100%;height:32px;padding:0 8px;border:none;border-radius:8px;background:transparent;cursor:pointer;overflow:hidden;color:var(--dsw-alias-label-primary);font-family:inherit;font-size:14px;line-height:20px;text-align:left}`,
    `[${PINNED_STRIP_ATTR}] [${PINNED_ROW_ATTR}]:hover{background:var(--dsw-alias-interactive-bg-hover)}`,
    // 当前会话行：悬停同款底 + 标题用会话 tab 划线的品牌色（单一强调）。
    `[${PINNED_STRIP_ATTR}] [${PINNED_ROW_ATTR}][${PINNED_CURRENT_ATTR}]{background:var(--dsw-alias-interactive-bg-hover)}`,
    `[${PINNED_STRIP_ATTR}] [${PINNED_ROW_ATTR}][${PINNED_CURRENT_ATTR}] [data-dsh-pinned-title]{color:var(--dsw-alias-state-business-primary)}`,
    `[${PINNED_STRIP_ATTR}] [data-dsh-pinned-title]{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}`,
    // 官方折叠（rail）：AppFrame 折叠时给 frame 加 data-sidebar-collapsed，整区隐藏。
    `[data-sidebar-collapsed] [${PINNED_STRIP_ATTR}]{display:none}`,
  ].join('')
}

/** 幂等注入样式（bundle 加载即执行；已注入则跳过）。返回移除函数。 */
function injectCss(): () => void {
  if (typeof document === 'undefined') return () => {}
  if (document.querySelector(CSS_TAG_SELECTOR) !== null) return () => {}
  const tag = document.createElement('style')
  tag.dataset.plugin = 'dsh-tabs'
  tag.dataset.pluginCss = '@dsh-tabs/pinned-strip'
  tag.textContent = pinnedCss()
  document.head.appendChild(tag)
  return () => tag.remove()
}

/**
 * 官方侧边栏座位：sidebar 列的 root（logoRow 的 parentElement，兜底首个子元素）
 * 与其内 regionArea（会话/工作区浏览区，置顶区插到它之前 = 列表上方）。
 */
function sidebarSeat(doc: Document): { root: HTMLElement; region: HTMLElement } | null {
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

/** 行按钮（首次创建；标题 span 由后续 sync 更新）。 */
function makeRow(doc: Document, row: PinnedRow, open: (id: string) => void): HTMLButtonElement {
  const btn = doc.createElement('button')
  btn.type = 'button'
  btn.setAttribute(PINNED_ROW_ATTR, '')
  btn.dataset.sessionId = row.id
  const title = doc.createElement('span')
  title.setAttribute('data-dsh-pinned-title', '')
  btn.appendChild(title)
  btn.addEventListener('click', () => { open(row.id) })
  return btn
}

/** 幂等同步：按派生行补齐/删除/更新/排序置顶区 DOM；无钉或座位缺席时移除。 */
function syncRows(deps: PinnedStripDeps, doc: Document, stripRef: { el: HTMLElement | null }): void {
  const rows = derivePinnedRows(deps.getPinned(), deps.sessions.getSnapshot())
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
  // 座位：插到 regionArea 之前（列表区上方）；React 重排导致移位时重插。
  if (strip.parentElement !== seat.root || strip.nextElementSibling !== seat.region) {
    seat.root.insertBefore(strip, seat.region)
  }
  const listEl = strip.querySelector<HTMLElement>('[data-dsh-pinned-list]')
  if (listEl === null) return
  const existing = new Map<string, HTMLButtonElement>()
  for (const btn of Array.from(listEl.querySelectorAll<HTMLButtonElement>(`button[${PINNED_ROW_ATTR}]`))) {
    existing.set(btn.dataset.sessionId ?? '', btn)
  }
  const wanted = new Set(rows.map((row) => row.id))
  for (const [id, btn] of existing) {
    if (wanted.has(id)) continue
    btn.remove()
    existing.delete(id)
  }
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    let btn = existing.get(row.id)
    if (btn === undefined || btn.parentElement !== listEl) {
      btn = makeRow(doc, row, deps.open)
      listEl.appendChild(btn)
      existing.set(row.id, btn)
    }
    // 轻量字段同步（标题/当前标记；滚动/悬停不打断——按钮不重建）。
    if (row.current) {
      btn.setAttribute(PINNED_CURRENT_ATTR, '')
      btn.setAttribute('aria-current', 'true')
    } else {
      btn.removeAttribute(PINNED_CURRENT_ATTR)
      btn.removeAttribute('aria-current')
    }
    btn.setAttribute('aria-label', row.title)
    btn.title = row.title
    const titleEl = btn.querySelector<HTMLElement>('[data-dsh-pinned-title]')
    // 可见文本带编号前缀（钉序第 N，与会话 tab 行编号一致）；tooltip/aria 保持纯标题。
    const label = `${i + 1}. ${row.title}`
    if (titleEl !== null && titleEl.textContent !== label) titleEl.textContent = label
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
 * @param deps - 数据/打开注入（getPinned/subscribeSettings/sessions/open）。
 * @returns 卸载函数。
 */
export function startPinnedStrip(deps: PinnedStripDeps): () => void {
  if (typeof document === 'undefined') return () => {}
  const doc = document
  const removeCss = injectCss()
  const stripRef: { el: HTMLElement | null } = { el: null }
  const sync = (): void => syncRows(deps, doc, stripRef)
  const unsubSettings = deps.subscribeSettings(sync)
  const unsubSessions = deps.sessions.subscribe(sync)
  const observer = new MutationObserver(sync)
  observer.observe(doc.body, { childList: true, subtree: true })
  sync()
  return () => {
    unsubSettings()
    unsubSessions()
    observer.disconnect()
    stripRef.el?.remove()
    stripRef.el = null
    removeCss()
  }
}
