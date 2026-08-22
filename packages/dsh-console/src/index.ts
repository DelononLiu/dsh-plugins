/**
 * dsh-console：管理组件（纯服务端）——主机/实例档案、生命周期、部署编排、
 * inbox/投递、总览数据。控制面：决策与编排在此，执行在远端。
 *
 * 一个包三角色，角色 = 部署位置（见
 * .agents/notes/proposed/architecture/2026-08-22-daemon-host-supervisor.md）：
 * - console（默认）：管理端——档案/inbox/HTTP API/编排（决策面）；
 * - daemon：主机守护——spawn/kill/追踪本机实例（执行面）；
 * - instance：实例自退兜底——收到 stop/restart 退出进程（执行面）。
 *
 * 实例管理服务提供者：`InstanceRecord` 在 channel 的 `InstanceIdentity` 上
 * 扩展 owner/type/host/version；消费者（dsh-quick-nav 等）经
 * type-only import + Typert ctx.remote 消费（运行时零依赖）。
 *
 * v1 为**进程内实现**：档案与 inbox 存内存（持久化后续）；生命周期指令经
 * channel.sendControl 下发（console 编排，daemon/instance 执行）。
 * @module dsh-console
 */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import 'dsh-channel'
import { isHostAgent, signRequest, type ControlCommand, type InstanceIdentity } from 'dsh-channel'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { randomUUID } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdirSync, openSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { connect } from 'node:net'

/** 实例特殊类型（可扩展枚举，已定）。 */
export type InstanceType = 'normal' | 'shared' | 'host'

/** 实例管理档案：在通信层实例身份上扩展管理概念。 */
export interface InstanceRecord extends InstanceIdentity {
  /** 归属者用户 id（全部实例皆 personal）。 */
  owner: string
  /** 实例类型（normal/shared/host）。 */
  type: InstanceType
  /** 所在主机 id。 */
  host: string
  /** 已部署的发行包版本。 */
  version: string
  /** shared 实例授权（owner 授权其他用户：read/full）。 */
  sharedAuth?: Record<string, 'read' | 'full'>
}

/** 主机档案（部署单元）。 */
export interface HostRecord {
  /** 主机 id。 */
  id: string
  /** 主机名/地址。 */
  addr: string
  /** 在线状态（聚合自其下实例心跳）。 */
  status: 'online' | 'offline'
  /** 已部署的发行包版本。 */
  version: string
}

/** 系统事件消息（inbox，聚焦系统级消息——升级/任务/健康/部署）。 */
export interface InboxMessage {
  /** 消息 id。 */
  id: string
  /** 归属用户（owner 隔离）。 */
  owner: string
  /** 来源实例 id。 */
  sender: string
  /** 消息类型（upgrade.done / task.result / health.alert / deploy.event…）。 */
  type: string
  /** 标题。 */
  title: string
  /** 正文。 */
  body: string
  /** 产生时间（epoch ms）。 */
  ts: number
  /** 已读。 */
  read: boolean
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    console: ConsoleService
  }
}

/** 实例启动规格（守护拉起离线实例用；console 端经 host 寻址目标守护）。 */
export interface LaunchSpec {
  /** 目标主机守护的 relay agent 名（如 host-lab1；console 端填写，daemon 端忽略）。 */
  host?: string
  /** 实例访问地址（跳转用，如 http://127.0.0.1:3083；channel 发现的 addr 为空时填充）。 */
  addr?: string
  /** DSH_HOME 目录（实例数据根）。 */
  dshHome: string
  /** profile 名（如 web）。 */
  profile: string
  /** 端口（记录/校验用，可选）。 */
  port?: number
  /** 额外环境变量（如 DSH_RELAY_AGENT/SECRET/BROKER_URL）。 */
  env?: Record<string, string>
}

/** 插件角色（部署位置）：console=管理端 / daemon=主机守护 / instance=实例自退。 */
export type ConsoleRole = 'console' | 'daemon' | 'instance'

