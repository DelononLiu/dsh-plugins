/**
 * 两个侧栏区（置顶区 + 活跃区）**同时挂载**时的收敛性测试。
 *
 * 每个区的 MutationObserver 只过滤「自己区域内」的写入——因此 A 区的写入对 B 区而言
 * 是「外部变更」，会触发 B 的 sync；若任一区的 sync 不是真正的不动点（稳定后仍写
 * DOM），就会形成 A写→B sync→B写→A sync 的自触发回环，把渲染主线程饿死（页面卡死）。
 * 本测试断言：稳定后注入一次外部变更，两个区都**零重复写**。
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { startPinnedStrip, type PinnedStripDeps } from '../src/client/PinnedStrip.ts'
import { startActiveStrip, type ActiveStripDeps } from '../src/client/ActiveStrip.ts'

const tick = (): Promise<void> => new Promise((resolve) => { setTimeout(resolve, 0) })
const H = (name: string): string => `_${name}_abc123`
const STRIPS = '[data-dsh-pinned-strip],[data-dsh-active-strip]'

/** 官方结构侧边栏：root > logoRow/newSession/regionArea/footArea。 */
function buildSidebar(): HTMLElement {
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
  return root
}

interface State {
  pinned: string[]
  ids: string[]
  current?: string
  byId: Record<string, { displayTitle?: string; updatedAt?: number; running?: boolean }>
  opened: string[]
  settingsCbs: Array<() => void>
  listCbs: Array<() => void>
  pendingCbs: Array<() => void>
  tagCbs: Array<() => void>
  tags: Record<string, { text: string }[]>
}

function makeState(): State {
  return {
    pinned: [], ids: [], current: undefined, byId: {}, opened: [],
    settingsCbs: [], listCbs: [], pendingCbs: [], tagCbs: [], tags: {},
  }
}

function sessionsList(h: State) {
  return {
    getSnapshot: () => ({ current: h.current, ids: h.ids, byId: h.byId }),
    subscribe: (fn: () => void) => { h.listCbs.push(fn); return () => { h.listCbs = h.listCbs.filter((f) => f !== fn) } },
  }
}

function commonDeps(h: State) {
  return {
    open: (id: string) => { h.opened.push(id) },
    getPinned: () => h.pinned,
    subscribeSettings: (fn: () => void) => { h.settingsCbs.push(fn); return () => {} },
    pendingKindOf: () => undefined,
    subscribePending: (fn: () => void) => { h.pendingCbs.push(fn); return () => {} },
    getTags: (id: string) => h.tags[id] ?? [],
    setTags: (id: string, tags: readonly { text: string }[]) => { h.tags[id] = [...tags]; h.tagCbs.forEach((cb) => cb()) },
    subscribeTags: (fn: () => void) => { h.tagCbs.push(fn); return () => {} },
  }
}

/** 统计窗口内「落在这两个区内部」的 DOM 变更条数。 */
function countStripWrites(): { count: number; stop: () => number } {
  let writes = 0
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      const target = record.target
      if (target instanceof Element && target.closest(STRIPS) !== null) writes += 1
      else if (target.parentElement?.closest(STRIPS) != null) writes += 1
    }
  })
  observer.observe(document.body, { childList: true, subtree: true, characterData: true })
  return { count: 0, stop: () => { observer.disconnect(); return writes } }
}

describe('置顶区 + 活跃区同时挂载', () => {
  let h: State

  beforeEach(() => {
    document.body.innerHTML = ''
    document.head.innerHTML = ''
    h = makeState()
  })

  it('稳定后注入外部变更：两区零重复写（不形成自触发回环）', async () => {
    buildSidebar()
    h.pinned = ['a']
    h.ids = ['a', 'b', 'c']
    h.byId = {
      a: { displayTitle: '会话 A', updatedAt: 3 },
      b: { displayTitle: '会话 B', updatedAt: 2 },
      c: { displayTitle: '会话 C', updatedAt: 1 },
    }
    h.current = 'b'
    h.tags = { b: [{ text: '重要' }], a: [{ text: '待办' }] }
    const pinned = startPinnedStrip({ ...commonDeps(h), sessions: sessionsList(h), setPinned: (ids) => { h.pinned = [...ids] } } as PinnedStripDeps)
    const active = startActiveStrip({ ...commonDeps(h), sessions: sessionsList(h), setPinned: (ids) => { h.pinned = [...ids] } } as ActiveStripDeps)

    // 初始挂载后等一轮，让两个区各自收敛。
    await tick()
    await tick()

    // 待评估窗口：注入一次「外部」变更（body 下新增无关节点）→ 触发两区 sync。
    const probe = countStripWrites()
    document.body.appendChild(document.createElement('div'))
    await tick()
    await tick()
    await tick()
    const writes = probe.stop()

    expect(writes).toBe(0)
    // 两个区都在位且内容正确（证明上面的 0 写不是"两区都没挂上"）。
    expect(document.querySelector('[data-dsh-pinned-strip]')).not.toBeNull()
    expect(document.querySelector('[data-dsh-active-strip]')).not.toBeNull()
    expect(document.querySelectorAll('[data-dsh-pinned-row]')).toHaveLength(1)
    expect(document.querySelectorAll('[data-dsh-active-row]')).toHaveLength(2)

    pinned()
    active()
  })

  it('外部变更频繁发生时也保持零写（模拟 React 侧栏重排/流式渲染）', async () => {
    buildSidebar()
    h.pinned = ['a']
    h.ids = ['a', 'b']
    h.byId = { a: { displayTitle: 'A', updatedAt: 2 }, b: { displayTitle: 'B', updatedAt: 1 } }
    const pinned = startPinnedStrip({ ...commonDeps(h), sessions: sessionsList(h), setPinned: (ids) => { h.pinned = [...ids] } } as PinnedStripDeps)
    const active = startActiveStrip({ ...commonDeps(h), sessions: sessionsList(h), setPinned: (ids) => { h.pinned = [...ids] } } as ActiveStripDeps)
    await tick()
    await tick()

    const probe = countStripWrites()
    for (let i = 0; i < 5; i++) {
      document.body.appendChild(document.createElement('span'))
      await tick()
    }
    expect(probe.stop()).toBe(0)

    pinned()
    active()
  })
})
