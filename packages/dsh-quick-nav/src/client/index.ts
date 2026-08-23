/**
 * dsh-quick-nav：UI·实例导航（client 半区）。
 *
 * 顶部区域：实例快捷导航（跳转/在线状态）。实例列表经 **typert 远程化**
 * 消费（`ctx.remote.channel.list()`——dsh-channel 的 @Remote 方法，替换
 * 手写 `/api/quick-nav/instances`）：client `$mount` channel 的 remote
 * contribution 后经 `ctx.remote.channel.list()` 调用，类型契约来自生成的
 * typert.remote-client。
 *
 * 布局配置（dsh-desk my-ui-layout）：topbar.visible 实时控制注册/注销
 * 会话头部入口（跨插件契约 = 共享 settings 配置，见 dsh-desk LayoutControl）。
 */

import { createElement } from 'react'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import channelRemote from 'dsh-channel/remote'
import type {} from 'dsh-channel/remote'
import type { TypertClientRemote } from '@deepseek-ai/dsh-typert-protocol'
import { QuickNav, type QuickNavHost } from './QuickNav'

/**
 * ctx.remote 类型注入：官方 api-remotes/client 只聚合官方 7 包（不含自研
 * channel），且 pnpm 隔离导致其 protocol 实例与 channel remote 合并分离。
 * 此处本地声明（使用本编译面已合并的 TypertClientRemote——含 channel）——
 * 单实例合并生效；运行时 ctx.remote 由内核 gateway 注入，声明仅为编译面。
 */
declare module '@deepseek-ai/cordis' {
  interface Context {
    remote: TypertClientRemote
  }
}

/** 需要的 client 服务：插槽注册 + settingsScope + typert remote（跨实例调用）。 */
export const inject = ['slots', 'settingsScope', 'remote']

/**
 * Client 插件体：注册顶栏实例导航入口（topbar.visible 实时控制）。
 * 数据源 = ctx.remote（channel @Remote list），$mount 后注入 QuickNav。
 * @param ctx - client 根上下文。
 */
export function apply(ctx: ClientContext): void {
  const layoutScope = ctx.settingsScope.bind<{ layout?: { topbar?: { visible?: boolean } } }>({ namespace: 'my-ui-layout' })
  const topbarVisible = (): boolean => layoutScope.getSnapshot().value?.layout?.topbar?.visible ?? true

  ctx.slots.inject(
    'conversation.session.header.actions',
    () => {
      // 注册态：dispose 为 null = 未注册。配置变更时注册/注销实时切换。
      let dispose: (() => void) | null = null
      // remote 装配：$mount channel contribution → ctx.remote.channel.list() 可用。
      let remoteDispose: (() => void) | null = null
      let remoteReady = false
      const sync = (): void => {
        if (topbarVisible()) {
          if (dispose === null) {
            // 装配 remote（幂等：仅首次 mount）
            if (!remoteReady) {
              void ctx.remote.$mount(channelRemote).then((d) => {
                remoteDispose = d
                remoteReady = true
              })
            }
            const host: QuickNavHost = {
              list: async () => {
                const result = await ctx.remote.channel.list()
                if (!result.ok) throw new Error(`channel.list failed: ${result.error.code}: ${result.error.message}`)
                return result.value
              },
            }
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
        if (remoteDispose !== null) {
          remoteDispose()
          remoteDispose = null
          remoteReady = false
        }
      }
    },
  )
}
