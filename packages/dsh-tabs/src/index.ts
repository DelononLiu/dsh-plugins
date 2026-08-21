/**
 * dsh-tabs：UI·会话标签页（host 面）。
 *
 * 固定会话标签页：顶栏可见 tab + Alt+1..9 跨工作区切换。纯 UI 插件：
 * host 面空 apply（占位），浏览器半区经 exports["./client"] 提供。
 * dsh-tabs 无内部依赖（独立插件）。
 * @module dsh-tabs
 */

/** Host 插件体——纯 UI 插件无 host 侧行为。 */
export function apply(): void {}
