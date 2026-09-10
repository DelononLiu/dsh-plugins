/**
 * 会话视图：会话 tab 的占位内容（正常不被渲染——会话切换由点击事件委托
 * 直接 open，'session-*' 永不写入官方 view 偏好）。
 *
 * 残留兜底：历史版本点击会话 tab 会把 'session-<id>' 写进某会话的官方
 * view 偏好（localStorage dsh.conversation.<sid>），官方 restoreView 忠实
 * 恢复 → 每次切到该会话自动激活本视图。挂载时清除该残留偏好并把视图切回
 * chat（官方 restore 的 fallback），否则激活态会随会话切换反复弹回。
 */

import { useLayoutEffect } from 'react'
import type { ConvViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { InjectFace } from '@deepseek-ai/dsh-client-ui-slots'

/** 视图条目注入的 props。 */
export interface SessionViewInjected {
  /** 该 tab 对应的会话 id。 */
  targetId: string
  /** 切换会话（选中该 tab 并显示会话内容）。 */
  open: (sessionId: string) => void
}

/** 视图插槽注入的 props。 */
export type SessionViewProps = ConvViewProps & InjectFace<SessionViewInjected>

/** 官方 conversation store 持久化 key（view 偏好按会话存 localStorage）。 */
const CONVERSATION_STORE_KEY = 'dsh.conversation'

/**
 * 清除某会话 localStorage view 偏好中的 `session-*` 残留（历史版本点击会话
 * tab 会把 'session-<id>' 写进官方偏好；不除则官方 restoreView 自动恢复 →
 * 本视图反复激活 → 死循环）。只重置 view 字段，保留 draft 等其余状态。
 */
function pruneSessionViewPreference(sessionId: string): void {
  try {
    const key = `${CONVERSATION_STORE_KEY}.${sessionId}`
    const raw = localStorage.getItem(key)
    if (raw === null) return
    const store = JSON.parse(raw) as { state?: { view?: unknown } }
    const view = store.state?.view
    if (typeof view === 'string' && view.startsWith('session-')) {
      if (store.state !== undefined) {
        store.state.view = null
        localStorage.setItem(key, JSON.stringify(store))
      }
    }
  } catch {
    // localStorage 不可用/损坏：忽略（不阻断渲染）。
  }
}

/**
 * 会话视图（占位）：正常由事件委托 open 切会话，本组件不应被激活；仅在
 * 历史 view 偏好残留把本 target 激活时挂载——清残留 + 切回官方 chat 视图，
 * 让官方 UI 回到对话。不执行 open（会话切换不在渲染副作用里做）。
 * @param props - 注入（targetId/open）+ 标准 kit（sessionId）。
 */
export function SessionView(props: SessionViewProps): React.JSX.Element {
  const { targetId, sessionId, useSessions } = props

  // 残留兜底：本组件被激活 ⇒ 当前会话的 view 偏好残留为本 target（历史
  // bug）。清掉偏好（只重置 view，保留 draft）——官方下次 restore 即回
  // chat。不清则每次切到该会话都被官方自动恢复 → 激活↔切走循环。
  useLayoutEffect(() => {
    pruneSessionViewPreference(sessionId)
  }, [sessionId])

  const list = useSessions((s) => s)
  const summary = (list.byId as Record<string, { displayTitle: string }>)[targetId]
  const isCurrent = sessionId === targetId
  return (
    <div style={{ padding: '10px 16px', fontSize: 13, opacity: 0.8 }}>
      {isCurrent ? '当前会话' : '正在切换…'}：{summary?.displayTitle ?? targetId}
    </div>
  )
}