/** 插件配置。 */
export interface Config {
  /** 角色：console（管理端，默认）/ daemon（主机守护）/ instance（实例自退）。 */
  role?: ConsoleRole
  /** console 端：实例启动规格（instanceId → 拉起信息；start 且实例离线时经目标守护拉起）。 */
  launch?: Record<string, LaunchSpec>
  /** daemon 端：本机主机 id（守护 agent 名 = host-<hostId>）。 */
  hostId?: string
  /** daemon 端：本机实例清单（守护只管理清单内的实例）。 */
  instances?: Record<string, LaunchSpec>
}

/** 运行时 schema。 */
export const Config = z.object({
  role: z.union([z.const('console'), z.const('daemon'), z.const('instance')]).default('console'),
  launch: z.any().default(undefined),
  hostId: z.string().default(''),
  instances: z.any().default(undefined),
}) as z<Config>

/** 解析控制指令的动作（可测纯函数）：exit=重启/停止；running=已在运行；pending=v1 占位。 */
export function resolveControlAction(command: ControlCommand): 'exit' | 'running' | 'pending' {
  switch (command.type) {
    case 'restart':
    case 'stop':
      return 'exit'
    case 'start':
      return 'running'
    case 'upgrade':
    case 'deploy':
      return 'pending'
    default:
      return 'pending'
  }
}

/** 控制路由（console 决策面）：给定在线状态与守护配置，确定执行路径。 */
export type ControlRoute =
  | { action: 'noop' }
  | { action: 'daemon'; daemonAgent: string; command: 'start' | 'stop' | 'restart' }
  | { action: 'instance'; command: 'stop' | 'restart' }
  | { action: 'error'; reason: string }

/** 解析控制路由（可测纯函数）：start 有守护→守护（守护侧幂等，绕开 broker TTL 滞后）；
 * stop/restart 有守护→守护；无守护在线→实例自退兜底。 */
export function resolveControlRoute(
  command: 'stop' | 'start' | 'restart',
  online: boolean,
  daemonAgent: string | undefined,
): ControlRoute {
  switch (command) {
    case 'start':
      // 有守护配置一律发守护：守护侧幂等（已在运行则忽略）；不依赖 broker 在线判断
      // （进程死后 90s TTL 内 broker 仍标 online，会导致 start 误判 noop 不投递）。
      if (daemonAgent) return { action: 'daemon', daemonAgent, command: 'start' }
      if (online) return { action: 'noop' }
      return { action: 'error', reason: '实例离线且无守护配置' }
    case 'stop':
      if (!online) return { action: 'noop' }
      if (daemonAgent) return { action: 'daemon', daemonAgent, command: 'stop' }
      return { action: 'instance', command: 'stop' }
    case 'restart':
      if (daemonAgent) return { action: 'daemon', daemonAgent, command: 'restart' }
      if (online) return { action: 'instance', command: 'restart' }
      return { action: 'error', reason: '实例离线且无守护配置' }
  }
}

/** 控制指令结果（console.controlInstance 返回；HTTP 端点据此响应）。 */
export interface ControlResult {
  ok: boolean
  /** 失败原因（ok=false 时）。 */
  error?: string
}

/** per-instance 操作状态（busy 锁：防并发指令交错；start/restart 共用）。 */
type InstanceOp = 'starting' | 'restarting'

/** 等待毫秒。 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** 端口是否空闲（无监听者）；连接失败/超时视为空闲。 */
function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host: '127.0.0.1', port })
    const done = (free: boolean): void => {
      socket.destroy()
      resolve(free)
    }
    socket.once('connect', () => done(false))
    socket.once('error', () => done(true))
    socket.setTimeout(2000, () => done(true))
  })
}

/** 离线覆盖（UI 即时显示）：op=stop/restart 发出后标记；restart 窗口超时或实例真离线时过期。 */
export interface OfflineOverride {
  op: 'stop' | 'restart'
  ts: number
}

/**
 * 应用离线覆盖到实例状态（可测纯函数）：broker 对下线判定有 TTL 滞后
 * （默认 90s），stop/restart 发出后本地强制显示 offline 直到覆盖过期。
 * @returns expired=true 表示覆盖可清除（实例真离线，或 restart 窗口已过）。
 */
