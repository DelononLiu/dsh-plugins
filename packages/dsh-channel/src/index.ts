/**
 * dsh-channel：系统层·通信（跨实例通道）。
 *
 * 实例服务提供者 + 事件总线 + 控制指令通道。v1 为**进程内实现**（单实例
 * 内的注册表/心跳/事件总线/指令回环）；跨实例物理传输（agent↔console
 * 的实例令牌通道）在 agent/传输层实现时接入——本插件的接口（register/
 * heartbeat/emit/sendControl）即其承载面。Typert 远程化（@Remote +
 * ctx.remote 消费）在 nav/console-ui 消费时接入。
 *
 * 事件总线语义（已定）：at-least-once + 消息 id 幂等去重 + TTL 过期 +
 * 三平面（control 控制指令 / task 幂等投递 / session 仅显式共享）。
 * @module dsh-channel
 */

import { Context, Service } from '@deepseek-ai/cordis'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import z from '@deepseek-ai/schemastery'
import { createHmac, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { dirname } from 'node:path'

// Remote 边界类型从 ./types 子路径导出（typert generator 规则：边界类型
// 必须来自公共非根类型子路径，供跨包消费与类型契约）。
import type { BrokerStatusView, InstanceIdentity } from './types.ts'
// 跨实例 RPC 复用官方 typert 协议类型：帧 = InvokeRemoteRequest（gateway），
// 回执 = RemoteResult（protocol）——channel 只做 carrier，不定义新协议。
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { InvokeRemoteRequest } from '@deepseek-ai/dsh-api-gateway/types'
// hub 路由挂在官方 webServer 的插件 exact 通道上（类型侧注入声明）。
import type {} from '@deepseek-ai/dsh-host-webserver'
export type * from './types.ts'
export type { InstanceIdentity } from './types.ts'

/** 事件三平面（已定）：control 控制指令 / task 幂等投递 / session 仅显式共享。 */
export type EventPlane = 'control' | 'task' | 'session'

/** 一条通道事件。 */
export interface ChannelEvent<P = unknown> {
  /** 消息 id（幂等去重键）。 */
  id: string
  /** 所在平面。 */
  plane: EventPlane
  /** 事件类型（平面内区分）。 */
  type: string
  /** 载荷。 */
  payload: P
  /** 产生时间（epoch ms）。 */
  ts: number
  /** 存活毫秒（过期清理）。 */
  ttl: number
}

/** 控制指令。 */
export interface ControlCommand<P = unknown> {
  /** 指令类型（deploy/create-instance/stop/start/upgrade…）。 */
  type: string
  /** 载荷。 */
  payload: P
  /** 指令 id（幂等回执）。 */
  id: string
  /** 发送时间戳（ms）——接收端用它区分积压旧指令（ts < 实例启动时刻）与当前指令。 */
  ts: number
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    channel: ChannelService
  }
}

/** 通道角色：local 进程内（缺省）/ hub 收注册与派发 / worker 出站拉取。 */
export type ChannelMode = 'local' | 'hub' | 'worker'

/** 插件配置：实例令牌 + 心跳超时 + 可选 relay（社区 broker 底座）+ 多机出站回路。 */
export interface Config {
  /** 实例令牌映射：{instanceId: token}——bootstrap 时注入 agent，注册/心跳校验。 */
  tokens: Record<string, string>
  /** 心跳超时（ms），超时判定离线。默认 30000。 */
  heartbeatTimeoutMs: number
  /** 可选：dsh-agent-relay broker 接入（实例联通底座）——配置即启用。 */
  relay?: RelayConfig
  /** 通道角色（缺省 local；配置 console 地址时缺省 worker）。 */
  mode?: ChannelMode
  /** 本实例 id（worker 身份；缺省回落 relay.agent / DSH_RELAY_AGENT）。 */
  id?: string
  /** hub（console 实例）基地址，如 http://10.0.0.1:3082——worker 出站目标。 */
  console?: string
  /** 本实例令牌（worker 出站鉴权；hub 侧需在 tokens 登记同名条目）。 */
  token?: string
  /** 长轮询最长等待（ms），也是 hub 接受客户端 wait 的上限。默认 25000。 */
  pollWaitMs?: number
  /** 注册/保活间隔（ms）。默认 10000。 */
  registerIntervalMs?: number
  /** 指令租约（ms）：派发后未回结果即重新投递（at-least-once）。默认 60000。 */
  commandLeaseMs?: number
  /** 指令台账落盘文件（hub 侧；缺省仅内存，重启即丢未完成指令）。 */
  ledgerFile?: string
}

/** 指令台账条目（hub 侧派发状态；worker 侧只消费指令本体）。 */
export interface CommandLedgerEntry {
  /** 指令 id（幂等键，worker 回执用它匹配）。 */
  id: string
  /** 目标 worker id（守护 agent 名）。 */
  targetId: string
  /** 指令本体。 */
  command: ControlCommand
  /** 单调序号（入队顺序）。 */
  seq: number
  /** 派发状态。 */
  status: 'pending' | 'dispatched' | 'done' | 'failed'
  /** 入队时间（epoch ms）。 */
  createdAt: number
  /** 最近一次派发时间。 */
  dispatchedAt?: number
  /** 租约截止（超过即视为投递失败，可重新派发）。 */
  leaseUntil?: number
  /** worker 回执。 */
  result?: { ok: boolean; error?: string }
}

/** 指令派发结果（sendControl 契约：入队/回环是否成立）。 */
export interface ControlDispatchResult {
  ok: boolean
  /** 成功时的指令 id（台账/回执对账用）。 */
  commandId?: string
  error?: string
}

/** worker 上报的本机实例状态（hub 侧据此维护实例表与归属）。 */
export interface WorkerInstanceReport {
  /** 实例 id。 */
  id: string
  /** 本机探测状态。 */
  status: 'online' | 'offline'
}

/** worker 注册载荷（上行）。 */
export interface WorkerReport {
  /** worker（守护）id。 */
  id: string
  /** 本机管理的实例及其状态。 */
  instances: WorkerInstanceReport[]
}

/** hub 对注册的回执（告知 worker 各周期参数）。 */
export interface RegisterAck {
  ok: boolean
  error?: string
  /** 期望的注册/保活间隔（ms）。 */
  registerIntervalMs?: number
  /** 长轮询最长等待（ms）。 */
  pollWaitMs?: number
  /** 指令租约（ms）。 */
  commandLeaseMs?: number
  /** 被拒的实例声明（归属冲突/非法 id）——其余照常受理。 */
  rejected?: Array<{ id: string; reason: string }>
}

/** Relay broker 接入配置（仅作跨实例传输兜底——实例发现不依赖 broker，
 * 权威源是管理端 launch/register；peers 无地址信息，轮询填充会让直连失效）。 */
export interface RelayConfig {
  /** broker 基地址（如 http://127.0.0.1:19121）。 */
  brokerUrl: string
  /** 本实例在 broker 的 agent 名（唯一稳定名，如 web2）。 */
  agent: string
  /** 共享密钥（HMAC 签名）。 */
  secret: string
  /** recv 增量游标持久化文件（长驻进程重启防重放积压指令；缺省不落盘）。 */
  stateFile?: string
}

