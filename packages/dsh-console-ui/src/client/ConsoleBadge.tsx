/**
 * Console 徽标按钮（会话头部可见 UI，v1 最小形态）。
 * 数据面（实例数/inbox 未读）在 Typert 远程化接入后补全。
 */

import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'

/** 会话头部动作插槽注入的 props。 */
export type ConsoleBadgeProps = PropsRuntime<'conversation.session.header.actions'>

/**
 * 渲染「Console」徽标——dsh-console 已接入的可见标记。
 * @param props - 插槽注入的运行时 props。
 */
export function ConsoleBadge(_props: ConsoleBadgeProps): React.JSX.Element {
  return (
    <button
      type="button"
      title="dsh-console：实例管理"
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
  )
}
