/**
 * Console 徽标按钮（会话头部可见 UI）——点击弹出实例控制面板。
 * 数据/操作经 host HTTP 端点：GET /api/console/instances（实例列表）、
 * POST /api/console/control（下发控制指令，如重启）。
 */

import { useEffect, useRef, useState } from 'react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'

/**
 * 按钮样式：照抄官方设置按钮（dsh-client-ui-settings-general .trigger）——
 * 纯 CSS 类 + 模块顶层注入（bundle 加载即执行）+ :hover 与默认背景同表。
 */
const CONSOLE_TRIGGER_CSS = [
  '.dsh-console-trigger{box-sizing:border-box;cursor:pointer;width:calc(100% + 4px);height:42px;color:var(--dsw-alias-label-primary);background:transparent;border:none;border-radius:12px;flex:none;align-items:center;gap:8px;margin:4px -2px;padding:0 10px 0 8px;font-family:inherit;font-size:14px;line-height:22px;display:flex;overflow:hidden}',
  '.dsh-console-trigger:hover{background:var(--dsw-alias-interactive-bg-hover)}',
  '.dsh-console-trigger--rail{border-radius:50%;justify-content:center;gap:0;width:36px;height:36px;margin:8px 0 10px;padding:0}',
].join('')
if (typeof document !== 'undefined' && !document.querySelector('style[data-plugin-css="@dsh-console-ui/ConsoleBadge"]')) {
  const tag = document.createElement('style')
  tag.dataset.plugin = 'dsh-console-ui'
  tag.dataset.pluginCss = '@dsh-console-ui/ConsoleBadge'
  tag.textContent = CONSOLE_TRIGGER_CSS
  document.head.appendChild(tag)
}

/** 侧栏底部动作插槽注入的 props（wide=false 为 56px 窄栏）。 */
export type ConsoleBadgeProps = PropsRuntime<'sidebar.footer.action'>

/** Broker 状态视图（/api/console/broker）。 */
interface BrokerView {
  connected: boolean
  reason?: string
  agents: Array<{ id: string; online: boolean }>
  queueCount: number
}

