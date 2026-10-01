/**
 * dsh-focus-session 左侧栏「活跃」区测试：按 `updatedAt` 时间序渲染最近活跃
 * 会话（剔除置顶区已显示/子代理/空白会话，上限条数），注入到置顶区之后
 * （无置顶区时在列表区之前），点击打开会话，订阅变更实时同步。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ACTIVE_LIMIT,
  deriveActiveRows,
  startActiveStrip,
  type ActiveList,
  type ActiveListSnapshot,
  type ActiveStripDeps,
} from '../src/client/ActiveStrip.ts'
import type { PendingInteractionKind } from '../src/client/session-status'
import { closeTagEditor } from '../src/client/tags.ts'
import { closeRowMenu } from '../src/client/menu.ts'

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

type Row = {
  displayTitle?: string
  updatedAt?: number
  blank?: boolean
  running?: boolean
  completed?: boolean
  parentId?: string
  origin?: string
}

interface Harness {
  pinned: string[]
  ids: string[]
  byId: Record<string, Row>
  opened: string[]
  settingCbs: Array<() => void>
  listCbs: Array<() => void>
  pendingCbs: Array<() => void>
  tags: Record<string, { text: string; tone?: string }[]>
  tagCbs: Array<() => void>
  pending: Record<string, PendingInteractionKind>
  renamed: Array<{ id: string; title: string }>
}

function makeHarness(): Harness {
  return {
    pinned: [],
    ids: [],
    byId: {},
    opened: [],
    settingCbs: [],
    listCbs: [],
    pendingCbs: [],
    tags: {},
    tagCbs: [],
    pending: {},
    renamed: [],
  }
}

function snapshotOf(h: Harness): ActiveListSnapshot {
  return { ids: h.ids, byId: h.byId }
}

/** 在官方侧栏里渲染官方会话行（`data-row-key=session:<id>` + `aria-selected`）。 */
function renderOfficialRows(ids: string[], selected?: string): void {
  const browser = document.querySelector('[class*="regionArea"]') ?? document.body
  for (const id of ids) {
    const row = document.createElement('div')
    row.setAttribute('data-row-key', `session:${id}`)
    row.setAttribute('role', 'treeitem')
    row.setAttribute('aria-selected', String(id === selected))
    browser.appendChild(row)
  }
}

/** 切换官方选中行（只改 `aria-selected`，模拟用户切会话）。 */
function selectOfficial(id: string | null): void {
  document.querySelectorAll('[data-row-key^="session:"]').forEach((row) => {
    row.setAttribute('aria-selected', String(row.getAttribute('data-row-key') === `session:${id}`))
  })
}

function makeDeps(h: Harness, limit?: number): ActiveStripDeps {
  const list: ActiveList = {
    getSnapshot: () => snapshotOf(h),
    subscribe: (fn) => { h.listCbs.push(fn); return () => {} },
  }
  return {
    sessions: list,
    open: (id) => { h.opened.push(id) },
    getPinned: () => h.pinned,
    subscribeSettings: (fn) => { h.settingCbs.push(fn); return () => {} },
    setPinned: (ids) => {
      h.pinned = [...ids]
      h.settingCbs.forEach((cb) => cb())
    },
    getTags: (id) => h.tags[id] ?? [],
    setTags: (id, tags) => {
      if (tags.length === 0) delete h.tags[id]
      else h.tags[id] = tags.map((t) => ({ ...t }))
      h.tagCbs.forEach((cb) => cb())
    },
    subscribeTags: (fn) => { h.tagCbs.push(fn); return () => {} },
    pendingKindOf: (id) => h.pending[id],
    subscribePending: (fn) => { h.pendingCbs.push(fn); return () => {} },
    officialActions: {
      fork: async () => {},
      displayTitleOf: (id) => h.byId[id]?.displayTitle ?? id,
      rename: async (id, title) => { h.renamed.push({ id, title }) },
    },
    ...limit === undefined ? {} : { limit },
  }
}

function stripEl(): HTMLElement | null {
  return document.querySelector('[data-dsh-active-strip]')
}

function rowEls(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('[data-dsh-active-row]'))
}

function rowTitles(): string[] {
  return rowEls().map((el) => el.querySelector('[data-dsh-active-title]')?.textContent ?? '')
}

