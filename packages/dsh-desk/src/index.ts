/**
 * dsh-desk：UI 平台（host 面）——四区布局 + 插件组合自定义。
 *
 * meta-package 定位：聚合 UI 插件（dsh-quick-nav / dsh-tabs），提供四区布局
 * （顶部/tab/侧边栏/左侧按钮区）的显隐/顺序/宽度配置（Config，实例级
 * 本地配置——cordis.yml 可配；"my"= personal 哲学，不做换肤）。
 * 浏览器半区经 exports["./client"] 提供。
 * @module dsh-desk
 */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'

/** 四区（已定布局）。 */
export type LayoutRegion = 'topbar' | 'tabs' | 'sidebar' | 'actions'

/** 单区布局配置。 */
export interface RegionLayout {
  /** 是否可见。 */
  visible: boolean
  /** 顺序（同栏排列次序）。 */
  order: number
  /** 宽度/尺寸（可选，如 sidebar 宽度）。 */
  size?: string
}

/** 四区布局配置（实例级，v1 本地配置）。 */
export type LayoutConfig = Record<LayoutRegion, RegionLayout>

/** 组装器工具（data-dsh-*-entry 注入型，v1 三家 + 可扩展）。 */
export type AssembledToolId = 'taskboard' | 'ssh' | 'skill'

/** 组装器配置（工具显隐；通用性 = 运行时发现 + 配置排除）。 */
export interface AssemblerConfig {
  /** 工具显隐（缺省可见；false = 组装器不摆位该工具）。 */
  tools: Partial<Record<AssembledToolId, { visible: boolean }>>
}

/** 默认组装器配置。 */
export const DEFAULT_ASSEMBLER: AssemblerConfig = {
  tools: {},
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    myUi: MyUiService
  }
}

/** 插件配置：四区布局 + 组装器（默认全部可见，顺序 topbar/tabs/sidebar/actions）。 */
export interface Config {
  layout: LayoutConfig
  assembler: AssemblerConfig
}

/** 布局 schema 段（复用：Config 与 LayoutSettingsSchema 各一份）。 */
const layoutSchema = z.object({
  topbar: z.object({ visible: z.boolean().default(true), order: z.number().default(0), size: z.string().default('') }).default({ visible: true, order: 0, size: '' }),
  tabs: z.object({ visible: z.boolean().default(true), order: z.number().default(1), size: z.string().default('') }).default({ visible: true, order: 1, size: '' }),
  sidebar: z.object({ visible: z.boolean().default(true), order: z.number().default(2), size: z.string().default('260px') }).default({ visible: true, order: 2, size: '260px' }),
  actions: z.object({ visible: z.boolean().default(true), order: z.number().default(3), size: z.string().default('') }).default({ visible: true, order: 3, size: '' }),
}).default({ topbar: { visible: true, order: 0, size: '' }, tabs: { visible: true, order: 1, size: '' }, sidebar: { visible: true, order: 2, size: '260px' }, actions: { visible: true, order: 3, size: '' } })

/** 组装器 schema 段（tools 为 dict，键可缺省，缺省 = 可见）。 */
const assemblerSchema = z.object({
  tools: z.dict(z.object({ visible: z.boolean().default(true) }).default({ visible: true })).default({}),
}).default(DEFAULT_ASSEMBLER)

/** 运行时 schema。 */
export const Config = z.object({
  layout: layoutSchema,
  assembler: assemblerSchema,
}) as z<Config>

/** 布局设置命名空间（settings 持久化，client settingsScope 读写）。 */
export const LAYOUT_NAMESPACE = settingsNamespace('my-ui-layout')

/** 布局设置 schema（settings 注册用）。 */
export const LayoutSettingsSchema = z.object({
  layout: layoutSchema,
  assembler: assemblerSchema,
}) as z<{ layout: LayoutConfig; assembler: AssemblerConfig }>

/** 默认布局（全部可见，标准顺序）。 */
export const DEFAULT_LAYOUT: LayoutConfig = {
  topbar: { visible: true, order: 0 },
  tabs: { visible: true, order: 1 },
  sidebar: { visible: true, order: 2, size: '260px' },
  actions: { visible: true, order: 3 },
}

/**
 * UI 平台服务（布局配置）：所有 UI 插件经 `ctx.myUi` 查询四区布局。
 * v1 只读配置（实例级）；"每用户布局"（跨实例一致）留 v2。
 */
export class MyUiService extends Service {
  static Config = Config

  constructor(ctx: Context, private readonly config: Config) {
    super(ctx, 'myUi')
    // 可选注入：settings 服务缺席（如单测）时不注册布局命名空间。
    ctx.inject(['settings'], (settingsCtx) => {
      settingsCtx.settings.register(LAYOUT_NAMESPACE, LayoutSettingsSchema)
    })
  }

  /** 读取完整四区布局配置。 */
  layout(): LayoutConfig {
    return {
      topbar: { ...DEFAULT_LAYOUT.topbar, ...this.config.layout.topbar },
      tabs: { ...DEFAULT_LAYOUT.tabs, ...this.config.layout.tabs },
      sidebar: { ...DEFAULT_LAYOUT.sidebar, ...this.config.layout.sidebar },
      actions: { ...DEFAULT_LAYOUT.actions, ...this.config.layout.actions },
    }
  }

  /** 查询单区布局配置。 */
  region(region: LayoutRegion): RegionLayout {
    return this.layout()[region]
  }

  /** 读取组装器配置（工具显隐）。 */
  assembler(): AssemblerConfig {
    return {
      tools: this.config.assembler.tools,
    }
  }
}

/** 类插件入口：cordis 实例化时自动注册 `ctx.myUi`（构造即注册，勿再 provide）。 */
export default MyUiService
