/**
 * 行尾「⋯」菜单（client 半区）——置顶区/活跃区会话行的操作入口。
 *
 * 形状与配色照官方基准（dsh-client-ui-workspace 的 `.iconButton`/`.rowActions`
 * + dsh-client-ui-model-selection 的 `.menu`/`.cell`）：
 * - 触发按钮 = 官方行尾图标按钮：16×16、`--dsw-alias-label-tertiary`、
 *   hover `--dsw-alias-label-primary`、圆角 4、无边框。
 * - 弹层 = 官方菜单：底 `--dsw-specific-menu`、`--dsw-elevation-prominent` 阴影、
 *   描边色变量 `--dsw-elevation-stroke-color: var(--dsw-alias-border-l1)`、
 *   最大高 `min(360px,100vh - 96px)`。
 * - 菜单项 = 官方 `.cell`：高 40、圆角 10、内边距 `0 10px`、`gap 8`、字号 14/行高 22、
 *   hover `--dsw-alias-interactive-bg-hover`。
 *
 * 菜单是**单例**（同时只开一个），点菜单外或 Esc 关闭；锚点滚动/重排时不跟随
 * （与官方 popup 的静态定位一致）。
 */

/** 菜单弹层标记。 */
export const MENU_ATTR = 'data-dsh-row-menu'
/** 菜单项标记。 */
export const MENU_ITEM_ATTR = 'data-dsh-row-menu-item'
/** 触发按钮标记（行尾 ⋯）。 */
export const MENU_BUTTON_ATTR = 'data-dsh-row-menu-button'
/** 幂等样式标签标记（同 dsh-desk `data-plugin-css` 约定）。 */
const CSS_TAG_SELECTOR = 'style[data-plugin-css="@dsh-focus-session/row-menu"]'

/** 一个菜单项。 */
export interface RowMenuItem {
  /** 稳定标识（测试与事件判据用）。 */
  id: string
  /** 显示文字。 */
  label: string
  /** 选中回调（菜单随即关闭）。 */
  onSelect(): void
}

/** 菜单样式（值取自官方菜单与行尾图标按钮契约）。 */
export function menuCss(): string {
  return [
    // 行尾 ⋯ 触发按钮（官方 .iconButton 契约）。
    `[${MENU_BUTTON_ATTR}]{flex:none;display:none;align-items:center;justify-content:center;width:16px;height:16px;margin-left:2px;padding:0;border:none;border-radius:4px;background:0 0;cursor:pointer;color:var(--dsw-alias-label-tertiary)}`,
    `[${MENU_BUTTON_ATTR}]:hover{color:var(--dsw-alias-label-primary)}`,
    `[data-dsh-pinned-row]:hover [${MENU_BUTTON_ATTR}],[data-dsh-pinned-row]:focus-within [${MENU_BUTTON_ATTR}],[data-dsh-active-row]:hover [${MENU_BUTTON_ATTR}],[data-dsh-active-row]:focus-within [${MENU_BUTTON_ATTR}],[${MENU_BUTTON_ATTR}][aria-expanded='true']{display:inline-flex}`,
    // 菜单弹层（官方 .menu 契约；圆角官方规则未声明，取与菜单项 10px 协调的 12px）。
    `[${MENU_ATTR}]{position:fixed;z-index:2147483000;box-sizing:border-box;width:max-content;min-width:min(180px,100vw - 32px);max-width:min(320px,100vw - 32px);max-height:min(360px,100vh - 96px);overflow-y:auto;padding:4px;border-radius:12px;background:var(--dsw-specific-menu);--dsw-elevation-stroke-color:var(--dsw-alias-border-l1);box-shadow:var(--dsw-elevation-prominent);color:var(--dsw-alias-label-primary);--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2)}`,
    // 菜单项（官方 .cell 契约）。
    `[${MENU_ITEM_ATTR}]{box-sizing:border-box;width:100%;min-width:100%;height:40px;display:flex;align-items:center;gap:8px;padding:0 10px;border:none;border-radius:10px;background:0 0;color:var(--dsw-alias-label-primary);font-family:inherit;font-size:14px;line-height:22px;text-align:left;cursor:pointer;white-space:nowrap}`,
    `[${MENU_ITEM_ATTR}]:hover{background:var(--dsw-alias-interactive-bg-hover)}`,
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
let openMenu: { el: HTMLElement; button: HTMLElement | null } | null = null

/** 关闭当前菜单（若有）。 */
export function closeRowMenu(): void {
  openMenu?.button?.setAttribute('aria-expanded', 'false')
  openMenu?.el.remove()
  openMenu = null
}

/**
 * 行尾「⋯」触发按钮（官方行尾图标按钮形态：三点横排 svg，16×16）。
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
 * 打开行尾菜单（单例；已开则先关）。点菜单外或 Esc 关闭。
 * @param deps - 锚点元素与菜单项。
 */
export function openRowMenu(deps: { anchor: HTMLElement; button?: HTMLElement | null; items: readonly RowMenuItem[] }): void {
  const doc = deps.anchor.ownerDocument
  closeRowMenu()
  const menu = doc.createElement('div')
  menu.setAttribute(MENU_ATTR, '')
  menu.setAttribute('role', 'menu')
  for (const item of deps.items) {
    const el = doc.createElement('button')
    el.type = 'button'
    el.setAttribute(MENU_ITEM_ATTR, '')
    el.dataset.menuItem = item.id
    el.setAttribute('role', 'menuitem')
    el.textContent = item.label
    el.addEventListener('click', (e) => {
      e.preventDefault()
      e.stopPropagation()
      closeRowMenu()
      item.onSelect()
    })
    menu.appendChild(el)
  }
  menu.addEventListener('click', (e) => e.stopPropagation())
  doc.body.appendChild(menu)
  // 定位：锚点下方；越界时上移/左移收敛在视口内。
  const rect = deps.anchor.getBoundingClientRect()
  const size = menu.getBoundingClientRect()
  const top = rect.bottom + 4 + size.height > window.innerHeight
    ? Math.max(8, rect.top - size.height - 4)
    : rect.bottom + 4
  menu.style.top = `${Math.round(top)}px`
  menu.style.left = `${Math.round(Math.min(Math.max(8, rect.left), Math.max(8, window.innerWidth - size.width - 8)))}px`
  openMenu = { el: menu, button: deps.button ?? null }
  deps.button?.setAttribute('aria-expanded', 'true')
  menu.querySelector<HTMLElement>(`[${MENU_ITEM_ATTR}]`)?.focus()
}