/** 运行时 schema。 */
export const Config = z.object({
  tokens: z.dict(z.string()).default({}),
  heartbeatTimeoutMs: z.number().default(30000),
  relay: z.any().default(undefined),
  mode: z.any().default(undefined),
  id: z.any().default(undefined),
  console: z.any().default(undefined),
  token: z.any().default(undefined),
  pollWaitMs: z.any().default(undefined),
  registerIntervalMs: z.any().default(undefined),
  commandLeaseMs: z.any().default(undefined),
  ledgerFile: z.any().default(undefined),
}) as z<Config>

/** 事件默认 TTL（7 天，已定投递语义）。 */
export const EVENT_TTL_MS = 7 * 24 * 3600_000

/** 实例/守护 id 允许的字符集与长度（注册上报的唯一性键，防注入与超长键）。 */
export const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/

/** 单机注册上报的实例数上限（防单机海量条目打爆 hub 实例表）。 */
export const MAX_WORKER_INSTANCES = 200

/** 默认注册/保活间隔（ms）。 */
export const DEFAULT_REGISTER_INTERVAL_MS = 10_000

/** 默认长轮询最长等待（ms）。 */
export const DEFAULT_POLL_WAIT_MS = 25_000

/** 默认指令租约（ms）：派发后未回结果即重新投递。 */
export const DEFAULT_COMMAND_LEASE_MS = 60_000

/** 注册失败退避上限（ms）。 */
export const MAX_REGISTER_BACKOFF_MS = 60_000

interface InstanceEntry extends InstanceIdentity {
  lastSeen: number
}

/**
 * 通信服务（实例服务提供者 + 事件总线 + 控制指令）。所有插件经 `ctx.channel`
 * 注册/发现实例、收发事件与控制指令。
 */
export class ChannelService extends TypertRemoteService {
  static Config = Config

  /** 已知实例表（id → 含心跳时间的条目）。 */
  private readonly instances = new Map<string, InstanceEntry>()
  /** 事件订阅者：plane → handler 集合。 */
  private readonly subscribers = new Map<EventPlane, Set<(event: ChannelEvent) => void>>()
  /** 控制指令接收者。 */
  private readonly controlHandlers = new Set<(command: ControlCommand, instanceId: string) => void>()
  /** 事件 id → 产生时间（幂等去重 + TTL 清理）。 */
  private readonly eventTimes = new Map<string, number>()
  /** 已确认事件 id（幂等回执）。 */
  private readonly ackedEvents = new Set<string>()
  /** 跨实例 RPC 待回执：id → resolve/reject（callRemote 的 Promise 关联）。 */
  private readonly pendingRpc = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>()
  /** 目标侧执行 RPC 的 typert gateway（经注入获取；缺席时 RPC 帧无法本地执行）。 */
  private typertGateway: { invoke(request: InvokeRemoteRequest): Promise<unknown> } | undefined
  /** 通道角色（构造时解析，见 {@link resolveMode}）。 */
  private mode: ChannelMode = 'local'
  /** 本实例 id（构造时解析，见 {@link resolveSelfId}）。 */
  private selfId: string | undefined
  /** hub：待派发指令队列（targetId → FIFO）。 */
  private readonly commandQueue = new Map<string, CommandLedgerEntry[]>()
  /** hub：指令台账（commandId → 条目；回执与状态查询）。 */
  private readonly ledger = new Map<string, CommandLedgerEntry>()
  /** hub：入队序号（单调，便于诊断排序）。 */
  private seq = 0
  /** hub：已注册 worker 的最近可见时间与上报内容。 */
  private readonly workerSeen = new Map<string, { lastSeen: number; instances: WorkerInstanceReport[] }>()
  /** hub：实例 → 归属 worker（注册声明；控制路由读它）。 */
  private readonly hostIndex = new Map<string, string>()
  /** hub：注册订阅者（console 据此落档案/发系统消息）。 */
  private readonly registerHandlers = new Set<(report: WorkerReport) => void>()
  /** hub：指令可派发时唤醒长轮询。 */
  private readonly dispatchWaiters = new Set<() => void>()
  /** worker：本机实例状态提供者（console 守护角色注入）。 */
  private reportProvider: (() => WorkerInstanceReport[]) | undefined
  constructor(ctx: Context, private readonly config: Config) {
    super(ctx, 'channel')
    // 心跳超时扫描：setInterval + ctx.effect（fiber 卸载时清理）。
    const timer = setInterval(() => this.sweep(), Math.min(config.heartbeatTimeoutMs, 60_000))
    timer.unref?.()
    ctx.effect(() => () => clearInterval(timer))
    // 目标侧执行跨实例 RPC 的 typert gateway（经注入等待——webServer 可用时挂载）。
    ctx.inject(['typertGateway'], (g) => {
      this.typertGateway = g.typertGateway
      ctx.effect(() => () => { this.typertGateway = undefined })
    })
    // Relay broker 接入：解析配置（config 优先，env 兜底——DSH_RELAY_*）。
    // broker 仅作跨实例传输兜底（无 addr 目标/直连失败），不做实例发现。
    const relay = config.relay ?? envRelayConfig()
    if (relay !== undefined) {
      this.relay = relay
      // 游标持久化：重启后从 stateFile 恢复，避免重读 broker 积压消息。
      if (relay.stateFile) {
        try {
          if (existsSync(relay.stateFile)) {
            const saved = JSON.parse(readFileSync(relay.stateFile, 'utf8')) as { since?: string }
            if (typeof saved.since === 'string') this.relaySince = saved.since
          }
        } catch {
          // 文件缺失/损坏：从零开始（首轮全量，属正常冷启动）。
        }
      }
      // 启动即保活注册 + 立即 recv 一次（首轮消费 broker 积压，避免迟到的旧
      // 控制指令在启动窗口后才被拉到）；周期 5s（recv 响应需快于 callRemote
      // 回执超时 15s——30s 周期会让跨实例 RPC 回执必然超时）。
      void this.relayRegister()
      void this.relayRecvControls()
      const relayTimer = setInterval(() => this.relayTick(), 5_000)
      relayTimer.unref?.()
      ctx.effect(() => () => clearInterval(relayTimer))
    }
    // 多机回路（2026-09 定）：hub 服务注册与派发；worker 出站注册 + 长轮询取指令。
    this.mode = resolveMode(config, relay)
    this.selfId = resolveSelfId(config, relay)
    if (this.mode === 'worker' && (config.console === undefined || this.selfId === undefined)) {
      throw new Error('dsh-channel: worker 模式需要 console 地址与实例 id（config.id 或 DSH_RELAY_AGENT）')
    }
    if (this.mode === 'hub') {
      this.loadLedger()
      // 路由挂在官方 webServer 的插件 exact 通道上（先于官方 /api prefix 命中，
      // 不受 BrowserAuth fence 约束）；headless 角色没有 webServer 即不对外服务。
      ctx.inject(['webServer'], (injected) => {
        const disposers = [
          injected.webServer.register({
            kind: 'exact',
            path: '/api/channel/register',
            handler: (req, res) => { void this.handleHubRegister(req, res) },
          }),
          injected.webServer.register({
            kind: 'exact',
            path: '/api/channel/commands',
            handler: (req, res) => { void this.handleHubCommands(req, res) },
          }),
          injected.webServer.register({
            kind: 'exact',
            path: '/api/channel/result',
            handler: (req, res) => { void this.handleHubResult(req, res) },
          }),
        ]
        injected.effect(() => () => { for (const dispose of disposers) dispose() })
      })
    }
    if (this.mode === 'worker') {
      const stop = this.startWorker()
      ctx.effect(() => stop)
    }
  }

