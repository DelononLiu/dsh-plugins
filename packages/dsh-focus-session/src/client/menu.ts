/**
 * 行尾「⋯」菜单（client 半区）——置顶区/活跃区会话行的操作入口。
 *
 * 形状、配色、尺寸、定位逐条照官方基准，不手写近似。基准（kernel 0.1.2-rc.1）：
 * - 卡片 = `ui-primitives/src/Menu.module.css` 的 `.list`/`.portal`：`padding:4px`、
 *   `border-radius:20px`、`min-width:218px`、`max-width:360px`、
 *   `max-height:calc(100vh - 24px)`、`z-index:1100`、底 `--dsw-specific-menu`、
 *   `--dsw-elevation-stroke-color:var(--dsw-alias-border-l1)` +
 *   `box-shadow:var(--dsw-elevation-prominent)`、滚动条取 l2 elevation token。
 * - 滚动结构 = 官方 `.viewport`：卡片本身不滚，内层视口滚（`overflow-y:auto`）。
 * - 菜单项 = 官方 `.item`：`min-height:40px`、`padding:8px 10px`、`border-radius:10px`、
 *   `gap:8px`、`14px/22px`、hover `--dsw-alias-interactive-bg-hover`、disabled `opacity:.4`、
 *   danger 用 `--dsw-alias-state-error-primary`；配套 `.itemIcon`（16×16、
 *   `--dsw-alias-label-tertiary`）与 `.itemLabel`（省略号）。
 * - 触发按钮 = 官方 `.iconButton`（`ui-workspace/src/client/rows/Rows.module.css`）：
 *   16×16、`border-radius:4px`、无边框、`--dsw-alias-label-tertiary`、hover 转 primary。
 * - 交互 = 官方 session 行用法（`ui-workspace/src/client/rows/Rows.tsx`）：`portal`
 *   固定定位（按锚点矩形算位、开着期间跟随 scroll/resize）、`closeOnPointerLeave`
 *   （`pointer-grace.ts` 的 `POINTER_GRACE_MS=200`）、点项/点外/Esc 关闭；菜单打开期间
 *   行保持 hover 底（官方 `.sessionRow.menuOpen`）。
 *
 * 定位算术照官方 `Menu.tsx` 的 `place()`：`MARGIN=12`、`align:'start'` 取锚点左边、
 * `side:'bottom'` 取 `rect.bottom + 4`，随后 clamp 进视口。
 */

/** 菜单卡片标记。 */
export const MENU_ATTR = 'data-dsh-row-menu'
/** 卡片内滚动视口标记（官方 `.viewport` 对应物）。 */
export const MENU_VIEWPORT_ATTR = 'data-dsh-row-menu-viewport'
/** 菜单项标记。 */
export const MENU_ITEM_ATTR = 'data-dsh-row-menu-item'
/** 触发按钮标记（行尾 ⋯）。 */
export const MENU_BUTTON_ATTR = 'data-dsh-row-menu-button'
/** 菜单打开期间打在锚点行上的标记（官方 `.menuOpen`：行保持 hover 底）。 */
export const MENU_OPEN_ROW_ATTR = 'data-dsh-row-menu-open'
/** 幂等样式标签标记（同 dsh-desk `data-plugin-css` 约定）。 */
const CSS_TAG_SELECTOR = 'style[data-plugin-css="@dsh-focus-session/row-menu"]'

/** 指针宽限（ms）——官方 `ui-primitives/src/pointer-grace.ts`。 */
export const POINTER_GRACE_MS = 200
/** 视口边距（px）——官方 `Menu.tsx` 的 `MARGIN`。 */
const VIEWPORT_MARGIN = 12
/** 锚点与卡片间距（px）——官方 `.list` 的 `top: calc(100% + 4px)`。 */
const ANCHOR_GAP = 4

/** 一个菜单项（官方 `MenuItem` 在本包用到的子集）。 */
export interface RowMenuItem {
  /** 稳定标识（测试与事件判据用）。 */
  id: string
  /** 显示文字。 */
  label: string
  /** 选中回调（菜单随即关闭）。 */
  onSelect(): void
  /** 危险项：文字/图标用错误色（官方 `.danger`）。 */
  danger?: boolean
  /** 禁用项：`opacity:.4` 且不可点（官方 `.item:disabled`）。 */
  disabled?: boolean
}

