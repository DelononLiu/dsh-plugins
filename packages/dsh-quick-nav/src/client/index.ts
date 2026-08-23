/**
 * dsh-quick-nav：UI·实例导航（client 半区）。
 *
 * 顶部区域：实例快捷导航（跳转/在线状态）。v1 可见形态：显示「实例」
 * 入口 + 点击浮层列出占位实例（本机实例 + 提示）。真实实例列表
 * （channel 实例服务 InstanceIdentity）经 Typert 远程化后补全。
 *
 * 布局配置（dsh-desk my-ui-layout）：topbar.visible=false → 不注册
 * 会话头部入口（跨插件契约 = 共享 settings 配置，见 dsh-desk LayoutControl）。
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { QuickNav } from './QuickNav'

/** 需要的 client 服务：插槽注册 + settingsScope（布局配置读取）。 */
export const inject = ['slots', 'settingsScope']

/**
 * Client 插件体：注册顶栏实例导航入口（受布局配置 topbar.visible 控制）。
 * @param ctx - client 根上下文。
 */
export function apply(ctx: ClientContext): void {
  const layoutScope = ctx.settingsScope.bind<{ layout?: { topbar?: { visible?: boolean } } }>({ namespace: 'my-ui-layout' })
  const topbarVisible = (): boolean => layoutScope.getSnapshot().value?.layout?.topbar?.visible ?? true

  if (!topbarVisible()) return
  ctx.slots.inject(
    'conversation.session.header.actions',
    () => ctx.slots.register({
      name: 'conversation.session.header.actions',
      id: 'instance-nav',
      order: 5,
    }, QuickNav),
  )
}