  /** 当前 relay 配置（未接入为 undefined）。 */
  readonly relay: RelayConfig | undefined

  /** recv 增量游标（relay 控制指令接收）。 */
  private relaySince = ''

  /** 周期任务：保活注册 + 控制指令/回执接收（broker 仅兜底传输，不做发现）。 */
  private relayTick(): void {
    void this.relayRegister()
    void this.relayRecvControls()
  }

  /** 向 broker 注册/保活（POST /register，HMAC 签名）。 */
  private async relayRegister(): Promise<void> {
    const relay = this.relay
    if (relay === undefined) return
    const body = JSON.stringify({ agent: relay.agent })
    try {
      await relayFetch(relay, 'POST', '/register', body)
    } catch {
      // broker 不可达：下次周期重试（保活失败不致命）。
    }
  }

  /** 向远端实例发控制指令（经 broker POST /messages，type=control）。 */
  private async relaySendControl(instanceId: string, command: ControlCommand): Promise<void> {
    const relay = this.relay
    if (relay === undefined) return
    // broker 的 normalizeEnvelope 只接受 type message|ack——控制指令用
    // kind='request' 承载，指令本体放 body.command。
    const body = JSON.stringify({
      id: randomUUID(),
      to: instanceId,
      body: { command },
      type: 'message',
      kind: 'request',
      replyTo: null,
      ack: false,
    })
    try {
      await relayFetch(relay, 'POST', '/messages', body)
    } catch {
      // broker 不可达：指令投递失败不致命。
    }
  }

  /** 拉取自己的控制指令消息（GET /messages?since=），触发 onControl。 */
  private async relayRecvControls(): Promise<void> {
    const relay = this.relay
    if (relay === undefined) return
    try {
      const res = await relayFetch(
        relay,
        'GET',
        `/messages?since=${encodeURIComponent(this.relaySince)}&limit=50`,
        '',
      )
      const data = await res.json() as {
        messages?: Array<{ id: string; from: string; type?: string; body?: { command?: ControlCommand; rpc?: InvokeRemoteRequest & { id: string }; rpcReply?: RemoteResult<unknown> & { id: string } } }>
        cursor?: string | null
      }
      // 先处理全部消息，后推进游标落盘：崩溃在处理中途 → 游标未推进 → 重启重读
      // （重复投递由消费方幂等吸收）——保证 at-least-once，不丢指令。
      for (const msg of data.messages ?? []) {
        const body = msg.body
        if (body === undefined) continue
        if (body.rpc !== undefined) {
          // 目标侧：执行跨实例 RPC（经本地 typert gateway），回执给调用方。
          void this.handleRemoteRpc(msg.from, body.rpc)
          continue
        }
        if (body.rpcReply !== undefined) {
          // 调用方侧：收到回执 → resolve 关联的 callRemote Promise。
          const pending = this.pendingRpc.get(body.rpcReply.id)
          if (pending !== undefined) {
            this.pendingRpc.delete(body.rpcReply.id)
            if (body.rpcReply.ok) {
              pending.resolve({ ok: true, value: body.rpcReply.value })
            } else {
              pending.resolve({ ok: false, error: body.rpcReply.error ?? { code: 'rpc-error', message: 'target failed', details: {} } })
            }
          }
          continue
        }
        if (body.command !== undefined) {
          for (const handler of this.controlHandlers) {
            handler(body.command, msg.from)
          }
        }
      }
      if (data.cursor) {
        this.relaySince = data.cursor
        if (relay.stateFile) {
          try {
            mkdirSync(dirname(relay.stateFile), { recursive: true })
            writeFileSync(relay.stateFile, JSON.stringify({ since: data.cursor }))
          } catch {
            // 落盘失败不致命：下次成功写入前仍从上次内存游标继续。
          }
        }
      }
    } catch {
      // broker 不可达：本轮跳过（下次重试）。
    }
  }

  /**
   * 轮询 broker peers 更新远端实例已移除（2026-08 去 broker 化）：broker 仅作
   * 传输兜底，实例发现权威源是管理端 launch/register——peers 无地址信息，
   * 轮询填充会让 callRemote 直连失效（addr 恒空 → 全走兜底）。
   */

  /**
   * 注册实例（agent 上线时调用）。校验实例令牌；重复注册刷新状态。
   * @param instance - 实例基础身份。
   * @param token - 实例令牌（bootstrap 注入；不匹配抛错）。
   */
  register(instance: InstanceIdentity, token: string): void {
    const expected = this.config.tokens[instance.id]
    if (expected && expected !== token) {
      throw new Error(`instance "${instance.id}" rejected: token mismatch`)
    }
    this.instances.set(instance.id, { ...instance, status: 'online', lastSeen: Date.now() })
  }

  /**
   * 声明实例（管理端权威写入：launch/instances 配置清单）。不校验 agent 令牌——
   * token 校验是 agent 自证身份的契约；管理端声明是配置事实，tokens 配置后
   * 不应导致 launch 注册失败（否则管理端发现失效）。
   */
  declare(instance: InstanceIdentity): void {
    this.instances.set(instance.id, { ...instance, status: 'online', lastSeen: Date.now() })
  }

  /**
   * 心跳上报（agent 周期调用）。未知实例或令牌不匹配抛错。
   * @param instanceId - 实例 id。
   * @param token - 实例令牌。
   */
  heartbeat(instanceId: string, token: string): void {
    const entry = this.instances.get(instanceId)
    if (!entry) throw new Error(`unknown instance "${instanceId}"`)
    const expected = this.config.tokens[instanceId]
    if (expected && expected !== token) throw new Error('token mismatch')
    entry.lastSeen = Date.now()
    entry.status = 'online'
  }

  /**
   * 设置实例状态（管理端探测结果驱动）。本地管理面调用（进程内）——
   * 不 @Remote（跨进程实例状态以各自 register/心跳为准，防止远端越权改状态）。
   * 用于管理端探测到不可达时**立即**标离线（不等心跳超时 sweep——
   * 否则 launch 声明即 online 的假绿窗口长达 heartbeatTimeoutMs）。
   * @param instanceId - 实例 id。
   * @param status - 目标状态。
   */
  setStatus(instanceId: string, status: 'online' | 'offline'): void {
    const entry = this.instances.get(instanceId)
    if (!entry) return // 未声明：不抛（探测竞态下实例可能刚被清理）
    entry.status = status
    if (status === 'online') entry.lastSeen = Date.now()
  }

  /**
   * 发现：列出全部已知实例（含离线——离线由心跳超时标记）。
   * @returns 实例基础身份列表。
   */
  @Remote
  list(): InstanceIdentity[] {
    return [...this.instances.values()].map(toIdentity)
  }