export function applyOverrideStatus(
  status: 'online' | 'offline',
  override: OfflineOverride | undefined,
  now: number,
  restartOverrideMs: number,
): { status: 'online' | 'offline'; expired: boolean } {
  if (override === undefined) return { status, expired: false }
  if (override.op === 'stop') {
    // 实例真离线（broker TTL 判定）→ 覆盖不再必要，可清除。
    if (status === 'offline') return { status: 'offline', expired: true }
    return { status: 'offline', expired: false }
  }
  // restart：窗口内显示离线（重启中），窗口后清除并回到 channel 状态。
  if (now - override.ts > restartOverrideMs) return { status, expired: true }
  return { status: 'offline', expired: false }
}

/**
 * 管理服务（实例管理服务提供者 + 生命周期执行者）：档案、生命周期编排、inbox。
 * 角色决定执行面：console 决策编排；daemon 本机进程管理；instance 自退。
 */
export class ConsoleService extends Service {
  static Config = Config
  /** 依赖注入：ctx.channel 必需；webServer 经 ctx.inject 等待（daemon/instance 角色不装也能加载）。 */
  static inject = ['channel']

  /** 停止宽限（ms）：SIGTERM 后仍未退出则 SIGKILL。 */
  private static readonly KILL_GRACE_MS = 5000
  /** 重启看门狗（ms）：kill 后进程始终不退则解锁，防 busy 锁永久泄漏。 */
  private static readonly RESTART_WATCHDOG_MS = 20000
  /** 非守护实例自退等待（ms，port 未知时）：覆盖实例收件周期（默认 30s）+ 自退 + 余量。 */
  private static readonly STOP_SELF_EXIT_WAIT_MS = 35000
  /** 端口释放轮询上限（500ms/轮，共 30s）。 */
  private static readonly STOP_POLL_LIMIT = 60
  /** restart 离线覆盖窗口（ms）：重启中显示离线，窗口后回到 channel 状态。 */
  private static readonly RESTART_OVERRIDE_MS = 15000

  /** spawn 实现（测试可替换为伪子进程；生产 = node:child_process.spawn）。 */
  static spawnImpl: typeof spawn = spawn

  /** 主机档案表。 */
  private readonly hosts = new Map<string, HostRecord>()
  /** 实例档案表（含管理扩展）。 */
  private readonly instances = new Map<string, InstanceRecord>()
  /** inbox：owner → 消息列表（实例级，按 owner 隔离）。 */
  private readonly inboxes = new Map<string, InboxMessage[]>()
  /** 订阅 channel task 平面（系统事件 → inbox）的 disposer。 */
  private readonly unsubscribe: () => void
  /** 控制指令接收（daemon/instance 角色）的 disposer。 */
  private unsubscribeControl: (() => void) | undefined
  /** daemon 角色：追踪的子进程（instanceId → 守护拉起的进程）。 */
  private readonly children = new Map<string, ChildProcess>()
  /** per-instance 操作锁（start/restart 进行中；防积压指令交错 spawn）。 */
  private readonly ops = new Map<string, InstanceOp>()
  /** UI 离线覆盖（stop/restart 发出后即时显示 offline，绕开 broker TTL 滞后）。 */
  private readonly offlineOverride = new Map<string, OfflineOverride>()

