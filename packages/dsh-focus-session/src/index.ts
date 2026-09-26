/**
 * dsh-focus-session：UI·会话关注层（host 面）——钉住列表与胶囊标签的配置面。
 *
 * 本包拥有两份会话关注数据（本插件 Config 的 volatile 字段——官方 0.1.7 起设置 =
 * 插件自身 Config，按 profile 条目 id 定位、持久化进当前 profile patch），client
 * 半区据此渲染侧栏「置顶区」与「活跃区」，dsh-focus-tabs 只读消费同一份数据渲染
 * 顶部会话 tab 行：
 * - `pinned`：钉住的会话 id 列表（顺序即置顶区行序与 tab 行序）。
 * - `tags`：会话 → 胶囊标签（人工自定义文字 + 可选色调）。
 *
 * （0.1.7 前这两份数据是独立 settings 命名空间 `dsh-focus-pinned` / `dsh-focus-tags`
 * 与迁移源 `dsh-tabs-pinned`；新模型下并入本插件 Config。）
 * @module dsh-focus-session
 */

import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-settings'

/** 本插件的 profile 条目 id（= 设置命名空间；消费方按此 id 读同一份配置）。 */
export const FOCUS_SESSION_ENTRY_ID = 'dsh-focus-session'

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

/**
 * 插件 Config：两份关注数据合成一份 volatile 配置（官方 0.1.7 设置模型——只有
 * volatile 字段可按 profile 条目 id 经表单读写，且写入不触发重挂载）。
 * `as unknown as`：`.volatile()` 会把 schema 的第三个类型参数标成 "volatile-defined"，
 * 与 `z<T>` 不重叠（官方同款写法不做断言，本仓库统一以断言保持既有类型口径）。
 */
export const Config = z.object({
  pinned: z.array(z.string()).default([]).volatile(),
  tags: z.dict(z.array(z.object({
    text: z.string().required(),
    tone: z.string(),
  }))).default({}).volatile(),
}) as unknown as z<PinnedSettings & TagsSettings>

/** Host 插件体：两区由 client 半区自绘，故不生成自动设置页（官方同款写法）。 */
export function apply(ctx: Context): void {
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.effect(() => settingsCtx.settings.configure({ auto: false }, ctx.fiber))
  })
}
