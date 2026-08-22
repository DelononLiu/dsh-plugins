/**
 * 工具区（下方）：承接全家桶插件插槽 web-ui.plugin.item（task-board / ssh /
 * skill-explorer 等 vendored 工具注册于此）——叠加在官方会话区下方。
 * 官方无独立工具区插槽，用 fixed 底部条叠加（不动官方布局）。
 * 注册到 sidebar.footer.action（常驻，无 inject 要求）。
 */

import type { PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'

/** 侧栏底部插槽注入的 props + 声明消费子插槽 web-ui.plugin.item（renderSlot）。 */
export type ToolAreaProps = PropsRuntime<'sidebar.footer.action'> & PropsRenderSlots<'web-ui.plugin.item'>

/** 工具区标题（后续可配置）。 */
const TOOL_LABEL = '工具'

/**
 * 渲染「下方工具区」：fixed 底部条，内容 = web-ui.plugin.item 的 occupants。
 * @param props - 插槽注入 props（renderSlot 渲染子插槽 web-ui.plugin.item）。
 */
export function ToolArea(props: ToolAreaProps): React.JSX.Element {
  return (
    <div
      style={{
        position: 'fixed',
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 900,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        minHeight: 40,
        padding: '4px 12px',
        borderTop: '1px solid var(--dsw-alias-border-l2)',
        background: 'var(--dsw-alias-bg-layer-2)',
        color: 'var(--dsw-alias-label-primary)',
        fontSize: 12,
        boxShadow: 'var(--dsw-shadow-lv2)',
      }}
    >
      <span style={{ color: 'var(--dsw-alias-label-secondary)', fontSize: 11, fontWeight: 600, flex: 'none' }}>
        {TOOL_LABEL}
      </span>
      {/* 承接全家桶插槽：task-board / ssh / skill-explorer 注册于此 */}
      {props.renderSlot('web-ui.plugin.item', {})}
    </div>
  )
}
