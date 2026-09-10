/**
 * tab-status 助手测试：会话 tab 前置状态小圆点的插入/状态切换/空闲移除，
 * 以及「同态零结构变更」的幂等约束（防 applyActive 的 body MutationObserver
 * 自触发死循环——结构只在首次插入/移除时变化，状态切换仅改属性）。
 */

import { describe, expect, it } from 'vitest'

import { renderTabStatusDot, TAB_STATUS_ATTR } from '../src/client/tab-status'

const view = (dot: 'warning' | 'ongoing' | 'done' | undefined) => ({ dot, label: '' })

describe('renderTabStatusDot', () => {
  it('插入圆点到按钮最前（warning/done/ongoing），不破坏文本', () => {
    for (const state of ['warning', 'done', 'ongoing'] as const) {
      const btn = document.createElement('button')
      btn.textContent = '1. 会话'
      renderTabStatusDot(btn, view(state))
      const dot = btn.querySelector(`[${TAB_STATUS_ATTR}]`)
      expect(dot).not.toBeNull()
      expect(dot?.dataset.state).toBe(state)
      expect(btn.children[0]).toBe(dot)
      expect(btn.textContent).toContain('1. 会话')
    }
  })

  it('同态重复调用：零结构变更（同一节点保留、仅 1 个圆点）', () => {
    const btn = document.createElement('button')
    btn.textContent = '1. 会话'
    renderTabStatusDot(btn, view('warning'))
    const first = btn.firstElementChild
    expect(first?.hasAttribute(TAB_STATUS_ATTR)).toBe(true)
    renderTabStatusDot(btn, view('warning'))
    expect(btn.firstElementChild).toBe(first)
    expect(btn.querySelectorAll(`[${TAB_STATUS_ATTR}]`).length).toBe(1)
  })

  it('状态切换：只改既有圆点 data-state，不重建节点', () => {
    const btn = document.createElement('button')
    renderTabStatusDot(btn, view('warning'))
    const first = btn.firstElementChild
    renderTabStatusDot(btn, view('ongoing'))
    expect(btn.firstElementChild).toBe(first)
    expect((first as HTMLElement).dataset.state).toBe('ongoing')
  })

  it('空闲：移除既有圆点；本就无点时无操作', () => {
    const btn = document.createElement('button')
    renderTabStatusDot(btn, view('done'))
    expect(btn.querySelector(`[${TAB_STATUS_ATTR}]`)).not.toBeNull()
    renderTabStatusDot(btn, view(undefined))
    expect(btn.querySelector(`[${TAB_STATUS_ATTR}]`)).toBeNull()
    renderTabStatusDot(btn, view(undefined)) // 第二次空闲：无点也无操作，不抛错
    expect(btn.firstElementChild).toBeNull()
  })

  it('保留按钮原有文本与子元素（圆点插在文本/子元素之前）', () => {
    const btn = document.createElement('button')
    btn.appendChild(document.createTextNode('2. '))
    const title = document.createElement('span')
    title.textContent = '会话标题'
    btn.appendChild(title)
    renderTabStatusDot(btn, view('warning'))
    // 结构：dot(元素) + 文本 + title(元素)
    expect(btn.childNodes.length).toBe(3)
    expect(btn.childNodes[0]).toBe(btn.firstElementChild)
    expect((btn.childNodes[0] as HTMLElement).hasAttribute(TAB_STATUS_ATTR)).toBe(true)
    expect(btn.childNodes[1].nodeType).toBe(Node.TEXT_NODE)
    expect(btn.childNodes[1].textContent).toBe('2. ')
    expect(btn.childNodes[2]).toBe(title)
    expect(title.textContent).toBe('会话标题')
  })
})