/** 打开菜单的选项（默认值与官方 session 行用法一致）。 */
export interface RowMenuOptions {
  /** 定位锚点（触发按钮所在的行）。 */
  anchor: HTMLElement
  /** 触发按钮（复位 aria-expanded、指针宽限判定）。 */
  button?: HTMLElement | null
  /** 菜单项。 */
  items: readonly RowMenuItem[]
  /** 对齐：`start` 左对齐锚点、`end` 右对齐（官方 `align`）。 */
  align?: 'start' | 'end'
  /** 展开方向：`bottom` 下方 / `top` 上方（官方 `side`）。 */
  side?: 'bottom' | 'top'
  /** 指针离开触发按钮与卡片后宽限关闭（官方 session 行的 `closeOnPointerLeave`）。 */
  closeOnPointerLeave?: boolean
}

/** 菜单样式（值逐条取自官方 `Menu.module.css` / `Rows.module.css`）。 */
export function menuCss(): string {
  return [
    // 行尾 ⋯ 触发按钮（官方 .iconButton）。
    `[${MENU_BUTTON_ATTR}]{flex:none;display:none;align-items:center;justify-content:center;width:16px;height:16px;padding:0;border:none;border-radius:4px;background:transparent;cursor:pointer;color:var(--dsw-alias-label-tertiary)}`,
    `[${MENU_BUTTON_ATTR}]:hover{color:var(--dsw-alias-label-primary)}`,
    `[data-dsh-pinned-row]:hover [${MENU_BUTTON_ATTR}],[data-dsh-pinned-row]:focus-within [${MENU_BUTTON_ATTR}],[data-dsh-active-row]:hover [${MENU_BUTTON_ATTR}],[data-dsh-active-row]:focus-within [${MENU_BUTTON_ATTR}],[${MENU_BUTTON_ATTR}][aria-expanded='true']{display:inline-flex}`,
    // 菜单打开期间行保持 hover 底（官方 .sessionRow.menuOpen）。
    `[data-dsh-pinned-row][${MENU_OPEN_ROW_ATTR}],[data-dsh-active-row][${MENU_OPEN_ROW_ATTR}]{background:var(--dsw-alias-interactive-bg-hover)}`,
    // 卡片（官方 .list/.portal）。
    `[${MENU_ATTR}]{position:fixed;z-index:1100;box-sizing:border-box;display:flex;flex-direction:column;gap:0;padding:4px;border:0;border-radius:20px;min-width:218px;max-width:360px;max-height:calc(100vh - 24px);background:var(--dsw-specific-menu);--dsw-elevation-stroke-color:var(--dsw-alias-border-l1);box-shadow:var(--dsw-elevation-prominent);color:var(--dsw-alias-label-primary);--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2)}`,
    // 滚动视口（官方 .viewport：卡片不滚、视口滚）。
    `[${MENU_VIEWPORT_ATTR}]{display:flex;flex-direction:column;min-height:0;overflow-y:auto}`,
    // 菜单项（官方 .item）。
    `[${MENU_ITEM_ATTR}]{display:flex;align-items:center;gap:8px;box-sizing:border-box;width:100%;min-height:40px;padding:8px 10px;border:none;border-radius:10px;background:transparent;cursor:pointer;font-family:inherit;font-size:14px;line-height:22px;color:var(--dsw-alias-label-primary);text-align:left}`,
    `[${MENU_ITEM_ATTR}]:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}`,
    `[${MENU_ITEM_ATTR}]:disabled{opacity:.4;cursor:not-allowed}`,
    `[${MENU_ITEM_ATTR}][data-danger]{color:var(--dsw-alias-state-error-primary)}`,
    // 图标槽/文字（官方 .itemIcon / .itemLabel）。
    `[${MENU_ITEM_ATTR}] [data-dsh-row-menu-icon]{display:inline-flex;flex:none;width:16px;height:16px;align-items:center;justify-content:center;color:var(--dsw-alias-label-tertiary)}`,
    `[${MENU_ITEM_ATTR}][data-danger] [data-dsh-row-menu-icon]{color:var(--dsw-alias-state-error-primary)}`,
    `[${MENU_ITEM_ATTR}] [data-dsh-row-menu-label]{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}`,
  ].join('')
}

