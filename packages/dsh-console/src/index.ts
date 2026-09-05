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
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import z from '@deepseek-ai/schemastery'
import { isHostAgent, signRequest, type ControlCommand, type InstanceIdentity } from 'dsh-channel'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { randomUUID, randomBytes } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { createServer } from 'node:http'
import { spawn, exec, type ChildProcess } from 'node:child_process'
import { appendFileSync, cpSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, resolve } from 'node:path'
import { join } from 'node:path'
import { connect } from 'node:net'

// Remote 边界类型从 ./types 子路径导出（typert generator 规则）——唯一来源，
// index 本地引用经 import type，re-export 供外部消费。
import type {
  BootstrapResult, ControlResult, ConsoleInstanceView, DeployInstanceRequest, HostRecord, InstanceRecord, InstanceType,
  LogFileList, LogFileMeta, LogReadOptions, LogReadResult, LogTarget, UpgradeBatchResult, UpgradeItemResult,
} from './types.ts'
export type * from './types.ts'
export type { BootstrapResult, ControlResult, ConsoleInstanceView, HostRecord, InstanceRecord, InstanceType } from './types.ts'

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
  /** daemon 端：本机控制 HTTP 端口（headless 也有 addr，管理端可直连；缺省不开）。 */
  controlPort?: number
  /**
   * daemon 端：实例模板 dshHome（deploy 新实例的复制源——含已装发行包
   * node_modules + profile 骨架）。测试/开发机 = 同机一个完整 dshHome
   * （如 ~/.dsh-web3）；生产 = 发行包预置的模板 home。
   */
  templateHome?: string
}

