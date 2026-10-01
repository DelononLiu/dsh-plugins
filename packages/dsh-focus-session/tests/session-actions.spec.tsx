/**
 * dsh-focus-session 两个侧栏区行菜单里的官方会话动作测试。
 *
 * 判据：关注区行菜单只放官方 rename(200) 与 fork(300)（id/顺序/文案/图标照官方；
 * pin/archive 按用户要求不进关注区菜单——置顶由本插件的「添加到置顶区」承担、归档在
 * 官方行里做）；动作落到官方数据面（本测试注入假实现）；rename 弹框用官方
 * Modal/Input/Button 基元收集标题并调用官方同路径改名；我们的「添加到置顶区 /
 * 从置顶区移除」与官方置顶数据独立。
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { flushSync } from 'react-dom'
import {
  IconBranchOutlineRegular, IconEditOutlineRegular, IconGlobeOutlineRegular,
} from '@deepseek-ai/dsh-client-ui-primitives'
import {
  FOCUS_PIN_LABEL, FOCUS_UNPIN_LABEL, OFFICIAL_FORK_LABEL, OFFICIAL_RENAME_LABEL,
  RENAME_DIALOG_ATTR, closeRenameDialog, focusSessionPinMenuItem, officialSessionMenuItems,
  openRenameDialog, type FocusPinDeps, type OfficialSessionActionDeps,
} from '../src/client/sessionActions.tsx'

/** 官方动作面 harness。 */
interface Harness {
  renamed: Array<{ id: string; title: string }>
  forked: string[]
  titles: Record<string, string>
}

function makeOfficial(h: Harness): OfficialSessionActionDeps {
  return {
    fork: async (id) => { h.forked.push(id) },
    displayTitleOf: (id) => h.titles[id] ?? id,
    rename: async (id, title) => { h.renamed.push({ id, title }) },
  }
}

/** 图标身份（React element 的 type）。 */
function iconType(node: unknown): unknown {
  return (node as { type?: unknown } | undefined)?.type
}

/** 设置受控 input 的值并触发 React onChange（绕开 value tracker）。 */
function typeInto(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  setter?.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

describe('officialSessionMenuItems', () => {
  let h: Harness

  beforeEach(() => {
    document.body.innerHTML = ''
    h = { renamed: [], forked: [], titles: { a: '会话 A' } }
  })

  it('只有官方 rename + fork 两项，id/顺序/文案/图标照官方', () => {
    const items = officialSessionMenuItems('a', makeOfficial(h))
    expect(items.map((item) => item.id)).toEqual(['rename', 'fork'])
    expect(items.map((item) => item.label)).toEqual([OFFICIAL_RENAME_LABEL, OFFICIAL_FORK_LABEL])
    expect(iconType(items[0]?.icon)).toBe(IconEditOutlineRegular)
    expect(iconType(items[1]?.icon)).toBe(IconBranchOutlineRegular)
  })

  it('官方 fork 行点击 = 官方 forkSession 路径', async () => {
    const items = officialSessionMenuItems('a', makeOfficial(h))
    items.find((item) => item.id === 'fork')!.onSelect()
    await Promise.resolve()
    expect(h.forked).toEqual(['a'])
  })

  it('官方 rename 行点击 = 打开弹框（初值 = 当前标题）', () => {
    const items = officialSessionMenuItems('a', makeOfficial(h))
    items.find((item) => item.id === 'rename')!.onSelect()
    const input = document.querySelector<HTMLInputElement>(`[${RENAME_DIALOG_ATTR}] input`)
    expect(input).not.toBeNull()
    expect(input!.value).toBe('会话 A')
    closeRenameDialog()
  })
})

describe('openRenameDialog（官方 Modal/Input/Button 基元）', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('提交：调用官方同路径改名并关闭弹框', async () => {
    const calls: Array<{ id: string; title: string }> = []
    openRenameDialog({
      sessionId: 'a',
      currentTitle: '会话 A',
      rename: async (id, title) => { calls.push({ id, title }) },
      doc: document,
    })
    const dialog = document.querySelector(`[${RENAME_DIALOG_ATTR}]`)!
    expect(dialog.textContent).toContain('重命名会话')
    const input = dialog.querySelector<HTMLInputElement>('input')!
    flushSync(() => { typeInto(input, '改后的标题') })
    const confirm = Array.from(dialog.querySelectorAll('button')).find((b) => b.textContent === '重命名')!
    flushSync(() => { confirm.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    await Promise.resolve()
    await Promise.resolve()
    expect(calls).toEqual([{ id: 'a', title: '改后的标题' }])
    expect(document.querySelector(`[${RENAME_DIALOG_ATTR}]`)).toBeNull()
  })

  it('取消：关闭弹框且不改名', async () => {
    const calls: string[] = []
    openRenameDialog({
      sessionId: 'a',
      currentTitle: 'A',
      rename: async (id) => { calls.push(id) },
      doc: document,
    })
    const cancel = Array.from(document.querySelectorAll(`[${RENAME_DIALOG_ATTR}] button`)).find((b) => b.textContent === '取消')!
    flushSync(() => { cancel.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    await Promise.resolve()
    expect(calls).toEqual([])
    expect(document.querySelector(`[${RENAME_DIALOG_ATTR}]`)).toBeNull()
  })
})

describe('focusSessionPinMenuItem', () => {
  let pinned: string[]
  let focus: FocusPinDeps

  beforeEach(() => {
    pinned = []
    focus = { getPinned: () => pinned, setPinned: (ids) => { pinned = [...ids] } }
  })

  it('未钉：地球字形 +「添加到置顶区」；点击写我们的 pinned（与官方置顶独立）', () => {
    const item = focusSessionPinMenuItem('a', focus)
    expect(item.id).toBe('focus-pin')
    expect(item.label).toBe(FOCUS_PIN_LABEL)
    expect(iconType(item.icon)).toBe(IconGlobeOutlineRegular)
    item.onSelect()
    expect(pinned).toEqual(['a'])
  })

  it('已钉：文案变「从置顶区移除」，点击移除', () => {
    pinned = ['a']
    const item = focusSessionPinMenuItem('a', focus)
    expect(item.label).toBe(FOCUS_UNPIN_LABEL)
    item.onSelect()
    expect(pinned).toEqual([])
  })
})
