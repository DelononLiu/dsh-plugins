/**
 * 会话视图：该会话 tab 被选中时渲染——paint 前自动把当前会话切到目标
 * 会话（open），内容区随之显示该会话（默认对话视图）；目标已是当前
 * 会话时不动，仅渲染低调占位。
 */

import { useLayoutEffect, useRef } from 'react'
import type { ConvViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { InjectFace } from '@deepseek-ai/dsh-client-ui-slots'

/** 视图条目注入的 props。 */
export interface SessionViewInjected {
  /** 该 tab 对应的会话 id。 */
  targetId: string
  /** 切换会话（选中该 tab 并显示会话内容）。 */
  open: (sessionId: string) => void
  /** 清空某会话的 slot store 状态（view 残留随之清除，下次渲染归零）。 */
  prune: (sessionId: string) => void
}

/** 视图插槽注入的 props。 */
export type SessionViewProps = ConvViewProps & InjectFace<SessionViewInjected>

/**
 * 会话视图：tab 被选中时自动切换会话。
 * @param props - 注入（targetId/open/prune）+ 标准 kit（sessionId/useSessions）。
 */
export function SessionView(props: SessionViewProps): React.JSX.Element {
  const { targetId, open, prune, sessionId, useSessions } = props
  const openRef = useRef(open)
  openRef.current = open

  // paint 前处理：点击会话 tab → 官方 setView 把 'session-<target>' 写进
  // 当前（来源）会话的 view（残留会让下次切回时自动弹回本视图 → 死循环）。
  // 挂载即 prune 来源会话（实例销毁 + 持久化清除）；随后 open(target) 切到
  // 目标——目标残留（如轨迹）由 onCurrentChange 统一清（新当前默认对话）。
  // 目标是当前会话时（防御：点自己的 tab 已在事件委托拦截，正常不触发）
  // 不动，仅渲染占位。
  useLayoutEffect(() => {
    prune(sessionId)
    if (sessionId !== targetId) {
      openRef.current(targetId)
    }
  }, [sessionId, targetId])

  const list = useSessions((s) => s)
  const summary = (list.byId as Record<string, { displayTitle: string }>)[targetId]
  const isCurrent = sessionId === targetId
  return (
    <div style={{ padding: '10px 16px', fontSize: 13, opacity: 0.8 }}>
      {isCurrent ? '当前会话' : '正在切换…'}：{summary?.displayTitle ?? targetId}
    </div>
  )
}