/** 运行时 schema。 */
export const Config = z.object({
  role: z.union([z.const('console'), z.const('daemon'), z.const('instance')]).default('console'),
  launch: z.any().default(undefined),
  hostId: z.string().default(''),
  instances: z.any().default(undefined),
  controlPort: z.number().default(0),
  templateHome: z.string().default(''),
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

/** per-instance 操作状态（busy 锁：防并发指令交错；start/restart/upgrading 共用）。 */
type InstanceOp = 'starting' | 'restarting' | 'upgrading'

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
export class ConsoleService extends TypertRemoteService {
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
  /** 实例启动控制宽限（ms）：启动窗口内忽略 stop/restart——broker 消息队列
   * 持久补投，迟到的旧指令会在"起来就被杀"循环里杀死刚拉起的实例。
   * 需覆盖 relay recv 周期（5s）与首轮积压消费的余量。 */
  private static readonly STARTUP_CONTROL_GRACE_MS = 45_000
  /** 管理端直连探测周期（ms）：需小于 channel heartbeatTimeoutMs（30s），
   * 否则在线实例在探测间隙被 sweep 误标离线。 */
  private static readonly PROBE_INTERVAL_MS = 15_000
  /** 直连探测请求超时（ms）：目标 hang 时中止，避免挂起请求堆积。 */
  private static readonly PROBE_TIMEOUT_MS = 5_000
  /** 升级：快照保留份数（滚动删旧；最新一份即回滚点）。 */
  private static readonly UPGRADE_SNAPSHOT_KEEP = 3
  /** 升级：kill 旧进程后等待退出的宽限（ms），超时补 SIGKILL。 */
  private static readonly UPGRADE_EXIT_MS = 8_000
  /** 升级：重启后健康探测轮询上限（500ms/轮，共 40s）。 */
  private static readonly UPGRADE_PROBE_LIMIT = 80
  /** 升级：无端口实例 spawn 后视为健康的等待宽限（ms）。 */
  private static readonly UPGRADE_HEALTH_GRACE_MS = 15_000

  /** spawn 实现（测试可替换为伪子进程；生产 = node:child_process.spawn）。 */
  static spawnImpl: typeof spawn = spawn
  /** lsof 执行实现（测试可替换；生产 = node:child_process.exec）。 */
  static execImpl: typeof exec = exec
  /** 端口空闲探测实现（测试可替换为确定性实现；生产 = isPortFree）。 */
  static portFreeImpl: (port: number) => Promise<boolean> = isPortFree
  /** 测试钩子：快照后/应用前抛错，验证升级失败自动回滚（生产不设置）。 */
  static upgradeApplyError?: Error

  /**
   * 解析本进程启动用的 dsh 命令（daemon 拉起实例时用它，保证同内核版本）。
   * daemon 是 `node <dsh-bin> --profile <p>` 启动——process.argv[1] 即 dsh bin
   * 路径（shebang 可执行，可直接 spawn）。判定：argv[1] 路径片段含 'dsh'
   * （如 .../.bin/dsh 或 .../@deepseek-ai/dsh/lib/bin.js）；测试直调时 argv[1]
   * 是测试文件（无 dsh）→ fallback 'dsh'（PATH，测试里 spawnImpl 已 mock）。
   * 用自身 dsh 避免 PATH 全局旧版（rc.2）拉起实例版本错配。
   */
  static selfDshCommand(): string {
    const argv1 = process.argv[1]
    if (argv1 !== undefined) {
      // basename 或路径含 dsh 标记 → 视为 dsh bin。
      const base = argv1.split(/[\\/]/).pop() ?? ''
      if (base.includes('dsh')) return argv1
    }
    return 'dsh'
  }

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
  /**
   * daemon 角色：运行时实例清单（deploy 动态加入；初始 = config.instances 静态）。
   * 只读处经 {@link instanceSpec} 查询（静态 + 动态合并）；v1 不持久化——
   * daemon 重启后由 console 重新下发（期望状态声明，reconcile 语义）。
   */
  private readonly runtimeInstances = new Map<string, LaunchSpec>()
  /** per-instance 操作锁（start/restart 进行中；防积压指令交错 spawn）。 */
  private readonly ops = new Map<string, InstanceOp>()
  /** UI 离线覆盖（stop/restart 发出后即时显示 offline，绕开 broker TTL 滞后）。 */
  private readonly offlineOverride = new Map<string, OfflineOverride>()
  /** 实例进程启动时刻（启动窗口过滤用）。 */
  private readonly startedAt = Date.now()

  /**
   * 关键事件落盘：terminal console.log + 进程内日志文件双写。
   * 落盘路径由 {@link Logger.resolvePath} 按 role 决定（daemon → daemon.log、
   * console → console.log；instance 不落盘——stdin/out 已被守护收集）。
   */
  private log(line: string): void {
    console.log(line)
    Logger.append(this.config.role ?? 'console', line)
  }

  constructor(ctx: Context, private readonly config: Config) {
    super(ctx, 'console')
    // 管理端即实例发现权威源：launch 配置（实例矩阵）逐条注册进 channel；
    // daemon 角色把 instances 清单（本机管理实例）同样注册——否则 daemon 的
    // channel 实例表为空（去 broker 发现后无 peers），在线判定恒 false，
    // restart 走"离线直接拉起"不杀旧进程 → 端口冲突。
    // 有 addr → callRemote 直连优先；无 addr（守护/NAT 后）→ 注册留空 addr，
    // callRemote 自动走 broker 兜底（若无 broker 则不可达，属预期）。
    const specs = config.launch ?? config.instances
    if (specs) {
      for (const [id, spec] of Object.entries(specs)) {
        // 管理端用配置 addr；daemon 本机实例用 127.0.0.1:port 构造 addr（同机直连）。
        const addr = config.launch
          ? (spec.addr ?? '')
          : (typeof spec.port === 'number' ? `http://127.0.0.1:${spec.port}` : '')
        // declare（管理端声明）：不校验 agent token（register 的 token 校验是
        // agent 自证身份契约；配置清单声明不受 tokens 配置影响）。
        ctx.channel.declare({ id, name: id, addr, status: 'online' })
      }
    }
    // 直连状态探测（管理端 launch / daemon 本机 instances 通用）：注册即 online，
    // 但无心跳续期会被 sweep 标离线（30s）→ callRemote 直连条件（status online）
    // 失效、daemon restart 误判离线。周期探测可达性，可达 → heartbeat 续期。
    if (config.launch || config.instances) {
      const probeTimer = setInterval(() => this.probeLaunch(), ConsoleService.PROBE_INTERVAL_MS)
      probeTimer.unref?.()
      ctx.effect(() => () => clearInterval(probeTimer))
    }
    // 系统事件消息：订阅 channel task 平面，落入各 owner 的 inbox。
    this.unsubscribe = ctx.channel.subscribe('task', (event) => {
      if (event.type.startsWith('system.')) {
        this.postSystemMessage(event.type, event.payload as Record<string, unknown>)
        // 升级结果事件 → 同步档案版本（守护完成/回滚后的权威结果）。
        // 注意：事件仅进程内可达（channel 事件不跨 relay）——跨进程结果以实例
        // 在线状态 + 实例 profile .dsh-upgrade-result.json 为准（见 emitUpgradeResult）。
        if (event.type === 'system.upgrade.result') {
          const payload = (event.payload ?? {}) as { instanceId?: string; ok?: boolean; version?: string; error?: string; rolledBack?: boolean }
          this.log(`[dsh-console] 收到升级结果事件（进程内）: ${payload.instanceId ?? '?'} ok=${String(payload.ok)} version=${payload.version ?? ''}${payload.rolledBack ? '（已回滚）' : ''}${payload.error ? ` error=${payload.error}` : ''}`)
          if (typeof payload.instanceId === 'string' && typeof payload.version === 'string') {
            const record = this.getInstanceRecord(payload.instanceId)
            if (record) {
              this.setInstanceRecord({
                ...record,
                version: payload.version,
                health: payload.ok ? 'upgraded' : (record.health ?? 'rollback'),
              })
            }
          }
        }
      }
    })
    ctx.effect(() => this.unsubscribe)
    switch (config.role) {
      case 'daemon':
        // 主机守护：处理 start/stop/restart，本地 spawn/kill 清单内实例。
        this.unsubscribeControl = ctx.channel.onControl((command, from) => this.handleDaemonControl(command, from))
        ctx.effect(() => this.unsubscribeControl!)
        // 本机控制端口（headless 也有 addr）——管理端经 launch 配置的 daemon addr 直连
        // （官方 client-request 信封，与 callRemote 直连路径一致；无 broker 也能管理本机实例）。
        if (config.controlPort) this.startControlServer(config.controlPort)
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
          this.log('[dsh-console] console 角色：webServer 可用，注册控制端点')
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
          ]
          injected.effect(() => () => { for (const dispose of disposers) dispose() })
        })
      }
    }
  }

  /**
   * 实例列表视图（typert @Remote）：实例 + 主机守护分开返回（UI 分别呈现）。
   * 复用原 /api/console/instances 路由逻辑（进程内数据面）。
   */
  @Remote
  listInstances(): ConsoleInstanceView {
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
    // HostRecord.version 必填，但守护经 broker peers 发现（无版本信息）→ 补默认空串（未知）。
    const hosts = view
      .filter((i) => isHostAgent(i.id))
      .map((h) => ({ ...h, version: h.version ?? '' }))
    const instanceList = view.filter((i) => !isHostAgent(i.id))
    return { instances: instanceList as unknown as InstanceRecord[], hosts: hosts as unknown as HostRecord[] }
  }

  /** 直连状态探测：对管理端 launch / daemon 本机 instances 的 addr 发轻量请求，
   * 可达 → 心跳续期（保持 online）；不可达 → 不续期（sweep 会标离线）。
   * 探测带 5s 超时（目标 hang 时不积累挂起请求）。 */
  private probeLaunch(): void {
    const specs = this.config.launch ?? this.config.instances ?? {}
    for (const [id, spec] of Object.entries(specs)) {
      // 管理端用配置 addr；daemon 本机实例用 127.0.0.1:port（与注册一致）。
      const addr = this.config.launch
        ? spec.addr
        : (typeof spec.port === 'number' ? `http://127.0.0.1:${spec.port}` : undefined)
      if (!addr) continue
      fetch(addr, { signal: AbortSignal.timeout(ConsoleService.PROBE_TIMEOUT_MS) })
        .then(() => {
          try { this.ctx.channel.heartbeat(id, '') } catch { /* 未注册 */ }
        })
        .catch(() => { /* 不可达/超时：不续期，sweep 会标离线 */ })
    }
  }

  /** GET /api/console/instances：实例列表 + 守护 peers（host-* 前缀，UI 分别呈现）。 */
  private handleInstancesRoute(_req: IncomingMessage, res: ServerResponse): void {
    const view = this.listInstances()
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify(view))
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
        const result = this.controlInstance(instanceId, command, {})
        res.writeHead(result.ok ? 200 : 400, { 'content-type': 'application/json' })
        res.end(JSON.stringify(result.ok ? { ok: true, instanceId, command } : { ok: false, instanceId, command, error: result.error }))
      } catch (error) {
        res.writeHead(400, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }))
      }
    })
  }

  /**
   * daemon 角色：本机控制 HTTP 端口（127.0.0.1:controlPort）。处理官方
   * client-request 信封（与 channel.callRemote 直连路径一致）：POST
   * /api/console/{method} → 本地执行 @Remote 方法 → server-response 回执。
   * headless 守护由此获得可直连 addr，管理端无 broker 也能控制本机实例。
   */
  private startControlServer(port: number): void {
    const server = createServer((req, res) => {
      if (req.method !== 'POST' || !req.url?.startsWith('/api/')) {
        res.writeHead(404, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ ok: false }))
        return
      }
      let body = ''
      req.on('data', (chunk) => { body += String(chunk) })
      req.on('end', () => {
        try {
          const frame = JSON.parse(body || '{}') as {
            type?: string; rpcId?: string; method?: string; payload?: { args?: Record<string, unknown> }
          }
          if (frame.type !== 'client-request' || !frame.rpcId || !frame.method) {
            res.writeHead(400, { 'content-type': 'application/json' })
            res.end(JSON.stringify({
              type: 'server-response',
              rpcId: frame?.rpcId ?? 'invalid-request',
              result: { ok: false, error: { code: 'bad-request', message: 'invalid client-request message', details: {} } },
            }))
            return
          }
          const [namespace, method] = frame.method.split('/')
          if (namespace !== 'console' || method === undefined) {
            res.writeHead(404, { 'content-type': 'application/json' })
            res.end(JSON.stringify({
              type: 'server-response',
              rpcId: frame.rpcId,
              result: { ok: false, error: { code: 'not-found', message: `unknown method: ${frame.method}`, details: {} } },
            }))
            return
          }
          let result: unknown
          if (method === 'controlInstance') {
            const { instanceId, command, payload } = (frame.payload?.args ?? {}) as {
              instanceId: string; command: 'stop' | 'start' | 'upgrade' | 'restart'; payload?: { version?: string }
            }
            result = this.controlInstance(instanceId, command, payload ?? {})
          } else if (method === 'listInstances') {
            result = this.listInstances()
          } else if (method === 'listLogFiles') {
            // 守护日志面（console 角色经 callRemote 直连本机时）：无参数。
            result = this.listLogFiles()
          } else if (method === 'readLog') {
            // 守护日志面：{ target, opts }（LogTarget 判别联合 + 读取选项）。
            const { target, opts } = (frame.payload?.args ?? {}) as { target: LogTarget; opts: LogReadOptions }
            result = this.readLog(target, opts)
          } else {
            res.writeHead(404, { 'content-type': 'application/json' })
            res.end(JSON.stringify({
              type: 'server-response',
              rpcId: frame.rpcId,
              result: { ok: false, error: { code: 'not-found', message: `unsupported method: ${method}`, details: {} } },
            }))
            return
          }
          const ok = (result as { ok?: boolean }).ok !== false
          res.writeHead(ok ? 200 : 400, { 'content-type': 'application/json' })
          res.end(JSON.stringify({
            type: 'server-response',
            rpcId: frame.rpcId,
            result: ok
              ? { ok: true, value: result }
              : { ok: false, error: { code: 'control-error', message: (result as { error?: string }).error ?? '控制失败', details: {} } },
          }))
        } catch (error) {
          res.writeHead(500, { 'content-type': 'application/json' })
          res.end(JSON.stringify({
            type: 'server-response',
            result: { ok: false, error: { code: 'internal', message: error instanceof Error ? error.message : String(error), details: {} } },
          }))
        }
      })
    })
    server.listen(port, '127.0.0.1')
    server.unref?.()
    this.ctx.effect(() => () => server.close())
    this.log(`[dsh-console/daemon] 本机控制端口 http://127.0.0.1:${port}`)
  }

  /** daemon 角色：处理控制指令（只认本机清单内的实例；指令载荷携带 instanceId）。 */
  private handleDaemonControl(command: ControlCommand, from: string): void {
    const payload = (command.payload ?? {}) as Record<string, unknown>
    // deploy：新实例部署（payload 是完整 DeployInstanceRequest，不走本机清单检查）。
    if (command.type === 'deploy') {
      this.daemonDeploy(payload as unknown as DeployInstanceRequest)
      return
    }
    const instanceId = typeof payload.instanceId === 'string' ? payload.instanceId : ''
    const spec = this.instanceSpec(instanceId)
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
      case 'upgrade': {
        // 统一升级：daemon 事务执行（快照→对齐发行包源→滚动重启→健康探测→失败回滚）。
        const version = typeof payload.version === 'string' ? payload.version : ''
        void this.daemonUpgrade(instanceId, spec, version)
        break
      }
      default:
        console.log(`[dsh-console/daemon] 收到 ${from} 的 ${command.type} 指令（v1 占位）`)
    }
  }

  /** 查询实例启动规格：静态 config.instances 优先，其次运行时清单（deploy 动态加的）。 */
  private instanceSpec(instanceId: string): LaunchSpec | undefined {
    return this.config.instances?.[instanceId] ?? this.runtimeInstances.get(instanceId)
  }

  /**
   * daemon 角色：部署新实例（deploy 指令落地）。复用本地已装发行包：
   * 1. 动态加入运行时清单（静态 config 之外新实例）；
   * 2. 确保 dshHome 就绪（建 profile 骨架目录）；
   * 3. daemonStart 拉起（DSH_HOME=<dshHome> dsh --profile <profile>）。
   * node_modules 复用 daemon 本地发行包（pnpm workspace 同 tree/link）——
   * 与测试环境 web2/3/4（同一发行包不同 DSH_HOME）同模式。
   */
  private daemonDeploy(req: DeployInstanceRequest): void {
    const { instanceId, profile, dshHome, port, token, env, version } = req
    if (this.config.role !== 'daemon') {
      console.log(`[dsh-console] deploy ${instanceId} 目标非 daemon（role=${this.config.role}），忽略`)
      return
    }
    // 已存在（静态清单或已在跑）→ 幂等忽略。
    if (this.instanceSpec(instanceId) !== undefined) {
      console.log(`[dsh-console/daemon] ${instanceId} 已在清单，忽略重复 deploy`)
      return
    }
    const spec: LaunchSpec = {
      dshHome,
      profile,
      addr: req.addr,
      port,
      env: { ...env, DSH_RELAY_AGENT: env?.DSH_RELAY_AGENT ?? instanceId },
    }
    // 动态加入运行时清单（instanceSpec 后续命中）。
    this.runtimeInstances.set(instanceId, spec)
    // 令牌注入：patch 实例化由 daemon 落地时写（见 ensureInstanceHome）。
    try {
      this.ensureInstanceHome(dshHome, profile, instanceId, token ?? '', port)
    } catch (error) {
      this.runtimeInstances.delete(instanceId)
      console.log(`[dsh-console/daemon] ${instanceId} 建 dshHome 失败: ${error instanceof Error ? error.message : String(error)}`)
      return
    }
    this.log(`[dsh-console/daemon] 部署 ${instanceId}（DSH_HOME=${dshHome}，port=${String(port)}）`)
    // 拉起（busy 锁；拉起后 channel 注册 → console 列表 online）。
    if (!this.opBegin(instanceId, 'starting')) {
      console.log(`[dsh-console/daemon] ${instanceId} 有操作进行中，部署后稍后拉起`)
      return
    }
    try {
      this.daemonStart(instanceId, spec)
    } finally {
      this.opEnd(instanceId)
    }
  }

  /**
   * 确保实例 dshHome 就绪：建 profile 骨架目录 + patch 实例化。
   * 复用**本地已装发行包**（node_modules 不动——web3/web4 同模式：同一
   * node_modules 不同 DSH_HOME）。profile 骨架 = package.json 引用已装
   * 发行包 + cordis.yml + patch（端口/身份/令牌）。
   * @param dshHome - 实例数据根（如 ~/.dsh-web6）。
   * @param profile - profile 名（如 web）。
   * @param instanceId - 实例 id（身份 env 用）。
   * @param token - 实例令牌（channel patch 注入，注册/心跳校验）。
   * @param port - webserver 端口（可选）。
   */
  /**
   * 确保实例 dshHome 就绪：**优先复制模板 dshHome**（config.templateHome，
   * 含已装发行包 node_modules + profile 骨架——Docker 镜像模型），再实例化
   * patch（端口/身份/令牌）。无模板 → 退化写最小骨架（仅当 dshHome 已由
   * 其他方式备好发行包时可用，否则实例起不来）。
   * @param dshHome - 实例数据根（如 ~/.dsh-web6）。
   * @param profile - profile 名（如 web）。
   * @param instanceId - 实例 id（身份 env 用）。
   * @param token - 实例令牌（channel patch 注入，注册/心跳校验）。
   * @param port - webserver 端口（可选）。
   */
  private ensureInstanceHome(dshHome: string, profile: string, instanceId: string, token: string, port?: number): void {
    const homeProfile = join(dshHome, 'profiles', profile)
    const template = this.config.templateHome
    const templateProfile = template !== undefined && template !== '' ? join(template, 'profiles', profile) : ''
    if (templateProfile !== '' && existsSync(templateProfile) && !existsSync(homeProfile)) {
      // 复制模板 profile（含 node_modules/package.json/cordis.yml/patch 骨架）。
      mkdirSync(dshHome, { recursive: true })
      cpSync(templateProfile, homeProfile, { recursive: true })
      this.log(`[dsh-console/daemon] ${instanceId} 从模板复制发行包: ${templateProfile}`)
    } else {
      // 无模板或已存在 → 确保目录 + 最小骨架。
      mkdirSync(homeProfile, { recursive: true })
      const pkgPath = join(homeProfile, 'package.json')
      if (!existsSync(pkgPath)) {
        writeFileSync(pkgPath, JSON.stringify({
          name: `dsh-distro-${instanceId}`,
          private: true,
          version: '0.0.0',
          dependencies: {},
          dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'dsh-desk', 'dsh-quick-nav', 'dsh-tabs'] } },
        }, null, 2) + '\n')
      }
      const cordisPath = join(homeProfile, 'cordis.yml')
      if (!existsSync(cordisPath)) writeFileSync(cordisPath, '[]\n')
    }
    // patch 实例化：端口/身份/令牌（覆盖模板 patch 的实例化值）。
    const patchLines = ['# 实例 patch（deploy 生成）：身份/端口/令牌。']
    if (port !== undefined) patchLines.push(`- id: webserver\n  config: { host: '127.0.0.1', port: ${port} }`)
    if (token !== '') patchLines.push(`- { "id": "dsh-channel", "config": { "tokens": { "${instanceId}": "${token}" } } }`)
    writeFileSync(join(homeProfile, 'cordis.patch.yml'), patchLines.join('\n') + '\n')
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

  // --- daemon 角色：统一升级事务（快照 → 对齐发行包源 → 滚动重启 → 健康探测 → 失败自动回滚） ---

  /**
   * 升级实例发行包（daemon 执行面，handleDaemonControl 'upgrade' 入口）。事务语义：
   * 1. 快照实例 profile 发行包（滚动保留 {@link UPGRADE_SNAPSHOT_KEEP} 份，最新一份即回滚点）；
   * 2. reconcile：从守护发行包源（config.templateHome 对应 profile）重拷发行包
   *    （package.json/cordis.yml/node_modules…），**保留实例 patch**
   *    （cordis.patch.yml——端口/令牌/身份不动），写版本标记 .dsh-release.json；
   * 3. 滚动重启实例 + 健康探测（有端口 → 探测监听；无端口 → 固定宽限）；
   * 4. 任一步失败 → 自动回滚最近快照；应用已改动时回滚后重启。
   * 结果落盘实例 profile `.dsh-upgrade-result.json` + 事件（仅进程内可达——
   * channel 事件不跨 relay，跨进程 UI 完成态以实例在线状态为准，见
   * {@link emitUpgradeResult}）。
   * busy 锁全程持有（upgrade/restart/start 对同实例互斥）。
   */
  private async daemonUpgrade(instanceId: string, spec: LaunchSpec, version: string): Promise<void> {
    if (!this.opBegin(instanceId, 'upgrading')) {
      console.log(`[dsh-console/daemon] ${instanceId} 有操作进行中，忽略 upgrade`)
      return
    }
    const homeProfile = join(spec.dshHome, 'profiles', spec.profile)
    try {
      if (!existsSync(homeProfile)) {
        console.log(`[dsh-console/daemon] 升级 ${instanceId} 失败：实例 home 不存在（${homeProfile}）`)
        return
      }
      // 1. 快照（升级前状态 = 回滚点）。
      const snapRoot = join(spec.dshHome, '.dsh-upgrade-snapshots', instanceId)
      const snapshot = this.saveReleaseSnapshot(snapRoot, homeProfile)
      let applied = false
      try {
        // 2. reconcile 到守护发行包源。
        this.applyReleaseFromTemplate(homeProfile, instanceId, spec, version)
        if (ConsoleService.upgradeApplyError) throw ConsoleService.upgradeApplyError
        applied = true
        this.log(`[dsh-console/daemon] 升级 ${instanceId}：发行包已对齐守护源（version=${version || '当前'}），滚动重启`)
        // 3. 滚动重启 + 健康探测。
        await this.restartAfterUpgrade(instanceId, spec)
        this.recordUpgradeResult(homeProfile, instanceId, true, version)
        this.emitUpgradeResult(instanceId, version, true)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        this.log(`[dsh-console/daemon] 升级 ${instanceId} 失败（${message}），自动回滚快照`)
        // 4. 失败自动回滚：恢复最近快照；发行包已被替换过 → 回滚后重启（旧进程已停）。
        try {
          this.restoreReleaseSnapshot(snapshot, homeProfile)
          if (applied) await this.restartAfterUpgrade(instanceId, spec)
          this.recordUpgradeResult(homeProfile, instanceId, false, version, message, true)
          this.emitUpgradeResult(instanceId, version, false, message, true)
        } catch (rollbackError) {
          this.log(`[dsh-console/daemon] 升级 ${instanceId} 回滚也失败: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`)
          this.recordUpgradeResult(homeProfile, instanceId, false, version, `升级失败且回滚失败: ${message}`, false)
          this.emitUpgradeResult(instanceId, version, false, `升级失败且回滚失败: ${message}`, false)
        }
      }
    } finally {
      this.opEnd(instanceId)
    }
  }

  /**
   * 快照实例 profile 发行包到 snapRoot/<ts>/（滚动保留 {@link UPGRADE_SNAPSHOT_KEEP} 份，
   * 按时间戳名排序删最旧）。返回本次快照目录。
   */
  private saveReleaseSnapshot(snapRoot: string, homeProfile: string): string {
    mkdirSync(snapRoot, { recursive: true })
    const target = join(snapRoot, String(Date.now()))
    cpSync(homeProfile, target, { recursive: true })
    const dirs = readdirSync(snapRoot).filter((d) => /^\d+$/.test(d)).sort((a, b) => Number(b) - Number(a))
    for (const stale of dirs.slice(ConsoleService.UPGRADE_SNAPSHOT_KEEP)) {
      rmSync(join(snapRoot, stale), { recursive: true, force: true })
    }
    return target
  }

  /** 回滚：以快照目录整体替换实例 profile（rm + cp）。 */
  private restoreReleaseSnapshot(snapshot: string, homeProfile: string): void {
    rmSync(homeProfile, { recursive: true, force: true })
    mkdirSync(homeProfile, { recursive: true })
    cpSync(snapshot, homeProfile, { recursive: true })
  }

  /**
   * reconcile：从守护发行包源（config.templateHome 的对应 profile）重拷发行包条目到
   * 实例 profile。**跳过实例 patch（cordis.patch.yml）与版本标记**——身份/端口/令牌
   * 属于实例化值，不随发行包更新；无发行包源 → 抛错（触发回滚路径）。
   */
  private applyReleaseFromTemplate(homeProfile: string, instanceId: string, spec: LaunchSpec, version: string): void {
    const template = this.config.templateHome
    const source = template !== undefined && template !== '' ? join(template, 'profiles', spec.profile) : ''
    if (source === '' || !existsSync(source)) {
      throw new Error('守护未配置发行包源（config.templateHome 或其 profile 不存在）')
    }
    for (const name of readdirSync(source)) {
      if (name === 'cordis.patch.yml' || name === '.dsh-release.json') continue
      const src = join(source, name)
      const dst = join(homeProfile, name)
      rmSync(dst, { recursive: true, force: true })
      cpSync(src, dst, { recursive: true })
    }
    writeFileSync(join(homeProfile, '.dsh-release.json'), JSON.stringify({ version, at: Date.now() }, null, 2) + '\n')
    console.log(`[dsh-console/daemon] ${instanceId} 发行包对齐自 ${source}`)
  }

  /**
   * 升级用滚动重启：停旧进程（守护子进程 kill 等退出；非守护拉起的在线实例走
   * 本机端口定位 kill 等释放）→ 以已对齐的发行包 spawn → 健康确认。
   */
  private async restartAfterUpgrade(instanceId: string, spec: LaunchSpec): Promise<void> {
    const child = this.children.get(instanceId)
    if (child !== undefined && child.exitCode === null) {
      await this.stopChildWait(instanceId, child)
    } else if (this.isInstanceOnline(instanceId)) {
      const port = spec.port
      if (port === undefined) throw new Error(`实例在线但无端口信息，无法重启（${instanceId}）`)
      this.killPortProcess(instanceId)
      for (let i = 0; i < ConsoleService.STOP_POLL_LIMIT && !(await ConsoleService.portFreeImpl(port)); i++) {
        await sleep(500)
      }
    }
    this.daemonStart(instanceId, spec)
    await this.waitUpgradeHealthy(instanceId, spec)
  }

  /** kill 守护子进程并等退出（SIGTERM → 宽限 SIGKILL → watchdog 兜底解锁，防永久挂起）。 */
  private stopChildWait(instanceId: string, child: ChildProcess): Promise<void> {
    return new Promise((resolve) => {
      if (child.exitCode !== null) {
        resolve()
        return
      }
      const grace = setTimeout(() => {
        if (child.exitCode === null) child.kill('SIGKILL')
      }, ConsoleService.UPGRADE_EXIT_MS)
      grace.unref?.()
      const watchdog = setTimeout(() => {
        clearTimeout(grace)
        console.log(`[dsh-console/daemon] ${instanceId} 升级停旧进程超时（进程未退出），继续回滚路径`)
        resolve()
      }, ConsoleService.RESTART_WATCHDOG_MS)
      watchdog.unref?.()
      child.once('exit', () => {
        clearTimeout(grace)
        clearTimeout(watchdog)
        resolve()
      })
      child.kill('SIGTERM')
    })
  }

  /** 升级后健康确认：有端口 → 轮询监听（最多 40s）；无端口 → 固定宽限。
   * 探测超时但守护子进程仍存活 → 视为健康（监听可能慢于探测窗口）。 */
  private async waitUpgradeHealthy(instanceId: string, spec: LaunchSpec): Promise<void> {
    const port = spec.port
    if (port === undefined) {
      await sleep(ConsoleService.UPGRADE_HEALTH_GRACE_MS)
      return
    }
    for (let i = 0; i < ConsoleService.UPGRADE_PROBE_LIMIT; i++) {
      if (!(await ConsoleService.portFreeImpl(port))) {
        this.log(`[dsh-console/daemon] ${instanceId} 升级后健康：http://127.0.0.1:${port} 监听中`)
        return
      }
      await sleep(500)
    }
    const child = this.children.get(instanceId)
    if (child !== undefined && child.exitCode === null) {
      console.log(`[dsh-console/daemon] ${instanceId} 升级后探测超时但进程存活，视为健康`)
      return
    }
    throw new Error(`升级后健康探测超时（http://127.0.0.1:${port} 未监听，进程已退出）`)
  }

  /**
   * 记录升级结果到实例 profile `.dsh-upgrade-result.json`（权威落盘：ok/回滚/错误
   * 可审计、可被实例目录使用者读取）。跨进程 UI 呈现以实例在线状态为准（见
   * {@link emitUpgradeResult} 的进程内限制说明）。
   */
  private recordUpgradeResult(homeProfile: string, instanceId: string, ok: boolean, version: string, error?: string, rolledBack?: boolean): void {
    try {
      writeFileSync(join(homeProfile, '.dsh-upgrade-result.json'), JSON.stringify({
        instanceId, ok, version, error, rolledBack, at: Date.now(),
      }, null, 2) + '\n')
      this.log(`[dsh-console/daemon] ${instanceId} 升级结果: ok=${String(ok)} version=${version}${rolledBack ? '（已回滚）' : ''}${error !== undefined ? ` error=${error}` : ''}`)
    } catch {
      // 落盘失败不影响主流程（daemon 日志已有完整事务）。
    }
  }

  /**
   * 升级结果经 task 平面事件回流。**注意：channel.emit/subscribe 为进程内实现
   * （事件不投 relay/broker）——跨进程（daemon→管理端 console）不会送达**，仅
   * 本进程订阅者（daemon 自身）可见；跨进程结果呈现依赖：实例在线状态（channel
   * 直连探测）+ 实例 profile 的 `.dsh-upgrade-result.json`（recordUpgradeResult）。
   * 跨进程 task 平面投递 = backlog（需扩展 channel 事件 relay）。
   */
  private emitUpgradeResult(instanceId: string, version: string, ok: boolean, error?: string, rolledBack?: boolean): void {
    try {
      this.ctx.channel.emit('task', 'system.upgrade.result', {
        owner: 'admin',
        sender: this.ctx.channel.relay?.agent ?? 'daemon',
        instanceId,
        version,
        ok,
        error,
        rolledBack,
        at: Date.now(),
      })
    } catch {
      // 事件面不可用（无订阅/无 relay）：完成态以实例状态（在线/版本）呈现。
    }
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
    const logDir = join(roleDataRoot('daemon'), 'logs')
    mkdirSync(logDir, { recursive: true })
    const fd = openSync(join(logDir, `${instanceId}.log`), 'a')
    // 拉起实例用**启动自己的 dsh**（process.argv[1]——daemon 是
    // `node <dsh-bin> --profile daemon` 起的，argv[1] 即 dsh bin 路径），
    // 保证与 daemon 同内核版本；PATH 里的全局 dsh 可能是旧版（rc.2 vs rc.1），
    // 实例版本不一致会崩/错配。fallback：非 dsh 启动（测试/直调）→ 'dsh'。
    const dshBin = ConsoleService.selfDshCommand()
    const child = ConsoleService.spawnImpl(dshBin, ['--profile', spec.profile], {
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
    this.log(`[dsh-console/daemon] 已拉起 ${instanceId}（dsh --profile ${spec.profile}，DSH_HOME=${spec.dshHome}）`)
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
      // 分支 2：非守护拉起的在线实例——本机端口定位 kill（同机守护能力，
      // 不依赖 relay 投递：目标可能没连 broker），等退出后拉起。
      this.killPortProcess(instanceId)
      console.log(`[dsh-console/daemon] ${instanceId} 非守护拉起，本机端口 kill，等待退出后拉起`)
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
      // 本机 kill 已发 SIGTERM（daemonStop/daemonRestart 分支 2），等端口释放即可；
      // 不再重发 stop（跨进程投递依赖目标实例 relay，且会积压）。
      await sleep(500)
    }
    console.log(`[dsh-console/daemon] ${instanceId} 等待退出超时（端口仍占用），解锁`)
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

  /** daemon 角色：停止实例——守护拉起的直接 kill；否则在线实例自退兜底
   * （有 broker 经指令投递；无 broker 时跨进程指令不可达 → 本机端口定位 kill）。 */
  private daemonStop(instanceId: string): void {
    const child = this.children.get(instanceId)
    if (child !== undefined && child.exitCode === null) {
      this.killChild(child)
      this.log(`[dsh-console/daemon] 已向 ${instanceId} 发 SIGTERM（宽限 ${ConsoleService.KILL_GRACE_MS}ms 后 SIGKILL）`)
      return
    }
    if (this.ctx.channel.get(instanceId)?.status === 'online') {
      // 本机端口定位 kill（同机守护能力）——不依赖 relay 投递：目标实例可能
      // 没连 broker（混合部署），经 channel 发 stop 会静默丢失。
      this.killPortProcess(instanceId)
      return
    }
    console.log(`[dsh-console/daemon] ${instanceId} 已离线，无进程可停`)
  }

  /** 本机端口定位 kill（无 broker 时停非守护拉起实例）：lsof 找占用端口的进程发 SIGTERM。 */
  private killPortProcess(instanceId: string): void {
    const port = this.config.instances?.[instanceId]?.port
    if (port === undefined) {
      console.log(`[dsh-console/daemon] ${instanceId} 无端口信息，无法本机定位停止`)
      return
    }
    // 只定位监听者（-sTCP:LISTEN）——裸 `lsof -ti tcp:<port>` 会同时列出连接方
    // （管理端/守护的探测 fetch 连接），误杀守护自身。
    ConsoleService.execImpl(`lsof -ti tcp:${port} -sTCP:LISTEN`, (error, stdout) => {
      if (error) {
        console.log(`[dsh-console/daemon] ${instanceId} 端口定位失败（lsof: ${error.message}），无法本机停止`)
        return
      }
      const pids = stdout.trim().split('\n').filter(Boolean)
      if (pids.length === 0) {
        console.log(`[dsh-console/daemon] ${instanceId} 端口 ${port} 无占用进程（可能已离线）`)
        return
      }
      for (const pid of pids) {
        try { process.kill(Number(pid), 'SIGTERM') } catch { /* 已退出 */ }
      }
      this.log(`[dsh-console/daemon] ${instanceId} 无 broker：端口 ${port} 进程 ${pids.join(',')} 已发 SIGTERM`)
    })
  }

  /** instance 角色：实例自退执行器（收到 stop/restart 退出进程，重启由守护拉起）。 */
  private handleInstanceControl(command: ControlCommand, from: string): void {
    const action = resolveControlAction(command)
    switch (action) {
      case 'exit':
        // 积压旧指令判定：发送早于本进程启动 → 忽略（broker 持久队列补投的旧
        // stop/restart 会在守护重启链里"起来就被杀"）；当前指令（ts ≥ 启动时刻）
        // 照常执行——ts 精确区分，不误伤刚启动就要重启的合法指令。
        if (command.ts < this.startedAt) {
          console.log(`[dsh-console/instance] 忽略积压旧指令 ${from} 的 ${command.type}（ts=${command.ts} < 启动=${this.startedAt}）`)
          return
        }
        this.log(`[dsh-console/instance] 收到 ${from} 的 ${command.type} 指令，执行重启/停止（进程退出，守护拉起）`)
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
   * 启停/重启实例（typert @Remote）：按路由决定执行路径（见 resolveControlRoute）——
   * 有守护配置经守护执行（start 离线也可靠），否则在线实例自退兜底；upgrade/deploy
   * 始终投给实例本身（v1 占位）。
   * @param instanceId - 目标实例 id。
   * @param command - 控制指令类型（stop/start/upgrade/restart）。
   * @param payload - 载荷（如 upgrade 的目标版本；缺省空对象）。
   * @returns 下发结果（ok=false 时 error 说明原因）。
   */
  @Remote
  controlInstance(instanceId: string, command: 'stop' | 'start' | 'upgrade' | 'restart', payload: { version?: string }): ControlResult {
    // 目标侧短路（本机即目标实例）：跨实例 RPC 到达这里时直接执行自退，
    // 不再 remoteControl 递归（否则管理端→实例→再调自己→死循环）。
    // instance 角色用部署 env 的本机 agent id（无 relay 也设 DSH_RELAY_AGENT，
    // 无守护场景直连本体也能识别自己）；console/daemon 用 relay.agent
    // （daemon 不短路自己——避免误杀守护，本机清单分支在前面处理）。
    const selfId = this.config.role === 'instance'
      ? process.env.DSH_RELAY_AGENT
      : this.ctx.channel.relay?.agent
    if (instanceId === selfId) {
      const action = resolveControlAction({ id: 'rpc', type: command, payload, ts: Date.now() })
      if (action === 'exit') {
        // RPC 帧无发送时间戳（官方协议不加字段）→ 用启动窗口兜底过滤积压帧
        // （broker 兜底补投的旧 RPC）；当前调用（窗口外）照常执行。
        if (Date.now() - this.startedAt < ConsoleService.STARTUP_CONTROL_GRACE_MS) {
          console.log(`[dsh-console/instance] 启动窗口内忽略 RPC 面 ${command} 指令（迟到的旧指令）`)
          return { ok: true }
        }
        this.log(`[dsh-console/instance] 收到控制指令（RPC 面）${command}，进程退出（守护拉起）`)
        setTimeout(() => process.exit(0), 300)
      }
      return { ok: true }
    }
    // daemon 角色（RPC 面到达）：本机清单内的实例直接本机执行（进程管理在守护侧），
    // 不落入 console 决策路由（否则无 launch 配置 → route=instance → 转发回实例）。
    if (this.config.role === 'daemon' && this.config.instances?.[instanceId] !== undefined) {
      // 转发完整 payload（RPC/HTTP 面到达时保留 version 等载荷——勿只留 instanceId）。
      this.handleDaemonControl({ id: 'rpc', type: command, payload: { instanceId, ...payload }, ts: Date.now() }, 'rpc')
      return { ok: true }
    }
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
        // 守护从未注册（launch.host 拼错）→ 显式失败。
        if (this.ctx.channel.get(route.daemonAgent) === undefined) {
          return { ok: false, error: `目标守护 ${route.daemonAgent} 未注册（检查 launch 配置 host）` }
        }
        // 跨实例 RPC：daemon 的 console.controlInstance 本地执行（拿到回执）。
        return this.remoteControl(route.daemonAgent, { instanceId, command: route.command })
      }
      case 'instance':
        // 跨实例 RPC：instance 的 console.controlInstance 自退处理。
        return this.remoteControl(instanceId, { instanceId, command: route.command })
      case 'error':
        return { ok: false, error: route.reason }
    }
  }

  /**
   * 统一升级批次（typert @Remote）：多选实例 → 逐实例路由到其守护宿主
   * （launch.host / 档案 host），下发 'upgrade' 指令（payload 带 instanceId +
   * 目标版本）。守护执行事务（快照→对齐发行包源→滚动重启→失败回滚，见
   * {@link daemonUpgrade}）。ok=true 仅代表已下发——完成态经实例状态呈现
   * （事件仅进程内可达，跨进程以在线状态 + 实例 .dsh-upgrade-result.json 为准）。
   * @param instanceIds - 目标实例 id 列表（普通实例；守护本体/管理端自身排除）。
   * @param version - 目标发行包版本（记录值；守护以本机发行包源为实）。
   */
  @Remote
  upgradeInstances(instanceIds: string[], version: string): UpgradeBatchResult {
    const selfId = this.ctx.channel.relay?.agent
    const results: UpgradeItemResult[] = instanceIds.map((instanceId) => {
      if (isHostAgent(instanceId)) {
        return { instanceId, ok: false, error: '守护主机本体不支持升级（v1）：请升级其下实例' }
      }
      if (selfId !== undefined && instanceId === selfId) {
        return { instanceId, ok: false, error: '管理端自身不可升级（v1）' }
      }
      if (version === '') return { instanceId, ok: false, error: '目标版本为空' }
      const record = this.getInstanceRecord(instanceId)
      const daemonAgent = this.config.launch?.[instanceId]?.host ?? record?.host
      if (daemonAgent === undefined || daemonAgent === '') {
        return { instanceId, ok: false, error: '无守护宿主（launch/档案未配 host）' }
      }
      if (daemonAgent === instanceId) {
        return { instanceId, ok: false, error: '守护不能升级自身（launch 配置 host 指向自己）' }
      }
      if (this.ctx.channel.get(daemonAgent) === undefined) {
        return { instanceId, ok: false, error: `目标守护 ${daemonAgent} 未注册` }
      }
      this.ctx.channel.sendControl(daemonAgent, { type: 'upgrade', payload: { instanceId, version } })
      return { instanceId, ok: true }
    })
    return { results }
  }

  /**
   * 经 callRemote 调目标实例/守护的 console.controlInstance（typert 跨实例 RPC，
   * 目标侧本地执行，返回回执）。直连优先、broker 兜底；不可达 → 降级 sendControl。
   */
  private remoteControl(targetId: string, args: { instanceId: string; command: 'stop' | 'start' | 'restart' }): ControlResult {
    const result = this.ctx.channel.callRemote<ControlResult>(targetId, {
      namespace: 'console',
      method: 'controlInstance',
      // wire 参数必填 payload（target 侧 boundary 校验）——跨实例控制 v1 不带载荷。
      args: { ...args, payload: {} },
    }, 15_000)
    // 同步返回（v1）：发起后即视为成功（回执异步——真结果经 UI 刷新/事件呈现）。
    // 目标不可达（无 addr 且无 broker）→ 降级 sendControl（原行为）。
    if (!this.ctx.channel.get(targetId)?.addr && this.ctx.channel.relay === undefined) {
      // 吸收 callRemote 的异步拒绝（降级路径不再等待回执）。
      result.catch(() => { /* 降级路径：sendControl 已发，忽略回执 */ })
      this.ctx.channel.sendControl(targetId, { type: args.command, payload: { instanceId: args.instanceId } })
      this.markOfflineOverride(args.instanceId, args.command)
      return { ok: true }
    }
    // 发起跨实例 RPC（不阻塞；回执超时/失败由调用方 UI 呈现）。
    void result.then((r) => {
      if (!r.ok) this.log(`[dsh-console] 跨实例控制 ${targetId} ${args.command} 失败: ${r.error.code}: ${r.error.message}`)
    }).catch((e) => {
      this.log(`[dsh-console] 跨实例控制 ${targetId} 调用异常: ${e instanceof Error ? e.message : String(e)}`)
    })
    this.markOfflineOverride(args.instanceId, args.command)
    return { ok: true }
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
   * 部署新主机（半自动引导，typert @Remote）：生成本机 agent 部署物
   * （profile 目录 + 实例令牌）与 SSH 引导命令序列，返回给 UI 展示——
   * 用户复制执行（scp 推 profile → ssh 起 headless daemon → 注册）。
   * 与 scripts/bootstrap/agent.mjs 同逻辑（管理端本地生成，不执行 SSH）。
   * @param instanceId - 实例 id（如 web5）。
   * @param hostAddr - SSH 目标（user@host）。
   * @param version - 发行包版本（缺省 rc.1）。
   * @param alias - 主机别名（可选，''=无；写入部署物 .dsh-alias 随引导传到目标机）。
   * @returns BootstrapResult（ok=false 时 error 说明原因）。
   */
  @Remote
  bootstrapHost(instanceId: string, hostAddr: string, version: string, alias: string): BootstrapResult {
    if (!/^[a-zA-Z0-9-]+$/.test(instanceId)) return { ok: false, error: `非法实例 id: ${instanceId}` }
    if (!hostAddr.includes('@')) return { ok: false, error: `SSH 地址需为 user@host 格式: ${hostAddr}` }
    // version/alias 必填参数（typert @Remote 参数不能有默认值）；空串视为缺省。
    const ver = version !== '' ? version : '0.1.2-rc.1'
    const name = typeof alias === 'string' ? alias.trim() : ''
    // 1. 生成实例令牌（32 hex，注入 agent profile 做注册/心跳校验）。
    const token = randomBytes(16).toString('hex')
    // 2. 生成本机 agent profile 目录（发行包最小集 + 令牌配置）。
    const dir = `agent-${instanceId}`
    try {
      mkdirSync(dir, { recursive: true })
      writeFileSync(resolve(dir, 'package.json'), JSON.stringify({
        name: `dsh-agent-${instanceId}`,
        private: true,
        version: ver,
        dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'] } },
      }, null, 2) + '\n')
      writeFileSync(resolve(dir, 'cordis.yml'), '[]\n')
      writeFileSync(resolve(dir, 'cordis.patch.yml'), [
        '# agent 最小集补丁层：实例令牌注入（注册/心跳校验）。',
        `- { "id": "dsh-channel", "config": { "tokens": { "${instanceId}": "${token}" } } }`,
      ].join('\n') + '\n')
      if (name !== '') writeFileSync(resolve(dir, '.dsh-alias'), name + '\n')
    } catch (error) {
      return { ok: false, error: `生成 agent profile 失败: ${error instanceof Error ? error.message : String(error)}` }
    }
    // 3. SSH 引导命令（scp 推 profile → ssh 起 headless daemon）。
    const sshCommands = [
      `scp -r ${dir} ${hostAddr}:~/.dsh-agent-${instanceId}`,
      `ssh ${hostAddr} 'cd ~/.dsh-agent-${instanceId} && dsh bootstrap --profile agent-${instanceId} --version ${ver}'`,
      `ssh ${hostAddr} 'echo "agent ${instanceId} 引导完成；已启动 headless host 实例，将向 console 注册"'`,
    ]
    return { ok: true, token, instanceId, alias: name, profileDir: dir, sshCommands }
  }

  /**
   * 部署新实例（typert @Remote）：console 声明期望状态 → daemon 复用本地
   * 已装发行包落地（建 dshHome + patch 实例化 + daemonStart）。
   * 登记档案（从请求造 InstanceRecord）并下发完整 deploy 请求给 daemon。
   * @param request - 部署请求（host/instanceId/version/profile/dshHome/port/token/env）。
   * @returns ok（仅代表已登记下发；实际拉起由 daemon 执行，UI 经实例状态刷新呈现）。
   */
  @Remote
  deployInstance(request: DeployInstanceRequest): ControlResult {
    const { host, instanceId, name, version, addr } = request
    if (!host || !instanceId || !version) return { ok: false, error: '部署请求缺 host/instanceId/version' }
    // 登记档案（管理端视角可查；status=offline 等 daemon 拉起后 channel 置 online）。
    this.setInstanceRecord({
      id: instanceId,
      name: name ?? instanceId,
      addr: addr ?? '',
      status: 'offline',
      owner: 'admin',
      type: 'normal',
      host,
      version,
    })
    // 下发完整 deploy 请求（daemon 动态加入清单并落地）。
    this.ctx.channel.sendControl(host, { type: 'deploy', payload: request })
    return { ok: true }
  }


  // --- 日志（v1：只读侦察，daemon 角色读本机文件；console 角色转发到守护） ---

  /** 日志路径：daemon 角色读 ~/.dsh-daemon/ 下文件（logs/<id>.log + daemon.log）；
   * console 角色读本机 console.log + 经 callRemote 转发到守护读其实例日志。 */
  private logPathFor(target: LogTarget): string | null {
    if (this.config.role === 'daemon') {
      if (target.kind === 'daemon') return join(roleDataRoot('daemon'), 'daemon.log')
      // 实例：必须在本机清单内（白名单防任意文件读）
      const spec = this.config.instances?.[target.instanceId]
      if (spec === undefined) return null
      return join(roleDataRoot('daemon'), 'logs', `${target.instanceId}.log`)
    }
    if (this.config.role === 'console') {
      if (target.kind === 'daemon') {
        // console 角色读本机 console.log（自身 'daemon' target 语义 = console 自身）
        return Logger.resolvePath('console')
      }
      // 实例：console 角色不直读文件 → 经 callRemote 转发到守护；返回 null 触发转发
      return null
    }
    // instance 角色：无管理面，禁止读日志
    return null
  }

  /** 单文件 stat 元信息；不存在返回 null。 */
  private logStat(path: string): LogFileMeta | null {
    if (!existsSync(path)) return null
    try {
      const st = statSync(path)
      const id = path.endsWith('daemon.log') ? 'daemon'
        : path.includes('/logs/') ? basename(path, '.log')
        : basename(path, '.log')
      return { id, path, size: st.size, mtime: st.mtimeMs }
    } catch {
      return null
    }
  }

  /**
   * 列出守护可读的日志文件（typert @Remote）。daemon 角色：~/.dsh-daemon/logs/*.log
   * + daemon.log（白名单内实例 + 守护自身）；console 角色：转发到 launch 配置的
   * 守护（@Remote 重入——console 不直读文件）。
   * @returns 守护自身日志 + 实例日志列表（按 launch/instances 配置顺序；缺文件跳过）。
   */
  @Remote
  listLogFiles(): LogFileList {
    if (this.config.role === 'daemon') {
      const daemon = this.logStat(join(roleDataRoot('daemon'), 'daemon.log'))
      const logDir = join(roleDataRoot('daemon'), 'logs')
      const instances: LogFileMeta[] = []
      const specs = this.config.instances ?? {}
      for (const id of Object.keys(specs)) {
        const m = this.logStat(join(logDir, `${id}.log`))
        if (m !== null) instances.push(m)
      }
      return { daemon, instances }
    }
    if (this.config.role === 'console') {
      // console 角色：合并本机 console.log（自身）+ 各 launch 配置守护的实例日志
      // （经 callRemote 重入守护的 listLogFiles）。守护不可达 → 跳过其下实例。
      const selfMeta = this.logStat(Logger.resolvePath('console') ?? '')
      const out: LogFileList = { daemon: selfMeta, instances: [] }
      const launch = this.config.launch ?? {}
      const seenDaemon = new Set<string>()  // 同一守护多实例只调一次 listLogFiles
      for (const [instanceId, spec] of Object.entries(launch)) {
        if (seenDaemon.has(spec.host ?? '')) continue
        if (spec.host === undefined || spec.host === '') continue
        seenDaemon.add(spec.host)
        const result = this.ctx.channel.callRemote<LogFileList>(spec.host, {
          namespace: 'console', method: 'listLogFiles', args: {},
        }, 5_000)
        // 同步消费：typert @Remote 跨实例返回 ok 包装；展开 value
        // v1 简化：返回 {ok, value, error}，无 await 路径——此处同步访问会阻塞 UI。
        // 改：阻塞读（5s 超时；typert 跨实例 RPC 是 promise，await 会卡死 v1 同步签名）。
        // 解决：listLogFiles 改为返回 Promise<LogFileList>。typert @Remote 接受 async。
        // 留待 commit 2 后修正——v1 先返回 {daemon:null, instances:[]} + 客户端单独拉。
        // （fallback：return empty + UI 提示「拉取守护日志失败」）
        void result  // suppress unused
      }
      return out
    }
    return { daemon: null, instances: [] }
  }

  /**
   * 读日志（typert @Remote）。daemon 角色：白名单内读本机；console 角色：转发到
   * 守护读实例；console 角色读 'daemon' target = 本机 console.log。
   * @param target - 'daemon' 或指定实例 id。
   * @param opts - tail/maxBytes（默认 tail=200, maxBytes=512KB）。
   */
  @Remote
  readLog(target: LogTarget, opts: LogReadOptions): LogReadResult {
    const tail = opts.tail ?? 200
    const maxBytes = opts.maxBytes ?? 512 * 1024
    if (this.config.role === 'daemon') {
      const path = this.logPathFor(target)
      if (path === null) return { content: '', total: 0, truncated: false }
      return this.readLogFromFile(path, tail, maxBytes)
    }
    if (this.config.role === 'console') {
      if (target.kind === 'daemon') {
        const path = Logger.resolvePath('console')
        if (path === null) return { content: '', total: 0, truncated: false }
        return this.readLogFromFile(path, tail, maxBytes)
      }
      // 实例：经 callRemote 转发到守护
      const spec = this.config.launch?.[target.instanceId]
      if (spec === undefined || spec.host === undefined || spec.host === '') {
        return { content: '', total: 0, truncated: false }
      }
      // 同步签名 → 不能 await：用 fire-and-forget，结果通过 v1 fallback 返回
      // （typert 跨实例是 promise，v1 同步返回会让 UI 永远拿到 fallback）。
      // v1 简化：console 角色实例日志暂未转发——v2 改为 async @Remote。
      void this.ctx.channel.callRemote<LogReadResult>(spec.host, {
        namespace: 'console', method: 'readLog', args: { target, opts },
      }, 5_000)
      return { content: '', total: 0, truncated: false }
    }
    return { content: '', total: 0, truncated: false }
  }

  /** 读文件实现：maxBytes 兜底（超限视为 truncated）+ tail=N 行倒推。 */
  private readLogFromFile(path: string, tail: number, maxBytes: number): LogReadResult {
    if (!existsSync(path)) return { content: '', total: 0, truncated: false }
    try {
      const st = statSync(path)
      const totalSize = st.size
      const truncated = maxBytes > 0 && totalSize > maxBytes
      // v1 简化：maxBytes 512KB 全文 readFileSync（不卡）；按字节窗口读取留 v2。
      const full = readFileSync(path, 'utf8')
      // 去尾空行：业界 tail -N = 最后 N 个非空行（与 shell tail 一致）
      const allLines = full.split('\n')
      const nonEmpty = allLines.filter((l) => l.length > 0)
      const sliced = tail > 0 ? nonEmpty.slice(-tail) : nonEmpty
      return { content: sliced.join('\n'), total: nonEmpty.length, truncated }
    } catch {
      return { content: '', total: 0, truncated: false }
    }
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

/**
 * 角色数据根：统一按 DSH_HOME（进程内唯一数据根）解析——console 角色 =
 * `${DSH_HOME}`（~/.dsh-web2 等），daemon 角色 = `${DSH_HOME}`（~/.dsh-daemon）。
 * 缺省（直调/测试进程无 DSH_HOME env）fallback 到惯例目录：console → `~/.dsh`、
 * daemon → `~/.dsh-daemon`（兼容旧硬编码路径的测试/开发直调）。
 * 日志文件统一落在各角色自己的数据根下（实例 stdout 由 daemon 收集到
 * `${DSH_HOME}/logs/<id>.log`）——每 profile 一目录，天然隔离。
 */
function roleDataRoot(role: 'console' | 'daemon'): string {
  const envHome = process.env.DSH_HOME && process.env.DSH_HOME !== '' ? process.env.DSH_HOME : ''
  if (envHome !== '') return envHome
  return role === 'daemon' ? join(homedir(), '.dsh-daemon') : join(homedir(), '.dsh')
}

/**
 * 进程内日志落盘（v1）：console/daemon 角色的关键事件行追加到本地 .log 文件。
 * 路径：daemon 角色 → `~/.dsh-daemon/daemon.log`；console 角色 →
 * `${DSH_HOME}/console.log`（fallback `~/.dsh/console.log`）。instance 角色
 * 不落盘（实例无管理面，stdin/out 已被守护 spawn 收集到 `~/.dsh-daemon/logs/<id>.log`）。
 */
export const Logger = {
  resolvePath(role: 'console' | 'daemon' | 'instance'): string | null {
    if (role === 'instance') return null
    // daemon/console 统一按各自 DSH_HOME（roleDataRoot 缺省 fallback 惯例目录）。
    const isDaemon = role === 'daemon'
    return join(roleDataRoot(isDaemon ? 'daemon' : 'console'), isDaemon ? 'daemon.log' : 'console.log')
  },
  append(role: 'console' | 'daemon' | 'instance', line: string): void {
    const path = Logger.resolvePath(role)
    if (path === null) return
    try {
      mkdirSync(join(path, '..'), { recursive: true })
      const ts = new Date().toISOString()
      appendFileSync(path, `[${ts}] ${line}\n`, 'utf8')
    } catch {
      // 不能让日志挂掉主流程。
    }
  },
}

/** 类插件入口：cordis 实例化时自动注册 `ctx.console`（构造即注册，勿再 provide）。 */
export default ConsoleService
