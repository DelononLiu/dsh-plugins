/**
 * 行尾「⋯」菜单测试：触发按钮形态、菜单项渲染与回调、单例语义、关闭时复位
 * aria-expanded、样式引用计数。
 */

import { beforeEach, describe, expect, it } from 'vitest'
import {
  MENU_ATTR,
  MENU_BUTTON_ATTR,
  MENU_ITEM_ATTR,
  closeRowMenu,
  injectMenuCss,
  makeMenuButton,
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
