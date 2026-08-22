/**
 * dsh-quick-nav：UI·快捷导航（顶部区域）——host 面。
 *
 * 纯粹链接导航：浮层一行一个链接，点击跳转。host 面提供实例链接数据面：
 * 挂 `/api/quick-nav/instances`——channel.list()（本地 + broker 轮询的远端
 * 实例）合并地址表（env DSH_QUICK_NAV_ADDRS："id=url,id=url"）输出
 * { id, name, addr, status }；client 浮层渲染为链接行。
 * @module dsh-quick-nav
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { isHostAgent, type InstanceIdentity } from 'dsh-channel'

/** 需要的服务：channel（实例数据）+ webServer（HTTP 路由）。 */
export const inject = ['channel', 'webServer']

/** 解析 env 地址表：DSH_QUICK_NAV_ADDRS="web2=http://127.0.0.1:3082,web3=..."。 */
function parseAddrTable(): Record<string, string> {
  const raw = process.env.DSH_QUICK_NAV_ADDRS ?? ''
  const table: Record<string, string> = {}
  for (const part of raw.split(',')) {
    const eq = part.indexOf('=')
    if (eq <= 0) continue
    table[part.slice(0, eq).trim()] = part.slice(eq + 1).trim()
  }
  return table
}

/** Host 插件体：挂实例链接数据面（channel 缺席时跳过）。 */
export function apply(ctx: Context): void {
  ctx.inject(['webServer'], (ctx) => {
    const addrTable = parseAddrTable()
    ctx.webServer.register({
      kind: 'exact',
      path: '/api/quick-nav/instances',
      handler: (_req: IncomingMessage, res: ServerResponse) => {
        // 只导航实例，排除主机守护（host<hostId>，不是可跳转的实例）。
        const instances: Array<InstanceIdentity & { addr: string; current?: boolean }> =
          ctx.channel.list()
            .filter((inst) => !isHostAgent(inst.id))
            .map((inst) => ({
              ...inst,
              // 地址表补齐（broker peers 无 addr）；有地址才是可跳转的链接。
              addr: inst.addr || addrTable[inst.id] || '',
            }))
        // 补本机实例（channel 本地注册表不含自己；DSH_RELAY_AGENT 标识）。
        const self = process.env.DSH_RELAY_AGENT
        if (self !== undefined && !instances.some((i) => i.id === self)) {
          instances.unshift({ id: self, name: self, addr: addrTable[self] ?? '', status: 'online' })
        }
        // 本机实例标记 current（client 渲染「当前」标识）。
        if (self !== undefined) {
          for (const inst of instances) inst.current = inst.id === self
        }
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify({ instances }))
      },
    })
  })
}
