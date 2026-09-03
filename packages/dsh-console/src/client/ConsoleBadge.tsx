/**
 * Console 徽标按钮（会话头部可见 UI）——点击弹出实例控制面板。
 * 数据/操作经 typert 远程化（host.listInstances / host.controlInstance /
 * host.brokerStatus——broker 状态由 channel 暴露，替换手写 HTTP 端点）。
 */

import { useState } from 'react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { ConsolePanel } from './ConsolePanel'
import type { ConsoleHost } from './types'

/**
 * 按钮样式：照抄官方设置按钮（dsh-client-ui-settings-general .trigger）——
 * 纯 CSS 类 + 模块顶层注入（bundle 加载即执行）+ :hover 与默认背景同表。
 */
const CONSOLE_TRIGGER_CSS = [
  '.dsh-console-trigger{box-sizing:border-box;cursor:pointer;width:calc(100% + 4px);height:42px;color:var(--dsw-alias-label-primary);background:transparent;border:none;border-radius:12px;flex:none;align-items:center;gap:8px;margin:4px -2px;padding:0 10px 0 8px;font-family:inherit;font-size:14px;line-height:22px;display:flex;overflow:hidden}',
  '.dsh-console-trigger:hover{background:var(--dsw-alias-interactive-bg-hover)}',
  '.dsh-console-trigger--rail{border-radius:50%;justify-content:center;gap:0;width:36px;height:36px;margin:8px 0 10px;padding:0}',
].join('')
if (typeof document !== 'undefined' && !document.querySelector('style[data-plugin-css="@dsh-console/ConsoleBadge"]')) {
  const tag = document.createElement('style')
  tag.dataset.plugin = 'dsh-console'
  tag.dataset.pluginCss = '@dsh-console/ConsoleBadge'
  tag.textContent = CONSOLE_TRIGGER_CSS
  document.head.appendChild(tag)
}

/** 侧栏底部动作插槽注入的 props（wide=false 为 56px 窄栏）。 */
export type ConsoleBadgeProps = PropsRuntime<'sidebar.footer.action'>

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
 * 渲染「Console」徽标触发器——点击打开全屏控制台面板（ConsolePanel）。
 * @param props - 插槽注入的运行时 props。
 */
export function ConsoleBadge(props: ConsoleBadgeProps & { host: ConsoleHost }): React.JSX.Element {
  const { host } = props
  const [open, setOpen] = useState(false)

  return (
    <span
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
        onClick={() => setOpen((v) => !v)}
      >
        <MonitorIcon size={props.wide ? 16 : 18} />
        {props.wide ? '控制台' : null}
      </button>
      {open && <ConsolePanel host={host} onClose={() => setOpen(false)} />}
    </span>
  )
}