/**
 * dsh-nav：UI·实例导航（顶部区域）——host 面。
 *
 * 顶栏实例快捷导航（跳转/在线状态）。纯 UI 插件：host 面空 apply（占位），
 * 浏览器半区经 exports["./client"] 提供。实例数据来源：channel 的实例
 * 服务（InstanceIdentity——type-only 引用，运行时经 ctx.remote 消费，
 * Typert 远程化接入后启用）。
 * @module dsh-nav
 */

/** Host 插件体——纯 UI 插件无 host 侧行为。 */
export function apply(): void {}
