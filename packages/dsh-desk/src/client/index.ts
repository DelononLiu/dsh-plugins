/**
 * dsh-desk：工作台组装器（client 半区）——布局设置 + 下方工具区承接。
 *
 * - 布局设置：设置页 General 区（settingsScope 读写，四区显隐）。
 * - 下方工具区：注册 ToolArea 到官方会话头部插槽，fixed 底部条渲染
 *   web-ui.plugin.item（承接 task-board / ssh / skill-explorer 等 vendored
 *   工具——它们注册在该插槽，宿主缺失由 dsh-desk 承接）。
 * - 工作台组装配置：设置页扩展（工具开关/布局调整，后续）。
 */

import { createElement } from 'react'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { LayoutControl, type LayoutRecord } from './LayoutControl'
import { ToolArea } from './ToolArea'

/**
 * 全家桶插槽类型扩展（vendored 注册目标，官方 SlotMap 无此键，消费方自行声明）：
 * - web-ui.plugin.item：task-board / ssh / skill-explorer 等注册目标（dsh-desk 承接）；
 * - sidebar.footer.action：ToolArea 的宿主插槽（同 dsh-console 的声明）。
 */
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    'web-ui.plugin.item': {
      kind: 'list'
      scope: 'root'
      owner: Record<never, never>
    }
    'sidebar.footer.action': {
      kind: 'list'
      scope: 'root'
      owner: { wide: boolean }
    }
  }
}

/** 需要的 client 服务：插槽注册 + settingsScope。 */
export const inject = ['slots', 'settingsScope']

/**
 * Client 插件体：绑定布局 settings 命名空间 + 注册设置页布局项 + 下方工具区。
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
  // 下方工具区：注册到 sidebar.footer.action（常驻插槽，fixed 底部渲染，
  // 声明子插槽 web-ui.plugin.item——承接 vendored 工具）。
  ctx.slots.inject(
    'sidebar.footer.action',
    () => ctx.slots.register({
      name: 'sidebar.footer.action',
      id: 'dsh-desk-tools',
      order: 200,
      // children 声明要求提供 inject（owner props：wide——ToolArea 不依赖，给 false）。
      inject: () => ({ wide: false }),
      children: {
        'web-ui.plugin.item': { kind: 'list', scope: 'root' },
      },
    }, ToolArea),
  )
}
