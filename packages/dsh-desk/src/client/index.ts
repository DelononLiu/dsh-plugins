/**
 * dsh-desk：UI 平台（client 半区）——工具入口组装器 + slots 型插件显隐。
 *
 * 绑定 my-ui-layout 命名空间（host Config/settings，实例配置），启动工具入口
 * 组装器（把全家桶 data-dsh-*-entry 入口摆到侧栏 foot/会话头顶部）与 slots
 * 型插件显隐（git-graph）。原「布局」设置页（settings.section，含 topbar/
 * tabs/sidebar 显隐与工具开关）已删除（2026-09，功能聚焦 dsh-console/dsh-focus-tabs）
 * ——区域显隐不再有设置入口，组装器/显隐控制器按配置缺省（全部可见/默认摆位）
 * 工作；官方侧边栏折叠走官方自身 toggle。
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type { LayoutConfig, AssemblerConfig } from '../index'
import { startToolAssembler } from './ToolAssembler'
import { startSlotsController } from './SlotsController'

/** 需要的 client 服务：settingsScope（读写 my-ui-layout 配置）。 */
export const inject = ['settingsScope']

/**
 * Client 插件体：绑定 my-ui-layout settings 命名空间，启动工具入口组装器与
 * slots 型插件显隐（无设置页，按配置/缺省工作）。
 * @param ctx - client 根上下文。
 */
export function apply(ctx: ClientContext): void {
  const host = ctx.settingsScope.bind<{ layout: LayoutConfig; assembler: AssemblerConfig }>({ namespace: 'my-ui-layout' })

  // 组装器：运行时发现 entry + 读 assembler 配置（间距/工具显隐）+ 订阅配置变更。
  const assemblerDisposer = startToolAssembler(
    host.getSnapshot(),
    (fn) => host.subscribe(fn),
    () => host.getSnapshot(),
  )
  // slots 型插件显隐：git-graph 开关（CSS 覆盖，配置变更实时生效）。
  const slotsDisposer = startSlotsController(
    host.getSnapshot(),
    (fn) => host.subscribe(fn),
    () => host.getSnapshot(),
  )
  ctx.effect(() => () => {
    assemblerDisposer()
    slotsDisposer()
  }, 'dsh-desk: tool assembler + slots controller')
}
