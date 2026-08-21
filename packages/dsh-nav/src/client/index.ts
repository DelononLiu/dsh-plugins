/**
 * dsh-nav：UI·实例导航（client 半区）。
 *
 * 顶部区域：实例列表（id/name/addr/status——channel 实例服务）+ 快捷跳转
 * + 在线状态点。v1 为最小注册骨架：注册到官方 client 插槽（slots）；
 * 渲染与实例数据（经 ctx.remote 消费 channel 实例服务）在 client 集成步
 * 补全——数据面接口已在 dsh-channel（host）就绪。
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'

/** 需要的 client 服务：插槽注册（v1 最小集）。 */
export const inject = ['slots']

/**
 * Client 插件体：注册顶栏导航入口（v1 骨架——实例列表渲染后续接入）。
 * @param ctx - client 根上下文。
 */
export function apply(ctx: ClientContext): void {
  // v1 骨架：预留顶栏实例导航插槽注册点。实例数据（InstanceIdentity）经
  // ctx.remote（channel 实例服务 @Remote）消费——Typert 远程化接入后启用。
  void ctx
}
