/**
 * dsh-desk：UI 平台（client 半区）——布局设置 + 布局消费方 + 工具入口组装器。
 *
 * 经官方 settingsScope 读写 host 布局/组装器配置（my-ui-layout 命名空间），
 * 注册到设置页 settings.general.item（用户反馈：布局不进顶部，进设置）；
 * 同时启动布局消费方（sidebar.visible 真正折叠官方侧边栏）与工具入口
 * 组装器（把全家桶 data-dsh-*-entry 入口摆到控制台上方）。
 */

import { createElement } from 'react'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import { LayoutControl, type LayoutRecord } from './LayoutControl'
import { startLayoutConsumer } from './LayoutConsumer'
import { startToolAssembler } from './ToolAssembler'

/** 需要的 client 服务：插槽注册 + settingsScope（布局消费方需 layout 服务）。 */
export const inject = ['slots', 'settingsScope', 'layout']

/**
 * Client 插件体：绑定布局 settings 命名空间并注册设置页布局项；
 * 启动布局消费方（sidebar 显隐生效）与工具入口组装器。
 * @param ctx - client 根上下文。
 */
export function apply(ctx: ClientContext): void {
  const host = ctx.settingsScope.bind<{ layout: LayoutRecord }>({ namespace: 'my-ui-layout' })
  ctx.slots.inject(
    'settings.general.item',
    () => ctx.slots.register({
      name: 'settings.general.item',
      id: 'layout-control',
      order: 20,
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
  ctx.effect(() => () => {
    consumerDisposer()
    assemblerDisposer()
  }, 'dsh-desk: layout consumer + tool assembler')
}
