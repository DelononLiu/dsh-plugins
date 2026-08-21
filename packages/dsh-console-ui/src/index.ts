/**
 * dsh-console-ui：UI·总览/管理界面（host 面）。
 *
 * 纯 UI 插件：host 面为空 apply（让插件出现在 host cordis.yml / Loader），
 * 浏览器半区经 exports["./client"] 提供（package.json dsh.client 声明）。
 * 数据消费：经 console 服务（type-only 类型 + ctx.remote——Typert 远程化
 * 在消费端接入时启用；v1 client 半区为最小注册骨架）。
 * @module dsh-console-ui
 */

/** Host 插件体——纯 UI 插件无 host 侧行为。 */
export function apply(): void {}
