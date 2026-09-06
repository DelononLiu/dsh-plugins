/**
 * dsh-tabs 左侧栏「置顶」区测试：只读镜像固定会话并注入官方侧边栏
 * （regionArea 之前），订阅 settings/会话列表变更实时同步，点击打开会话，
 * React 重排/重挂自愈，折叠态经 CSS 隐藏。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { derivePinnedRows, startPinnedStrip, type PinnedList, type PinnedStripDeps } from '../src/client/PinnedStrip.ts'
import type { PendingInteractionKind } from '../src/client/session-status'

/** 官方 SidebarRoot.module.css 的 hash 类前缀（css-modules 形式）。 */
const H = (name: string): string => `_${name}_abc123`

/** 构建官方结构侧边栏（SidebarRoot.tsx 树）：root > logoRow/newSession/regionArea/footArea。 */
function buildSidebar(): HTMLElement {
  const root = document.createElement('div')
  root.dataset.pane = 'sidebar'
  root.className = H('root')

  const logoRow = document.createElement('div')
  logoRow.className = H('logoRow')
  const newSession = document.createElement('button')
  newSession.className = H('newSession')
  logoRow.appendChild(newSession)

  const region = document.createElement('div')
  region.className = H('regionArea')
  const browser = document.createElement('div')
  browser.className = H('root')
  region.appendChild(browser)

  const foot = document.createElement('div')
  foot.className = H('footArea')

  root.append(logoRow, newSession, region, foot)
  document.body.appendChild(root)
  return root
}

/** 状态 + 订阅记录 harness（settings/list/pending 三个可手动触发的变更源）。 */
interface Harness {
  pinned: string[]
  ids: string[]
  current?: string
  byId: Record<string, { displayTitle?: string; running?: boolean; completed?: boolean; parentId?: string; origin?: string }>
  opened: string[]
  settingCbs: Array<() => void>
  listCbs: Array<() => void>
  pendingCbs: Array<() => void>
  pending: Record<string, PendingInteractionKind>
}

function makeHarness(): Harness {
  return {
    pinned: [],
    ids: [],
    current: undefined,
    byId: {},
    opened: [],
    settingCbs: [],
    listCbs: [],
    pendingCbs: [],
    pending: {},
  }
}

function makeDeps(h: Harness): PinnedStripDeps {
  const list: PinnedList = {
    getSnapshot: () => ({ current: h.current, ids: h.ids, byId: h.byId as Record<string, { displayTitle?: string; running?: boolean; completed?: boolean; parentId?: string; origin?: string }> }),
    subscribe: (fn) => { h.listCbs.push(fn); return () => {} },
  }
  return {
    getPinned: () => h.pinned,
    subscribeSettings: (fn) => { h.settingCbs.push(fn); return () => {} },
    sessions: list,
    open: (id) => { h.opened.push(id) },
    pendingKindOf: (id) => h.pending[id],
    subscribePending: (fn) => { h.pendingCbs.push(fn); return () => {} },
  }
}

function stripEl(): HTMLElement | null {
  return document.querySelector('[data-dsh-pinned-strip]')
}

function rowIds(): string[] {
  const el = stripEl()
  if (el === null) return []
  return Array.from(el.querySelectorAll('[data-dsh-pinned-row]'))
    .map((row) => (row as HTMLElement).dataset.sessionId ?? '')
}

function rowTitles(): string[] {
  const el = stripEl()
  if (el === null) return []
  return Array.from(el.querySelectorAll('[data-dsh-pinned-title]'))
    .map((row) => row.textContent ?? '')
}

function rowButtons(): HTMLButtonElement[] {
  const el = stripEl()
  return el === null ? [] : Array.from(el.querySelectorAll<HTMLButtonElement>('[data-dsh-pinned-row]'))
}

