/**
 * dsh-focus-tabs：UI·会话标签页（host 面）——无 host 侧状态。
 *
 * 会话关注数据（钉住列表 `dsh-focus-pinned`、胶囊标签 `dsh-focus-tags`）的
 * 命名空间注册与持久化归 dsh-focus-session 拥有；本包只在 client 半区读同一份
 * settings 渲染顶部会话 tab 行。因此 host 面不做注册动作——同一个命名空间在
 * settings 服务里只能注册一次，两边都注册会被拒绝。
 * @module dsh-focus-tabs
 */

import { Context } from '@deepseek-ai/cordis'

/** 钉住列表命名空间（由 dsh-focus-session 拥有并注册，此处仅供引用/文档）。 */
export const PINNED_NAMESPACE = 'dsh-focus-pinned'

/** Host 插件体：无 host 侧状态（命名空间注册归 dsh-focus-session）。 */
export function apply(_ctx: Context): void {}
