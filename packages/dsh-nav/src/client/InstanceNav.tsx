/**
 * 实例导航（顶栏）：v1 显示「实例」入口 + 点击浮层（占位实例列表）。
 * 真实实例列表（channel InstanceIdentity：id/addr/status）在 Typert
 * 远程化接入后补全——本组件先提供入口与占位形态。
 */

import { useState } from 'react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'

/** 会话头部动作插槽注入的 props。 */
export type InstanceNavProps = PropsRuntime<'conversation.session.header.actions'>

/**
 * 渲染「实例」导航入口 + 占位浮层。
 * @param props - 插槽注入的运行时 props。
 */
export function InstanceNav(props: InstanceNavProps): React.JSX.Element {
  const { useSessions } = props
  const list = useSessions((s) => s)
  const [open, setOpen] = useState(false)
  return (
    <span style={{ position: 'relative', display: 'inline-flex' }}>
      <button
        type="button"
        title="实例导航（多实例跳转/在线状态）"
        onClick={() => setOpen((v) => !v)}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          padding: '2px 8px',
          borderRadius: 4,
          border: '1px solid currentColor',
          background: 'transparent',
          color: 'inherit',
          fontSize: 12,
          cursor: 'pointer',
        }}
      >
        ⚙ 实例
      </button>
      {open && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            right: 0,
            zIndex: 1000,
            width: 240,
            padding: '8px 10px',
            borderRadius: 6,
            border: '1px solid #444',
            background: '#1e1e1e',
            color: '#eee',
            fontSize: 12,
            boxShadow: '0 4px 12px rgba(0,0,0,.35)',
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 4 }}>实例导航</div>
          <div style={{ opacity: 0.85, marginBottom: 4 }}>
            本机实例（当前工作区：{list.current ? list.byId[list.current]?.cwd ?? list.byId[list.current]?.displayTitle ?? list.current : '—'}）
          </div>
          <div style={{ fontSize: 11, opacity: 0.6, lineHeight: 1.5 }}>
            多实例团队部署：从这里跳转各实例/看在线状态。
            <br />实例列表经 dsh-channel 发现——Typert 远程化后显示
          </div>
        </div>
      )}
    </span>
  )
}