describe('derivePinnedRows', () => {
  const byId = { a: { displayTitle: '会话甲' }, b: {}, c: { displayTitle: '会话丙' } }

  it('按钉顺序派生，剔除已不存在的会话并去重', () => {
    const rows = derivePinnedRows(['b', 'a', 'b', 'ghost'], { ids: ['a', 'b', 'c'], byId, current: 'a' })
    expect(rows.map((r) => r.id)).toEqual(['b', 'a'])
  })

  it('标题取 displayTitle，缺省回退 id；current 只在钉内标记', () => {
    const rows = derivePinnedRows(['b', 'a', 'c'], { ids: ['a', 'b', 'c'], byId, current: 'c' })
    expect(rows.map((r) => [r.title, r.current])).toEqual([
      ['b', false],
      ['会话甲', false],
      ['会话丙', true],
    ])
  })

  it('current 不在钉内 / undefined 时不标任何行', () => {
    const rows = derivePinnedRows(['a'], { ids: ['a'], byId, current: undefined })
    expect(rows[0].current).toBe(false)
  })
})

describe('startPinnedStrip', () => {
  let h: Harness
  let disposers: Array<() => void>

  beforeEach(() => {
    buildSidebar()
    h = makeHarness()
    h.pinned = ['a', 'b']
    h.ids = ['a', 'b', 'c']
    h.byId = { a: { displayTitle: '会话甲' }, b: {}, c: { displayTitle: '会话丙' } }
    disposers = []
  })

  afterEach(() => {
    for (const d of disposers) d()
    document.body.innerHTML = ''
  })

  it('把置顶区插到 regionArea 之前，标题+行按钉顺序渲染', () => {
    disposers.push(startPinnedStrip(makeDeps(h)))
    const root = document.querySelector('[data-pane="sidebar"]') as HTMLElement
    const strip = stripEl()
    expect(strip).not.toBeNull()
    expect(root.children[2]).toBe(strip) // logoRow/newSession 之后、regionArea 之前
    expect(strip?.querySelector('[data-dsh-pinned-label]')?.textContent).toBe('置顶区')
    expect(rowIds()).toEqual(['a', 'b'])
    expect(rowTitles()).toEqual(['1. 会话甲', '2. b'])
  })

  it('无固定会话时不注入（无空置顶区残留）', () => {
    h.pinned = []
    disposers.push(startPinnedStrip(makeDeps(h)))
    expect(stripEl()).toBeNull()
  })

  it('点击置顶行 = 打开对应会话', () => {
    disposers.push(startPinnedStrip(makeDeps(h)))
    const rows = stripEl()?.querySelectorAll('[data-dsh-pinned-row]') ?? []
    ;(rows[1] as HTMLButtonElement).click()
    expect(h.opened).toEqual(['b'])
  })

  it('settings/list 变更实时同步：取消钉删行、会话消失滤行、current 标记跟随', () => {
    disposers.push(startPinnedStrip(makeDeps(h)))
    // 当前会话 b → b 行带当前标记
    h.current = 'b'
    h.listCbs.forEach((cb) => cb())
    const rows = stripEl()?.querySelectorAll('[data-dsh-pinned-row]') ?? []
    expect((rows[1] as HTMLElement).hasAttribute('data-dsh-pinned-current')).toBe(true)

    // 取消钉 a（settings 变更）→ 只剩 b
    h.pinned = ['b']
    h.settingCbs.forEach((cb) => cb())
    expect(rowIds()).toEqual(['b'])
    expect(rowTitles()).toEqual(['1. b'])

    // b 会话被归档消失（list 变更）→ 无钉 → 整区移除
    h.ids = ['c']
    h.current = undefined
    h.listCbs.forEach((cb) => cb())
    expect(stripEl()).toBeNull()
  })

  it('React 重排移除后自愈重插（MutationObserver）', async () => {
    disposers.push(startPinnedStrip(makeDeps(h)))
    const strip = stripEl()
    expect(strip).not.toBeNull()
    strip?.remove()
    expect(stripEl()).toBeNull()
    await vi.waitFor(() => {
      expect(stripEl()).not.toBeNull()
      expect(rowIds()).toEqual(['a', 'b'])
    })
  })

  it('注入样式含官方折叠（rail）隐藏规则', () => {
    disposers.push(startPinnedStrip(makeDeps(h)))
    const tag = document.querySelector('style[data-plugin-css="@dsh-tabs/pinned-strip"]')
    expect(tag).not.toBeNull()
    const css = (tag as HTMLStyleElement).textContent ?? ''
    expect(css).toContain('[data-sidebar-collapsed] [data-dsh-pinned-strip]{display:none}')
    expect(css).toContain('var(--dsw-alias-state-business-primary)')
  })

  it('侧边栏未渲染 / 无 regionArea 时不报错，DOM 出现后自愈', async () => {
    document.body.innerHTML = ''
    disposers.push(startPinnedStrip(makeDeps(h)))
    buildSidebar()
    await vi.waitFor(() => {
      expect(stripEl()).not.toBeNull()
      expect(rowIds()).toEqual(['a', 'b'])
    })
  })

  it('disposer 清理：退订、移除置顶区与样式', () => {
    const dispose = startPinnedStrip(makeDeps(h))
    const strip = stripEl()
    expect(strip).not.toBeNull()
    dispose()
    expect(stripEl()).toBeNull()
    expect(document.querySelector('style[data-plugin-css="@dsh-tabs/pinned-strip"]')).toBeNull()
  })

  it('运行中会话 → 状态槽渲染追逐矩阵，tooltip 带「运行中」；空闲行无点、纯标题', () => {
    h.byId.a = { ...h.byId.a, running: true }
    disposers.push(startPinnedStrip(makeDeps(h)))
    const rows = rowButtons()
    expect(rows[0].querySelector('.dsh-pinned-matrix')).not.toBeNull()
    expect(rows[0].title).toBe('运行中 · 会话甲')
    expect(rows[1].querySelector('.dsh-pinned-dot, .dsh-pinned-matrix')).toBeNull()
    expect(rows[1].title).toBe('b')
  })

  it('completed → done 圆点 +「已完成」tooltip', () => {
    h.byId.a = { ...h.byId.a, completed: true }
    disposers.push(startPinnedStrip(makeDeps(h)))
    const rows = rowButtons()
    const dot = rows[0].querySelector<HTMLElement>('.dsh-pinned-dot')
    expect(dot?.dataset.state).toBe('done')
    expect(rows[0].title).toBe('已完成 · 会话甲')
  })

  it('running 子代理（origin=subagent）挂在祖先 → 祖先行 ongoing + 计数 tooltip', () => {
    h.byId.sub1 = { origin: 'subagent', parentId: 'a', running: true }
    disposers.push(startPinnedStrip(makeDeps(h)))
    const rows = rowButtons()
    expect(rows[0].querySelector('.dsh-pinned-matrix')).not.toBeNull()
    expect(rows[0].title).toBe('1 个子代理运行 · 会话甲')
  })

  it('pending（approval）盖过 running → warning 圆点 +「等待审批」', () => {
    h.byId.a = { ...h.byId.a, running: true }
    h.pending = { a: 'approval' }
    disposers.push(startPinnedStrip(makeDeps(h)))
    const rows = rowButtons()
    const dot = rows[0].querySelector<HTMLElement>('.dsh-pinned-dot')
    expect(dot?.dataset.state).toBe('warning')
    expect(rows[0].querySelector('.dsh-pinned-matrix')).toBeNull()
    expect(rows[0].title).toBe('等待审批 · 会话甲')
  })

  it('pending 变更（pending 订阅回调触发）实时更新状态', () => {
    disposers.push(startPinnedStrip(makeDeps(h)))
    expect(rowButtons()[0].querySelector('.dsh-pinned-dot, .dsh-pinned-matrix')).toBeNull()
    h.pending = { a: 'question' }
    h.pendingCbs.forEach((cb) => cb())
    const rows = rowButtons()
    const dot = rows[0].querySelector<HTMLElement>('.dsh-pinned-dot')
    expect(dot?.dataset.state).toBe('warning')
    expect(rows[0].title).toBe('等待你回复 · 会话甲')
  })

  it('状态样式注入：槽几何/圆点 token/矩阵色/动画 keyframes', () => {
    h.byId.a = { ...h.byId.a, running: true }
    disposers.push(startPinnedStrip(makeDeps(h)))
    const tag = document.querySelector('style[data-plugin-css="@dsh-tabs/pinned-strip"]')
    const css = (tag as HTMLStyleElement).textContent ?? ''
    expect(css).toContain('[data-dsh-pinned-status]{flex:none;width:16px;height:20px')
    expect(css).toContain('dsh-tabs-dot-chase')
    expect(css).toContain('var(--dsw-alias-state-warn-primary)')
    expect(css).toContain('var(--dsw-static-deepseek-450)')
  })
})
