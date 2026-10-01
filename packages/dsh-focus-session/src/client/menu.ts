/**
 * 行尾「⋯」菜单（client 半区）——置顶区/活跃区会话行的操作入口。
 *
 * 形状、配色、尺寸、定位逐条照官方基准，不手写近似。基准（kernel 0.1.7-rc.2，
 * 取本机内核 `~/dsh-017-cli/node_modules/@deepseek-ai/` 的编译产物）：
 * - 卡片表面 = 官方 `dsh-client-ui-primitives/lib/MenuSurface.module.css:1-29`：
 *   外圆角 `--dsw-radius-lg`（16px）、`isolation:isolate`；底由内层 `.material` 提供
 *   ——`background:var(--dsw-menu-surface-fill)`（浅 `#f8f9fa94` / 深 `#43454a73`，
 *   定义在 `dsh-client-ui-theme/lib/client.js`）+ `backdrop-filter:var(--dsw-menu-backdrop-filter)`
 *   （`blur(40px) saturate(150%)`），`position:absolute;inset:0;z-index:-1`。
 *   卡片本身**不着色**（官方把底与模糊隔离在一层，避免祖先 backdrop root）。官方
 *   在 `html[data-platform='darwin']` 下另挂 `.backing` 不透明层（CSS anchor 定位）
 *   给原生 vibrancy 兜底，克隆未复刻该层。
 * - 卡片几何 = 官方 `lib/Menu.module.css` 的 `.list`(7-39)/`.portal`(41-45)/
 *   `.scrollable`(65-67)：`padding:4px`、`min-width:144px`、`max-width:360px`、
 *   `max-height:calc(100vh - 12px - max(12px, var(--dsh-frame-top-clearance, 12px)))`、
 *   portal 态 `position:fixed;z-index:1100`、`border:0`、
 *   `--dsw-elevation-stroke-color:var(--dsw-alias-border-l1)` +
 *   `box-shadow:var(--dsw-elevation-prominent)`、滚动条取 l2 elevation token。
 * - 滚动结构 = 官方 `.viewport`（`Menu.module.css:69-77`）：卡片本身不滚，内层视口滚。
 * - 菜单项 = 官方 `.item`（`Menu.module.css:95-131`）：`min-height:34px`、
 *   `padding:6px 8px`、`border-radius:var(--dsw-radius-md)`（12px）、`gap:6px`、
 *   `13px/20px`、hover/focus-visible `--dsw-alias-interactive-bg-hover`、disabled
 *   `opacity:.4`、danger 用 `--dsw-alias-state-error-primary` + hover
 *   `--dsw-alias-interactive-bg-hover-danger`（226-241）；配套 `.itemIcon`（168-176）：
 *   14×14、`--dsw-alias-menu-icon`，与 `.itemLabel`（190-192）省略号。
 * - 触发按钮 = 官方会话行 `.iconButton`（`dsh-client-ui-workspace/lib/client.js` 的
 *   Rows 样式，会话行 ⋯ 用同款）：16×16、`border-radius:var(--dsw-radius-xs)`（4px）、
 *   无边框、`--dsw-alias-label-tertiary`、hover 转 primary。
 * - 交互 = 官方 session 行用法（`dsh-client-ui-workspace/lib/client.js:1642-1660` 的
 *   会话行 ⋯ `Menu`：`portal:true` + `closeOnPointerLeave:true` + anchor=触发按钮）：
 *   portal 固定定位（按触发按钮矩形算位、开着期间跟随 scroll(capture)/resize 且每帧
 *   `track()`）、点项/点外/Esc 关闭；菜单打开期间行保持 hover 底（官方 `.sessionRow.menuOpen`）。
 *
 * 定位算术照官方 `Menu` 的 `place()`（`dsh-client-ui-primitives/lib/index.js` 的 Menu
 * useLayoutEffect，约 3940-3969 行）：`MARGIN=12`、`align:'start'` 取**触发按钮**矩形
 * 左边（官方 anchor 即按钮，Menu 的包装 span 收缩到按钮，`place()` 量的是包装 span）、
 * `side:'bottom'` 取 `rect.bottom + 4`；`x` clamp 到 `[MARGIN, vw - lw - MARGIN]`，
 * `y` clamp 到 `[overlayTopMargin(MARGIN), vh - lh - MARGIN]`——上边距经
 * `overlay-top-margin.ts`（index.js:3517）用 `--dsh-frame-top-clearance` 放宽（macOS 标题条）。
 * 官方开菜单时起一个 `track()` rAF 每帧调 `place()`（跟随不触发 scroll/resize 的移动），
 * 克隆同样实现，并按坐标去重避免每帧写样式。
 */

