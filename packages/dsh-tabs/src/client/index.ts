/**
 * dsh-tabs：UI·会话标签页（client 半区）——tab 行只显示 Alt+P 固定的会话。
 *
 * 保持官方行（conversation.view 条目，与官方「对话/轨迹」同行）：
 * - Alt+P 固定/取消固定当前会话；× 关闭；编号「1. 标题」
 * - 点击会话 tab → 切到绑定的会话（官方 setView + SessionView open）
 * - 选中划线（单一，纯派生）：当前会话固定 → 会话 tab 蓝色划线（官方样式）
 *   并抑制官方「对话/轨迹」划线；未固定 → 官方划线。划线 = 固定且当前，
 *   无状态机（label 标记 + MutationObserver 机械映射）。
 * - 点自己的 tab：拦截官方 setView（防占位）+ prune 清残留（轨迹）+ 借官方
 *   「对话」tab 的 setView('chat') 切回对话视图（官方可靠路径）。
 * - 点击左侧会话 → 默认「对话」（onCurrentChange 清新当前残留）。
 */

import { createElement } from 'react'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { SessionView, type SessionViewInjected } from './SessionView'

/** 需要的 client 服务：插槽 + sessions + settings。 */
export const inject = ['slots', 'sessions', 'settingsScope']

/** 会话 tab 标识标记（区分官方「对话/轨迹」tab）。 */
const SESSION_MARK = '\u200b'
/** 固定且当前会话的划线标记。 */
const ACTIVE_MARK = '\u2060'
/** 会话 tab 关闭按钮（尾部可见字符）。 */
const CLOSE_CHAR = ' ×'
/** 会话 tab 划线类名。 */
const ACTIVE_CLASS = 'dsh-tabs-active'
/** 抑制官方划线状态类名（body 级：当前会话固定时生效，单一划线）。 */
const PINNED_ACTIVE_CLASS = 'dsh-tabs-pinned-active'
/** × 关闭热区宽度（button 右端像素）。 */
const CLOSE_HOTZONE = 24
/** 固定会话 settings 命名空间（与 host PINNED_NAMESPACE 对应）。 */
const PINNED_NS = 'dsh-tabs-pinned'

/** settingsScope 绑定的固定列表。 */
interface PinnedValue { pinned?: string[] }

/**
 * Client 插件体：Alt+P/× 固定管理 + 动态注册固定会话 tab + 选中划线。
 * @param ctx - client 根上下文。
 */

/** 会话标签消费的 ctx.sessions 最小契约（绕开官方 dsh-session 的 host
 *  SessionStore 漂移——会话标签只需 list 快照 + open）。 */
interface TabsSessionsList {
  getSnapshot(): { current: string | undefined; ids: readonly string[]; byId: Record<string, { displayTitle?: string }> }
  subscribe(fn: () => void): () => void
}
interface TabsSessions {
  list: TabsSessionsList
  open(id: string): void
}
function sessionsOf(ctx: { sessions: unknown }): TabsSessions {
  return sessionsOf(ctx) as TabsSessions
}