  constructor(ctx: Context, private readonly config: Config) {
    super(ctx, 'console')
    // 系统事件消息：订阅 channel task 平面，落入各 owner 的 inbox。
    this.unsubscribe = ctx.channel.subscribe('task', (event) => {
      if (event.type.startsWith('system.')) {
        this.postSystemMessage(event.type, event.payload as Record<string, unknown>)
      }
    })
    ctx.effect(() => this.unsubscribe)
    switch (config.role) {
      case 'daemon':
        // 主机守护：处理 start/stop/restart，本地 spawn/kill 清单内实例。
        this.unsubscribeControl = ctx.channel.onControl((command, from) => this.handleDaemonControl(command, from))
        ctx.effect(() => this.unsubscribeControl!)
        break
      case 'instance':
        // 实例自退兜底：收到 stop/restart 退出进程（重启由守护拉起）。
        this.unsubscribeControl = ctx.channel.onControl((command, from) => this.handleInstanceControl(command, from))
        ctx.effect(() => this.unsubscribeControl!)
        break
      default: {
        // console 角色：等 webServer 服务可用后挂 HTTP 端点（ctx.inject 原生等待；
        // daemon/instance 角色部署的无 webserver profile 不会走到这里）。
        // 注意用注入后的 ctx（webServer 只在注入 fiber 的 scope 可见）。
        ctx.inject(['webServer'], (injected) => {
          console.log('[dsh-console] console 角色：webServer 可用，注册控制端点')
          const disposers = [
            injected.webServer.register({
              kind: 'exact',
              path: '/api/console/instances',
              handler: (req, res) => this.handleInstancesRoute(req, res),
            }),
            injected.webServer.register({
              kind: 'exact',
              path: '/api/console/control',
              handler: (req, res) => this.handleControlRoute(req, res),
            }),
            injected.webServer.register({
              kind: 'exact',
              path: '/api/console/broker',
              handler: (req, res) => this.handleBrokerRoute(req, res),
            }),
          ]
          injected.effect(() => () => { for (const dispose of disposers) dispose() })
        })
      }
    }
  }