  /** 查询单个实例；未知返回 undefined。 */
  @Remote
  get(instanceId: string): InstanceIdentity | undefined {
    const entry = this.instances.get(instanceId)
    return entry ? toIdentity(entry) : undefined
  }

  /**
   * Broker 运行状态（typert @Remote）：连接/在线 agent/消息队列计数。
   * broker 是 channel 的传输后端（relay）——状态由 channel 暴露，上层
   * （console/UI）经 ctx.remote.channel.brokerStatus() 消费，不绕道直连。
   */
  @Remote
  async brokerStatus(): Promise<BrokerStatusView> {
    const relay = this.relay
    if (relay === undefined) {
      return { connected: false, reason: 'relay 未配置', agents: [], queueCount: 0 }
    }
    try {
      const ts = Math.floor(Date.now() / 1000)
      const peersRes = await fetch(`${relay.brokerUrl}/peers`, {
        headers: {
          'x-relay-agent': relay.agent,
          'x-relay-timestamp': String(ts),
          'x-relay-signature': signRequest(relay.secret, 'GET', '/peers', ts),
        },
      })
      if (!peersRes.ok) {
        return { connected: false, reason: `broker http ${peersRes.status}`, agents: [], queueCount: 0 }
      }
      const peers = (await peersRes.json() as { peers?: Array<{ agent: string; online: boolean }> }).peers ?? []
      // 队列计数：本 agent 收件箱待处理消息（since 空 → 从最新游标起）。
      const ts2 = Math.floor(Date.now() / 1000)
      const path2 = '/messages?since=&limit=50'
      const msgRes = await fetch(`${relay.brokerUrl}${path2}`, {
        headers: {
          'x-relay-agent': relay.agent,
          'x-relay-timestamp': String(ts2),
          'x-relay-signature': signRequest(relay.secret, 'GET', path2, ts2),
        },
      })
      const queueCount = msgRes.ok ? ((await msgRes.json() as { messages?: unknown[] }).messages ?? []).length : -1
      return { connected: true, agents: peers.map((p) => ({ id: p.agent, online: p.online })), queueCount }
    } catch (error) {
      return { connected: false, reason: error instanceof Error ? error.message : String(error), agents: [], queueCount: 0 }
    }
  }

  /**
   * 发布事件（at-least-once 投递语义的进程内实现）：自动生成消息 id（幂等
   * 去重键），按 TTL 清理。跨实例投递由传输层消费同一接口。
   * @param plane - 事件平面（control/task/session）。
   * @param type - 事件类型。
   * @param payload - 载荷。
   * @param ttl - 存活毫秒（默认 7 天）。
   * @returns 事件 id（订阅方可回执/去重）。
   */
  emit<P = unknown>(plane: EventPlane, type: string, payload: P, ttl: number = EVENT_TTL_MS): string {
    const event: ChannelEvent<P> = { id: randomUUID(), plane, type, payload, ts: Date.now(), ttl }
    this.eventTimes.set(event.id, event.ts)
    for (const handler of this.subscribers.get(plane) ?? []) {
      handler(event)
    }
    return event.id
  }

  /**
   * 订阅某平面事件（进程内）。返回解除订阅 disposer。
   * @param plane - 事件平面。
   * @param handler - 处理函数。
   * @returns disposer。
   */
  subscribe(plane: EventPlane, handler: (event: ChannelEvent) => void): () => void {
    let set = this.subscribers.get(plane)
    if (!set) {
      set = new Set()
      this.subscribers.set(plane, set)
    }
    set.add(handler)
    return () => set!.delete(handler)
  }

  /**
   * 已处理消息确认（幂等回执）：同一事件 id 首次确认返回 true，重复返回
   * false——消费方对重复投递跳过处理。
   * @param eventId - 消息 id。
   * @returns 是否首次确认。
   */
  ack(eventId: string): boolean {
    if (this.ackedEvents.has(eventId)) return false
    this.ackedEvents.add(eventId)
    return true
  }

  /**
   * 发送控制指令到某实例（远程管理）。契约：返回派发结果——本机/无 hub 的
   * 进程内场景回环本地 handler；hub 模式下入队给目标 worker（未注册即失败，
   * 不做静默丢弃）。入队成功仅代表已受理，worker 回执经台账（见
   * {@link commandStatus}）查询。
   * @param instanceId - 目标实例 id（agent 名）。
   * @param command - 指令（不含 id，自动生成幂等 id）。
   * @returns 派发结果（ok=false 时 error 说明原因）。
   */
  sendControl<P = unknown>(instanceId: string, command: Omit<ControlCommand<P>, 'id' | 'ts'>): ControlDispatchResult {
    if (this.mode !== 'hub' || instanceId === this.selfId) {
      const full: ControlCommand<P> = { ...command, id: randomUUID(), ts: Date.now() }
      // 无 hub 的进程内/同机场景：relay 兜底（原行为）或本地回环。
      if (this.relay !== undefined && this.mode !== 'hub' && instanceId !== this.relay.agent) {
        void this.relaySendControl(instanceId, full as ControlCommand)
        return { ok: true, commandId: full.id }
      }
      if (this.controlHandlers.size === 0) {
        return { ok: false, error: `目标 ${instanceId} 无本机接收者（channel 非 hub 模式，且无 relay）` }
      }
      for (const handler of this.controlHandlers) {
        handler(full, instanceId)
      }
      return { ok: true, commandId: full.id }
    }
    return this.enqueueCommand(instanceId, command as Omit<ControlCommand, 'id' | 'ts'>)
  }

  /** 注册控制指令接收者（agent 侧消费）。返回 disposer。 */
  onControl(handler: (command: ControlCommand, instanceId: string) => void): () => void {
    this.controlHandlers.add(handler)
    return () => this.controlHandlers.delete(handler)
  }

  // --- 多机：身份、归属与注册订阅 ---

  /** 本实例 id（worker 身份；未配置且无 relay/`DSH_RELAY_AGENT` 时为 undefined）。 */
  get instanceId(): string | undefined {
    return this.selfId
  }

  /** 通道角色（local/hub/worker）。 */
  get channelMode(): ChannelMode {
    return this.mode
  }

  /**
   * 归属查询：某实例由哪个 worker（守护）管理。hub 侧读注册声明；未注册返回
   * undefined（调用方回落配置期望态）。
   * @param instanceId - 实例 id。
   */
  hostOf(instanceId: string): string | undefined {
    return this.hostIndex.get(instanceId)
  }

  /** 订阅 worker 注册（hub 侧；console 据此落档案）。返回 disposer。 */
  onRegister(handler: (report: WorkerReport) => void): () => void {
    this.registerHandlers.add(handler)
    return () => this.registerHandlers.delete(handler)
  }

  /**
   * worker 侧：注册"本机实例状态"提供者（console 守护角色注入），注册与保活
   * 时上报。返回 disposer。
   * @param provider - 返回本机实例 id 与探测状态。
   */
  setWorkerReport(provider: () => WorkerInstanceReport[]): () => void {
    this.reportProvider = provider
    return () => { if (this.reportProvider === provider) this.reportProvider = undefined }
  }

