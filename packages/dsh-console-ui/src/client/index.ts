/**
 * dsh-console-ui：UI·总览/管理界面（client 半区）。
 *
 * 四区布局：左侧设置上方按钮区入口 + 内容区总览。v1 为最小注册骨架：
 * 注册到官方 client 插槽（slots）与本地化；总览渲染（实例列表/生命周期
 * 操作/inbox）在 client 集成步（React + slots 挂载 + ctx.remote 消费
 * console 服务）补全——数据面接口已在 dsh-console（host）就绪。
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'

/** 需要的 client 服务：插槽注册（v1 最小集）。 */
export const inject = ['slots']

/**
 * Client 插件体：注册插槽入口（v1 骨架——总览面板渲染后续接入）。
 * @param ctx - client 根上下文。
 */
export function apply(ctx: ClientContext): void {
  // v1 骨架：预留总览入口插槽注册点。数据（实例档案/inbox）经
  // ctx.remote（console @Remote）消费——Typert 远程化接入后启用。
  void ctx
}
