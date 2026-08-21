/**
 * dsh-tabs：UI·会话标签页（client 半区）。
 *
 * tab 区：顶栏可见固定会话标签 + Alt+1..9 跨工作区切换（快捷键键位经
 * settings 持久化，参考社区 dsh-hotkeys 的 settings 半区模式）。v1 为
 * 最小注册骨架：注册到官方 client 插槽（slots）；标签渲染与快捷键绑定在
 * client 集成步补全。
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'

/** 需要的 client 服务：插槽注册（v1 最小集）。 */
export const inject = ['slots']

/**
 * Client 插件体：注册 tab 区入口（v1 骨架——会话标签渲染 + Alt+1..9 后续接入）。
 * @param ctx - client 根上下文。
 */
export function apply(ctx: ClientContext): void {
  // v1 骨架：预留 tab 区插槽注册点。会话标签 + 快捷键绑定在 client 集成步补全。
  void ctx
}