  /** 已注册 worker 的 id（hub 侧；诊断与派发目标校验用）。 */
  registeredWorkers(): Array<{ id: string; lastSeen: number }> {
    return [...this.workerSeen.entries()].map(([id, seen]) => ({ id, lastSeen: seen.lastSeen }))
  }

  /**
   * 处理 worker 注册（hub 侧；路由与进程内调用共用）。默认 deny：`tokens` 未登记
   * 的 id 一律拒绝；归属冲突的实例逐个拒绝（不牵连整次注册）。
   * @param report - worker 上报（id + 本机实例状态）。
   * @param token - 上报方令牌（须与 `tokens[report.id]` 一致）。
   * @returns 回执（ok=false 时 error 说明原因）。
   */
  registerWorker(report: WorkerReport, token: string | undefined): RegisterAck {
    if (!SAFE_ID.test(report.id)) return { ok: false, error: `invalid instance id "${report.id}"` }
    const expected = this.config.tokens[report.id]
    if (expected === undefined) return { ok: false, error: `instance "${report.id}" not registered` }
    if (expected !== token) return { ok: false, error: 'token mismatch' }
    const now = Date.now()
    const rejected: Array<{ id: string; reason: string }> = []
    const accepted: WorkerInstanceReport[] = []
    for (const inst of report.instances.slice(0, MAX_WORKER_INSTANCES)) {
      if (!SAFE_ID.test(inst.id)) {
        rejected.push({ id: inst.id, reason: 'invalid id' })
        continue
      }
      const owner = this.hostIndex.get(inst.id)
      if (owner !== undefined && owner !== report.id) {
        rejected.push({ id: inst.id, reason: `already hosted by ${owner}` })
        continue
      }
      this.hostIndex.set(inst.id, report.id)
      accepted.push({ id: inst.id, status: inst.status === 'online' ? 'online' : 'offline' })
    }
    if (report.instances.length > MAX_WORKER_INSTANCES) {
      rejected.push({ id: '(truncated)', reason: `超过单机上报上限 ${MAX_WORKER_INSTANCES}` })
    }
    this.workerSeen.set(report.id, { lastSeen: now, instances: accepted })
    // 注册即身份事实：worker 自身与其上报实例全部 upsert 进实例表（状态按上报值）。
    this.upsert(report.id, 'online', now)
    for (const inst of accepted) this.upsert(inst.id, inst.status, now)
    const full: WorkerReport = { id: report.id, instances: accepted }
    for (const handler of this.registerHandlers) handler(full)
    return {
      ok: true,
      registerIntervalMs: this.config.registerIntervalMs ?? DEFAULT_REGISTER_INTERVAL_MS,
      pollWaitMs: this.config.pollWaitMs ?? DEFAULT_POLL_WAIT_MS,
      commandLeaseMs: this.config.commandLeaseMs ?? DEFAULT_COMMAND_LEASE_MS,
      ...(rejected.length > 0 ? { rejected } : {}),
    }
  }

  // --- 多机：hub 侧指令台账与派发 ---

  /**
   * 入队一条控制指令（hub 侧唯一派发入口）。目标未注册即失败——无静默丢弃。
   * 入队只代表受理；worker 经长轮询取走并回执，状态见 {@link commandStatus}。
   * @param targetId - 目标 worker（守护）id。
   * @param command - 指令（不含 id/ts）。
   * @returns 派发结果（含 commandId）。
   */
  enqueueCommand(targetId: string, command: Omit<ControlCommand, 'id' | 'ts'>): ControlDispatchResult {
    if (this.mode !== 'hub') return { ok: false, error: 'channel 非 hub 模式：无跨机派发面' }
    if (!this.workerSeen.has(targetId)) {
      return { ok: false, error: `目标 ${targetId} 未注册（守护未上线或 id 不符）` }
    }
    const full: ControlCommand = { ...command, id: randomUUID(), ts: Date.now() }
    const entry: CommandLedgerEntry = {
      id: full.id,
      targetId,
      command: full,
      seq: ++this.seq,
      status: 'pending',
      createdAt: Date.now(),
    }
    this.ledger.set(entry.id, entry)
    const queue = this.commandQueue.get(targetId) ?? []
    queue.push(entry)
    this.commandQueue.set(targetId, queue)
    this.persistLedger()
    this.wakeDispatchers()
    return { ok: true, commandId: entry.id }
  }

  /** 查指令台账条目（hub 侧；UI/诊断对账用）。 */
  commandStatus(commandId: string): CommandLedgerEntry | undefined {
    const entry = this.ledger.get(commandId)
    return entry === undefined ? undefined : { ...entry }
  }

  /** 台账快照（按入队顺序；hub 侧诊断/测试用）。 */
  ledgerSnapshot(): CommandLedgerEntry[] {
    return [...this.ledger.values()].map((entry) => ({ ...entry })).sort((a, b) => a.seq - b.seq)
  }

  /**
   * 处理 worker 回执（幂等：重复回执返回 true 且不覆盖首个结果）。
   * @param commandId - 指令 id。
   * @param result - worker 结果（ok=false 时 error 说明原因）。
   * @returns 是否命中台账条目。
   */
  completeCommand(commandId: string, result: { ok: boolean; error?: string }): boolean {
    const entry = this.ledger.get(commandId)
    if (entry === undefined) return false
    if (entry.status === 'done' || entry.status === 'failed') return true
    entry.status = result.ok ? 'done' : 'failed'
    entry.result = result.ok ? { ok: true } : { ok: false, error: result.error ?? 'worker 报告失败' }
    this.dropFromQueue(entry)
    this.persistLedger()
    return true
  }

