/**
 * 行尾「⋯」菜单测试：触发按钮形态、菜单项渲染与回调、单例语义、关闭时复位
 * aria-expanded、样式引用计数。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  MENU_ATTR,
  MENU_BUTTON_ATTR,
  MENU_ITEM_ATTR,
  MENU_OPEN_ROW_ATTR,
  MENU_VIEWPORT_ATTR,
  POINTER_GRACE_MS,
  closeRowMenu,
  injectMenuCss,
  makeMenuButton,
  menuCss,
  openRowMenu,
} from '../src/client/menu.ts'

const CSS_SELECTOR = 'style[data-plugin-css="@dsh-focus-session/row-menu"]'

describe('makeMenuButton', () => {
  it('生成 ⋯ 图标按钮（aria-haspopup=menu / aria-expanded=false）', () => {
    const button = makeMenuButton(document)
    expect(button.hasAttribute(MENU_BUTTON_ATTR)).toBe(true)
    expect(button.getAttribute('aria-haspopup')).toBe('menu')
    expect(button.getAttribute('aria-expanded')).toBe('false')
    expect(button.querySelector('svg')?.querySelectorAll('circle')).toHaveLength(3)
  })
})

describe('openRowMenu', () => {
  let anchor: HTMLElement
  let button: HTMLButtonElement
  let selected: string[]

  beforeEach(() => {
    document.body.innerHTML = ''
    closeRowMenu()
    selected = []
    anchor = document.createElement('div')
    button = makeMenuButton(document)
    document.body.append(anchor, button)
  })

  const items = () => [
    { id: 'a', label: '甲', onSelect: () => { selected.push('a') } },
    { id: 'b', label: '乙', onSelect: () => { selected.push('b') } },
  ]

  it('渲染菜单项（role=menu / menuitem）并标记按钮展开', () => {
    openRowMenu({ anchor, button, items: items() })
    const menu = document.querySelector<HTMLElement>(`[${MENU_ATTR}]`)
    expect(menu).not.toBeNull()
    expect(menu!.getAttribute('role')).toBe('menu')
    const rendered = Array.from(menu!.querySelectorAll<HTMLElement>(`[${MENU_ITEM_ATTR}]`))
    expect(rendered.map((el) => el.textContent)).toEqual(['甲', '乙'])
    expect(rendered.every((el) => el.getAttribute('role') === 'menuitem')).toBe(true)
    expect(button.getAttribute('aria-expanded')).toBe('true')
  })

  it('点击菜单项：回调一次且菜单关闭', () => {
    openRowMenu({ anchor, button, items: items() })
    document.querySelector<HTMLElement>('[data-menu-item="b"]')!
      .dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(selected).toEqual(['b'])
    expect(document.querySelector(`[${MENU_ATTR}]`)).toBeNull()
    expect(button.getAttribute('aria-expanded')).toBe('false')
  })

  it('单例：再次打开替换前一个，且前一个按钮的展开态复位', () => {
    const other = makeMenuButton(document)
    document.body.appendChild(other)
    openRowMenu({ anchor, button, items: items() })
    openRowMenu({ anchor, button: other, items: items() })
    expect(document.querySelectorAll(`[${MENU_ATTR}]`)).toHaveLength(1)
    expect(button.getAttribute('aria-expanded')).toBe('false')
    expect(other.getAttribute('aria-expanded')).toBe('true')
  })

  it('closeRowMenu 幂等（未打开时调用不抛）', () => {
    expect(() => closeRowMenu()).not.toThrow()
    openRowMenu({ anchor, items: items() })
    closeRowMenu()
    closeRowMenu()
    expect(document.querySelector(`[${MENU_ATTR}]`)).toBeNull()
  })
})

describe('injectMenuCss', () => {
  beforeEach(() => {
    document.head.innerHTML = ''
  })

  it('两个持有者共享一份样式；归零才摘除', () => {
    const a = injectMenuCss()
    const b = injectMenuCss()
    expect(document.querySelectorAll(CSS_SELECTOR)).toHaveLength(1)
    a()
    expect(document.querySelector(CSS_SELECTOR)).not.toBeNull()
    b()
    expect(document.querySelector(CSS_SELECTOR)).toBeNull()
  })
})

describe('官方 Menu 契约对齐（kernel 0.1.2-rc.1 ui-primitives/Menu.module.css）', () => {
  let anchor: HTMLElement
  let button: HTMLButtonElement

  beforeEach(() => {
    document.body.innerHTML = ''
    closeRowMenu()
    vi.useRealTimers()
    anchor = document.createElement('div')
    button = makeMenuButton(document)
    document.body.append(anchor, button)
    vi.spyOn(anchor, 'getBoundingClientRect').mockReturnValue({
      left: 100, right: 260, top: 200, bottom: 232, width: 160, height: 32, x: 100, y: 200, toJSON: () => ({}),
    } as DOMRect)
  })

  const items = () => [
    { id: 'a', label: '甲', onSelect: () => {} },
    { id: 'b', label: '乙', onSelect: () => {} },
  ]

  it('样式含官方卡片/项度量（r20、218/360、100vh-24、z1100、item 40/8-10）', () => {
    const css = menuCss()
    expect(css).toContain('border-radius:20px')
    expect(css).toContain('min-width:218px')
    expect(css).toContain('max-width:360px')
    expect(css).toContain('max-height:calc(100vh - 24px)')
    expect(css).toContain('z-index:1100')
    expect(css).toContain('min-height:40px')
    expect(css).toContain('padding:8px 10px')
    expect(css).toContain(`[${MENU_VIEWPORT_ATTR}]`)
    expect(css).toContain('overflow-y:auto')
  })

  it('卡片内含滚动视口（官方 .viewport），菜单项挂在视口里', () => {
    openRowMenu({ anchor, button, items: items() })
    const card = document.querySelector<HTMLElement>(`[${MENU_ATTR}]`)!
    const viewport = card.querySelector<HTMLElement>(`[${MENU_VIEWPORT_ATTR}]`)
    expect(viewport).not.toBeNull()
    expect(viewport!.querySelectorAll(`[${MENU_ITEM_ATTR}]`)).toHaveLength(2)
  })

  it('定位：align=start 取锚点左边、side=bottom 取 rect.bottom + 4（官方 place()）', () => {
    openRowMenu({ anchor, items: items() })
    const card = document.querySelector<HTMLElement>(`[${MENU_ATTR}]`)!
    expect(card.style.left).toBe('100px')
    expect(card.style.top).toBe('236px')
  })

  it('开着时跟随版面滚动重定位（官方 scroll capture 监听）', () => {
    openRowMenu({ anchor, items: items() })
    const card = document.querySelector<HTMLElement>(`[${MENU_ATTR}]`)!
    vi.spyOn(anchor, 'getBoundingClientRect').mockReturnValue({
      left: 40, right: 200, top: 10, bottom: 42, width: 160, height: 32, x: 40, y: 10, toJSON: () => ({}),
    } as DOMRect)
    window.dispatchEvent(new Event('scroll'))
    expect(card.style.left).toBe('40px')
    expect(card.style.top).toBe('46px')
  })

  it('打开期间行带打开标记（官方 .sessionRow.menuOpen），关闭后移除', () => {
    openRowMenu({ anchor, button, items: items() })
    expect(anchor.hasAttribute(MENU_OPEN_ROW_ATTR)).toBe(true)
    closeRowMenu()
    expect(anchor.hasAttribute(MENU_OPEN_ROW_ATTR)).toBe(false)
  })

  it('danger / disabled 项：官方 danger 色钩子与不可点语义', () => {
    const clicked: string[] = []
    openRowMenu({
      anchor,
      items: [
        { id: 'danger', label: '危险', danger: true, onSelect: () => { clicked.push('danger') } },
        { id: 'off', label: '禁用', disabled: true, onSelect: () => { clicked.push('off') } },
      ],
    })
    const danger = document.querySelector<HTMLButtonElement>('[data-menu-item="danger"]')!
    const off = document.querySelector<HTMLButtonElement>('[data-menu-item="off"]')!
    expect(danger.hasAttribute('data-danger')).toBe(true)
    expect(off.disabled).toBe(true)
    off.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(clicked).toEqual([])
  })

  it('指针宽限关闭：离开卡片 200ms 后关闭，回来则取消（官方 closeOnPointerLeave）', () => {
    vi.useFakeTimers()
    openRowMenu({ anchor, button, items: items() })
    const card = document.querySelector<HTMLElement>(`[${MENU_ATTR}]`)!
    card.dispatchEvent(new MouseEvent('mouseleave'))
    vi.advanceTimersByTime(POINTER_GRACE_MS - 1)
    expect(document.querySelector(`[${MENU_ATTR}]`)).not.toBeNull()
    card.dispatchEvent(new MouseEvent('mouseenter'))
    vi.advanceTimersByTime(POINTER_GRACE_MS * 2)
    expect(document.querySelector(`[${MENU_ATTR}]`)).not.toBeNull()
    card.dispatchEvent(new MouseEvent('mouseleave'))
    vi.advanceTimersByTime(POINTER_GRACE_MS)
    expect(document.querySelector(`[${MENU_ATTR}]`)).toBeNull()
  })
})
