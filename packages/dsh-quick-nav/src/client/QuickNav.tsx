/**
 * 快捷导航（顶栏）：纯粹链接导航——浮层一行一个链接，点击跳转。
 * 数据：host `/api/quick-nav/instances`（channel.list + 地址表）。
 */

import { useEffect, useRef, useState } from 'react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'

/** 会话头部动作插槽注入的 props。 */
export type QuickNavProps = PropsRuntime<'conversation.session.header.actions'>

/** 一个实例导航链接。 */
interface InstanceLink {
  id: string
  name: string
  addr: string
  status: 'online' | 'offline'
  current?: boolean
}

/** 从地址提取端口（显示用）。 */
function portOf(addr: string): string {
  const m = /:(\d+)$/.exec(addr.replace(/\/$/, ''))
  return m?.[1] ?? ''
}

/**
 * 渲染「快捷导航」入口 + 链接列表浮层（一行一个链接）。
 * @param props - 插槽注入的运行时 props。
 */
export function QuickNav(props: QuickNavProps): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [links, setLinks] = useState<InstanceLink[]>([])
  const rootRef = useRef<HTMLSpanElement>(null)

  // 点击浮层外部（其他按钮/空白）时关闭。
  useEffect(() => {
    if (!open) return
    const onDocClick = (e: MouseEvent): void => {
      if (rootRef.current !== null && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('click', onDocClick)
    return () => document.removeEventListener('click', onDocClick)
  }, [open])

  // 打开浮层时拉取实例链接。
  useEffect(() => {
    if (!open) return
    let cancelled = false
    fetch('/api/quick-nav/instances')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`http ${r.status}`))))
      .then((data: { instances?: InstanceLink[] }) => {
        if (!cancelled) setLinks(data.instances ?? [])
      })
      .catch(() => { /* 数据面不可用：浮层保持空 */ })
    return () => { cancelled = true }
  }, [open])

  return (
    <span ref={rootRef} style={{ position: 'relative', display: 'inline-flex' }}>
      <button
        type="button"
        title="快捷导航"
        onClick={() => setOpen((v) => !v)}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          padding: '2px 6px',
          borderRadius: 4,
          border: 'none',
          background: 'transparent',
          color: 'inherit',
          fontSize: 12,
          cursor: 'pointer',
        }}
      >
        ⚙ 快捷导航
      </button>
      {open && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            right: 0,
            zIndex: 1000,
            minWidth: 220,
            padding: '6px 0',
            // 浮层风格对齐官方（与控制台面板一致）：层级背景 + 官方阴影 + 官方圆角/边框层级。
            borderRadius: 8,
            border: '1px solid var(--dsw-alias-border-l2)',
            background: 'var(--dsw-alias-bg-layer-2)',
            color: 'var(--dsw-alias-label-primary)',
            fontSize: 13,
            boxShadow: 'var(--dsw-shadow-lv2)',
          }}
        >
          {links.length === 0 && (
            <div style={{ padding: '6px 12px', color: 'var(--dsw-alias-label-secondary)', fontSize: 12 }}>（无导航链接）</div>
          )}
          {links.map((link) => {
            const row = (
              <>
                <span style={{ color: link.status === 'online' ? 'var(--dsw-alias-state-success-primary)' : 'var(--dsw-alias-label-tertiary)' }}>
                  {link.status === 'online' ? '●' : '○'}
                </span>
                <span>{link.name}</span>
                {link.current && <span style={{ color: 'var(--dsw-alias-label-tertiary)', fontSize: 11 }}>（当前）</span>}
                {link.addr && (
                  <span style={{ marginLeft: 'auto', color: 'var(--dsw-alias-label-tertiary)', fontSize: 11 }}>{portOf(link.addr)}</span>
                )}
              </>
            )
            // 可点击条件：在线且有地址、且非当前实例（当前实例不可点击，弱化显示）。
            const clickable = link.addr && link.status === 'online' && !link.current
            return clickable
              ? (
                <a
                  key={link.id}
                  href={link.addr}
                  target="_blank"
                  rel="noreferrer"
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '6px 12px', color: 'inherit', textDecoration: 'none',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--dsw-alias-interactive-bg-hover)' }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
                >
                  {row}
                </a>
              )
              : (
                <div key={link.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', opacity: 0.5 }}>
                  {row}
                </div>
              )
          })}
        </div>
      )}
    </span>
  )
}