/** 显示器图标（官方 SVG stroke 风格，与侧栏图标一致）。 */
function MonitorIcon(props: { size: number }): React.JSX.Element {
  return (
    <svg width={props.size} height={props.size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="1.5" y="2.5" width="13" height="9" rx="1.5" />
      <path d="M5.5 13.5h5M8 11.5v2" />
    </svg>
  )
}

/** 实例视图（channel 发现，含在线状态）。 */
interface InstanceView {
  id: string
  name: string
  addr: string
  status: 'online' | 'offline'
  hostId?: string
  /** 所属主机名（守护 agent 名，如 host1；来自 launch 配置）。 */
  host?: string
  /** 当前实例（管理端自己）：不参与跳转。 */
  self?: boolean
}

/** 主机守护视图（host-* peers）。 */
interface HostView {
  id: string
  name: string
  status: 'online' | 'offline'
}

/**
 * 渲染「Console」徽标 + 实例控制面板浮层。
 * @param props - 插槽注入的运行时 props。
 */
export function ConsoleBadge(props: ConsoleBadgeProps): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [instances, setInstances] = useState<InstanceView[] | null>(null)
  const [hosts, setHosts] = useState<HostView[] | null>(null)
  const [broker, setBroker] = useState<BrokerView | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [panelPos, setPanelPos] = useState<{ left: number; bottom: number } | null>(null)
  const rootRef = useRef<HTMLSpanElement>(null)

  const toggle = (): void => {
    const next = !open
    setOpen(next)
    setNotice(null)
    if (next) {
      // fixed 定位：按按钮实际视口坐标，面板在按钮上方弹出（右缘对齐按钮，clamp 视口内）。
      // 不用 absolute 相对按钮容器——侧栏渲染上下文可能干扰定位。
      const rect = rootRef.current?.getBoundingClientRect()
      if (rect) {
        setPanelPos({
          left: Math.max(8, Math.min(rect.right - 260, window.innerWidth - 268)),
          bottom: window.innerHeight - rect.top + 4,
        })
      }
      fetch('/api/console/instances')
        .then((r) => r.json() as Promise<{ instances: InstanceView[]; hosts?: HostView[] }>)
        .then((d) => {
          setInstances(d.instances ?? [])
          setHosts(d.hosts ?? [])
        })
        .catch(() => { setInstances([]); setHosts([]) })
      fetch('/api/console/broker')
        .then((r) => r.json() as Promise<BrokerView>)
        .then((d) => setBroker(d))
        .catch(() => setBroker(null))
    }
  }

  const CONTROL_LABEL: Record<string, string> = { start: '启动', stop: '停止', restart: '重启' }
  const control = (id: string, name: string, command: 'start' | 'stop' | 'restart'): void => {
    fetch('/api/console/control', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ instanceId: id, command }),
    })
      .then((r) => r.json() as Promise<{ ok: boolean; error?: string }>)
      .then((d) => {
        setNotice(d.ok ? `已向 ${name} 下发${CONTROL_LABEL[command]}指令` : `失败：${d.error ?? 'unknown'}`)
      })
      .catch(() => setNotice(`${CONTROL_LABEL[command]} ${name} 失败（无法连接控制端点）`))
  }

  // 浮层打开时：点击外部（非本面板）关闭。
  useEffect(() => {
    if (!open) return
    const onDocClick = (e: MouseEvent): void => {
      const target = e.target as HTMLElement
      if (!target.closest('[data-console-panel]')) setOpen(false)
    }
    document.addEventListener('click', onDocClick)
    return () => document.removeEventListener('click', onDocClick)
  }, [open])

  return (
    // 包裹层：展开态占满整行（等效 settingsArea 全宽，让按钮 width:calc(100%+4px) 解析成全宽）；
    // 折叠态内容宽（按钮 36px 圆居中）。
    <span
      ref={rootRef}
      data-console-panel
      style={{
        position: 'relative',
        display: props.wide ? 'flex' : 'inline-flex',
        width: props.wide ? '100%' : undefined,
      }}
    >
      <button
        type="button"
        // 纯 CSS 类（与官方设置按钮同机制），零 inline 视觉样式。
        className={props.wide ? 'dsh-console-trigger' : 'dsh-console-trigger dsh-console-trigger--rail'}
        title="dsh-console：实例管理"
        onClick={toggle}
      >
        <MonitorIcon size={props.wide ? 16 : 18} />
        {props.wide ? '控制台' : null}
      </button>
      {open && panelPos && (
        <div
          style={{
            position: 'fixed',
            left: panelPos.left,
            bottom: panelPos.bottom,
            zIndex: 2000,
            width: 260,
            maxHeight: 'calc(100dvh - 80px)',
            overflowY: 'auto',
            padding: '8px 10px',
            borderRadius: 6,
            border: '1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.12))',
            background: 'var(--dsw-alias-bg-base, #ffffff)',
            color: 'var(--dsw-alias-label-primary, #1a1a1a)',
            fontSize: 12,
            boxShadow: '0 4px 12px rgba(0,0,0,.35)',
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 4 }}>实例管理（单机/多机）</div>
          {instances === null && <div style={{ opacity: 0.7 }}>加载中…</div>}
          {instances !== null && instances.length === 0 && (
            <div style={{ opacity: 0.7 }}>暂无实例（channel 未发现）</div>
          )}
          {instances !== null && instances.map((inst) => (
            <div key={inst.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 0' }}>
              <span style={{ color: inst.status === 'online' ? '#4caf50' : '#f44336' }}>{inst.status === 'online' ? '●' : '○'}</span>
              {/* 行文本 = 实例名 + 所属主机名（在线状态由圆点表示）；在线且非当前实例、有地址 → 可点击跳转 */}
              {inst.status === 'online' && !inst.self && inst.addr ? (
                <a
                  href={inst.addr}
                  target="_blank"
                  rel="noreferrer"
                  title={`打开 ${inst.name} 的服务`}
                  style={{
                    flex: 1,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    color: 'inherit',
                    textDecoration: 'none',
                    cursor: 'pointer',
                  }}
                >
                  {inst.name}{inst.host ? `（${inst.host}）` : ''}
                </a>
              ) : (
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {inst.name}{inst.host ? `（${inst.host}）` : ''}
                </span>
              )}
              {(inst.status === 'online' ? (['stop', 'restart'] as const) : (['start'] as const)).map((cmd) => (
                <button
                  key={cmd}
                  type="button"
                  onClick={() => control(inst.id, inst.name, cmd)}
                  style={{
                    padding: '1px 6px',
                    borderRadius: 4,
                    border: '1px solid currentColor',
                    background: 'transparent',
                    color: 'inherit',
                    fontSize: 11,
                    cursor: 'pointer',
                  }}
                >
                  {CONTROL_LABEL[cmd]}
                </button>
              ))}
            </div>
          ))}
          {hosts !== null && hosts.length > 0 && (
            <div style={{ marginTop: 6, paddingTop: 6, borderTop: '1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.12))' }}>
              <div style={{ fontWeight: 600, marginBottom: 2 }}>主机守护</div>
              {hosts.map((host) => (
                <div key={host.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 0' }}>
                  <span style={{ color: host.status === 'online' ? '#4caf50' : '#f44336' }}>{host.status === 'online' ? '●' : '○'}</span>
                  <span style={{ flex: 1 }}>{host.name}（{host.status}）</span>
                </div>
              ))}
            </div>
          )}
          {broker !== null && (
            <div style={{ marginTop: 6, paddingTop: 6, borderTop: '1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.12))' }}>
              <div style={{ fontWeight: 600, marginBottom: 2 }}>Broker 状态</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 0' }}>
                <span style={{ color: broker.connected ? '#4caf50' : '#f44336' }}>{broker.connected ? '●' : '○'}</span>
                <span style={{ flex: 1 }}>{broker.connected ? `已连接（在线 ${broker.agents.filter((a) => a.online).length} / ${broker.agents.length}）` : `不可达${broker.reason ? `：${broker.reason}` : ''}`}</span>
              </div>
              <div style={{ padding: '2px 0', opacity: 0.85 }}>消息队列：{broker.queueCount < 0 ? '查询失败' : `${broker.queueCount} 条`}</div>
            </div>
          )}
          {notice && <div style={{ marginTop: 6, opacity: 0.85 }}>{notice}</div>}
        </div>
      )}
    </span>
  )
}
