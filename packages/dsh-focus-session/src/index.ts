/**
 * dsh-focus-session：UI·会话关注层（host 面）——钉住列表与胶囊标签的 settings
 * 持久化。
 *
 * 本包拥有两份会话关注数据（settings 命名空间），client 半区据此渲染侧栏
 * 「置顶区」与「活跃区」，dsh-focus-tabs 只读消费同一份数据渲染顶部会话 tab 行：
 * - `dsh-focus-pinned`：钉住的会话 id 列表（顺序即置顶区行序与 tab 行序）。
 * - `dsh-focus-tags`：会话 → 胶囊标签（人工自定义文字 + 可选色调）。
 *
 * 旧命名空间 `dsh-tabs-pinned`（本包从 dsh-tabs 拆出前的归属）同样注册，供 client
 * 半区在 scope 就绪后一次性把旧值搬进新命名空间并清空旧值——用户既有钉不丢，且
 * 「全部取消钉」之后旧钉不会复活。
 * @module dsh-focus-session
 */

import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-settings'

/** 钉住会话命名空间（settings 持久化）。 */
export const PINNED_NAMESPACE = 'dsh-focus-pinned'

/** 拆分前的旧钉住命名空间（一次性迁移源；迁移完成后由 client 清空）。 */
export const LEGACY_PINNED_NAMESPACE = 'dsh-tabs-pinned'

/** 会话胶囊标签命名空间。 */
export const TAGS_NAMESPACE = 'dsh-focus-tags'

/** 钉住会话 settings 结构。 */
export interface PinnedSettings {
  /** 钉住的会话 id 列表（顺序即置顶区行序 / 会话 tab 行序）。 */
  pinned: string[]
}

/** 会话胶囊标签 settings 结构。 */
export interface TagsSettings {
  /** 会话 id → 标签列表（顺序即渲染顺序）。 */
  tags: Record<string, SessionTag[]>
}

/** 一个胶囊标签：文字 + 可选色调（tone 为空 = 中性灰）。 */
export interface SessionTag {
  /** 标签文字（显示即原文）。 */
  text: string
  /**
   * 色调键（`neutral`/`blue`/`green`/`amber`/`red`），映射到官方语义色变量；
   * 缺省 = 中性（未知值渲染为中性）。
   */
  tone?: string
}

/** 钉住列表 schema。 */
export const PinnedSchema = z.object({
  pinned: z.array(z.string()).default([]),
}) as z<PinnedSettings>

/** 胶囊标签 schema。 */
export const TagsSchema = z.object({
  tags: z.dict(z.array(z.object({
    text: z.string().required(),
    tone: z.string(),
  }))).default({}),
}) as z<TagsSettings>

/** Host 插件体：注册三份命名空间（settings 服务缺席时跳过）。 */
export function apply(ctx: Context): void {
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.register(PINNED_NAMESPACE, PinnedSchema)
    // 旧命名空间同样注册，只是为了 client 能读到旧值做一次性迁移（迁移完成后
    // client 会把它清空）。
    settingsCtx.settings.register(LEGACY_PINNED_NAMESPACE, PinnedSchema)
    settingsCtx.settings.register(TAGS_NAMESPACE, TagsSchema)
  })
}