import { createElement, type ReactNode } from 'react'
import { flushSync } from 'react-dom'
import { createRoot, type Root } from 'react-dom/client'

/** 菜单卡片标记。 */
export const MENU_ATTR = 'data-dsh-row-menu'
/** 卡片表面材质层标记（官方 `MenuSurface` 的 `.material`：底色 + backdrop-filter）。 */
export const MENU_MATERIAL_ATTR = 'data-dsh-row-menu-material'
/** 卡片内滚动视口标记（官方 `.viewport` 对应物）。 */
export const MENU_VIEWPORT_ATTR = 'data-dsh-row-menu-viewport'
/** 菜单项标记。 */
export const MENU_ITEM_ATTR = 'data-dsh-row-menu-item'
/** 触发按钮标记（行尾 ⋯）。 */
export const MENU_BUTTON_ATTR = 'data-dsh-row-menu-button'
/** 菜单打开期间打在锚点行上的标记（官方 `.menuOpen`：行保持 hover 底）。 */
export const MENU_OPEN_ROW_ATTR = 'data-dsh-row-menu-open'
/** 幂等样式标签标记（沿用本仓 `data-plugin-css` 约定）。 */
const CSS_TAG_SELECTOR = 'style[data-plugin-css="@dsh-focus-session/row-menu"]'

/** 指针宽限（ms）——官方 `ui-primitives/src/pointer-grace.ts`。 */
export const POINTER_GRACE_MS = 200
/** 视口边距（px）——官方 `place()` 的 `MARGIN`。 */
const VIEWPORT_MARGIN = 12
/** 锚点与卡片间距（px）——官方 `place()` 的 `rect.bottom + 4`（`.list` 的 `top: calc(100% + 4px)` 同值）。 */
const ANCHOR_GAP = 4

/**
 * 顶层浮层与视口上沿的净空（官方 `overlay-top-margin.ts`，`index.js:3517`）：至少
 * `min`，macOS 桌面由框架在根元素发布的 `--dsh-frame-top-clearance` 放宽。
 * @param doc - 文档。
 * @param min - 本浮层自带的视口边距下限。
 * @returns 实际使用的上边距（px）。
 */
function overlayTopMargin(doc: Document, min: number): number {
  const raw = doc.defaultView?.getComputedStyle(doc.documentElement).getPropertyValue('--dsh-frame-top-clearance') ?? ''
  const clearance = Number.parseFloat(raw)
  return Number.isNaN(clearance) ? min : Math.max(min, clearance)
}

/** 一个菜单项（官方 `MenuItem` 在本包用到的子集）。 */
export interface RowMenuItem {
  /** 稳定标识（测试与事件判据用）。 */
  id: string
  /** 显示文字。 */
  label: string
  /** 前导图标（官方 `.itemIcon` 16×16 槽位）；React 节点，按官方图标集导出复用。 */
  icon?: ReactNode
  /** 选中回调（菜单随即关闭）。 */
  onSelect(): void
  /** 危险项：文字/图标用错误色（官方 `.danger`）。 */
  danger?: boolean
  /** 禁用项：`opacity:.4` 且不可点（官方 `.item:disabled`）。 */
  disabled?: boolean
}

/** 打开菜单的选项（默认值与官方 session 行用法一致）。 */
export interface RowMenuOptions {
  /** 打开标记的落点行（官方 `.sessionRow.menuOpen` 的 hover 底；无按钮时兼作定位锚点）。 */
  anchor: HTMLElement
  /** 触发按钮（定位锚点、复位 aria-expanded、指针宽限判定；官方 anchor 即此按钮）。 */
  button?: HTMLElement | null
  /** 菜单项。 */
  items: readonly RowMenuItem[]
  /** 对齐：`start` 左对齐触发按钮、`end` 右对齐（官方 `align`）。 */
  align?: 'start' | 'end'
  /** 展开方向：`bottom` 下方 / `top` 上方（官方 `side`）。 */
  side?: 'bottom' | 'top'
  /** 指针离开触发按钮与卡片后宽限关闭（官方 session 行的 `closeOnPointerLeave`）。 */
  closeOnPointerLeave?: boolean
}