  /**
   * 跨实例 RPC 调用（第三期）：把 typert 调用帧（InvokeRemoteRequest）经 broker
   * 投递到目标实例，目标侧经本地 typert gateway 执行，回执（RemoteResult）关联
   * Promise。channel 只做 carrier——协议全程 typert，不定义新 RPC。
   * @param instanceId - 目标实例 id（agent 名）。
   * @param request - typert 调用帧（namespace/method/args，同 InvokeRemoteRequest）。
   * @param timeoutMs - 回执超时（默认 15s）。
   * @returns 目标执行结果（RemoteResult 语义）。
   */
  callRemote<T = unknown>(
    instanceId: string,
    request: Omit<InvokeRemoteRequest, 'signal'>,
    timeoutMs: number,
  ): Promise<RemoteResult<T>> {
    const id = randomUUID()
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRpc.delete(id)
        reject(new Error(`channel.callRemote(${instanceId}, ${request.namespace}.${request.method}) 回执超时`))
      }, timeoutMs)
      this.pendingRpc.set(id, {
        resolve: (v) => { clearTimeout(timer); resolve(v as RemoteResult<T>) },
        reject: (e) => { clearTimeout(timer); reject(e) },
        timer,
      })
      // 传输双路径（broker 可选，直连优先）：目标 addr 可达 → 直连 HTTP RPC；
      // 直连失败（网络/HTTP 错误）→ 降级 broker 兜底；无 addr（daemon 出站等）→ broker。
      const target = this.instances.get(instanceId)
      const directAddr = target?.addr && target.status === 'online' ? target.addr : undefined
      const send = directAddr !== undefined
        ? this.directRpc(directAddr, { id, ...request }).catch(() => this.relaySendRpc(instanceId, { id, ...request }))
        : this.relaySendRpc(instanceId, { id, ...request })
      send.catch((e) => {
        clearTimeout(timer)
        this.pendingRpc.delete(id)
        reject(e)
      })
    })
  }

  /** 直连 RPC：POST {addr}/api/{ns}/{method}（官方 Connection client-request 信封）。 */
  private async directRpc(addr: string, rpc: InvokeRemoteRequest & { id: string }): Promise<void> {
    const url = `${addr.replace(/\/$/, '')}/api/${rpc.namespace}/${rpc.method}`
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'client-request',
        rpcId: rpc.id,
        method: `${rpc.namespace}/${rpc.method}`,
        payload: { args: rpc.args },
      }),
    })
    // 业务 4xx（目标已处理并返回 server-response 信封）不算传输失败——先解析 body
    // 的业务结果；只有无信封/5xx/网络错误才 throw（callRemote 据此降级 broker 兜底，
    // 避免业务失败被当成传输失败重发同一指令）。
    const data = await res.json().catch(() => null) as {
      result?: { ok: boolean; value?: unknown; error?: { code: string; message: string; details?: object } }
    } | null
    const result = data?.result
    if (result === undefined && !res.ok) {
      throw new Error(`directRpc ${url}: http ${res.status}`)
    }
    const pending = this.pendingRpc.get(rpc.id)
    if (pending === undefined) return
    this.pendingRpc.delete(rpc.id)
    if (result === undefined) {
      pending.resolve({ ok: false, error: new RemoteError('rpc-error', `directRpc ${url}: 无 result`, {}) })
    } else if (result.ok) {
      pending.resolve({ ok: true, value: result.value })
    } else {
      pending.resolve({ ok: false, error: result.error ?? new RemoteError('rpc-error', 'target failed', {}) })
    }
  }

  /** 发送跨实例 RPC 帧（经 broker POST /messages，kind=request + body.rpc=InvokeRemoteRequest）。 */
  private async relaySendRpc(instanceId: string, rpc: InvokeRemoteRequest & { id: string }): Promise<void> {
    const relay = this.relay
    if (relay === undefined) throw new Error('channel.callRemote: relay 未配置（跨实例 RPC 需 broker）')
    const body = JSON.stringify({
      id: randomUUID(),
      to: instanceId,
      body: { rpc },
      type: 'message',
      kind: 'request',
      replyTo: null,
      ack: false,
    })
    await relayFetch(relay, 'POST', '/messages', body)
  }

  /** 目标侧：执行跨实例 RPC 帧（经本地 typert gateway），回执给调用方。 */
  private async handleRemoteRpc(from: string, rpc: InvokeRemoteRequest & { id: string }): Promise<void> {
    if (this.typertGateway === undefined) {
      await this.relaySendRpcReply(from, { id: rpc.id, ok: false, error: new RemoteError('gateway-unavailable', 'typert gateway 未就绪', {}) })
      return
    }
    try {
      const value = await this.typertGateway.invoke({ namespace: rpc.namespace, method: rpc.method, args: rpc.args })
      await this.relaySendRpcReply(from, { id: rpc.id, ok: true, value })
    } catch (error) {
      await this.relaySendRpcReply(from, {
        id: rpc.id,
        ok: false,
        error: new RemoteError('rpc-error', error instanceof Error ? error.message : String(error), {}),
      })
    }
  }

  /** 发送跨实例 RPC 回执（目标侧执行后回发）。 */
  private async relaySendRpcReply(to: string, reply: RemoteResult<unknown> & { id: string }): Promise<void> {    const relay = this.relay
    if (relay === undefined) return
    const body = JSON.stringify({
      id: randomUUID(),
      to,
      body: { rpcReply: reply },
      type: 'message',
      kind: 'request',
      replyTo: null,
      ack: false,
    })
    try {
      await relayFetch(relay, 'POST', '/messages', body)
    } catch {
      // 回执投递失败：调用方侧超时兜底。
    }
  }

  // --- 多机：hub 路由（注册 / 取指令 / 回执） ---

  /**
   * 路由鉴权（默认 deny）：`x-instance-id` + `x-instance-token` 必须与 `tokens`
   * 登记一致。未登记的 id 返回 403（配置错误），令牌不符返回 401。
   */
  private authenticatePeer(req: IncomingMessage): { ok: true; id: string } | { ok: false; status: number; error: string } {
    const id = headerValue(req, 'x-instance-id')
    if (id === undefined) return { ok: false, status: 401, error: 'missing x-instance-id' }
    const expected = this.config.tokens[id]
    if (expected === undefined) return { ok: false, status: 403, error: `instance "${id}" not registered` }
    if (expected !== headerValue(req, 'x-instance-token')) return { ok: false, status: 401, error: 'token mismatch' }
    return { ok: true, id }
  }

  /** POST /api/channel/register：worker 注册/保活（带本机实例状态）。 */
  private async handleHubRegister(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const auth = this.authenticatePeer(req)
    if (!auth.ok) return sendJson(res, auth.status, { ok: false, error: auth.error })
    const body = await readJsonBody(req)
    const instances = Array.isArray((body as { instances?: unknown })?.instances)
      ? ((body as { instances: unknown[] }).instances.filter(isWorkerInstanceReport))
      : []
    const ack = this.registerWorker({ id: auth.id, instances }, this.config.tokens[auth.id])
    sendJson(res, ack.ok ? 200 : 400, ack)
  }

  /** GET /api/channel/commands：长轮询取本 worker 的待执行指令（租约到期重投）。 */
  private async handleHubCommands(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const auth = this.authenticatePeer(req)
    if (!auth.ok) return sendJson(res, auth.status, { ok: false, error: auth.error })
    const url = new URL(req.url ?? '/', 'http://localhost')
    const waitParam = Number(url.searchParams.get('wait') ?? '')
    const cap = this.config.pollWaitMs ?? DEFAULT_POLL_WAIT_MS
    const waitMs = Number.isFinite(waitParam) && waitParam >= 0 ? Math.min(waitParam, cap) : cap
    // 轮询本身即保活证据：刷新 seen，避免长轮询间隔长于心跳超时而误判离线。
    const seen = this.workerSeen.get(auth.id)
    if (seen) seen.lastSeen = Date.now()
    const deadline = Date.now() + waitMs
    let commands = this.claimCommands(auth.id)
    while (commands.length === 0 && Date.now() < deadline) {
      await this.waitForDispatch(auth.id, deadline - Date.now())
      commands = this.claimCommands(auth.id)
    }
    sendJson(res, 200, { ok: true, commands })
  }

  /** POST /api/channel/result：worker 回执（受理/失败）；未知指令 id 返回 404。 */
  private async handleHubResult(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const auth = this.authenticatePeer(req)
    if (!auth.ok) return sendJson(res, auth.status, { ok: false, error: auth.error })
    const body = await readJsonBody(req) as { commandId?: unknown; ok?: unknown; error?: unknown }
    if (typeof body?.commandId !== 'string' || typeof body.ok !== 'boolean') {
      return sendJson(res, 400, { ok: false, error: 'result 需要 commandId 与 ok' })
    }
    const entry = this.ledger.get(body.commandId)
    if (entry === undefined) return sendJson(res, 404, { ok: false, error: `unknown commandId ${body.commandId}` })
    if (entry.targetId !== auth.id) return sendJson(res, 403, { ok: false, error: 'commandId 归属其它 worker' })
    this.completeCommand(body.commandId, {
      ok: body.ok,
      ...(typeof body.error === 'string' ? { error: body.error } : {}),
    })
    sendJson(res, 200, { ok: true })
  }

  // --- 多机：hub 台账内部 ---

  /** 取出可派发条目（pending 或租约到期的 dispatched）并标记派发（at-least-once）。 */
  private claimCommands(targetId: string, limit = 10): CommandLedgerEntry[] {
    const now = Date.now()
    const queue = this.commandQueue.get(targetId) ?? []
    const taken: CommandLedgerEntry[] = []
    for (const entry of queue) {
      if (taken.length >= limit) break
      if (entry.status === 'dispatched' && (entry.leaseUntil ?? 0) > now) continue
      entry.status = 'dispatched'
      entry.dispatchedAt = now
      entry.leaseUntil = now + (this.config.commandLeaseMs ?? DEFAULT_COMMAND_LEASE_MS)
      taken.push({ ...entry })
    }
    if (taken.length > 0) this.persistLedger()
    return taken
  }

  /** 等待派发唤醒或超时（长轮询用）。 */
  private waitForDispatch(targetId: string, waitMs: number): Promise<void> {
    if (waitMs <= 0) return Promise.resolve()
    if ((this.commandQueue.get(targetId) ?? []).length > 0) return Promise.resolve()
    return new Promise((resolve) => {
      const done = (): void => {
        clearTimeout(timer)
        this.dispatchWaiters.delete(done)
        resolve()
      }
      const timer = setTimeout(done, waitMs)
      timer.unref?.()
      this.dispatchWaiters.add(done)
    })
  }

  /** 唤醒全部长轮询（入队后调用）。 */
  private wakeDispatchers(): void {
    for (const wake of [...this.dispatchWaiters]) wake()
  }

  /** 从目标队列摘除条目（回执完成后）。 */
  private dropFromQueue(entry: CommandLedgerEntry): void {
    const queue = this.commandQueue.get(entry.targetId)
    if (queue === undefined) return
    const index = queue.findIndex((candidate) => candidate.id === entry.id)
    if (index >= 0) queue.splice(index, 1)
    if (queue.length === 0) this.commandQueue.delete(entry.targetId)
  }

  /** 实例表 upsert（保留既有 addr/name；注册上报只更新状态与心跳时间）。 */
  private upsert(id: string, status: 'online' | 'offline', lastSeen: number): void {
    const entry = this.instances.get(id)
    if (entry === undefined) {
      this.instances.set(id, { id, name: id, addr: '', status, lastSeen })
      return
    }
    entry.status = status
    entry.lastSeen = lastSeen
  }

  /** 读台账文件（未完成条目重新排队；损坏即从空台账开始）。 */
  private loadLedger(): void {
    const file = this.config.ledgerFile
    if (file === undefined) return
    try {
      if (!existsSync(file)) return
      const saved = JSON.parse(readFileSync(file, 'utf8')) as { seq?: number; entries?: CommandLedgerEntry[] }
      if (typeof saved.seq === 'number') this.seq = saved.seq
      for (const entry of saved.entries ?? []) {
        // 派发中条目视为待重新投递（worker 未回执即未确认执行）。
        const restored: CommandLedgerEntry = { ...entry, status: 'pending', dispatchedAt: undefined, leaseUntil: undefined }
        this.ledger.set(restored.id, restored)
        const queue = this.commandQueue.get(restored.targetId) ?? []
        queue.push(restored)
        this.commandQueue.set(restored.targetId, queue)
      }
    } catch {
      // 文件损坏：从空台账开始（未完成指令丢失，worker 侧无副作用由幂等键吸收）。
    }
  }

  /** 落盘未完成条目（pending/dispatched）。 */
  private persistLedger(): void {
    const file = this.config.ledgerFile
    if (file === undefined) return
    try {
      mkdirSync(dirname(file), { recursive: true })
      const entries = [...this.ledger.values()].filter((entry) => entry.status === 'pending' || entry.status === 'dispatched')
      writeFileSync(file, JSON.stringify({ seq: this.seq, entries }, null, 2))
    } catch {
      // 落盘失败不致命：内存台账仍可派发，重启后丢失未完成指令。
    }
  }

  // --- 多机：worker 出站回路 ---

  /**
   * 启动出站回路（worker）：周期注册/保活 + 长轮询取指令；失败按指数退避重试。
   * 返回停止函数。
   */
  private startWorker(): () => void {
    let stopped = false
    let registerTimer: ReturnType<typeof setTimeout> | undefined
    let pollTimer: ReturnType<typeof setTimeout> | undefined
    let abort: AbortController | undefined
    let failures = 0
    const baseInterval = this.config.registerIntervalMs ?? DEFAULT_REGISTER_INTERVAL_MS
    const wait = this.config.pollWaitMs ?? DEFAULT_POLL_WAIT_MS
    const loopRegister = (): void => {
      if (stopped) return
      void this.workerRegister().then((ok) => {
        failures = ok ? 0 : failures + 1
        if (stopped) return
        const delay = Math.min(baseInterval * 2 ** Math.min(failures, 6), MAX_REGISTER_BACKOFF_MS)
        registerTimer = setTimeout(loopRegister, delay)
        registerTimer.unref?.()
      })
    }
    const loopPoll = (): void => {
      if (stopped) return
      abort = new AbortController()
      void this.workerPoll(wait, abort.signal).finally(() => {
        if (stopped) return
        // 成功时已在服务端等满 wait；失败时短暂退避再连。
        pollTimer = setTimeout(loopPoll, 1_000)
        pollTimer.unref?.()
      })
    }
    loopRegister()
    loopPoll()
    return () => {
      stopped = true
      if (registerTimer !== undefined) clearTimeout(registerTimer)
      if (pollTimer !== undefined) clearTimeout(pollTimer)
      abort?.abort()
    }
  }

  /** 注册/保活一次：上报本机实例状态。@returns 是否被 hub 接受。 */
  private async workerRegister(): Promise<boolean> {
    const id = this.selfId
    const hubAddr = this.config.console
    if (id === undefined || hubAddr === undefined) return false
    const instances = this.reportProvider?.() ?? []
    try {
      const res = await fetch(`${trimSlash(hubAddr)}/api/channel/register`, {
        method: 'POST',
        headers: this.peerHeaders(id),
        body: JSON.stringify({ id, instances }),
      })
      const ack = await res.json().catch(() => null) as RegisterAck | null
      if (!res.ok || ack?.ok !== true) {
        console.error(`[dsh-channel/worker] 注册被拒（http ${res.status}）：${ack?.error ?? 'no body'}`)
        return false
      }
      for (const rejected of ack.rejected ?? []) {
        console.error(`[dsh-channel/worker] 实例声明被拒：${rejected.id}（${rejected.reason}）`)
      }
      return true
    } catch (error) {
      console.error(`[dsh-channel/worker] 注册失败：${error instanceof Error ? error.message : String(error)}`)
      return false
    }
  }

  /** 长轮询一次：取指令 → 本地执行 → 回执（回执语义 = 已受理）。 */
  private async workerPoll(waitMs: number, signal: AbortSignal): Promise<void> {
    const id = this.selfId
    const hubAddr = this.config.console
    if (id === undefined || hubAddr === undefined) return
    try {
      const res = await fetch(`${trimSlash(hubAddr)}/api/channel/commands?wait=${waitMs}`, {
        headers: this.peerHeaders(id),
        signal,
      })
      if (!res.ok) return
      const data = await res.json() as { commands?: CommandLedgerEntry[] }
      for (const entry of data.commands ?? []) {
        let result: { ok: boolean; error?: string } = { ok: true }
        try {
          for (const handler of this.controlHandlers) handler(entry.command, HUB_SENDER)
        } catch (error) {
          result = { ok: false, error: error instanceof Error ? error.message : String(error) }
        }
        await this.workerResult(id, entry.id, result)
      }
    } catch {
      // 网络失败/abort：由调用方决定重试节奏。
    }
  }

  /** 回执一次指令结果。 */
  private async workerResult(id: string, commandId: string, result: { ok: boolean; error?: string }): Promise<void> {
    const hubAddr = this.config.console
    if (hubAddr === undefined) return
    try {
      await fetch(`${trimSlash(hubAddr)}/api/channel/result`, {
        method: 'POST',
        headers: this.peerHeaders(id),
        body: JSON.stringify({ id, commandId, ...result }),
      })
    } catch {
      // 回执失败：hub 侧租约到期后重新投递（at-least-once）。
    }
  }

  /** worker 出站请求头（实例令牌鉴权）。 */
  private peerHeaders(id: string): Record<string, string> {
    return {
      'content-type': 'application/json',
      'x-instance-id': id,
      'x-instance-token': this.config.token ?? '',
    }
  }

  /**
   * 心跳超时检查：超时实例标记离线；清除过期事件与确认记录。 */
  private sweep(): void {
    const now = Date.now()
    for (const entry of this.instances.values()) {
      if (now - entry.lastSeen > this.config.heartbeatTimeoutMs) {
        entry.status = 'offline'
      }
    }
    for (const [id, seen] of this.workerSeen) {
      if (now - seen.lastSeen > this.config.heartbeatTimeoutMs) this.workerSeen.delete(id)
    }
    for (const [id, ts] of this.eventTimes) {
      if (now - ts > EVENT_TTL_MS) {
        this.eventTimes.delete(id)
        this.ackedEvents.delete(id)
      }
    }
  }
}

