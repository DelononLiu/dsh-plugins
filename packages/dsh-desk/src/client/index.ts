/**
 * dsh-desk：UI 平台（client 半区）——布局设置 + 布局消费方 + 工具入口组装器
 * + slots 型插件显隐。
 *
 * 经官方 settingsScope 读写 host 布局/组装器配置（my-ui-layout 命名空间），
 * 注册为设置页左侧导航的独立 section「布局」（settings.section，官方
 * "one settings page per list entry"）；同时启动布局消费方（sidebar.visible
 * 真正折叠官方侧边栏）、工具入口组装器（把全家桶 data-dsh-*-entry 入口
 * 摆到控制台上方）与 slots 型插件显隐控制器（git-graph 开关）。
 */

import { createElement } from 'react'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import { LayoutControl, type LayoutRecord } from './LayoutControl'
import { startLayoutConsumer } from './LayoutConsumer'
import { startToolAssembler } from './ToolAssembler'
import { startSlotsController } from './SlotsController'

/** 需要的 client 服务：插槽注册 + settingsScope（布局消费方需 layout 服务）。 */
export const inject = ['slots', 'settingsScope', 'layout']

/**
 * Client 插件体：绑定布局 settings 命名空间并注册设置页「布局」section；
 * 启动布局消费方（sidebar 显隐生效）、工具入口组装器与 slots 型插件显隐。
 * @param ctx - client 根上下文。
 */
export function apply(ctx: ClientContext): void {
  const host = ctx.settingsScope.bind<{ layout: LayoutRecord }>({ namespace: 'my-ui-layout' })
  ctx.slots.inject(
    'settings.section',
    () => ctx.slots.register({
      name: 'settings.section',
      id: 'layout',
      // 排在 General(0)/Models/Agent presets 之后（布局是部署态微调，非高频入口）。
      order: 40,
      label: '布局',
    }, (props) => createElement(LayoutControl, { ...props, host })),
  )

  // 布局消费方：sidebar.visible=false → 折叠官方侧边栏（读 data-sidebar-collapsed 对齐）。
  const consumerDisposer = startLayoutConsumer(
    ctx.layout,
    (fn) => host.subscribe(fn),
    () => host.getSnapshot(),
  )
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
    consumerDisposer()
    assemblerDisposer()
    slotsDisposer()
  }, 'dsh-desk: layout consumer + tool assembler + slots controller')
}