describe('deriveActiveRows', () => {
  it('按 updatedAt 降序排列（最新在前）', () => {
    const rows = deriveActiveRows([], {
      ids: ['a', 'b', 'c'],
      byId: {
        a: { updatedAt: 100 },
        b: { updatedAt: 300 },
        c: { updatedAt: 200 },
      },
    })
    expect(rows.map((r) => r.id)).toEqual(['b', 'c', 'a'])
  })

  it('剔除已在置顶区的会话', () => {
    const rows = deriveActiveRows(['b'], {
      ids: ['a', 'b', 'c'],
      byId: { a: { updatedAt: 100 }, b: { updatedAt: 300 }, c: { updatedAt: 200 } },
    })
    expect(rows.map((r) => r.id)).toEqual(['c', 'a'])
  })

  it('剔除子代理会话与空白会话', () => {
    const rows = deriveActiveRows([], {
      ids: ['parent', 'child', 'blank'],
      byId: {
        parent: { updatedAt: 100 },
        child: { updatedAt: 300, origin: 'subagent', parentId: 'parent' },
        blank: { updatedAt: 200, blank: true },
      },
    })
    expect(rows.map((r) => r.id)).toEqual(['parent'])
  })

  it('截断到上限条数', () => {
    const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g']
    const byId = Object.fromEntries(ids.map((id, i) => [id, { updatedAt: i * 10 }]))
    const rows = deriveActiveRows([], { ids, byId }, 3)
    expect(rows.map((r) => r.id)).toEqual(['g', 'f', 'e'])
  })

  it('缺省上限为 ACTIVE_LIMIT', () => {
    const ids = Array.from({ length: ACTIVE_LIMIT + 3 }, (_, i) => `s${i}`)
    const byId = Object.fromEntries(ids.map((id, i) => [id, { updatedAt: i }]))
    expect(deriveActiveRows([], { ids, byId })).toHaveLength(ACTIVE_LIMIT)
  })

  it('标记当前会话 + 标题回退到 id', () => {
    const rows = deriveActiveRows([], {
      ids: ['a', 'b'],
      byId: { a: { displayTitle: '会话 A', updatedAt: 2 }, b: { updatedAt: 1 } },
    }, ACTIVE_LIMIT, 'a')
    expect(rows[0]).toEqual({ id: 'a', title: '会话 A', current: true })
    expect(rows[1]).toEqual({ id: 'b', title: 'b', current: false })
  })

  it('updatedAt 相同时保持快照顺序（稳定排序）', () => {
    const rows = deriveActiveRows([], {
      ids: ['a', 'b', 'c'],
      byId: { a: { updatedAt: 5 }, b: { updatedAt: 5 }, c: { updatedAt: 5 } },
    })
    expect(rows.map((r) => r.id)).toEqual(['a', 'b', 'c'])
  })
})