function toIdentity(entry: InstanceEntry): InstanceIdentity {
  const { lastSeen: _lastSeen, ...identity } = entry
  return identity
}

/** 从环境变量解析 relay 配置（DSH_RELAY_BROKER_URL/AGENT/SECRET/POLL_PEERS_MS/STATE_FILE）。 */
function envRelayConfig(): RelayConfig | undefined {
  const brokerUrl = process.env.DSH_RELAY_BROKER_URL
  const agent = process.env.DSH_RELAY_AGENT
  const secret = process.env.DSH_RELAY_SECRET
  if (!brokerUrl || !agent || !secret) return undefined
  const stateFile = process.env.DSH_RELAY_STATE_FILE
  return {
    brokerUrl,
    agent,
    secret,
    stateFile: stateFile || undefined,
  }
}

/** HMAC-SHA256 请求签名（dsh-agent-relay wire 协议 v1：method\npath\nts\nbody）。 */
export function signRequest(secret: string, method: string, path: string, tsSeconds: number, rawBody = ''): string {
  return createHmac('sha256', secret)
    .update(`${method}\n${path}\n${tsSeconds}\n${rawBody}`)
    .digest('hex')
}

/** 主机守护 agent 名规则（host<hostId>，如 host1）：实例/守护的共享识别契约。 */
export function isHostAgent(agentId: string): boolean {
  return /^host\d+$/.test(agentId)
}

