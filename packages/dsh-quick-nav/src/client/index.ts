/**
 * dsh-quick-nav：UI·实例导航（client 半区）。
 *
 * 顶部区域：实例快捷导航（跳转/在线状态/本实例不可点）。
 * 实例列表经本插件 host 面的 HTTP 端点 `/api/quick-nav/instances` 拉取——该端点在
 * host 侧以**管理端（DSH_CONSOLE_ADDR）实例表为权威源**（`/api/console/instances`，
 * 含每实例 addr + 本实例 current 标记 + 过滤 host 守护），console 不可达时回退本地
 * channel 表。客户端直接 fetch 即可拿到「全实例 + current」，本实例(current)渲染为
 * 不可点击弱化项（见 QuickNav）。
 * （此前曾改用 `ctx.remote.channel.list()`——channel 表不含 current、且管理端上该表
 * 为空，导致快捷导航空白；回退到权威 HTTP 端点。）
 *
 * 布局配置（dsh-desk my-ui-layout）：topbar.visible 实时控制注册/注销
 * 会话头部入口（跨插件契约 = 共享 settings 配置，见 dsh-desk LayoutControl）。
 */

import { createElement } from 'react'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from 'dsh-channel/remote'
import { QuickNav, type InstanceLink, type QuickNavHost } from './QuickNav'

/** 需要的 client 服务：插槽注册 + settingsScope。 */
export const inject = ['slots', 'settingsScope']

/**
 * Client 插件体：注册顶栏实例导航入口（topbar.visible 实时控制）。
 * 数据源 = host `/api/quick-nav/instances`（权威实例表，含 current）。
 * @param ctx - client 根上下文。
 */
export function apply(ctx: ClientContext): void {
  const layoutScope = ctx.settingsScope.bind<{ layout?: { topbar?: { visible?: boolean } } }>({ namespace: 'my-ui-layout' })
  const topbarVisible = (): boolean => layoutScope.getSnapshot().value?.layout?.topbar?.visible ?? true

  // 拉取快捷导航实例表（本插件 host 端点；不可用 → 空列表，浮层显示"无导航链接"）。
  const fetchNav = async (): Promise<InstanceLink[]> => {
    try {
      const res = await fetch('/api/quick-nav/instances')
      if (!res.ok) return []
      const data = await res.json() as { instances?: InstanceLink[] }
      return data.instances ?? []
    } catch {
      return []
    }
  }

  ctx.slots.inject(
    'conversation.session.header.actions',
    () => {
      // 注册态：dispose 为 null = 未注册。配置变更时注册/注销实时切换。
      let dispose: (() => void) | null = null
      const sync = (): void => {
        if (topbarVisible()) {
          if (dispose === null) {
            const host: QuickNavHost = { list: fetchNav }
            dispose = ctx.slots.register({
              name: 'conversation.session.header.actions',
              id: 'instance-nav',
              order: 5,
            }, (props) => createElement(QuickNav, { ...props, host }))
          }
        } else if (dispose !== null) {
          dispose()
          dispose = null
        }
      }
      const unsubscribe = layoutScope.subscribe(sync)
      sync()
      return () => {
        unsubscribe()
        if (dispose !== null) dispose()
      }
    },
  )
}