export function apply(ctx: ClientContext): void {
  const settings = ctx.settingsScope.bind<{ pinned: string[] }>({ namespace: PINNED_NS })
  const pinnedOf = (): string[] => (settings.getSnapshot().value as PinnedValue | undefined)?.pinned ?? []

  // 布局配置（dsh-desk my-ui-layout）：tabs.visible=false → 不注册会话 tab
  // （跨插件契约 = 共享 settings 配置，见 dsh-desk LayoutControl）。
  const layoutScope = ctx.settingsScope.bind<{ layout?: { tabs?: { visible?: boolean } } }>({ namespace: 'my-ui-layout' })
  const tabsVisible = (): boolean => layoutScope.getSnapshot().value?.layout?.tabs?.visible ?? true

  // —— 选中划线：注入官方 tabActive 同款样式（仅会话 tab）+ 抑制官方划线 ——
  const style = document.createElement('style')
  style.textContent = [
    `button[role="tab"].${ACTIVE_CLASS} { color: var(--dsw-alias-state-business-primary) !important; }`,
    `button[role="tab"].${ACTIVE_CLASS}::after { background: var(--dsw-alias-state-business-primary) !important; }`,
    // 当前会话固定：抑制官方「对话/轨迹」tab 的划线（单一划线；功能不受影响）。
    `body.${PINNED_ACTIVE_CLASS} button[role="tab"][aria-selected="true"] { color: var(--dsw-alias-label-tertiary) !important; }`,
    `body.${PINNED_ACTIVE_CLASS} button[role="tab"][aria-selected="true"]::after { background: transparent !important; }`,
  ].join('\n')
  document.head.appendChild(style)

  // 模式：true = 官方划线（对话/轨迹，点官方 tab 时）；false = 会话 tab 划线。
  let officialView = false
  // 「对话」tab 记忆的会话（切换前看的；点「对话」时切回，VSCode preview 模型）。
  let dialogSession: string | undefined
  // 点「对话」切回记忆会话后的过渡标记：onCurrentChange 保持对话视图，
  // 不被"进入固定会话 → 会话 tab 划线"覆盖。
  let pendingDialogView = false

  // 划线：会话 tab 模式（非官方视图 且 当前会话固定）→ 会话 tab 划线 +
  // 抑制官方；否则官方划线。
  const applyActive = (): void => {
    const list = sessionsOf(ctx).list.getSnapshot()
    const current = list.current
    const tabMode = !officialView && current !== undefined && pinnedOf().includes(current)
    document.body.classList.toggle(PINNED_ACTIVE_CLASS, tabMode)
    for (const btn of document.querySelectorAll<HTMLButtonElement>('button[role="tab"]')) {
      const text = btn.textContent ?? ''
      btn.classList.toggle(ACTIVE_CLASS, tabMode && text.includes(ACTIVE_MARK))
    }
  }
  // React 重渲染会替换 button DOM，childList/characterData 都能触发重扫。
  const observer = new MutationObserver(applyActive)
  observer.observe(document.body, { childList: true, subtree: true, characterData: true })
  applyActive()
  ctx.effect(() => () => {
    observer.disconnect()
    style.remove()
    document.body.classList.remove(PINNED_ACTIVE_CLASS)
  }, 'dsh-tabs: active-tab observer')

  // —— 会话切换（含左侧点击）：清新当前残留视图（如轨迹）→ 默认对话 ——
  // 需求：点击左侧会话默认在「对话」。列表增删时 current 未变则不误清。
  let lastCurrent: string | undefined
  const onCurrentChange = (): void => {
    const current = sessionsOf(ctx).list.getSnapshot().current
    if (current === undefined) return
    if (current !== lastCurrent) {
      lastCurrent = String(current)
    }
    if (pendingDialogView) {
      // 事件 10：点「对话」切回记忆会话后：保持对话视图（官方划线），
      // 记忆同步为当前。
      pendingDialogView = false
      officialView = true
      dialogSession = String(current)
      applyActive()
      return
    }
    const isPinned = pinnedOf().includes(current)
    if (isPinned) {
      // 事件 8：切到固定会话 → 会话 tab 划线；记忆保持。
      officialView = false
    } else {
      // 事件 9：切到未固定会话（对话视图）→ 官方划线；记忆跟随。
      officialView = true
      dialogSession = String(current)
    }
    applyActive()
  }
  const unsubCurrent = sessionsOf(ctx).list.subscribe(onCurrentChange)
  ctx.effect(() => () => unsubCurrent(), 'dsh-tabs: current sync')
  {
    // 初始：按当前会话是否固定对齐状态；未固定 → 记录对话记忆。
    const current = sessionsOf(ctx).list.getSnapshot().current
    if (current !== undefined) {
      lastCurrent = String(current)
      const isPinned = pinnedOf().includes(current)
      officialView = !isPinned
      if (!isPinned) dialogSession = String(current)
    }
  }

  // —— 事件委托（捕获阶段，先于官方 onClick）：× 关闭 + 点自己的 tab 恢复对话 ——
  // programmaticClick：程序化触发官方「对话」tab（点自己的 tab 恢复对话视图）
  // 时绕过本委托——否则会被当成"真实点对话"覆盖 officialView 并触发记忆切回。
  let programmaticClick = false
  const onClickCapture = (e: MouseEvent): void => {
    if (programmaticClick) {
      programmaticClick = false
      return
    }
    const target = e.target as HTMLElement
    const btn = target.closest?.('button[role="tab"]') as HTMLButtonElement | null
    if (btn === null) return
    const text = btn.textContent ?? ''
    if (!text.includes(SESSION_MARK)) {
      // 事件 1/2：官方 tab → 官方划线（轨迹选中，不被抑制）。
      officialView = true
      applyActive()
      // 事件 1 细分：仅「对话」（第一个官方 tab）切回记忆的会话（切换前
      // 看的，VSCode preview 模型）；「轨迹」保持官方（当前会话轨迹，不切）。
      const officialTabs = Array.from(document.querySelectorAll<HTMLButtonElement>('button[role="tab"]'))
        .filter((b) => !(b.textContent ?? '').includes(SESSION_MARK))
      if (officialTabs[0] === btn && dialogSession !== undefined) {
        const listNow = sessionsOf(ctx).list.getSnapshot()
        const current = listNow.current
        if (current !== undefined && String(current) !== dialogSession && listNow.ids.includes(dialogSession as never)) {
          pendingDialogView = true
          sessionsOf(ctx).open(dialogSession as never)
        }
      }
      return
    }
    // 会话 tab：解析会话 id（第 N 个会话 tab = 固定列表第 N 个）。
    const sessionTabs = Array.from(document.querySelectorAll<HTMLButtonElement>('button[role="tab"]'))
      .filter((b) => (b.textContent ?? '').includes(SESSION_MARK))
    const idx = sessionTabs.indexOf(btn)
    if (idx < 0) return
    const list = sessionsOf(ctx).list.getSnapshot()
    const pinnedExisting = [...new Set(pinnedOf())].filter((id) => list.ids.includes(id as never))
    const sessionId = pinnedExisting[idx]
    const current = list.current !== undefined ? String(list.current) : undefined
    // 事件 4：点击尾部 × 热区 → 取消固定（拦截，避免触发官方 setView）→ 官方划线。
    const rect = btn.getBoundingClientRect()
    if (e.clientX > rect.right - CLOSE_HOTZONE) {
      e.preventDefault()
      e.stopPropagation()
      if (sessionId !== undefined) {
        settings.set('pinned', pinnedExisting.filter((id) => id !== sessionId))
        // 关闭的是当前会话：它在对话视图了（未固定），记为「对话」记忆。
        if (sessionId === current) dialogSession = sessionId
      }
      officialView = true
      applyActive()
      return
    }
    // 事件 3：点击当前会话自己的 tab：拦截官方 setView（否则 view 被污染成
    // 'session-<当前>'，内容区渲染占位「当前会话：xxx」）；清残留视图
    // （如轨迹）并借官方「对话」tab 的 setView('chat') 切回对话视图——
    // chatStore 不可达，官方「对话」tab 是唯一可靠的"切到对话"入口。
    if (sessionId !== undefined && current === sessionId) {
      e.preventDefault()
      e.stopPropagation()
      officialView = false
      applyActive()
      const chatBtn = Array.from(document.querySelectorAll<HTMLButtonElement>('button[role="tab"]'))
        .find((b) => !(b.textContent ?? '').includes(SESSION_MARK))
      if (chatBtn !== undefined) {
        programmaticClick = true
        chatBtn.click()
      }
      return
    }
    // 事件 2：其他会话 tab → 会话 tab 划线；切会话由官方 setView + SessionView 执行。
    officialView = false
    applyActive()
  }
  document.addEventListener('click', onClickCapture, true)
  ctx.effect(() => () => document.removeEventListener('click', onClickCapture, true), 'dsh-tabs: tab click delegation')

  // —— Alt+P 固定/取消固定；Alt+1..9 切到第 N 个固定 tab ——
  const onKeyDown = (e: KeyboardEvent): void => {
    if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return
    // Alt+P：固定/取消固定当前会话（事件 5/6）。
    if (e.code === 'KeyP') {
      e.preventDefault()
      const current = sessionsOf(ctx).list.getSnapshot().current
      if (current === undefined) return
      const pinned = pinnedOf()
      const isPinned = pinned.includes(current as never)
      settings.set('pinned', isPinned
        ? pinned.filter((id) => id !== current)
        : [...pinned, String(current)])
      // 固定 → 会话 tab 划线（记忆保持）；取消固定 → 官方划线 + 记忆当前。
      officialView = isPinned
      if (isPinned) dialogSession = String(current)
      applyActive()
      return
    }
    // Alt+1..9（主键盘/Numpad）：切到第 N 个固定会话 tab。
    const digit = /^(?:Digit|Numpad)([1-9])$/.exec(e.code)?.[1]
    if (digit === undefined) return
    e.preventDefault()
    const index = Number(digit) - 1
    const list = sessionsOf(ctx).list.getSnapshot()
    const pinnedExisting = [...new Set(pinnedOf())].filter((id) => list.ids.includes(id as never))
    const target = pinnedExisting[index]
    if (target === undefined) return
    sessionsOf(ctx).open(target as never)
    // 切到固定会话 → 会话 tab 划线（open 触发的 onCurrentChange 也会设，这里兜底）。
    officialView = false
    applyActive()
  }
  window.addEventListener('keydown', onKeyDown)
  ctx.effect(() => () => window.removeEventListener('keydown', onKeyDown), 'dsh-tabs: Alt+P pin toggle')

  // —— 动态注册固定的会话 tab ——
  // 每次注册都须经 slots.inject 包装：conversation.view 仅在声明它的
  // 条目挂载时存在，inject 保证声明就绪才注册、声明重挂载时重跑。
  // 布局配置 tabs.visible 实时控制：false → 注销全部 tab，true → 恢复。
  ctx.slots.inject('conversation.view', () => {
    const disposers = new Map<string, () => void>()

    /** 注销全部 tab 注册（tabs.visible=false 时）。 */
    const clearAll = (): void => {
      for (const dispose of [...disposers.values()]) dispose()
      disposers.clear()
    }

    const sync = (): void => {
      if (!tabsVisible()) {
        clearAll()
        return
      }
      const list = sessionsOf(ctx).list.getSnapshot()
      // 只注册固定的会话（且仍存在）；去重保序。
      const toRegister = [...new Set(pinnedOf())].filter((id) => list.ids.includes(id as never))
      const seen = new Set<string>()
      toRegister.forEach((id, index) => {
        seen.add(id)
        if (disposers.has(id)) return
        const dispose = ctx.slots.register({
          name: 'conversation.view',
          id: `session-${id}`,
          // 官方视图 tab（0/10/…）之后留足空间：会话 tabs 永远排同一行末尾。
          order: 100 + index,
          // label：会话 tab 显示「编号. 标题」（按固定列表顺序，从 1 起），
          // 固定且当前的 tab 带划线标记（DOM 层加官方划线样式）+ 不可见标记
          //（区分官方 tab）+ 尾部可见 ×；会话 id 不写入 label（避免可见）。
          label: () => {
            const listNow = sessionsOf(ctx).list.getSnapshot()
            const pinnedExisting = [...new Set(pinnedOf())].filter((pid) => listNow.ids.includes(pid as never))
            const idx = pinnedExisting.indexOf(id)
            const title = (listNow.byId as Record<string, { displayTitle: string }>)[id]?.displayTitle ?? id
            const isActive = listNow.current === id && pinnedOf().includes(id)
            const num = idx >= 0 ? `${idx + 1}. ` : ''
            return `${num}${title}${isActive ? ACTIVE_MARK : ''}${SESSION_MARK}${CLOSE_CHAR}`
          },
          inject: (): SessionViewInjected => ({
            targetId: id,
            open: (sid: string) => { sessionsOf(ctx).open(sid as never) },
            // 清来源会话的 slot store：官方 setView('session-<id>') 污染
            // 当前（来源）会话的 view，残留导致切回时死循环；挂载时清掉。
          }),
        }, (props) => createElement(SessionView, props))
        disposers.set(id, dispose)
      })
      for (const [id, dispose] of [...disposers]) {
        if (!seen.has(id)) {
          dispose()
          disposers.delete(id)
        }
      }
    }

    sync()
    const unsubList = sessionsOf(ctx).list.subscribe(sync)
    const unsubSettings = settings.subscribe(() => {
      sync()
      applyActive()
    })
    const unsubLayout = layoutScope.subscribe(sync)
    return () => {
      unsubList()
      unsubSettings()
      unsubLayout()
      clearAll()
    }
  })
}
