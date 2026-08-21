/**
 * dsh-console-ui：总览/管理界面（client 半区）。
 *
 * v1 可见 UI：在会话头部注册「Console」徽标按钮（顶部区域入口的最小
 * 可见形态）。数据面（实例列表/inbox 经 console 服务）在 Typert 远程化
 * 接入后补全——本组件先展示可加载状态。
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { ConsoleBadge } from './ConsoleBadge'

/** 需要的 client 服务：插槽注册。 */
export const inject = ['slots']

/**
 * Client 插件体：注册会话头部「Console」入口。
 * @param ctx - client 根上下文。
 */
export function apply(ctx: ClientContext): void {
  ctx.slots.inject(
    'conversation.session.header.actions',
    () => ctx.slots.register({
      name: 'conversation.session.header.actions',
      id: 'console-ui',
      order: 30,
    }, ConsoleBadge),
  )
}
