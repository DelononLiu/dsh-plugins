/**
 * dsh-my-ui：UI 平台（client 半区）。
 *
 * 消费 host 布局配置（ctx.myUi，四区显隐/顺序）并驱动 UI 布局；聚合的
 * 插件（nav/tabs/console-ui 等）经插槽注册到对应区域。v1 为最小注册
 * 骨架：布局应用（按 ctx.myUi 配置控制区域显隐）在 client 集成步补全。
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'

/** 需要的 client 服务：插槽注册（v1 最小集）。 */
export const inject = ['slots']

/**
 * Client 插件体：UI 平台入口（v1 骨架——布局应用后续接入）。
 * @param ctx - client 根上下文。
 */
export function apply(ctx: ClientContext): void {
  // v1 骨架：预留布局应用入口。四区显隐/顺序经 ctx.myUi（host @Remote，
  // Typert 远程化接入后启用）驱动——client 集成步补全。
  void ctx
}
