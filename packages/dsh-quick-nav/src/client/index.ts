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
 * 顶栏入口常驻；本包不读任何布局配置。
 */

import { createElement } from 'react'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from 'dsh-console/remote'
import { QuickNav, type InstanceLink, type QuickNavHost } from './QuickNav'

/** 需要的 client 服务：插槽注册。 */
export const inject = ['slots']

/**
 * Client 插件体：注册顶栏实例导航入口。
 * 数据源 = host `/api/quick-nav/instances`（权威实例表，含 current）。
 * @param ctx - client 根上下文。
 */
export function apply(ctx: ClientContext): void {
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
      const host: QuickNavHost = { list: fetchNav }
      const dispose = ctx.slots.register({
        name: 'conversation.session.header.actions',
        id: 'instance-nav',
        order: 5,
      }, (props) => createElement(QuickNav, { ...props, host }))
      return () => { dispose() }
    },
  )
}