/** 样式引用计数（两个区共用一份；任一方卸载不摘掉另一方在用的样式）。 */
let menuCssRefs = 0

/**
 * 幂等注入菜单样式；引用计数归零才摘除。
 * @returns 释放函数。
 */
export function injectMenuCss(): () => void {
  if (typeof document === 'undefined') return () => {}
  menuCssRefs++
  let released = false
  const release = (): void => {
    if (released) return
    released = true
    menuCssRefs = Math.max(0, menuCssRefs - 1)
    if (menuCssRefs === 0) document.querySelector(CSS_TAG_SELECTOR)?.remove()
  }
  if (menuCssRefs > 1) return release
  const tag = document.createElement('style')
  tag.dataset.plugin = 'dsh-focus-session'
  tag.dataset.pluginCss = '@dsh-focus-session/row-menu'
  tag.textContent = menuCss()
  document.head.appendChild(tag)
  return release
}

/** 当前打开的菜单（单例）。 */
let openMenu: {
  el: HTMLElement
  button: HTMLElement | null
  anchor: HTMLElement
  graceTimer: ReturnType<typeof setTimeout> | null
  dispose: () => void
} | null = null

/** 关闭当前菜单（若有）：复位展开态与行标记、摘除监听与指针宽限计时。 */
export function closeRowMenu(): void {
  const current = openMenu
  if (current === null) return
  openMenu = null
  if (current.graceTimer !== null) clearTimeout(current.graceTimer)
  current.dispose()
  current.button?.setAttribute('aria-expanded', 'false')
  current.anchor.removeAttribute(MENU_OPEN_ROW_ATTR)
  current.el.remove()
}

/**
 * 行尾「⋯」触发按钮（官方 `.iconButton` 形态：三点横排 svg，16×16）。
 * @param doc - 文档（测试注入）。
 * @returns 按钮元素。
 */
export function makeMenuButton(doc: Document): HTMLButtonElement {
  const button = doc.createElement('button')
  button.type = 'button'
  button.setAttribute(MENU_BUTTON_ATTR, '')
  button.setAttribute('aria-haspopup', 'menu')
  button.setAttribute('aria-expanded', 'false')
  button.title = '更多操作'
  button.setAttribute('aria-label', '更多操作')
  const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', '0 0 16 16')
  svg.setAttribute('width', '16')
  svg.setAttribute('height', '16')
  svg.setAttribute('fill', 'currentColor')
  svg.setAttribute('aria-hidden', 'true')
  for (const cx of ['3.5', '8', '12.5']) {
    const dot = doc.createElementNS('http://www.w3.org/2000/svg', 'circle')
    dot.setAttribute('cx', cx)
    dot.setAttribute('cy', '8')
    dot.setAttribute('r', '1.25')
    svg.appendChild(dot)
  }
  button.appendChild(svg)
  return button
}

/**
 * 打开行尾菜单（单例；已开则先关）。定位与关闭语义照官方：portal 固定定位、
 * 开着期间跟随版面滚动与窗口尺寸、点外（pointerdown）/Esc/选中关闭；指针离开
 * 触发按钮与卡片后按 {@link POINTER_GRACE_MS} 宽限关闭。
 * @param options - 锚点、触发按钮、菜单项与对齐/方向/指针宽限选项。
 */
