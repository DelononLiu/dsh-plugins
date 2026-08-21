/**
 * Console 徽标按钮（会话头部可见 UI）——点击弹出状态浮层。
 * v1：浮层展示 console 已接入状态（实例管理入口占位）；真实数据
 * （实例列表/inbox 未读）在 Typert 远程化接入后补全。
 */

import { useState } from 'react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'

/** 会话头部动作插槽注入的 props。 */
export type ConsoleBadgeProps = PropsRuntime<'conversation.session.header.actions'>

/**
 * 渲染「Console」徽标 + 点击浮层。
 * @param props - 插槽注入的运行时 props。
 */
export function ConsoleBadge(_props: ConsoleBadgeProps): React.JSX.Element {
  const [open, setOpen] = useState(false)
  return (
    <span style={{ position: 'relative', display: 'inline-flex' }}>
      <button
        type="button"
        title="dsh-console：实例管理"
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
        Console
      </button>
      {open && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            right: 0,
            zIndex: 1000,
            width: 220,
            padding: '8px 10px',
            borderRadius: 6,
            border: '1px solid #444',
            background: '#1e1e1e',
            color: '#eee',
            fontSize: 12,
            boxShadow: '0 4px 12px rgba(0,0,0,.35)',
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 4 }}>dsh-console</div>
          <div>实例管理总览（数据接入中）</div>
          <div style={{ marginTop: 6, opacity: 0.7 }}>
            实例列表 · 生命周期 · inbox —— Typert 远程化后显示真实数据
          </div>
        </div>
      )}
    </span>
  )
}