/** 带 HMAC 鉴权头发起 relay 请求（node 内置 fetch）。 */
function relayFetch(
  relay: RelayConfig,
  method: 'GET' | 'POST',
  path: string,
  rawBody: string,
): Promise<Response> {
  const ts = Math.floor(Date.now() / 1000)
  return fetch(`${relay.brokerUrl}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      'x-relay-agent': relay.agent,
      'x-relay-timestamp': String(ts),
      'x-relay-signature': signRequest(relay.secret, method, path, ts, rawBody),
    },
    body: method === 'POST' ? rawBody : undefined,
  })
}

/** hub 派发指令时的发送方标识（worker 侧 onControl 的 from）。 */
export const HUB_SENDER = 'console'

/**
 * 解析通道角色：显式 `mode` 优先；给出 `console` 地址即 worker（出站拉取）；
 * 否则 local（进程内 + relay 兜底）。
 */
export function resolveMode(config: Config, relay: RelayConfig | undefined): ChannelMode {
  if (config.mode !== undefined) return config.mode
  if (config.console !== undefined) return 'worker'
  void relay
  return 'local'
}

/** 解析本实例 id：config.id → relay.agent → DSH_RELAY_AGENT。 */
export function resolveSelfId(config: Config, relay: RelayConfig | undefined): string | undefined {
  if (config.id !== undefined && config.id !== '') return config.id
  if (relay !== undefined) return relay.agent
  const fromEnv = process.env.DSH_RELAY_AGENT
  return fromEnv !== undefined && fromEnv !== '' ? fromEnv : undefined
}

/** 去尾部斜杠（拼 URL 用）。 */
function trimSlash(url: string): string {
  return url.replace(/\/+$/, '')
}

/** 读请求头（大小写不敏感；node 已小写化，兼容直接传入的原始对象）。 */
function headerValue(req: IncomingMessage, name: string): string | undefined {
  const raw = req.headers[name]
  if (typeof raw === 'string') return raw
  if (Array.isArray(raw)) return raw[0]
  return undefined
}

/** 请求体大小上限（注册载荷含实例清单，仍须防超大体打爆内存）。 */
const MAX_BODY_BYTES = 256 * 1024

/** 读 JSON 请求体（超限或非法返回空对象，由调用方按字段校验拒绝）。 */
function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve) => {
    let size = 0
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        req.destroy()
        resolve({})
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'))
      } catch {
        resolve({})
      }
    })
    req.on('error', () => resolve({}))
  })
}

/** 回 JSON 响应。 */
function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

/** 校验 worker 上报的实例条目形状。 */
function isWorkerInstanceReport(value: unknown): value is WorkerInstanceReport {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as { id?: unknown; status?: unknown }
  return typeof candidate.id === 'string' && (candidate.status === 'online' || candidate.status === 'offline')
}

/** 类插件入口：cordis 实例化时自动注册 `ctx.channel`（构造即注册，勿再 provide）。 */
export default ChannelService
