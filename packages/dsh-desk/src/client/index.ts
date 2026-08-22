/**
 * dsh-desk：UI 平台（client 半区）——布局设置（设置页 General 区）。
 *
 * 经官方 settingsScope 读写 host 布局配置（my-ui-layout 命名空间），
 * 注册到设置页 settings.general.item（用户反馈：布局不进顶部，进设置）。
 */

import { createElement } from 'react'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { LayoutControl, type LayoutRecord } from './LayoutControl'
import { startToolAssembler } from './ToolAssembler'

/** 需要的 client 服务：插槽注册 + settingsScope。 */
export const inject = ['slots', 'settingsScope']

/**
 * Client 插件体：绑定布局 settings 命名空间并注册设置页布局项；
 * 同时启动工具入口组装器（把全家桶 data-dsh-*-entry 入口摆到控制台上方）。
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
  const disposer = startToolAssembler()
  ctx.effect(() => disposer, 'dsh-desk: tool assembler')
}
