/**
 * dsh-tabs：UI·会话标签页（host 面）——固定会话 settings 持久化。
 *
 * tab 行只显示 Alt+P 固定的会话（client 半区动态注册 conversation.view
 * 条目）；host 面注册固定列表 settings 命名空间（settings 服务缺席时跳过）。
 * @module dsh-tabs
 */

import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-settings'

/** 固定会话命名空间（settings 持久化）。 */
export const PINNED_NAMESPACE = 'dsh-tabs-pinned'

/** 固定会话 settings 结构。 */
export interface PinnedSettings {
  /** 固定的会话 id 列表（顺序即 tab 顺序）。 */
  pinned: string[]
}

/** settings schema。 */
export const PinnedSchema = z.object({
  pinned: z.array(z.string()).default([]),
}) as z<PinnedSettings>

/** Host 插件体：注册固定会话命名空间（settings 服务缺席时跳过）。 */
export function apply(ctx: Context): void {
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.register(PINNED_NAMESPACE, PinnedSchema)
  })
}
