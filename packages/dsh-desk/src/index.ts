/**
 * dsh-desk：UI 平台（host 面）——布局配置（四区显隐/顺序/宽度）。
 *
 * meta-package 定位：为 UI 插件（dsh-quick-nav / dsh-focus-session / dsh-focus-tabs）
 * 提供布局配置服务 `ctx.myUi`（实例级 Config；"my" = personal 哲学，不做换肤）。
 *
 * 2026-09-26：vendored 全家桶 UI 应用（task-board / ssh / git-graph / skill-explorer）
 * 移除后，原「工具入口组装器」与「slots 型插件显隐」随之下线（它们只为那些插件的
 * `data-dsh-*-entry` 入口与 git-graph chip 服务），本包只剩布局配置；浏览器半区
 * 不再存在（消费方自己读同一份配置的 volatile 表单）。
 * @module dsh-desk
 */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-settings'

/** 布局区（官方/自研真实结构：顶部导航、tab 区、侧边栏；无独立 actions 区）。 */
export type LayoutRegion = 'topbar' | 'tabs' | 'sidebar'

/** 单区布局配置。 */
export interface RegionLayout {
  /** 是否可见。 */
  visible: boolean
  /** 顺序（同栏排列次序）。 */
  order: number
  /** 宽度/尺寸（可选，如 sidebar 宽度）。 */
  size?: string
}

/** 布局配置（实例级，v1 本地配置）。 */
export type LayoutConfig = Record<LayoutRegion, RegionLayout>

declare module '@deepseek-ai/cordis' {
  interface Context {
    myUi: MyUiService
  }
}

/** 插件配置：布局（默认三区全可见，顺序 topbar/tabs/sidebar）。 */
export interface Config {
  layout: LayoutConfig
}

/** 布局 schema 段。 */
const layoutSchema = z.object({
  topbar: z.object({ visible: z.boolean().default(true), order: z.number().default(0), size: z.string().default('') }).default({ visible: true, order: 0, size: '' }),
  tabs: z.object({ visible: z.boolean().default(true), order: z.number().default(1), size: z.string().default('') }).default({ visible: true, order: 1, size: '' }),
  sidebar: z.object({ visible: z.boolean().default(true), order: z.number().default(2), size: z.string().default('260px') }).default({ visible: true, order: 2, size: '260px' }),
}).default({ topbar: { visible: true, order: 0, size: '' }, tabs: { visible: true, order: 1, size: '' }, sidebar: { visible: true, order: 2, size: '260px' } })

/**
 * 运行时 schema。`layout` 声明 `volatile()`：官方 0.1.7 起「设置」= 插件自身 Config 的
 * volatile 字段（表单按 profile 条目 id 定位、写入当前 profile patch、无需重挂载），
 * 消费方（dsh-quick-nav / dsh-focus-tabs）按条目 id `dsh-desk` 经 `ctx.configForms.get()` 读。
 * `as unknown as`：`.volatile()` 会把 schema 的第三个类型参数标成 "volatile-defined"，
 * 与 `z<T>` 不重叠。
 */
export const Config = z.object({
  layout: layoutSchema.volatile(),
}) as unknown as z<Config>

/** 布局数据的 profile 条目 id（= 设置命名空间；消费方按此 id 读同一份配置）。 */
export const DESK_ENTRY_ID = 'dsh-desk'

/** 默认布局（全部可见，标准顺序）。 */
export const DEFAULT_LAYOUT: LayoutConfig = {
  topbar: { visible: true, order: 0 },
  tabs: { visible: true, order: 1 },
  sidebar: { visible: true, order: 2, size: '260px' },
}

/**
 * UI 平台服务（布局配置）：所有 UI 插件经 `ctx.myUi` 查询布局配置。
 * v1 只读配置（实例级）；"每用户布局"（跨实例一致）留 v2。
 */
export class MyUiService extends Service {
  static Config = Config

  constructor(ctx: Context, private readonly config: Config) {
    super(ctx, 'myUi')
    // 可选注入：settings 服务缺席（如单测）时不声明设置页策略。本插件的布局设置
    // 自带消费方（quick-nav/focus-tabs 读同一份配置），不生成自动设置页
    // （官方同款写法：configure({ auto: false })）。
    ctx.inject(['settings'], (settingsCtx) => {
      settingsCtx.effect(() => settingsCtx.settings.configure({ auto: false }, ctx.fiber))
    })
  }

  /** 读取完整布局配置。 */
  layout(): LayoutConfig {
    return {
      topbar: { ...DEFAULT_LAYOUT.topbar, ...this.config.layout.topbar },
      tabs: { ...DEFAULT_LAYOUT.tabs, ...this.config.layout.tabs },
      sidebar: { ...DEFAULT_LAYOUT.sidebar, ...this.config.layout.sidebar },
    }
  }

  /** 查询单区布局配置。 */
  region(region: LayoutRegion): RegionLayout {
    return this.layout()[region]
  }
}

/** 类插件入口：cordis 实例化时自动注册 `ctx.myUi`（构造即注册，勿再 provide）。 */
export default MyUiService
