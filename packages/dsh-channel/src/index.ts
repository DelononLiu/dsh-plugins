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
import { dirname } from 'node:path'

// Remote 边界类型从 ./types 子路径导出（typert generator 规则：边界类型
// 必须来自公共非根类型子路径，供跨包消费与类型契约）。
import type { BrokerStatusView, InstanceIdentity } from './types.ts'
// 跨实例 RPC 复用官方 typert 协议类型：帧 = InvokeRemoteRequest（gateway），
// 回执 = RemoteResult（protocol）——channel 只做 carrier，不定义新协议。
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { InvokeRemoteRequest } from '@deepseek-ai/dsh-api-gateway/types'
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

/** 插件配置：实例令牌 + 心跳超时 + 可选 relay（社区 broker 底座）。 */
export interface Config {
  /** 实例令牌映射：{instanceId: token}——bootstrap 时注入 agent，注册/心跳校验。 */
  tokens: Record<string, string>
  /** 心跳超时（ms），超时判定离线。默认 30000。 */
  heartbeatTimeoutMs: number
  /** 可选：dsh-agent-relay broker 接入（实例联通底座）——配置即启用。 */
  relay?: RelayConfig
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
}) as z<Config>

/** 事件默认 TTL（7 天，已定投递语义）。 */
export const EVENT_TTL_MS = 7 * 24 * 3600_000

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
   * 发送控制指令到某实例（远程管理）。目标为本机 agent 名或无 relay 时进程内
   * 回环；否则经 broker（POST /messages，type=control）投递给远端实例。
   * @param instanceId - 目标实例 id（agent 名）。
   * @param command - 指令（不含 id，自动生成幂等 id）。
   */
  sendControl<P = unknown>(instanceId: string, command: Omit<ControlCommand<P>, 'id' | 'ts'>): void {
    const full: ControlCommand<P> = { ...command, id: randomUUID(), ts: Date.now() }
    if (this.relay !== undefined && instanceId !== this.relay.agent) {
      void this.relaySendControl(instanceId, full as ControlCommand)
      return
    }
    for (const handler of this.controlHandlers) {
      handler(full, instanceId)
    }
  }

  /** 注册控制指令接收者（agent 侧消费）。返回 disposer。 */
  onControl(handler: (command: ControlCommand, instanceId: string) => void): () => void {
    this.controlHandlers.add(handler)
    return () => this.controlHandlers.delete(handler)
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

  /**
   * 心跳超时检查：超时实例标记离线；清除过期事件与确认记录。 */
  private sweep(): void {
    const now = Date.now()
    for (const entry of this.instances.values()) {
      if (now - entry.lastSeen > this.config.heartbeatTimeoutMs) {
        entry.status = 'offline'
      }
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

/** 类插件入口：cordis 实例化时自动注册 `ctx.channel`（构造即注册，勿再 provide）。 */
export default ChannelService