export function openRowMenu(options: RowMenuOptions): void {
  const { anchor, items, align = 'start', side = 'bottom', closeOnPointerLeave = true } = options
  const button = options.button ?? null
  const doc = anchor.ownerDocument
  const win = doc.defaultView ?? window
  closeRowMenu()

  const card = doc.createElement('div')
  card.setAttribute(MENU_ATTR, '')
  card.setAttribute('role', 'menu')
  const viewport = doc.createElement('div')
  viewport.setAttribute(MENU_VIEWPORT_ATTR, '')
  card.appendChild(viewport)
  for (const item of items) {
    const el = doc.createElement('button')
    el.type = 'button'
    el.setAttribute(MENU_ITEM_ATTR, '')
    el.dataset.menuItem = item.id
    el.setAttribute('role', 'menuitem')
    if (item.danger === true) el.setAttribute('data-danger', '')
    el.disabled = item.disabled === true
    const label = doc.createElement('span')
    label.setAttribute('data-dsh-row-menu-label', '')
    label.textContent = item.label
    el.appendChild(label)
    if (item.disabled !== true) {
      el.addEventListener('click', (e) => {
        e.preventDefault()
        e.stopPropagation()
        closeRowMenu()
        item.onSelect()
      })
    }
    viewport.appendChild(el)
  }
  card.addEventListener('click', (e) => e.stopPropagation())

  // 先隐藏挂在固定原点测量真实尺寸（官方 MEASURE_STYLE：定位算术要用真宽高）。
  card.style.visibility = 'hidden'
  card.style.left = '0px'
  card.style.top = '0px'
  doc.body.appendChild(card)

  /** 依官方 `Menu.tsx` 的 `place()`：锚点矩形算位 → clamp 进视口（MARGIN=12）。 */
  const reposition = (): void => {
    const rect = anchor.getBoundingClientRect()
    const width = card.offsetWidth
    const height = card.offsetHeight
    let x = align === 'start' ? rect.left : rect.right - width
    let y = side === 'bottom' ? rect.bottom + ANCHOR_GAP : rect.top - height - ANCHOR_GAP
    if (width > 0) x = Math.min(Math.max(x, VIEWPORT_MARGIN), win.innerWidth - width - VIEWPORT_MARGIN)
    if (height > 0) y = Math.min(Math.max(y, VIEWPORT_MARGIN), win.innerHeight - height - VIEWPORT_MARGIN)
    card.style.left = `${Math.round(x)}px`
    card.style.top = `${Math.round(y)}px`
  }
  reposition()
  card.style.visibility = ''

  const onPointerDown = (e: Event): void => {
    const target = e.target
    if (!(target instanceof Node)) return
    if (card.contains(target)) return
    if (button?.contains(target) === true) return
    closeRowMenu()
  }
  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') closeRowMenu()
  }
  const armGrace = (): void => {
    if (openMenu === null) return
    if (openMenu.graceTimer !== null) clearTimeout(openMenu.graceTimer)
    openMenu.graceTimer = setTimeout(() => closeRowMenu(), POINTER_GRACE_MS)
  }
  const cancelGrace = (): void => {
    if (openMenu === null || openMenu.graceTimer === null) return
    clearTimeout(openMenu.graceTimer)
    openMenu.graceTimer = null
  }
  doc.addEventListener('pointerdown', onPointerDown, true)
  doc.addEventListener('keydown', onKeyDown)
  // 跟随版面滚动（capture 捕获内层滚动容器）与窗口尺寸变化——官方同款监听。
  win.addEventListener('scroll', reposition, true)
  win.addEventListener('resize', reposition)
  if (closeOnPointerLeave) {
    card.addEventListener('mouseenter', cancelGrace)
    card.addEventListener('mouseleave', armGrace)
    button?.addEventListener('mouseenter', cancelGrace)
    button?.addEventListener('mouseleave', armGrace)
  }

  openMenu = {
    el: card,
    button,
    anchor,
    graceTimer: null,
    dispose: (): void => {
      doc.removeEventListener('pointerdown', onPointerDown, true)
      doc.removeEventListener('keydown', onKeyDown)
      win.removeEventListener('scroll', reposition, true)
      win.removeEventListener('resize', reposition)
      if (closeOnPointerLeave) {
        card.removeEventListener('mouseenter', cancelGrace)
        card.removeEventListener('mouseleave', armGrace)
        button?.removeEventListener('mouseenter', cancelGrace)
        button?.removeEventListener('mouseleave', armGrace)
      }
    },
  }
  button?.setAttribute('aria-expanded', 'true')
  anchor.setAttribute(MENU_OPEN_ROW_ATTR, '')
  viewport.querySelector<HTMLElement>(`[${MENU_ITEM_ATTR}]`)?.focus()
}