  /** GET /api/console/instances：实例列表 + 守护 peers（host-* 前缀，UI 分别呈现）。 */
  private handleInstancesRoute(_req: IncomingMessage, res: ServerResponse): void {
    let instances = this.ctx.channel.list()
    // 加本机实例（console 端自己，channel 发现的是远端）。
    const self = this.ctx.channel.relay?.agent
    if (self !== undefined && !instances.some((i) => i.id === self)) {
      instances = [{ id: self, name: self, addr: '', status: 'online' as const }, ...instances]
    }
    const now = Date.now()
    // 应用离线覆盖（stop/restart 后即时显示 offline，绕开 broker TTL 滞后）；过期项清除。
    const view = instances.map((inst) => {
      // 实例访问地址（channel 发现为空 → launch 配置 addr 补充，跳转用）与所属主机名。
      const spec = this.config.launch?.[inst.id]
      const withHost = spec?.host ? { ...inst, host: spec.host } : inst
      const launchAddr = spec?.addr
      const withAddr = launchAddr ? { ...withHost, addr: launchAddr } : withHost
      // 标记当前实例（管理端自己）：UI 跳转时排除。
      const withSelf = self !== undefined && inst.id === self ? { ...withAddr, self: true as const } : withAddr
      const override = this.offlineOverride.get(inst.id)
      if (override === undefined) return withSelf
      const applied = applyOverrideStatus(inst.status, override, now, ConsoleService.RESTART_OVERRIDE_MS)
      if (applied.expired) this.offlineOverride.delete(inst.id)
      return applied.status === inst.status ? withSelf : { ...withSelf, status: applied.status }
    })
    // 主机守护（host<hostId>）与普通实例分开返回，UI 分别呈现。
    const hosts = view.filter((i) => isHostAgent(i.id))
    const instanceList = view.filter((i) => !isHostAgent(i.id))
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ instances: instanceList, hosts }))
  }

  /** POST /api/console/control：下发控制指令（body: {instanceId, command}）。 */
  private handleControlRoute(req: IncomingMessage, res: ServerResponse): void {
    let body = ''
    req.on('data', (chunk) => { body += String(chunk) })
    req.on('end', () => {
      try {
        const { instanceId, command } = JSON.parse(body || '{}') as { instanceId?: string; command?: 'stop' | 'start' | 'upgrade' | 'restart' }
        if (typeof instanceId !== 'string' || !instanceId) throw new Error('instanceId required')
        if (!command || !['stop', 'start', 'upgrade', 'restart'].includes(command)) throw new Error(`unsupported command: ${String(command)}`)
        const result = this.controlInstance(instanceId, command)
        res.writeHead(result.ok ? 200 : 400, { 'content-type': 'application/json' })
        res.end(JSON.stringify(result.ok ? { ok: true, instanceId, command } : { ok: false, instanceId, command, error: result.error }))
      } catch (error) {
        res.writeHead(400, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }))
      }
    })
  }

  /**
   * GET /api/console/broker：broker 运行状态（连接/在线 agent/消息队列计数）。
   * 控制台面板的「Broker 状态」区块数据面（自实现，不依赖 dsh-agent-relay 插件）。
   */
  private async handleBrokerRoute(_req: IncomingMessage, res: ServerResponse): Promise<void> {
    const relay = this.ctx.channel.relay
    const reply = (body: Record<string, unknown>): void => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify(body))
    }
    if (relay === undefined) {
      reply({ connected: false, reason: 'relay 未配置', agents: [], queueCount: 0 })
      return
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
        reply({ connected: false, reason: `broker http ${peersRes.status}`, agents: [], queueCount: 0 })
        return
      }
      const peers = (await peersRes.json() as { peers?: Array<{ agent: string; online: boolean }> }).peers ?? []
      // 队列计数：console 自己的收件箱待处理消息（since 空 → 从最新游标起）。
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
      reply({
        connected: true,
        agents: peers.map((p) => ({ id: p.agent, online: p.online })),
        queueCount,
      })
    } catch (error) {
      reply({ connected: false, reason: error instanceof Error ? error.message : String(error), agents: [], queueCount: 0 })
    }
  }

  /** daemon 角色：处理控制指令（只认本机清单内的实例；指令载荷携带 instanceId）。 */
  private handleDaemonControl(command: ControlCommand, from: string): void {
    const payload = (command.payload ?? {}) as Record<string, unknown>
    const instanceId = typeof payload.instanceId === 'string' ? payload.instanceId : ''
    const spec = this.config.instances?.[instanceId]
    if (spec === undefined) {
      console.log(`[dsh-console/daemon] 收到 ${from} 的 ${command.type} 指令，但 ${instanceId || '(空)'} 不在本机清单（拒绝）`)
      return
    }
    switch (command.type) {
      case 'start':
        // busy 锁：操作进行中（如重启等待窗口）忽略，防并发 spawn 端口冲突。
        if (!this.opBegin(instanceId, 'starting')) {
          console.log(`[dsh-console/daemon] ${instanceId} 有操作进行中，忽略 start`)
          return
        }
        try {
          this.daemonStart(instanceId, spec)
        } finally {
          this.opEnd(instanceId)
        }
        break
      case 'stop':
        this.daemonStop(instanceId)
        break
      case 'restart':
        if (!this.opBegin(instanceId, 'restarting')) {
          console.log(`[dsh-console/daemon] ${instanceId} 有操作进行中，忽略 restart`)
          return
        }
        this.daemonRestart(instanceId, spec)
        break
      default:
        console.log(`[dsh-console/daemon] 收到 ${from} 的 ${command.type} 指令（v1 占位）`)
    }
  }

  /** 尝试占用实例操作锁；已被占用返回 false（调用方忽略新指令）。 */
  private opBegin(instanceId: string, op: InstanceOp): boolean {
    if (this.ops.has(instanceId)) return false
    this.ops.set(instanceId, op)
    return true
  }

  /** 释放实例操作锁。 */
  private opEnd(instanceId: string): void {
    this.ops.delete(instanceId)
  }

  /**
   * daemon 角色：拉起实例。已在运行 → 忽略（幂等，含 busy 锁期间）。
   * spawn 后追踪子进程；exit/error 都清理（error 不清理会让死条目
   * 阻塞后续 start 的幂等判断）。
   */
  private daemonStart(instanceId: string, spec: LaunchSpec): void {
    const existing = this.children.get(instanceId)
    if (existing !== undefined && existing.exitCode === null) {
      console.log(`[dsh-console/daemon] ${instanceId} 已在运行，忽略 start`)
      return
    }
    // 实例日志落盘（~/.dsh-daemon/logs/<id>.log，append）——stdio:'ignore'
    // 会让实例崩溃原因无从查起。
    const logDir = join(homedir(), '.dsh-daemon', 'logs')
    mkdirSync(logDir, { recursive: true })
    const fd = openSync(join(logDir, `${instanceId}.log`), 'a')
    const child = ConsoleService.spawnImpl('dsh', ['--profile', spec.profile], {
      env: { ...process.env, DSH_HOME: spec.dshHome, ...spec.env },
      detached: true,
      stdio: ['ignore', fd, fd],
    })
    child.unref()
    this.children.set(instanceId, child)
    const cleanup = (): void => {
      if (this.children.get(instanceId) === child) this.children.delete(instanceId)
    }
    child.on('exit', cleanup)
    child.on('error', cleanup)
    console.log(`[dsh-console/daemon] 已拉起 ${instanceId}（dsh --profile ${spec.profile}，DSH_HOME=${spec.dshHome}）`)
  }

  /**
   * daemon 角色：重启实例（三分支，busy 锁由调用方持有、完成时解除）：
   * - 守护拉起的（children 有且运行中）→ kill，等 exit 后拉起（watchdog 防永久锁死）；
   * - 非守护拉起的在线实例 → 发 stop 自退，等端口释放/超时后拉起；
   * - 离线 → 直接拉起。
   */
  private daemonRestart(instanceId: string, spec: LaunchSpec): void {
    const child = this.children.get(instanceId)
    if (child !== undefined && child.exitCode === null) {
      // 分支 1：守护拉起的——kill 后等 exit（SIGTERM → 宽限 SIGKILL），exit 再拉起。
      const watchdog = setTimeout(() => {
        console.log(`[dsh-console/daemon] ${instanceId} 重启超时（进程未退出），解锁（可手动重试）`)
        this.opEnd(instanceId)
      }, ConsoleService.RESTART_WATCHDOG_MS)
      watchdog.unref?.()
      child.once('exit', (code, signal) => {
        clearTimeout(watchdog)
        console.log(`[dsh-console/daemon] ${instanceId} 旧进程退出（code=${String(code)} signal=${String(signal)}），拉起`)
        try {
          this.daemonStart(instanceId, spec)
        } finally {
          this.opEnd(instanceId)
        }
      })
      this.killChild(child)
      return
    }
    if (this.ctx.channel.get(instanceId)?.status === 'online') {
      // 分支 2：非守护拉起的在线实例——发 stop 自退，等退出后拉起。
      this.ctx.channel.sendControl(instanceId, { type: 'stop', payload: {} })
      console.log(`[dsh-console/daemon] ${instanceId} 非守护拉起，发 stop 自退，等待退出后拉起`)
      void this.daemonStartAfterStop(instanceId, spec)
      return
    }
    // 分支 3：离线——直接拉起。
    try {
      this.daemonStart(instanceId, spec)
    } finally {
      this.opEnd(instanceId)
    }
  }

  /**
   * daemon 角色：等非守护拉起的实例自退后拉起（分支 2 的异步等待）。
   * spec.port 已知 → 轮询端口释放（最可靠，不依赖 broker TTL）；未知 → 固定窗口
   * （覆盖实例收件周期 30s + 自退 + 余量）。超时 → 重试 stop 后解锁（不强制拉起，
   * 避免端口冲突）。
   */
  private async daemonStartAfterStop(instanceId: string, spec: LaunchSpec): Promise<void> {
    const port = spec.port
    const finish = (): void => this.opEnd(instanceId)
    if (port === undefined) {
      await sleep(ConsoleService.STOP_SELF_EXIT_WAIT_MS)
      try {
        this.daemonStart(instanceId, spec)
      } finally {
        finish()
      }
      return
    }
    for (let i = 0; i < ConsoleService.STOP_POLL_LIMIT; i++) {
      if (await isPortFree(port)) {
        try {
          this.daemonStart(instanceId, spec)
        } finally {
          finish()
        }
        return
      }
      // 每轮重试 stop（实例可能没收到第一条）。
      if (i > 0 && i % 10 === 0) {
        this.ctx.channel.sendControl(instanceId, { type: 'stop', payload: {} })
      }
      await sleep(500)
    }
    console.log(`[dsh-console/daemon] ${instanceId} 等待退出超时（端口仍占用），重发 stop，解锁`)
    this.ctx.channel.sendControl(instanceId, { type: 'stop', payload: {} })
    finish()
  }

  /** 向子进程发 SIGTERM，宽限后 SIGKILL（对已退出进程无操作）。 */
  private killChild(child: ChildProcess): void {
    child.kill('SIGTERM')
    const timer = setTimeout(() => {
      if (child.exitCode === null) child.kill('SIGKILL')
    }, ConsoleService.KILL_GRACE_MS)
    timer.unref?.()
  }

  /** daemon 角色：停止实例——守护拉起的直接 kill；否则在线实例自退兜底。 */
  private daemonStop(instanceId: string): void {
    const child = this.children.get(instanceId)
    if (child !== undefined && child.exitCode === null) {
      this.killChild(child)
      console.log(`[dsh-console/daemon] 已向 ${instanceId} 发 SIGTERM（宽限 ${ConsoleService.KILL_GRACE_MS}ms 后 SIGKILL）`)
      return
    }
    if (this.ctx.channel.get(instanceId)?.status === 'online') {
      this.ctx.channel.sendControl(instanceId, { type: 'stop', payload: {} })
      console.log(`[dsh-console/daemon] ${instanceId} 非守护拉起，经 channel 发 stop 自退`)
      return
    }
    console.log(`[dsh-console/daemon] ${instanceId} 已离线，无进程可停`)
  }

  /** instance 角色：实例自退执行器（收到 stop/restart 退出进程，重启由守护拉起）。 */
  private handleInstanceControl(command: ControlCommand, from: string): void {
    const action = resolveControlAction(command)
    switch (action) {
      case 'exit':
        console.log(`[dsh-console/instance] 收到 ${from} 的 ${command.type} 指令，执行重启/停止（进程退出，守护拉起）`)
        setTimeout(() => process.exit(0), 300)
        break
      case 'running':
        console.log(`[dsh-console/instance] 收到 ${from} 的 start 指令（已在运行）`)
        break
      case 'pending':
        console.log(`[dsh-console/instance] 收到 ${from} 的 ${command.type} 指令（v1 占位）`)
        break
    }
  }

  /** 实例是否在线（channel 发现的实例状态）。 */
  private isInstanceOnline(instanceId: string): boolean {
    return this.ctx.channel.get(instanceId)?.status === 'online'
  }

  // --- 主机档案 ---

  /** 登记主机（agent 上线/引导后调用）。 */
  registerHost(host: HostRecord): void {
    this.hosts.set(host.id, host)
  }

  /** 列出全部主机。 */
  listHosts(): HostRecord[] {
    return [...this.hosts.values()]
  }

  // --- 实例档案（实例管理服务提供者） ---

  /** 写入/更新实例档案。 */
  setInstanceRecord(record: InstanceRecord): void {
    this.instances.set(record.id, record)
  }

  /** 查询实例档案。 */
  getInstanceRecord(instanceId: string): InstanceRecord | undefined {
    return this.instances.get(instanceId)
  }

  /** 列出全部实例档案。 */
  listInstanceRecords(): InstanceRecord[] {
    return [...this.instances.values()]
  }

  /** 查询实例的访问地址（launch 配置 addr，跳转用；未配置返回 undefined）。 */
  getLaunchAddr(instanceId: string): string | undefined {
    return this.config.launch?.[instanceId]?.addr
  }

  // --- 生命周期 / 部署编排（控制面：决策，执行在 daemon/instance） ---

  /**
   * 启停/重启实例：按路由决定执行路径（见 resolveControlRoute）——有守护配置
   * 经守护执行（start 离线也可靠），否则在线实例自退兜底；upgrade/deploy 始终
   * 投给实例本身（v1 占位）。
   * @param instanceId - 目标实例 id。
   * @param command - 控制指令类型（stop/start/upgrade/restart）。
   * @param payload - 载荷（如 upgrade 的目标版本）。
   * @returns 下发结果（ok=false 时 error 说明原因，供 HTTP 端点响应）。
   */
  controlInstance(instanceId: string, command: 'stop' | 'start' | 'upgrade' | 'restart', payload: Record<string, unknown> = {}): ControlResult {
    if (command === 'upgrade') {
      this.ctx.channel.sendControl(instanceId, { type: command, payload })
      return { ok: true }
    }
    const online = this.isInstanceOnline(instanceId)
    const daemonAgent = this.config.launch?.[instanceId]?.host
    const route = resolveControlRoute(command, online, daemonAgent)
    switch (route.action) {
      case 'noop':
        return { ok: true }
      case 'daemon': {
        // 守护从未注册（launch.host 拼错）→ 显式失败；守护离线（TTL 内）消息排队，恢复后生效。
        if (this.ctx.channel.get(route.daemonAgent) === undefined) {
          return { ok: false, error: `目标守护 ${route.daemonAgent} 未注册（检查 launch 配置 host）` }
        }
        this.ctx.channel.sendControl(route.daemonAgent, { type: route.command, payload: { instanceId } })
        this.markOfflineOverride(instanceId, route.command)
        return { ok: true }
      }
      case 'instance':
        this.ctx.channel.sendControl(instanceId, { type: route.command, payload })
        this.markOfflineOverride(instanceId, route.command)
        return { ok: true }
      case 'error':
        return { ok: false, error: route.reason }
    }
  }

  /**
   * 下发后更新 UI 离线覆盖：stop/restart → 立即标记 offline（broker TTL 滞后期间
   * 也即时显示）；start → 清除覆盖（实例启动/上线后回到 channel 状态）。
   */
  private markOfflineOverride(instanceId: string, command: 'stop' | 'start' | 'restart'): void {
    if (command === 'start') {
      this.offlineOverride.delete(instanceId)
      return
    }
    this.offlineOverride.set(instanceId, { op: command, ts: Date.now() })
  }

  /**
   * 部署新实例（模板实例化）：登记档案并下发 deploy 指令。v1 为编排意图
   * 记录 + 指令回环；实际部署（clone 模板→新 profile→起进程）由 daemon 执行，
   * 且须把新实例写入守护 instances 清单（见 daemon-host-supervisor note）。
   */
  deployInstance(record: InstanceRecord): void {
    this.setInstanceRecord(record)
    this.ctx.channel.sendControl(record.host, { type: 'deploy', payload: { instanceId: record.id, version: record.version } })
  }

  // --- inbox（系统事件消息，实例级，按 owner 隔离） ---

  /** 发布系统事件消息到指定 owner 的 inbox。 */
  postMessage(owner: string, sender: string, type: string, title: string, body: string): void {
    const message: InboxMessage = { id: randomUUID(), owner, sender, type, title, body, ts: Date.now(), read: false }
    let list = this.inboxes.get(owner)
    if (!list) {
      list = []
      this.inboxes.set(owner, list)
    }
    list.unshift(message)
  }

  /** 读取某 owner 的 inbox（最新在前）。 */
  listInbox(owner: string): InboxMessage[] {
    return [...(this.inboxes.get(owner) ?? [])]
  }

  /** 标记消息已读；返回是否更新成功。 */
  markRead(owner: string, messageId: string): boolean {
    const list = this.inboxes.get(owner)
    if (!list) return false
    const message = list.find((m) => m.id === messageId)
    if (!message) return false
    message.read = true
    return true
  }

  /** 未读数。 */
  unreadCount(owner: string): number {
    return (this.inboxes.get(owner) ?? []).filter((m) => !m.read).length
  }

  /** 由 channel task 平面系统事件生成 inbox 消息。 */
  private postSystemMessage(type: string, payload: Record<string, unknown>): void {
    const owner = typeof payload.owner === 'string' ? payload.owner : 'anonymous'
    const sender = typeof payload.sender === 'string' ? payload.sender : 'console'
    const title = typeof payload.title === 'string' ? payload.title : type
    const body = typeof payload.body === 'string' ? payload.body : JSON.stringify(payload)
    this.postMessage(owner, sender, type, title, body)
  }
}

/** 类插件入口：cordis 实例化时自动注册 `ctx.console`（构造即注册，勿再 provide）。 */
export default ConsoleService
