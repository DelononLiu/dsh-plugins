/**
 * dsh-console：管理组件 client 半区（原 dsh-console-ui 并入，UI 与实现同包）。
 *
 * v1 可见 UI：在左侧栏底部（sidebar.footer.action，设置上方）注册
 * 「Console」徽标按钮入口。数据面（实例列表/控制指令/broker 状态）经
 * **typert 远程化**消费（`ctx.remote.console.listInstances()` /
 * `controlInstance()` + `ctx.remote.channel.brokerStatus()`——broker 是
 * channel 的传输后端，状态由 channel 暴露）。
 *
 * 控制台入口只对管理端（console 角色）显示：/api/console/* 端点只由
 * console 角色挂载，client 启动时探测该端点，200 才注册入口——
 * 非管理端（instance/daemon 角色）不显示控制台按钮。
 */

import { createElement } from 'react'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { BootstrapResult, ConsoleInstanceView, ControlResult, DeployInstanceRequest } from 'dsh-console/types'
import type { BrokerStatusView } from 'dsh-channel/types'
import consoleRemote from 'dsh-console/remote'
import channelRemote from 'dsh-channel/remote'
import type {} from 'dsh-console/remote'
import type {} from 'dsh-channel/remote'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { ConsoleBadge } from './ConsoleBadge'
import type { ConsoleHost } from './types'
import './ConsolePanel.css'

/**
 * sidebar.footer.action 插槽类型扩展（官方 sidebar 包未在公开 types 暴露
 * SlotMap 扩展，消费方自行声明，与官方 contract/slots.d.ts 一致）。
 */
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    'sidebar.footer.action': {
      kind: 'list'
      scope: 'root'
      owner: { wide: boolean }
    }
  }
}



/** 需要的 client 服务：插槽注册 + typert remote。 */
export const inject = ['slots', 'remote']

/**
 * Client 插件体：管理端注册侧栏底部「Console」入口（非管理端不注册）。
 * 数据面经 ctx.remote（console @Remote + channel brokerStatus）。
 * @param ctx - client 根上下文。
 */
export function apply(ctx: ClientContext): void {
  // 探测管理端控制端点：只有 console 角色挂 /api/console/instances。
  void fetch('/api/console/instances')
    .then((r) => {
      if (!r.ok) return
      ctx.slots.inject(
        'sidebar.footer.action',
        () => {
          // 装配 remote（console + channel contribution）。$mount 异步（等 namespace
          // 服务就绪才 resolve）——缓存 Promise 并 await；且 remote.console /
          // remote.channel 是 cordis 服务（'remote.console'），属性访问需在注入
          // fiber 里进行（否则 "cannot get property without inject"）——用
          // ctx.inject 进入注入 fiber 抓取 namespace 引用（服务注册在 ownerCtx，
          // 引用在 fiber 结束后仍有效，可缓存）。
          // 注意：只 $mount consoleRemote——channel remote 已由 dsh-quick-nav 挂载
          // （channel.list 等），重复 $mount(channelRemote) 会报
          // "channel/brokerStatus already mounted"。brokerStatus 直接访问已挂载的
          // ctx.remote.channel（同实例已挂 channel remote 时可用；缺席时降级）。
          const consoleReady = ctx.remote.$mount(consoleRemote)
          const host: ConsoleHost = {
            listInstances: async () => {
              await consoleReady
              let ns: { listInstances(): Promise<{ ok: boolean; value: ConsoleInstanceView; error: { code: string; message: string } }> }
              await ctx.inject(['remote.console'], (injected) => { ns = (injected as unknown as { remote: { console: typeof ns } }).remote.console })
              const result = await ns!.listInstances()
              if (!result.ok) throw new Error(`console.listInstances failed: ${result.error.code}: ${result.error.message}`)
              return result.value
            },
            controlInstance: async (instanceId, command) => {
              await consoleReady
              let ns: { controlInstance(id: string, c: string, p: object): Promise<{ ok: boolean; error: { message: string } }> }
              await ctx.inject(['remote.console'], (injected) => { ns = (injected as unknown as { remote: { console: typeof ns } }).remote.console })
              const result = await ns!.controlInstance(instanceId, command, {})
              return result.ok ? { ok: true } : { ok: false, error: result.error.message }
            },
            brokerStatus: async () => {
              // broker 是 channel 的传输后端——状态由 channel 暴露。channel remote
              // 已由 quick-nav 挂载（不重复 $mount）；此处直接注入取 namespace。
              let ns: { brokerStatus(): Promise<{ ok: boolean; value: BrokerStatusView; error: { message: string } }> }
              await ctx.inject(['remote.channel'], (injected) => { ns = (injected as unknown as { remote: { channel: typeof ns } }).remote.channel })
              const result = await ns!.brokerStatus()
              return result.ok ? result.value : { connected: false, reason: result.error.message, agents: [], queueCount: 0 }
            },
            bootstrapHost: async (instanceId, hostAddr, version) => {
              await consoleReady
              let ns: { bootstrapHost(id: string, h: string, v: string): Promise<BootstrapResult> }
              await ctx.inject(['remote.console'], (injected) => { ns = (injected as unknown as { remote: { console: typeof ns } }).remote.console })
              return ns!.bootstrapHost(instanceId, hostAddr, version ?? '')
            },
            deployInstance: async (request) => {
              await consoleReady
              let ns: { deployInstance(req: DeployInstanceRequest): Promise<ControlResult> }
              await ctx.inject(['remote.console'], (injected) => { ns = (injected as unknown as { remote: { console: typeof ns } }).remote.console })
              return ns!.deployInstance(request)
            },
          }
          return ctx.slots.register({
            name: 'sidebar.footer.action',
            id: 'console-ui',
            order: 120,
          }, (props) => createElement(ConsoleBadge, { ...props, host }))
        },
      )
    })
    .catch(() => { /* 端点不可用：非管理端，控制台入口不注册 */ })
}