/** 菜单样式（值逐条取自官方 `Menu.module.css` / `MenuSurface.module.css` / Rows 的 `.iconButton`）。 */
export function menuCss(): string {
  return [
    // 行尾 ⋯ 触发按钮（官方 .iconButton）。
    `[${MENU_BUTTON_ATTR}]{flex:none;display:none;align-items:center;justify-content:center;width:16px;height:16px;padding:0;border:none;border-radius:var(--dsw-radius-xs);background:transparent;cursor:pointer;color:var(--dsw-alias-label-tertiary)}`,
    `[${MENU_BUTTON_ATTR}]:hover{color:var(--dsw-alias-label-primary)}`,
    `[data-dsh-pinned-row]:hover [${MENU_BUTTON_ATTR}],[data-dsh-pinned-row]:focus-within [${MENU_BUTTON_ATTR}],[data-dsh-active-row]:hover [${MENU_BUTTON_ATTR}],[data-dsh-active-row]:focus-within [${MENU_BUTTON_ATTR}],[${MENU_BUTTON_ATTR}][aria-expanded='true']{display:inline-flex}`,
    // 菜单打开期间行保持 hover 底（官方 .sessionRow.menuOpen）。
    `[data-dsh-pinned-row][${MENU_OPEN_ROW_ATTR}],[data-dsh-active-row][${MENU_OPEN_ROW_ATTR}]{background:var(--dsw-alias-interactive-bg-hover)}`,
    // 卡片表面（官方 MenuSurface `.surface` + `.material`；卡片自身不着色，底与模糊在材质层）。
    `[${MENU_ATTR}]{position:fixed;z-index:1100;box-sizing:border-box;isolation:isolate;display:flex;flex-direction:column;gap:0;padding:4px;border:0;border-radius:var(--dsw-radius-lg);min-width:144px;max-width:360px;max-height:calc(100vh - 12px - max(12px, var(--dsh-frame-top-clearance, 12px)));--dsw-elevation-stroke-color:var(--dsw-alias-border-l1);box-shadow:var(--dsw-elevation-prominent);color:var(--dsw-alias-label-primary);--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2)}`,
    `[${MENU_MATERIAL_ATTR}]{position:absolute;inset:0;z-index:-1;border-radius:inherit;background:var(--dsw-menu-surface-fill);backdrop-filter:var(--dsw-menu-backdrop-filter);pointer-events:none}`,
    // 滚动视口（官方 .viewport：卡片不滚、视口滚）。
    `[${MENU_VIEWPORT_ATTR}]{display:flex;flex-direction:column;min-height:0;overflow-y:auto}`,
    // 菜单项（官方 .item）。
    `[${MENU_ITEM_ATTR}]{display:flex;align-items:center;gap:6px;box-sizing:border-box;width:100%;min-height:34px;padding:6px 8px;border:none;border-radius:var(--dsw-radius-md);background:transparent;cursor:pointer;font-family:inherit;font-size:13px;line-height:20px;color:var(--dsw-alias-label-primary);text-align:left}`,
    `[${MENU_ITEM_ATTR}]:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}`,
    `[${MENU_ITEM_ATTR}]:focus-visible:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);outline:none}`,
    `[${MENU_ITEM_ATTR}]:disabled{opacity:.4;cursor:not-allowed}`,
    `[${MENU_ITEM_ATTR}][data-danger]{color:var(--dsw-alias-state-error-primary)}`,
    `[${MENU_ITEM_ATTR}][data-danger]:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-danger)}`,
    `[${MENU_ITEM_ATTR}][data-danger]:focus-visible:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-danger);outline:none}`,
    // 图标槽/文字（官方 .itemIcon / .itemLabel）。
    `[${MENU_ITEM_ATTR}] [data-dsh-row-menu-icon]{display:inline-flex;flex:none;width:14px;height:14px;align-items:center;justify-content:center;color:var(--dsw-alias-menu-icon)}`,
    `[${MENU_ITEM_ATTR}] [data-dsh-row-menu-icon] svg{width:14px;height:14px}`,
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
  /** 菜单项图标各自的 React root（关闭时卸载，避免悬挂）。 */
  iconRoots: Root[]
} | null = null

/**
 * 造一个官方 `.itemIcon` 槽位并渲染图标（React 节点 → DOM）。图标是官方图标集导出的
 * React 组件，用独立 root 同步渲染（`flushSync`）——菜单主体仍是 DOM 实现，图标是唯一
 * 的 React 面；root 记进菜单状态，关闭时统一卸载。
 * @param doc - 文档。
 * @param icon - 图标 React 节点。
 * @param roots - 收集本次菜单的图标 root。
 * @returns 图标槽元素。
 */
function makeIconSlot(doc: Document, icon: ReactNode, roots: Root[]): HTMLElement {
  const host = doc.createElement('span')
  host.setAttribute('data-dsh-row-menu-icon', '')
  const root = createRoot(host)
  flushSync(() => { root.render(icon) })
  roots.push(root)
  return host
}

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
  for (const root of current.iconRoots) root.unmount()
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
  // 表面材质层（官方 MenuSurface `.material`）：底 + 模糊在内容之下，卡片自身不着色。
  const material = doc.createElement('div')
  material.setAttribute(MENU_MATERIAL_ATTR, '')
  material.setAttribute('aria-hidden', 'true')
  const viewport = doc.createElement('div')
  viewport.setAttribute(MENU_VIEWPORT_ATTR, '')
  card.append(material, viewport)
  const iconRoots: Root[] = []
  for (const item of items) {
    const el = doc.createElement('button')
    el.type = 'button'
    el.setAttribute(MENU_ITEM_ATTR, '')
    el.dataset.menuItem = item.id
    el.setAttribute('role', 'menuitem')
    if (item.danger === true) el.setAttribute('data-danger', '')
    el.disabled = item.disabled === true
    if (item.icon !== undefined) el.appendChild(makeIconSlot(doc, item.icon, iconRoots))
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

  /**
   * 依官方 `place()`：**触发按钮**矩形算位（官方 anchor 即按钮；无按钮时回落整行），
   * clamp 进视口（左/右/下 MARGIN=12，上边距经 `overlayTopMargin` 放宽）。
   * 只在坐标变化时写样式（官方 `place()` 亦按值去重）。
   */
  let lastLeft = Number.NaN
  let lastTop = Number.NaN
  const reposition = (): void => {
    const rect = (button ?? anchor).getBoundingClientRect()
    const width = card.offsetWidth
    const height = card.offsetHeight
    let x = align === 'start' ? rect.left : rect.right - width
    let y = side === 'bottom' ? rect.bottom + ANCHOR_GAP : rect.top - height - ANCHOR_GAP
    if (width > 0) x = Math.min(Math.max(x, VIEWPORT_MARGIN), win.innerWidth - width - VIEWPORT_MARGIN)
    if (height > 0) y = Math.min(Math.max(y, overlayTopMargin(doc, VIEWPORT_MARGIN)), win.innerHeight - height - VIEWPORT_MARGIN)
    const left = Math.round(x)
    const top = Math.round(y)
    if (left === lastLeft && top === lastTop) return
    lastLeft = left
    lastTop = top
    card.style.left = `${left}px`
    card.style.top = `${top}px`
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
  // 官方同款 track()：开着期间每帧重算（跟随不触发 scroll/resize 的版面移动，例如 React
  // 重排 / 行被 sync 重建），并监听滚动（capture 捕获内层滚动容器）与窗口尺寸变化。
  let frame = 0
  const track = (): void => {
    reposition()
    frame = win.requestAnimationFrame(track)
  }
  win.addEventListener('scroll', reposition, true)
  win.addEventListener('resize', reposition)
  if (typeof win.requestAnimationFrame === 'function') frame = win.requestAnimationFrame(track)
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
    iconRoots,
    dispose: (): void => {
      doc.removeEventListener('pointerdown', onPointerDown, true)
      doc.removeEventListener('keydown', onKeyDown)
      win.removeEventListener('scroll', reposition, true)
      win.removeEventListener('resize', reposition)
      if (frame !== 0) win.cancelAnimationFrame(frame)
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
