/**
 * dsh-quick-nav：UI·快捷导航（顶部区域）——host 面。
 *
 * 纯粹链接导航：浮层一行一个链接，点击跳转。host 面提供实例链接数据面：
 * 挂 `/api/quick-nav/instances`。
 *
 * **实例表权威源 = 管理端（主 dsh，console 角色）**：配置 DSH_CONSOLE_ADDR
 * （管理端地址，集群一个值）时，从管理端 `/api/console/instances` 拉取实例表
 * （channel 发现 + launch 配置的访问地址）；管理端不可达或未配置时退本地兜底
 * （channel 发现 + env 地址表 DSH_QUICK_NAV_ADDRS + console launch）。
 * @module dsh-quick-nav
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { isHostAgent, type InstanceIdentity } from 'dsh-channel'

/** 需要的服务：channel（实例数据）+ webServer（HTTP 路由）。 */
export const inject = ['channel', 'webServer']

/** 一个导航实例链接。 */
interface NavInstance extends InstanceIdentity {
  addr: string
  current?: boolean
}

/** 解析 env 地址表：DSH_QUICK_NAV_ADDRS="web2=http://127.0.0.1:3082,web3=..."（本地兜底用）。 */
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

/** 本地兜底实例表：channel 发现 + env 地址表 + console launch 地址。 */
function localInstances(ctx: Context, addrTable: Record<string, string>): NavInstance[] {
  const instances: NavInstance[] = ctx.channel.list()
    .filter((inst) => !isHostAgent(inst.id))
    .map((inst) => ({
      ...inst,
      // 地址补齐（优先级）：channel 发现 → env 地址表 → console launch 配置。
      addr: inst.addr || addrTable[inst.id] || ctx.get('console')?.getLaunchAddr(inst.id) || '',
    }))
  // 补本机实例（channel 本地注册表不含自己；DSH_RELAY_AGENT 标识）。
  const self = process.env.DSH_RELAY_AGENT
  if (self !== undefined && !instances.some((i) => i.id === self)) {
    instances.unshift({
      id: self,
      name: self,
      addr: addrTable[self] ?? ctx.get('console')?.getLaunchAddr(self) ?? '',
      status: 'online',
    })
  }
  return instances
}

/** 从管理端（DSH_CONSOLE_ADDR）拉实例表（权威源，含 launch 地址）；失败返回 null。 */
async function fetchFromConsole(consoleAddr: string): Promise<NavInstance[] | null> {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 5000)
    const res = await fetch(`${consoleAddr.replace(/\/$/, '')}/api/console/instances`, { signal: controller.signal })
    clearTimeout(timer)
    if (!res.ok) return null
    const data = await res.json() as { instances?: NavInstance[] }
    return (data.instances ?? []).filter((inst) => !isHostAgent(inst.id))
  } catch {
    return null
  }
}

/** Host 插件体：挂实例链接数据面。 */
export function apply(ctx: Context): void {
  ctx.inject(['webServer'], (ctx) => {
    const addrTable = parseAddrTable()
    const consoleAddr = process.env.DSH_CONSOLE_ADDR
    ctx.webServer.register({
      kind: 'exact',
      path: '/api/quick-nav/instances',
      handler: (_req: IncomingMessage, res: ServerResponse) => {
        const self = process.env.DSH_RELAY_AGENT
        const finish = (instances: NavInstance[]): void => {
          // 本机实例标记 current（client 渲染「当前」标识，不可点击弱化）。
          if (self !== undefined) {
            for (const inst of instances) inst.current = inst.id === self
          }
          res.setHeader('content-type', 'application/json')
          res.end(JSON.stringify({ instances }))
        }
        if (consoleAddr) {
          void fetchFromConsole(consoleAddr).then((remote) => {
            // 管理端可达 → 用权威实例表；不可达 → 本地兜底。
            finish(remote ?? localInstances(ctx, addrTable))
          })
          return
        }
        finish(localInstances(ctx, addrTable))
      },
    })
  })
}