describe('startActiveStrip', () => {
  let h: Harness

  beforeEach(() => {
    document.body.innerHTML = ''
    document.head.innerHTML = ''
    h = makeHarness()
  })

  it('无活跃行时不注入任何 DOM', () => {
    buildSidebar()
    const dispose = startActiveStrip(makeDeps(h))
    expect(stripEl()).toBeNull()
    dispose()
  })

  it('注入到列表区（regionArea）之前', () => {
    const root = buildSidebar()
    h.ids = ['a']
    h.byId = { a: { displayTitle: '会话 A', updatedAt: 1 } }
    const dispose = startActiveStrip(makeDeps(h))
    const strip = stripEl()
    expect(strip).not.toBeNull()
    expect(strip?.parentElement).toBe(root)
    const region = root.querySelector('[class*="regionArea"]')
    expect(strip?.nextElementSibling).toBe(region)
    expect(rowTitles()).toEqual(['会话 A'])
    dispose()
  })

  it('插在置顶区之后（置顶区存在时）', () => {
    const root = buildSidebar()
    const pinned = document.createElement('div')
    pinned.setAttribute('data-dsh-pinned-strip', '')
    root.insertBefore(pinned, root.querySelector('[class*="regionArea"]'))
    h.ids = ['a']
    h.byId = { a: { displayTitle: '会话 A', updatedAt: 1 } }
    const dispose = startActiveStrip(makeDeps(h))
    expect(stripEl()?.previousElementSibling).toBe(pinned)
    dispose()
  })

  it('点击行打开会话；Enter 键同样打开', () => {
    buildSidebar()
    h.ids = ['a', 'b']
    h.byId = { a: { updatedAt: 2 }, b: { updatedAt: 1 } }
    const dispose = startActiveStrip(makeDeps(h))
    const first = rowEls()[0]
    first.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(h.opened).toEqual(['a'])
    first.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    expect(h.opened).toEqual(['a', 'a'])
    dispose()
  })

  it('会话列表变更后同步行（新增/排序/移除）', () => {
    buildSidebar()
    h.ids = ['a']
    h.byId = { a: { displayTitle: 'A', updatedAt: 1 } }
    const dispose = startActiveStrip(makeDeps(h))
    expect(rowTitles()).toEqual(['A'])

    h.ids = ['a', 'b']
    h.byId = { a: { displayTitle: 'A', updatedAt: 1 }, b: { displayTitle: 'B', updatedAt: 9 } }
    h.listCbs.forEach((cb) => cb())
    expect(rowTitles()).toEqual(['B', 'A'])

    h.ids = ['b']
    h.listCbs.forEach((cb) => cb())
    expect(rowTitles()).toEqual(['B'])
    dispose()
  })

  it('钉住变更后从活跃区剔除该会话', () => {
    buildSidebar()
    h.ids = ['a', 'b']
    h.byId = { a: { displayTitle: 'A', updatedAt: 2 }, b: { displayTitle: 'B', updatedAt: 1 } }
    const dispose = startActiveStrip(makeDeps(h))
    expect(rowTitles()).toEqual(['A', 'B'])

    h.pinned = ['a']
    h.settingCbs.forEach((cb) => cb())
    expect(rowTitles()).toEqual(['B'])
    dispose()
  })

  it('活跃行清空后整区移除', () => {
    buildSidebar()
    h.ids = ['a']
    h.byId = { a: { updatedAt: 1 } }
    const dispose = startActiveStrip(makeDeps(h))
    expect(stripEl()).not.toBeNull()

    h.ids = []
    h.listCbs.forEach((cb) => cb())
    expect(stripEl()).toBeNull()
    dispose()
  })

  it('当前会话行带标记属性（官方选中行反推）', () => {
    buildSidebar()
    renderOfficialRows(['a'], 'a')
    h.ids = ['a']
    h.byId = { a: { displayTitle: 'A', updatedAt: 1 } }
    const dispose = startActiveStrip(makeDeps(h))
    expect(rowEls()[0].hasAttribute('data-dsh-active-current')).toBe(true)
    expect(rowEls()[0].getAttribute('aria-current')).toBe('true')
    dispose()
  })

  it('官方选中切到另一会话 → 标记移动（观察 aria-selected）', async () => {
    buildSidebar()
    renderOfficialRows(['a', 'b'], 'a')
    h.ids = ['a', 'b']
    h.byId = { a: { updatedAt: 2 }, b: { updatedAt: 1 } }
    const dispose = startActiveStrip(makeDeps(h))
    expect(rowEls()[0].hasAttribute('data-dsh-active-current')).toBe(true)

    selectOfficial('b')
    await vi.waitFor(() => {
      expect(rowEls()[0].hasAttribute('data-dsh-active-current')).toBe(false)
      expect(rowEls()[1].hasAttribute('data-dsh-active-current')).toBe(true)
    })
    dispose()
  })

  it('官方无选中行 → 我们所有行都不带标记', () => {
    buildSidebar()
    renderOfficialRows(['a', 'b']) // 全 aria-selected="false"
    h.ids = ['a', 'b']
    h.byId = { a: { updatedAt: 2 }, b: { updatedAt: 1 } }
    const dispose = startActiveStrip(makeDeps(h))
    expect(rowEls().every((el) => !el.hasAttribute('data-dsh-active-current'))).toBe(true)
    expect(rowEls().every((el) => !el.hasAttribute('aria-current'))).toBe(true)
    dispose()
  })

  it('dispose 后官方选中变化不再触发同步（观察者已断开）', async () => {
    buildSidebar()
    renderOfficialRows(['a', 'b'], 'a')
    h.ids = ['a', 'b']
    h.byId = { a: { updatedAt: 2 }, b: { updatedAt: 1 } }
    const dispose = startActiveStrip(makeDeps(h))
    expect(stripEl()).not.toBeNull()
    dispose()
    expect(stripEl()).toBeNull()

    selectOfficial('b')
    await new Promise((resolve) => { setTimeout(resolve, 0) })
    expect(stripEl()).toBeNull()
  })

  it('标签胶囊在行首（标题之前），文字带 # 前缀', () => {
    buildSidebar()
    h.ids = ['a']
    h.byId = { a: { displayTitle: 'dsh-console开发', updatedAt: 1 } }
    h.tags = { a: [{ text: '功能', tone: 'blue' }] }
    const dispose = startActiveStrip(makeDeps(h))
    const row = rowEls()[0]
    const children = Array.from(row.children)
    const tagIdx = children.findIndex((el) => el.hasAttribute('data-dsh-tag-list'))
    const titleIdx = children.findIndex((el) => el.hasAttribute('data-dsh-active-title'))
    expect(tagIdx).toBeGreaterThanOrEqual(0)
    expect(tagIdx).toBeLessThan(titleIdx)
    expect(row.querySelector('[data-dsh-tag]')?.textContent).toBe('#功能')
    expect(row.querySelector('[data-dsh-active-title]')?.textContent).toBe('dsh-console开发')
    dispose()
  })

  it('行尾 ⋯ 菜单：官方 rename/fork 前置，后接编辑标签与「添加到置顶区」', () => {
    buildSidebar()
    h.ids = ['a']
    h.byId = { a: { displayTitle: 'A', updatedAt: 1 } }
    const dispose = startActiveStrip(makeDeps(h))
    rowEls()[0].querySelector<HTMLElement>('[data-dsh-row-menu-button]')!
      .dispatchEvent(new MouseEvent('click', { bubbles: true }))
    const items = Array.from(document.querySelectorAll<HTMLElement>('[data-dsh-row-menu-item]'))
    expect(items.map((el) => el.dataset.menuItem)).toEqual(['rename', 'fork', 'edit-tags', 'focus-pin'])
    expect(items[0]?.textContent).toBe('重命名')
    expect(items[1]?.textContent).toBe('分叉会话')
    expect(items[2]?.textContent).toBe('编辑标签')
    expect(items[3]?.textContent).toBe('添加到置顶区')
    // 我们的置顶行 = 关注区 pinned（官方动作项不写它）
    items.find((el) => el.dataset.menuItem === 'focus-pin')!
      .dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(h.pinned).toEqual(['a'])
    expect(h.opened).toEqual([])
    closeRowMenu()
    dispose()
  })

  it('行尾 ⋯ 菜单「编辑标签」：打开标签面板', () => {
    buildSidebar()
    h.ids = ['a']
    h.byId = { a: { displayTitle: 'A', updatedAt: 1 } }
    const dispose = startActiveStrip(makeDeps(h))
    rowEls()[0].querySelector<HTMLElement>('[data-dsh-row-menu-button]')!
      .dispatchEvent(new MouseEvent('click', { bubbles: true }))
    Array.from(document.querySelectorAll<HTMLElement>('[data-dsh-row-menu-item]'))
      .find((el) => el.dataset.menuItem === 'edit-tags')!
      .dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(document.querySelector('[data-dsh-tag-editor]')).not.toBeNull()
    closeTagEditor()
    dispose()
  })

  it('点击行本身打开会话（# 按钮之外的区域）', () => {
    buildSidebar()
    h.ids = ['a']
    h.byId = { a: { displayTitle: 'A', updatedAt: 1 } }
    const dispose = startActiveStrip(makeDeps(h))
    rowEls()[0].dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(h.opened).toEqual(['a'])
    dispose()
  })

  it('dispose 后移除 DOM 与样式标签', () => {
    buildSidebar()
    h.ids = ['a']
    h.byId = { a: { updatedAt: 1 } }
    const dispose = startActiveStrip(makeDeps(h))
    expect(stripEl()).not.toBeNull()
    dispose()
    expect(stripEl()).toBeNull()
    expect(document.querySelector('style[data-plugin-css="@dsh-focus-session/active-strip"]')).toBeNull()
  })
})
