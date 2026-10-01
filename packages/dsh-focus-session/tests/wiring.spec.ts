/**
 * dsh-focus-session 接线层测试：`apply()` 把两个侧栏区的「打开会话」接到**官方**
 * `ctx.uiWorkspace.openSession(target)`（官方左侧栏会话行点击的同一入口）。
 *
 * 既有 strip 用例注入的是 `open` stub（`deps.open` 被调用即通过），挡不住
 * 「接线调了一个内核根本没有的方法」这类缺陷：本文件用最小 `ctx` 替身装配真实
 * `apply`，收集 `uiWorkspace.openSession` 的实参，证明点击行 → 调用官方入口，
 * 且 target 指向该行会话（SessionTarget 的已知会话 id 分支）。
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { apply } from '../src/client/index.ts'

/** 官方 SidebarRoot.module.css 的 hash 类前缀（css-modules 形式）。 */
const H = (name: string): string => `_${name}_abc123`

/** 构建官方结构侧边栏（SidebarRoot.tsx 树）：root > logoRow/newSession/regionArea/footArea。 */
function buildSidebar(): void {
  const root = document.createElement('div')
  root.dataset.pane = 'sidebar'
  root.className = H('root')

  const logoRow = document.createElement('div')
  logoRow.className = H('logoRow')
  logoRow.appendChild(document.createElement('button'))

  const region = document.createElement('div')
  region.className = H('regionArea')

  root.append(logoRow, region)
  document.body.appendChild(root)
}

/** 一行会话快照（内核 `SessionSummary` 字段子集）。 */
interface Row {
  displayTitle?: string
  updatedAt?: number
  blank?: boolean
}

/** 最小 client ctx 替身 + 可断言状态。 */
interface Harness {
  /** apply 的实参（只实现本插件实际触达的服务面）。 */
  ctx: unknown
  /** `uiWorkspace.openSession` 收到的实参（应恒为一行会话的已知 id）。 */
  openSessionCalls: unknown[]
  /** settings `pinned` 值与订阅。 */
  pinned: string[]
  settingCbs: Array<() => void>
  /** ctx.effect 注册的 disposer（afterEach 清理）。 */
  disposers: Array<() => void>
}

function makeHarness(ids: string[], byId: Record<string, Row>): Harness {
  const openSessionCalls: unknown[] = []
  const settingCbs: Array<() => void> = []
  const disposers: Array<() => void> = []
  const h: Harness = { ctx: undefined, openSessionCalls, pinned: [], settingCbs, disposers }

  const list = {
    // 内核 `ISessions.list` 快照形状（SessionListState）：无当前选择字段。
    getSnapshot: () => ({
      ids,
      byId,
      phase: 'ready',
      projectionsBySession: {},
    }),
    subscribe: () => () => {},
  }

  h.ctx = {
    configForms: {
      get: () => ({
        getSnapshot: () => ({ value: { pinned: h.pinned, tags: {} } }),
        subscribe: (fn: () => void) => { settingCbs.push(fn); return () => {} },
        set: async (_key: string, value: unknown) => {
          if (Array.isArray(value)) h.pinned = [...value]
        },
      }),
    },
    workspaces: {
      list: { getSnapshot: () => ({ pinnedSessionIds: [], archivedSessionIds: [] }), subscribe: () => () => {} },
    },
    uiSession: {
      sessionStatus: { getSnapshot: () => new Map(), subscribe: () => () => {} },
    },
    sessions: {
      list,
      using: async () => ({ ok: true, value: undefined }),
    },
    uiWorkspace: {
      openSession: (target: unknown) => { openSessionCalls.push(target) },
      pinSession: async () => {},
      unpinSession: async () => {},
      archiveSession: async () => {},
      unarchiveSession: async () => {},
      forkSession: async () => {},
    },
    slots: {
      inject: (_name: string, callback: () => unknown) => { callback(); return () => {} },
      register: () => () => {},
    },
    effect: (callback: () => () => void) => { disposers.push(callback()) },
  }
  return h
}

function stripRow(attr: string, index: number): HTMLElement {
  const rows = document.querySelectorAll<HTMLElement>(`[${attr}]`)
  expect(rows.length).toBeGreaterThan(index)
  return rows[index]
}

describe('apply 接线：两侧栏区行点击走官方 uiWorkspace.openSession', () => {
  let h: Harness

  beforeEach(() => {
    document.body.innerHTML = ''
    document.head.innerHTML = ''
    buildSidebar()
    h = makeHarness(['a', 'b', 'c'], {
      a: { displayTitle: '会话甲', updatedAt: 3 },
      b: { displayTitle: '会话乙', updatedAt: 2 },
      c: { displayTitle: '会话丙', updatedAt: 1 },
    })
    h.pinned = ['a', 'b']
  })

  afterEach(() => {
    for (const dispose of h.disposers) dispose()
    document.body.innerHTML = ''
    document.head.innerHTML = ''
  })

  it('点击置顶区行 → uiWorkspace.openSession(SessionTarget=该行会话 id)', () => {
    apply(h.ctx as never)
    const row = stripRow('data-dsh-pinned-row', 1)
    expect(row.dataset.sessionId).toBe('b')
    row.click()
    expect(h.openSessionCalls).toEqual(['b'])
    // 已知会话 id 分支：SessionId 是构建期品牌字符串，运行时即该字符串（非 SubagentAddress 对象）。
    expect(typeof h.openSessionCalls[0]).toBe('string')
  })

  it('点击活跃区行 → uiWorkspace.openSession(SessionTarget=该行会话 id)', () => {
    apply(h.ctx as never)
    // 活跃区剔除置顶区已显示的 a/b，只剩 c。
    const row = stripRow('data-dsh-active-row', 0)
    expect(row.dataset.sessionId).toBe('c')
    row.click()
    expect(h.openSessionCalls).toEqual(['c'])
    expect(typeof h.openSessionCalls[0]).toBe('string')
  })

  it('键盘（Enter）打开也走同一官方入口', () => {
    apply(h.ctx as never)
    const row = stripRow('data-dsh-pinned-row', 0)
    expect(row.dataset.sessionId).toBe('a')
    row.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    expect(h.openSessionCalls).toEqual(['a'])
  })
})
