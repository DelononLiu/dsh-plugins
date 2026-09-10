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
import { isHostAgent, signRequest, type ControlCommand, type ControlOutcome, type InstanceIdentity, type WorkerInstanceReport, type WorkerReport } from 'dsh-channel'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { randomUUID, randomBytes } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { createServer } from 'node:http'
import { spawn, exec, type ChildProcess } from 'node:child_process'
import { appendFileSync, cpSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, resolve } from 'node:path'
import { join } from 'node:path'
import { connect } from 'node:net'

// Remote 边界类型从 ./types 子路径导出（typert generator 规则）——唯一来源，
// index 本地引用经 import type，re-export 供外部消费。
import type {
  BootstrapResult, ControlResult, ConsoleInstanceView, DeployInstanceRequest, HostRecord, InstanceRecord, InstanceType,
  LogFileList, LogFileMeta, LogLevel, LogReadOptions, LogReadResult, LogRecord, LogTarget,
  UpgradeBatchResult, UpgradeItemResult, UpgradeStatus, UpgradeStep,
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
   * 只读处经 {@link instanceSpec} 查询（静态 + 动态合并）。deploy 出来的实例
   * 落盘 `<daemon root>/instances.json`，daemon 重启时经 {@link loadDeployedInstances}
   * 恢复；启动对账结果见 {@link reconcileResult}。
   */
  private readonly runtimeInstances = new Map<string, LaunchSpec>()
  /** daemon 角色：启动对账结果（{@link reconcileInstances} 写入）。 */
  private reconcileReport: Array<{ id: string; state: 'online' | 'offline' | 'orphan'; detail: string }> = []
  /** per-instance 操作锁（start/restart 进行中；防积压指令交错 spawn）。 */
  private readonly ops = new Map<string, InstanceOp>()
  /** UI 离线覆盖（stop/restart 发出后即时显示 offline，绕开 broker TTL 滞后）。 */
  private readonly offlineOverride = new Map<string, OfflineOverride>()
  /** 实例进程启动时刻（启动窗口过滤用）。 */
  private readonly startedAt = Date.now()

  /**
   * 关键事件落盘：terminal console.log + 进程内日志双写。
   * - console.log(msg)：终端可见（daemon/instance 自身进程输出）；
   * - Logger.record(role, …)：结构化 JSONL 落盘（ts/role/level/scope/msg，可搜索/过滤）；
   * - Logger.append(role, msg)：保留纯文本 `[ISO] msg` 镜像（老 .log 读取器兼容）。
   * 落盘路径由 {@link Logger.resolvePath} 按 role 决定（daemon → daemon.log、
   * console → console.log；instance 不落盘——stdin/out 已被守护收集）。
   * level 缺省按字面标记表 {@link deriveLogLevel} 推导（本库消息为固定中文串）。
   * @param msg - 日志正文。
   * @param extra - 结构化附加字段（level 覆盖推导；scope 标记模块/域，缺省 'console'）。
   */
  private log(msg: string, extra?: { level?: LogLevel; scope?: string; instanceId?: string }): void {
    console.log(msg)
    const role = this.config.role ?? 'console'
    const level = extra?.level ?? deriveLogLevel(msg)
    const scope = extra?.scope ?? 'console'
    Logger.record(role, {
      level,
      scope,
      msg,
      ...(extra?.instanceId !== undefined ? { instanceId: extra.instanceId } : {}),
    })
    // 纯文本镜像：JSONL 语义与历史 .log 读取/外部工具双轨共存（不静默丢 append）。
    Logger.append(role, msg)
  }

  constructor(ctx: Context, private readonly config: Config) {
    super(ctx, 'console')
    // 管理端即实例发现权威源：launch 配置（实例矩阵）逐条注册进 channel；
    // daemon 角色把 instances 清单（本机管理实例）同样注册——否则 daemon 的
    // channel 实例表为空（去 broker 发现后无 peers），在线判定恒 false，
    // restart 走"离线直接拉起"不杀旧进程 → 端口冲突。
    // 有 addr → callRemote 直连优先；无 addr（守护/NAT 后）→ 注册留空 addr，
    // daemon 角色：先恢复部署清单（deploy 出来的实例落盘 instances.json）——
    // 恢复后与静态清单一起 declare/探测，重启不再是"清单丢、进程变孤儿"。
    if (config.role === 'daemon') this.loadDeployedInstances()
    // callRemote 自动走 broker 兜底（若无 broker 则不可达，属预期）。
    const specs = config.launch ?? (config.role === 'daemon' ? this.allInstanceSpecs() : config.instances)
    if (specs) {
      for (const [id, spec] of Object.entries(specs)) {
        // 管理端用配置 addr；daemon 本机实例用 127.0.0.1:port 构造 addr（同机直连）。
        const addr = config.launch
          ? (spec.addr ?? '')
          : (typeof spec.port === 'number' ? `http://127.0.0.1:${spec.port}` : '')
        // declare（管理端声明）：不校验 agent token（register 的 token 校验是
        // agent 自证身份契约；配置清单声明不受 tokens 配置影响）。
        // 初始 online（声明即身份 + 直连前提）——但构造尾部立即首轮 probe，
        // 不可达实例马上被 setStatus(offline)，消除"重启即全绿"的假在线窗口。
        ctx.channel.declare({ id, name: id, addr, status: 'online' })
      }
    }
    // 直连状态探测（管理端 launch / daemon 本机 instances 通用）：可达 → heartbeat
    // 续期 online；**不可达 → setStatus(offline) 立即离线**（不等 sweep 超时——
    // 否则声明即 online 后，实例挂了要 heartbeatTimeoutMs 才转灰，UI 假绿）。
    // declare 后立即首轮 probe（不等 setInterval 首拍 15s），重启瞬间即反映真实状态。
    if (config.launch || config.instances !== undefined || (config.role === 'daemon' && this.runtimeInstances.size > 0)) {
      this.probeLaunch()
      const probeTimer = setInterval(() => this.probeLaunch(), ConsoleService.PROBE_INTERVAL_MS)
      probeTimer.unref?.()
      ctx.effect(() => () => clearInterval(probeTimer))
    }
    // daemon 启动对账（异步；报告端口占用与疑似孤儿，不阻塞启动）。
    if (config.role === 'daemon') void this.reconcileInstances()
    // 系统事件消息：订阅 channel task 平面，落入各 owner 的 inbox。
    this.unsubscribe = ctx.channel.subscribe('task', (event) => {
      if (event.type.startsWith('system.')) {
        this.postSystemMessage(event.type, event.payload as Record<string, unknown>)
        // 升级结果事件 → 同步档案版本（守护完成/回滚后的权威结果）。
        // 注意：事件仅进程内可达（channel 事件不跨 relay）——跨进程结果以实例
        // 在线状态 + 实例 profile .dsh-upgrade-result.json 为准（见 emitUpgradeResult）。
        if (event.type === 'system.upgrade.result') {
          const payload = (event.payload ?? {}) as { instanceId?: string; ok?: boolean; version?: string; error?: string; rolledBack?: boolean }
          this.log(`[dsh-console] 收到升级结果事件（进程内）: ${payload.instanceId ?? '?'} ok=${String(payload.ok)} version=${payload.version ?? ''}${payload.rolledBack ? '（已回滚）' : ''}${payload.error ? ` error=${payload.error}` : ''}`, { scope: 'upgrade' })
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
        // 多机：向 hub 上报本机实例状态（周期注册即保活；指令经长轮询取回本地执行）。
        if (ctx.channel.channelMode === 'worker') {
          const disposeReport = ctx.channel.setWorkerReport(() => this.workerReport())
          ctx.effect(() => disposeReport)
        }
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
        // console 角色（多机 hub）：worker 注册落档案（归属 + 状态）并入 inbox。
        const unsubscribeRegister = ctx.channel.onRegister((report) => this.handleWorkerRegister(report))
        ctx.effect(() => unsubscribeRegister)
        // 等 webServer 服务可用后挂 HTTP 端点（ctx.inject 原生等待；
        // daemon/instance 角色部署的无 webserver profile 不会走到这里）。
        // 注意用注入后的 ctx（webServer 只在注入 fiber 的 scope 可见）。
        ctx.inject(['webServer'], (injected) => {
          // 启动注册是固定动作非审计事件——仅终端可见，不落盘（避免噪音刷屏审计日志）。
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
      // 实例访问地址（channel 发现为空 → launch 配置 addr 补充，跳转用）与所属主机：
      // 归属以注册声明为准（多机），launch 配置回落（期望态/同机部署）。
      const spec = this.config.launch?.[inst.id]
      const host = this.ctx.channel.hostOf(inst.id) ?? spec?.host
      const withHost = host ? { ...inst, host } : inst
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
    // 主机条目带机器名/IP（launch 的 host 键条目配 name/ip——UI 呈现机器，
    // 不暴露 agent id）。HostRecord.version 必填，守护无版本信息补空串。
    const hosts = view
      .filter((i) => isHostAgent(i.id))
      .map((h) => {
        const hostSpec = this.config.launch?.[h.id] as { name?: string; ip?: string } | undefined
        return {
          ...h,
          version: h.version ?? '',
          name: hostSpec?.name,
          ip: hostSpec?.ip,
        }
      })
    const instanceList = view.filter((i) => !isHostAgent(i.id))
    return { instances: instanceList as unknown as InstanceRecord[], hosts: hosts as unknown as HostRecord[] }
  }

  /** 直连状态探测：对管理端 launch / daemon 本机 instances 的 addr 发轻量请求，
   * 可达 → 心跳续期（保持 online）；不可达 → 不续期（sweep 会标离线）。
   * 探测带 5s 超时（目标 hang 时不积累挂起请求）。
   * hub 模式下跳过已注册目标（worker 与其上报实例的存活证据来自注册/长轮询，
   * 探测会与之抢状态）与非回环地址（跨机探测不是本进程的职责）。 */
  private probeLaunch(): void {
    const specs = this.config.launch ?? this.allInstanceSpecs()
    const hub = this.ctx.channel.channelMode === 'hub'
    for (const [id, spec] of Object.entries(specs)) {
      // 管理端用配置 addr；daemon 本机实例用 127.0.0.1:port（与注册一致）。
      const addr = this.config.launch
        ? spec.addr
        : (typeof spec.port === 'number' ? `http://127.0.0.1:${spec.port}` : undefined)
      if (!addr) continue
      if (hub && (!isLoopbackAddr(addr) || this.ctx.channel.hostOf(id) !== undefined)) continue
      fetch(addr, { signal: AbortSignal.timeout(ConsoleService.PROBE_TIMEOUT_MS) })
        .then(() => {
          try { this.ctx.channel.heartbeat(id, '') } catch { /* 未注册 */ }
        })
        .catch(() => {
          // 不可达/超时：立即标离线（不续期等 sweep）——探测结果驱动状态，
          // 避免"进程已停仍绿 heartbeatTimeoutMs"的假在线。
          try { this.ctx.channel.setStatus(id, 'offline') } catch { /* 未注册 */ }
        })
    }
  }

  /**
   * daemon 角色：本机实例状态上报（多机 worker 的注册载荷）。状态取本进程
   * channel 实例表（daemon 构造时已 declare 清单并周期探测本机端口），
   * 运行时 deploy 出来的实例同样纳入。
   */
  private localInstanceReport(): WorkerInstanceReport[] {
    const specs = this.allInstanceSpecs()
    return Object.keys(specs).map((id) => {
      const version = this.readInstanceVersion(specs[id])
      return {
        id,
        status: this.ctx.channel.get(id)?.status === 'online' ? 'online' : 'offline',
        ...(version !== undefined ? { version } : {}),
      }
    })
  }

  /** daemon 角色：本机实例上报（含守护自身发行包版本）。 */
  private workerReport(): WorkerReport {
    const id = this.ctx.channel.instanceId ?? this.config.hostId ?? 'daemon'
    const version = this.readDaemonPackageVersion()
    return {
      id,
      ...(version !== undefined ? { version } : {}),
      instances: this.localInstanceReport(),
    }
  }

  /**
   * console 角色：处理 worker 注册（多机 hub）——把上报实例的归属与状态写进档案，
   * 并向 inbox 投一条系统消息（新主机上线可见）。归属冲突由 channel 侧拒绝，
   * 这里只消费被受理的部分。
   */
  private handleWorkerRegister(report: WorkerReport): void {
    const host = report.id
    for (const inst of report.instances) {
      const record = this.getInstanceRecord(inst.id)
      if (record !== undefined) {
        this.setInstanceRecord({
          ...record,
          host,
          status: inst.status,
          ...(inst.version !== undefined ? { version: inst.version } : {}),
        })
        continue
      }
      this.setInstanceRecord({
        id: inst.id,
        name: inst.id,
        addr: '',
        status: inst.status,
        owner: 'admin',
        type: 'normal',
        host,
        version: inst.version ?? '',
      })
    }
    const hostRecord = this.getInstanceRecord(host)
    if (hostRecord !== undefined) {
      this.setInstanceRecord({
        ...hostRecord,
        status: 'online',
        ...(report.version !== undefined ? { version: report.version } : {}),
      })
    }
    this.postSystemMessage('system.host.register', {
      owner: 'admin',
      sender: host,
      title: `主机 ${host} 已注册`,
      body: `主机 ${host}${report.version !== undefined ? `（发行包 ${report.version}）` : ''} 上报实例：${report.instances.map((i) => `${i.id}(${i.status}${i.version !== undefined ? `/${i.version}` : ''})`).join('、') || '（无）'}`,
    })
    this.log(`[dsh-console] worker ${host} 注册：实例 ${report.instances.map((i) => i.id).join(',') || '（无）'}`, { scope: 'control' })
  }

  /**
   * 解析请求发起者（审计用）：dsh-user 可得则取用户 id（网关注入头/cookie/静态
   * 配置），否则 `system`。控制指令的 actor 随台账条目落盘。
   */
  private resolveActor(req: IncomingMessage): string {
    const user = this.ctx.get('user') as { current(headers?: Record<string, string | undefined>): { id: string } } | undefined
    if (user === undefined) return 'system'
    try {
      return user.current(req.headers as Record<string, string | undefined>).id
    } catch {
      return 'system'
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
        const result = this.controlInstanceAs(instanceId, command, {}, this.resolveActor(req))
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
          } else if (method === 'getUpgradeStatus') {
            // 升级状态查询：async @Remote——Promise 结果异步回执。
            const { instanceId } = (frame.payload?.args ?? {}) as { instanceId: string }
            void this.getUpgradeStatus(instanceId).then((st) => {
              res.writeHead(200, { 'content-type': 'application/json' })
              res.end(JSON.stringify({ type: 'server-response', rpcId: frame.rpcId, result: { ok: true, value: st } }))
            }).catch((err) => {
              res.writeHead(400, { 'content-type': 'application/json' })
              res.end(JSON.stringify({ type: 'server-response', rpcId: frame.rpcId, result: { ok: false, error: { code: 'internal', message: err instanceof Error ? err.message : String(err), details: {} } } }))
            })
            return
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
    this.log(`[dsh-console/daemon] 本机控制端口 http://127.0.0.1:${port}`, { scope: 'daemon' })
  }

  /** daemon 角色：处理控制指令（只认本机清单内的实例；指令载荷携带 instanceId）。 */
  private handleDaemonControl(command: ControlCommand, from: string): ControlOutcome {
    const payload = (command.payload ?? {}) as Record<string, unknown>
    // deploy：新实例部署（payload 是完整 DeployInstanceRequest，不走本机清单检查）。
    if (command.type === 'deploy') {
      return this.daemonDeploy(payload as unknown as DeployInstanceRequest)
    }
    const instanceId = typeof payload.instanceId === 'string' ? payload.instanceId : ''
    const spec = this.instanceSpec(instanceId)
    if (spec === undefined) {
      this.log(`[dsh-console/daemon] 收到 ${from} 的 ${command.type} 指令，但 ${instanceId || '(空)'} 不在本机清单（拒绝）`, { scope: 'control' })
      return { ok: false, error: `实例 ${instanceId || '(空)'} 不在本机清单` }
    }
    switch (command.type) {
      case 'start':
        // busy 锁：操作进行中（如重启等待窗口）拒绝，防并发 spawn 端口冲突。
        if (!this.opBegin(instanceId, 'starting')) {
          this.log(`[dsh-console/daemon] ${instanceId} 有操作进行中，忽略 start`, { scope: 'control' })
          return { ok: false, error: `${instanceId} 有操作进行中（busy）` }
        }
        try {
          this.daemonStart(instanceId, spec)
        } finally {
          this.opEnd(instanceId)
        }
        return { ok: true, detail: '已拉起' }
      case 'stop':
        this.daemonStop(instanceId)
        return { ok: true, detail: '已发停止' }
      case 'restart':
        if (!this.opBegin(instanceId, 'restarting')) {
          this.log(`[dsh-console/daemon] ${instanceId} 有操作进行中，忽略 restart`, { scope: 'control' })
          return { ok: false, error: `${instanceId} 有操作进行中（busy）` }
        }
        this.daemonRestart(instanceId, spec)
        return { ok: true, detail: '已发重启' }
      case 'upgrade': {
        // 统一升级：daemon 事务执行（快照→对齐发行包源→滚动重启→健康探测→失败回滚）。
        const version = typeof payload.version === 'string' ? payload.version : ''
        void this.daemonUpgrade(instanceId, spec, version)
        // 事务异步：回执 = 已受理；完成态经在线状态 + .dsh-upgrade-result.json。
        return { ok: true, detail: `升级已受理（目标 ${version || '当前发行包源'}，异步事务）` }
      }
      default:
        console.log(`[dsh-console/daemon] 收到 ${from} 的 ${command.type} 指令（v1 占位）`)
        return { ok: false, error: `未知指令 ${command.type}` }
    }
  }

  /** 查询实例启动规格：静态 config.instances 优先，其次运行时清单（deploy 动态加的）。 */
  private instanceSpec(instanceId: string): LaunchSpec | undefined {
    return this.config.instances?.[instanceId] ?? this.runtimeInstances.get(instanceId)
  }

  /**
   * 本机全部实例清单（静态 config.instances + 运行时 deploy 出来的，后者已落盘
   * `instances.json`）。daemon 的探测/日志白名单/端口定位统一读这里，避免
   * "静态清单之外看不见"（部署出的实例曾因此无状态、停不掉）。
   */
  private allInstanceSpecs(): Record<string, LaunchSpec> {
    const merged: Record<string, LaunchSpec> = {}
    for (const [id, spec] of Object.entries(this.config.instances ?? {})) merged[id] = spec
    for (const [id, spec] of this.runtimeInstances) merged[id] = spec
    return merged
  }

  /** 部署清单文件（daemon 角色；记录 deploy 出来的实例，重启后据此恢复）。 */
  private deployedInstancesFile(): string {
    return join(roleDataRoot('daemon'), 'instances.json')
  }

  /** 读部署清单到运行时清单（daemon 启动时调用；文件缺失/损坏即空）。 */
  private loadDeployedInstances(): void {
    try {
      const file = this.deployedInstancesFile()
      if (!existsSync(file)) return
      const saved = JSON.parse(readFileSync(file, 'utf8')) as { instances?: Record<string, LaunchSpec> }
      for (const [id, spec] of Object.entries(saved.instances ?? {})) {
        if (spec !== null && typeof spec === 'object') this.runtimeInstances.set(id, spec)
      }
      this.log(`[dsh-console/daemon] 部署清单恢复 ${this.runtimeInstances.size} 个实例（${file}）`, { scope: 'deploy' })
    } catch (error) {
      this.log(`[dsh-console/daemon] 部署清单读取失败（按空清单继续）：${error instanceof Error ? error.message : String(error)}`, { scope: 'deploy' })
    }
  }

  /** 落盘部署清单（deploy 成功后调用；失败不致命，仅丢失重启恢复能力）。 */
  private persistDeployedInstances(): void {
    try {
      const file = this.deployedInstancesFile()
      mkdirSync(dirname(file), { recursive: true })
      writeFileSync(file, JSON.stringify({ version: 1, instances: Object.fromEntries(this.runtimeInstances) }, null, 2))
    } catch (error) {
      this.log(`[dsh-console/daemon] 部署清单落盘失败：${error instanceof Error ? error.message : String(error)}`, { scope: 'deploy' })
    }
  }

  /**
   * daemon 启动对账（reconcile）：报告清单内实例的端口占用情况，以及"日志存在但
   * 不在清单"的疑似孤儿（清单丢失/手工起的实例），让半完成状态可见而不是静默。
   * 结果同时供注册上报与 `getReconcileReport()` 查询。
   */
  private async reconcileInstances(): Promise<void> {
    const report: Array<{ id: string; state: 'online' | 'offline' | 'orphan'; detail: string }> = []
    for (const [id, spec] of Object.entries(this.allInstanceSpecs())) {
      const port = typeof spec.port === 'number' ? spec.port : undefined
      if (port === undefined) {
        report.push({ id, state: 'offline', detail: '无端口信息（无法探测）' })
        continue
      }
      const free = await isPortFree(port)
      report.push({ id, state: free ? 'offline' : 'online', detail: free ? `端口 ${port} 空闲` : `端口 ${port} 被占用` })
    }
    // 疑似孤儿：日志目录里有 <id>.log，但既不在静态清单也不在部署清单。
    try {
      const logDir = join(roleDataRoot('daemon'), 'logs')
      if (existsSync(logDir)) {
        const known = new Set(Object.keys(this.allInstanceSpecs()))
        for (const file of readdirSync(logDir)) {
          if (!file.endsWith('.log')) continue
          const id = file.slice(0, -4)
          if (known.has(id)) continue
          report.push({ id, state: 'orphan', detail: '有实例日志但不在清单（清单丢失或手工启动）' })
        }
      }
    } catch {
      // 日志目录不可读：跳过孤儿检查（不影响主流程）。
    }
    this.reconcileReport = report
    for (const item of report) {
      this.log(`[dsh-console/daemon] reconcile ${item.id}: ${item.state}（${item.detail}）`, { scope: 'daemon' })
    }
  }

  /** 启动对账结果（reconcile 完成后可查；未跑过为空数组）。 */
  reconcileResult(): Array<{ id: string; state: 'online' | 'offline' | 'orphan'; detail: string }> {
    return [...this.reconcileReport]
  }

  /** 读实例发行包版本（instance home 的 profile package.json；不可读返回 undefined）。 */
  private readInstanceVersion(spec: LaunchSpec): string | undefined {
    const candidate = resolve(spec.dshHome, 'profiles', spec.profile, 'package.json')
    try {
      const parsed = JSON.parse(readFileSync(candidate, 'utf8')) as { version?: unknown }
      return typeof parsed.version === 'string' ? parsed.version : undefined
    } catch {
      return undefined
    }
  }

  /** 守护本地发行包版本（templateHome 的 profile package.json；不可读返回 undefined）。 */
  private readDaemonPackageVersion(): string | undefined {
    const template = this.config.templateHome
    if (template === undefined || template === '') return undefined
    const profilesDir = resolve(template, 'profiles')
    try {
      for (const name of readdirSync(profilesDir)) {
        const version = this.readInstanceVersion({ dshHome: template, profile: name })
        if (version !== undefined) return version
      }
    } catch {
      return undefined
    }
    return undefined
  }

  /**
   * daemon 角色：部署新实例（deploy 指令落地）。复用本地已装发行包：
   * 1. 动态加入运行时清单（静态 config 之外新实例）；
   * 2. 确保 dshHome 就绪（建 profile 骨架目录）；
   * 3. daemonStart 拉起（DSH_HOME=<dshHome> dsh --profile <profile>）。
   * node_modules 复用 daemon 本地发行包（pnpm workspace 同 tree/link）——
   * 与测试环境 web2/3/4（同一发行包不同 DSH_HOME）同模式。
   */
  private daemonDeploy(req: DeployInstanceRequest): ControlOutcome {
    const { instanceId, profile, dshHome, port, token, env, version } = req
    if (this.config.role !== 'daemon') {
      this.log(`[dsh-console] deploy ${instanceId} 目标非 daemon（role=${this.config.role}），忽略`, { scope: 'deploy' })
      return { ok: false, error: `目标非 daemon（role=${this.config.role}）` }
    }
    // 已存在（静态清单或已在跑）→ 幂等忽略。
    if (this.instanceSpec(instanceId) !== undefined) {
      this.log(`[dsh-console/daemon] ${instanceId} 已在清单，忽略重复 deploy`, { scope: 'deploy' })
      return { ok: true, detail: `${instanceId} 已在清单（幂等忽略）` }
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
      this.log(`[dsh-console/daemon] ${instanceId} 建 dshHome 失败: ${error instanceof Error ? error.message : String(error)}`, { scope: 'deploy' })
      return { ok: false, error: `建 dshHome 失败：${error instanceof Error ? error.message : String(error)}` }
    }
    // 清单落盘：daemon 重启后据此恢复（否则进程在跑却不在清单 = 孤儿）。
    this.persistDeployedInstances()
    this.log(`[dsh-console/daemon] 部署 ${instanceId}（DSH_HOME=${dshHome}，port=${String(port)}）`, { scope: 'deploy' })
    // 拉起（busy 锁；拉起后 channel 注册 → console 列表 online）。
    if (!this.opBegin(instanceId, 'starting')) {
      this.log(`[dsh-console/daemon] ${instanceId} 有操作进行中，部署后稍后拉起`, { scope: 'deploy' })
      return { ok: false, error: `${instanceId} 有操作进行中（busy），已入清单未拉起` }
    }
    try {
      this.daemonStart(instanceId, spec)
    } finally {
      this.opEnd(instanceId)
    }
    return { ok: true, detail: `${instanceId} 已部署并拉起` }
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
      this.log(`[dsh-console/daemon] ${instanceId} 从模板复制发行包: ${templateProfile}`, { scope: 'deploy' })
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
          dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'dsh-desk', 'dsh-quick-nav', 'dsh-focus-session', 'dsh-focus-tabs'] } },
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

  /**
   * 落盘升级状态到实例 home 的 .dsh-upgrade-status.json（进度 UI 轮询读）。
   * daemon 执行面每步完成调用；console 经 @Remote getUpgradeStatus 跨实例查询。
   */
  private writeUpgradeStatus(spec: LaunchSpec, instanceId: string, status: Omit<UpgradeStatus, 'instanceId' | 'ts'>): void {
    try {
      const path = join(spec.dshHome, '.dsh-upgrade-status.json')
      writeFileSync(path, JSON.stringify({ instanceId, ...status, ts: Date.now() }, null, 2) + '\n', 'utf8')
    } catch {
      // 状态落盘失败不阻断升级事务。
    }
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
      this.log(`[dsh-console/daemon] ${instanceId} 有操作进行中，忽略 upgrade`, { scope: 'upgrade' })
      return
    }
    const homeProfile = join(spec.dshHome, 'profiles', spec.profile)
    try {
      if (!existsSync(homeProfile)) {
        this.log(`[dsh-console/daemon] 升级 ${instanceId} 失败：实例 home 不存在（${homeProfile}）`, { scope: 'upgrade' })
        return
      }
      // 1. 快照（升级前状态 = 回滚点）。
      this.writeUpgradeStatus(spec, instanceId, { step: 'snapshot', done: false, version, message: '开始升级：快照当前发行包…' })
      const snapRoot = join(spec.dshHome, '.dsh-upgrade-snapshots', instanceId)
      const snapshot = this.saveReleaseSnapshot(snapRoot, homeProfile)
      let applied = false
      try {
        // 2. reconcile 到守护发行包源。
        this.writeUpgradeStatus(spec, instanceId, { step: 'snapshot', done: true, version, message: '快照完成（保留为回滚点）' })
        this.writeUpgradeStatus(spec, instanceId, { step: 'align', done: false, version, message: '对齐守护发行包源…' })
        this.applyReleaseFromTemplate(homeProfile, instanceId, spec, version)
        if (ConsoleService.upgradeApplyError) throw ConsoleService.upgradeApplyError
        applied = true
        this.log(`[dsh-console/daemon] 升级 ${instanceId}：发行包已对齐守护源（version=${version || '当前'}），滚动重启`, { scope: 'upgrade' })
        this.writeUpgradeStatus(spec, instanceId, { step: 'align', done: true, version, message: '发行包已对齐守护源' })
        // 3. 滚动重启 + 健康探测。
        this.writeUpgradeStatus(spec, instanceId, { step: 'restart', done: false, version, message: '滚动重启实例…' })
        await this.restartAfterUpgrade(instanceId, spec)
        this.writeUpgradeStatus(spec, instanceId, { step: 'restart', done: true, version, message: '实例已重启' })
        this.writeUpgradeStatus(spec, instanceId, { step: 'health', done: false, version, message: '健康探测…' })
        // 健康探测结果经 restartAfterUpgrade 内确认；完成后标记 done。
        this.writeUpgradeStatus(spec, instanceId, { step: 'health', done: true, version, message: '健康检查通过' })
        this.recordUpgradeResult(homeProfile, instanceId, true, version)
        this.writeUpgradeStatus(spec, instanceId, { step: 'done', done: true, ok: true, version, message: '升级完成' })
        this.emitUpgradeResult(instanceId, version, true)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        this.log(`[dsh-console/daemon] 升级 ${instanceId} 失败（${message}），自动回滚快照`, { scope: 'upgrade' })
        // 4. 失败自动回滚：恢复最近快照；发行包已被替换过 → 回滚后重启（旧进程已停）。
        try {
          this.writeUpgradeStatus(spec, instanceId, { step: 'rollback', done: false, version, message: `升级失败（${message}），自动回滚…` })
          this.restoreReleaseSnapshot(snapshot, homeProfile)
          if (applied) await this.restartAfterUpgrade(instanceId, spec)
          this.recordUpgradeResult(homeProfile, instanceId, false, version, message, true)
          this.writeUpgradeStatus(spec, instanceId, { step: 'rollback', done: true, version, message: '已回滚到升级前版本' })
          this.writeUpgradeStatus(spec, instanceId, { step: 'done', done: true, ok: false, error: message, rolledBack: true, version, message: '升级失败，已回滚' })
          this.emitUpgradeResult(instanceId, version, false, message, true)
        } catch (rollbackError) {
          this.log(`[dsh-console/daemon] 升级 ${instanceId} 回滚也失败: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`, { scope: 'upgrade' })
          this.recordUpgradeResult(homeProfile, instanceId, false, version, `升级失败且回滚失败: ${message}`, false)
          this.writeUpgradeStatus(spec, instanceId, { step: 'done', done: true, ok: false, error: `升级失败且回滚失败: ${message}`, version, message: '升级与回滚均失败' })
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
    // 源 = templateHome 下实际存在的发行包 profile（daemon 模板 home 的完整发行包）。
    // 不按目标实例名猜（实例 profile 名 = 实例名，守护模板 home 只有自己的 profile）。
    let source = ''
    if (template !== undefined && template !== '') {
      const dir = join(template, 'profiles')
      if (existsSync(dir)) {
        const candidates = readdirSync(dir).filter((n) => existsSync(join(dir, n, 'package.json')))
        // 优先同 spec.profile 名（若守护模板恰好同名），否则取第一个完整发行包。
        source = candidates.includes(spec.profile)
          ? join(dir, spec.profile)
          : (candidates.length > 0 ? join(dir, candidates[0]) : '')
      }
    }
    if (source === '') {
      throw new Error('守护未配置发行包源（config.templateHome 下无完整发行包 profile）')
    }
    for (const name of readdirSync(source)) {
      if (name === 'cordis.patch.yml' || name === '.dsh-release.json') continue
      const src = join(source, name)
      const dst = join(homeProfile, name)
      rmSync(dst, { recursive: true, force: true })
      cpSync(src, dst, { recursive: true })
    }
    writeFileSync(join(homeProfile, '.dsh-release.json'), JSON.stringify({ version, at: Date.now() }, null, 2) + '\n')
    this.log(`[dsh-console/daemon] ${instanceId} 发行包对齐自 ${source}`, { scope: 'upgrade' })
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
        this.log(`[dsh-console/daemon] ${instanceId} 升级停旧进程超时（进程未退出），继续回滚路径`, { scope: 'upgrade' })
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
        this.log(`[dsh-console/daemon] ${instanceId} 升级后健康：http://127.0.0.1:${port} 监听中`, { scope: 'upgrade' })
        return
      }
      await sleep(500)
    }
    const child = this.children.get(instanceId)
    if (child !== undefined && child.exitCode === null) {
      this.log(`[dsh-console/daemon] ${instanceId} 升级后探测超时但进程存活，视为健康`, { scope: 'upgrade' })
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
      this.log(`[dsh-console/daemon] ${instanceId} 升级结果: ok=${String(ok)} version=${version}${rolledBack ? '（已回滚）' : ''}${error !== undefined ? ` error=${error}` : ''}`, { scope: 'upgrade' })
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
      this.log(`[dsh-console/daemon] ${instanceId} 已在运行，忽略 start`, { scope: 'daemon' })
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
    this.log(`[dsh-console/daemon] 已拉起 ${instanceId}（dsh --profile ${spec.profile}，DSH_HOME=${spec.dshHome}）`, { scope: 'daemon' })
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
        this.log(`[dsh-console/daemon] ${instanceId} 重启超时（进程未退出），解锁（可手动重试）`, { scope: 'daemon' })
        this.opEnd(instanceId)
      }, ConsoleService.RESTART_WATCHDOG_MS)
      watchdog.unref?.()
      child.once('exit', (code, signal) => {
        clearTimeout(watchdog)
        this.log(`[dsh-console/daemon] ${instanceId} 旧进程退出（code=${String(code)} signal=${String(signal)}），拉起`, { scope: 'daemon' })
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
      this.log(`[dsh-console/daemon] ${instanceId} 非守护拉起，本机端口 kill，等待退出后拉起`, { scope: 'daemon' })
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
    this.log(`[dsh-console/daemon] ${instanceId} 等待退出超时（端口仍占用），解锁`, { scope: 'daemon' })
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
      this.log(`[dsh-console/daemon] 已向 ${instanceId} 发 SIGTERM（宽限 ${ConsoleService.KILL_GRACE_MS}ms 后 SIGKILL）`, { scope: 'daemon' })
      return
    }
    if (this.ctx.channel.get(instanceId)?.status === 'online') {
      // 本机端口定位 kill（同机守护能力）——不依赖 relay 投递：目标实例可能
      // 没连 broker（混合部署），经 channel 发 stop 会静默丢失。
      this.killPortProcess(instanceId)
      return
    }
    this.log(`[dsh-console/daemon] ${instanceId} 已离线，无进程可停`, { scope: 'daemon' })
  }

  /** 本机端口定位 kill（无 broker 时停非守护拉起实例）：lsof 找占用端口的进程发 SIGTERM。 */
  private killPortProcess(instanceId: string): void {
    const port = this.allInstanceSpecs()[instanceId]?.port
    if (port === undefined) {
      this.log(`[dsh-console/daemon] ${instanceId} 无端口信息，无法本机定位停止`, { scope: 'daemon' })
      return
    }
    // 只定位监听者（-sTCP:LISTEN）——裸 `lsof -ti tcp:<port>` 会同时列出连接方
    // （管理端/守护的探测 fetch 连接），误杀守护自身。
    ConsoleService.execImpl(`lsof -ti tcp:${port} -sTCP:LISTEN`, (error, stdout) => {
      if (error) {
        this.log(`[dsh-console/daemon] ${instanceId} 端口定位失败（lsof: ${error.message}），无法本机停止`, { scope: 'daemon' })
        return
      }
      const pids = stdout.trim().split('\n').filter(Boolean)
      if (pids.length === 0) {
        this.log(`[dsh-console/daemon] ${instanceId} 端口 ${port} 无占用进程（可能已离线）`, { scope: 'daemon' })
        return
      }
      for (const pid of pids) {
        try { process.kill(Number(pid), 'SIGTERM') } catch { /* 已退出 */ }
      }
      this.log(`[dsh-console/daemon] ${instanceId} 无 broker：端口 ${port} 进程 ${pids.join(',')} 已发 SIGTERM`, { scope: 'daemon' })
    })
  }

  /** instance 角色：实例自退执行器（收到 stop/restart 退出进程，重启由守护拉起）。 */
  private handleInstanceControl(command: ControlCommand, from: string): ControlOutcome {
    const action = resolveControlAction(command)
    switch (action) {
      case 'exit':
        // 积压旧指令判定：发送早于本进程启动 → 忽略（broker 持久队列补投的旧
        // stop/restart 会在守护重启链里"起来就被杀"）；当前指令（ts ≥ 启动时刻）
        // 照常执行——ts 精确区分，不误伤刚启动就要重启的合法指令。
        if (command.ts < this.startedAt) {
          console.log(`[dsh-console/instance] 忽略积压旧指令 ${from} 的 ${command.type}（ts=${command.ts} < 启动=${this.startedAt}）`)
          return { ok: true, detail: '积压旧指令已忽略' }
        }
        this.log(`[dsh-console/instance] 收到 ${from} 的 ${command.type} 指令，执行重启/停止（进程退出，守护拉起）`, { scope: 'instance' })
        setTimeout(() => process.exit(0), 300)
        return { ok: true, detail: '进程退出（守护拉起）' }
      case 'running':
        console.log(`[dsh-console/instance] 收到 ${from} 的 start 指令（已在运行）`)
        return { ok: true, detail: '已在运行' }
      case 'pending':
        console.log(`[dsh-console/instance] 收到 ${from} 的 ${command.type} 指令（v1 占位）`)
        return { ok: true, detail: 'v1 占位' }
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
    return this.controlInstanceAs(instanceId, command, payload, 'system')
  }

  /**
   * 控制指令实体（审计身份显式传入）：HTTP 面从请求解析用户身份，@Remote 面
   * 暂无身份可得 → `system`。指令经台账派发时 actor 随条目落盘（审计留痕）。
   */
  private controlInstanceAs(
    instanceId: string,
    command: 'stop' | 'start' | 'upgrade' | 'restart',
    payload: { version?: string },
    actor: string,
  ): ControlResult {
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
        this.log(`[dsh-console/instance] 收到控制指令（RPC 面）${command}，进程退出（守护拉起）`, { scope: 'instance' })
        setTimeout(() => process.exit(0), 300)
      }
      return { ok: true }
    }
    // daemon 角色（RPC 面到达）：本机清单内的实例直接本机执行（进程管理在守护侧），
    // 不落入 console 决策路由（否则无 launch 配置 → route=instance → 转发回实例）。
    if (this.config.role === 'daemon' && this.config.instances?.[instanceId] !== undefined) {
      // 转发完整 payload（RPC/HTTP 面到达时保留 version 等载荷——勿只留 instanceId）。
      const outcome = this.handleDaemonControl({ id: 'rpc', type: command, payload: { instanceId, ...payload }, ts: Date.now() }, 'rpc')
      return outcome.ok
        ? { ok: true, ...(outcome.detail !== undefined ? { health: outcome.detail } : {}) }
        : { ok: false, error: outcome.error }
    }
    if (command === 'upgrade') {
      const upgradeHost = this.ctx.channel.hostOf(instanceId) ?? this.config.launch?.[instanceId]?.host
      const target = upgradeHost ?? (this.ctx.channel.channelMode === 'hub' ? undefined : instanceId)
      if (target === undefined) {
        return { ok: false, error: `实例 ${instanceId} 无守护宿主（无法派发升级）` }
      }
      return this.dispatchToHost(target, { type: command, payload: { instanceId, ...payload } }, actor)
    }
    const online = this.isInstanceOnline(instanceId)
    const daemonAgent = this.ctx.channel.hostOf(instanceId) ?? this.config.launch?.[instanceId]?.host
    const route = resolveControlRoute(command, online, daemonAgent)
    switch (route.action) {
      case 'noop':
        this.log(`[dsh-console] 控制 ${instanceId} ${command} → noop 忽略（${online ? '已在线' : '已离线'}）`, { scope: 'control' })
        return { ok: true }
      case 'daemon': {
        // 守护从未注册（launch.host 拼错，多机下也含"守护未上线"）→ 显式失败。
        if (this.ctx.channel.channelMode !== 'hub' && this.ctx.channel.get(route.daemonAgent) === undefined) {
          this.log(`[dsh-console] 控制 ${instanceId} ${command} → 失败：目标守护 ${route.daemonAgent} 未注册（launch 配置 host 疑错）`, { scope: 'control' })
          return { ok: false, error: `目标守护 ${route.daemonAgent} 未注册（检查 launch 配置 host）` }
        }
        this.log(`[dsh-console] 控制 ${instanceId} ${command} → 下发守护 ${route.daemonAgent}`, { scope: 'control' })
        return this.dispatchToHost(route.daemonAgent, { type: route.command, payload: { instanceId } }, actor)
      }
      case 'instance':
        // 无守护宿主的在线实例：多机下实例不开控制面（生命周期全经本机 daemon），
        // 显式失败；同机 local 模式保留直连自退（原行为）。
        if (this.ctx.channel.channelMode === 'hub') {
          return { ok: false, error: `实例 ${instanceId} 无守护宿主：多机模式下实例不暴露控制面` }
        }
        this.log(`[dsh-console] 控制 ${instanceId} ${command} → 下发实例自退（无守护兜底）`, { scope: 'control' })
        return this.remoteControl(instanceId, { instanceId, command: route.command })
      case 'error':
        this.log(`[dsh-console] 控制 ${instanceId} ${command} → 失败：${route.reason}`, { scope: 'control' })
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
      const daemonAgent = this.ctx.channel.hostOf(instanceId) ?? this.config.launch?.[instanceId]?.host ?? record?.host
      if (daemonAgent === undefined || daemonAgent === '') {
        return { instanceId, ok: false, error: '无守护宿主（launch/档案未配 host）' }
      }
      if (daemonAgent === instanceId) {
        return { instanceId, ok: false, error: '守护不能升级自身（launch 配置 host 指向自己）' }
      }
      // 同机 local 模式：守护必须先被声明（launch 声明或注册）；否则无从直连。
      if (this.ctx.channel.channelMode !== 'hub' && this.ctx.channel.get(daemonAgent) === undefined) {
        return { instanceId, ok: false, error: `目标守护 ${daemonAgent} 未注册` }
      }
      const dispatched = this.dispatchToHost(daemonAgent, { type: 'upgrade', payload: { instanceId, version } }, 'system')
      return dispatched.ok
        ? { instanceId, ok: true }
        : { instanceId, ok: false, error: dispatched.error ?? '派发失败' }
    })
    return { results }
  }

  /**
   * 派发控制指令给守护宿主：多机 hub 模式经 channel 落盘台账（worker 长轮询取走，
   * 未注册目标显式失败）；同机 local 模式走直连 RPC（守护控制端口，原行为）。
   * @param hostId - 目标守护 id。
   * @param command - 指令（不含 id/ts）。
   * @returns 派发结果（ok 仅代表已受理/已下发）。
   */
  private dispatchToHost(hostId: string, command: Omit<ControlCommand, 'id' | 'ts'>, actor: string): ControlResult {
    if (this.ctx.channel.channelMode === 'hub') {
      const dispatched = this.ctx.channel.sendControl(hostId, command, actor)
      this.log(
        dispatched.ok
          ? `[dsh-console] 指令 ${command.type} 已入队守护 ${hostId}（actor=${actor}，commandId=${dispatched.commandId ?? ''}）`
          : `[dsh-console] 指令 ${command.type} 派发守护 ${hostId} 失败：${dispatched.error ?? ''}`,
        { scope: 'control' },
      )
      return dispatched.ok
        ? { ok: true, ...(dispatched.commandId !== undefined ? { commandId: dispatched.commandId } : {}) }
        : { ok: false, error: dispatched.error }
    }
    const payload = command.payload as { instanceId?: string } | undefined
    const instanceId = payload?.instanceId
    // 同机 local 模式：有 addr → 直连守护控制端口；无 addr → 进程内回环（本机守护/
    // 单进程模拟）；两种都能给出生死结论，不留"已下发"的假成功。
    const addr = this.ctx.channel.get(hostId)?.addr
    if (addr === undefined || addr === '') {
      const loopback = this.ctx.channel.sendControl(hostId, command)
      return loopback.ok
        ? { ok: true, ...(loopback.commandId !== undefined ? { commandId: loopback.commandId } : {}) }
        : { ok: false, error: loopback.error }
    }
    if (instanceId === undefined) return { ok: false, error: `${command.type} 缺少 instanceId` }
    if (command.type !== 'stop' && command.type !== 'start' && command.type !== 'restart') {
      return { ok: false, error: `${command.type} 需要 hub 模式（多机台账派发）；同机 local 模式只直连 stop/start/restart` }
    }
    return this.remoteControl(hostId, { instanceId, command: command.type })
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
      if (!r.ok) this.log(`[dsh-console] 跨实例控制 ${targetId} ${args.command} 失败: ${r.error.code}: ${r.error.message}`, { scope: 'control' })
    }).catch((e) => {
      this.log(`[dsh-console] 跨实例控制 ${targetId} 调用异常: ${e instanceof Error ? e.message : String(e)}`, { scope: 'control' })
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
    // 先派发再登记：登记 = 已受理（派发失败时不留下"有档案无人执行"的假成功）。
    const dispatched = this.dispatchToHost(host, { type: 'deploy', payload: request }, 'system')
    if (!dispatched.ok) return dispatched
    // 登记档案（管理端视角可查；status=offline 等 daemon 拉起后由注册上报置 online）。
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
    return dispatched
  }


  // --- 日志（v1：只读侦察，daemon 角色读本机文件；console 角色转发到守护） ---

  /** 日志路径：daemon 角色读 ~/.dsh-daemon/ 下文件（logs/<id>.log + daemon.log）；
   * console 角色读本机 console.log + 经 callRemote 转发到守护读其实例日志。 */
  private logPathFor(target: LogTarget): string | null {
    if (this.config.role === 'daemon') {
      if (target.kind === 'daemon') return join(roleDataRoot('daemon'), 'daemon.log')
      // 实例：必须在本机清单内（白名单防任意文件读；含 deploy 出来的实例）
      const spec = this.allInstanceSpecs()[target.instanceId]
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
      const specs = this.allInstanceSpecs()
      for (const id of Object.keys(specs)) {
        const m = this.logStat(join(logDir, `${id}.log`))
        if (m !== null) instances.push(m)
      }
      return { daemon, instances }
    }
    if (this.config.role === 'console') {
      // console 角色：只返回本机 console.log（自身）。跨守护实例日志的转发读取属
      // 异步 @Remote（v2，见 note）——v1 不在同步方法里 fire-and-forget callRemote：
      // 守护(host1)不可达时其 5s 超时 rejection 无人 catch → Node unhandledRejection
      // 会把整个 web2 判 fatal 崩掉（此前"web2 总断"根因）。实例日志项待 v2 补齐。
      const selfMeta = this.logStat(Logger.resolvePath('console') ?? '')
      return { daemon: selfMeta, instances: [] }
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
      if (path === null) return { records: [], total: 0, truncated: false }
      // 记录角色按文件归属推断：daemon.log → 'daemon'；logs/<id>.log（实例 stdout）→ 'instance'。
      const recordRole = basename(path) === 'daemon.log' ? 'daemon' : 'instance'
      return this.readLogFromFile(recordRole, path, tail, maxBytes)
    }
    if (this.config.role === 'console') {
      if (target.kind === 'daemon') {
        // console 角色读 'daemon' target = 本机 console.log（role='console'）。
        const path = Logger.resolvePath('console')
        if (path === null) return { records: [], total: 0, truncated: false }
        return this.readLogFromFile('console', path, tail, maxBytes)
      }
      // 实例：经 callRemote 转发到守护
      const spec = this.config.launch?.[target.instanceId]
      if (spec === undefined || spec.host === undefined || spec.host === '') {
        return { records: [], total: 0, truncated: false }
      }
      // 实例：经 callRemote 转发到守护（v1 同步签名无法 await——fire-and-forget；
      // 结果由上方 fallback 空返回，转发仅为预触发）。必须 catch：守护不可达超时
      // 的 rejection 不捕获会成 unhandledRejection → 崩整个进程。
      this.ctx.channel.callRemote<LogReadResult>(spec.host, {
        namespace: 'console', method: 'readLog', args: { target, opts },
      }, 5_000).catch((e: unknown) => {
        this.log(`[dsh-console] 转发读实例日志失败（${spec.host}/${target.instanceId}）: ${e instanceof Error ? e.message : String(e)}`, { scope: 'console' })
      })
      return { records: [], total: 0, truncated: false }
    }
    return { records: [], total: 0, truncated: false }
  }

  /**
   * 查升级状态（typert @Remote）。daemon 角色：读本机实例 home 的状态文件；
   * console 角色：经 callRemote 转发到守护查询（与日志转发同模式）。
   * @param instanceId - 实例 id。
   * @returns 状态（无记录/不可达 → step='done' + ok=false + error 说明）。
   */
  @Remote
  async getUpgradeStatus(instanceId: string): Promise<UpgradeStatus> {
    if (this.config.role === 'daemon') {
      const spec = this.config.instances?.[instanceId]
      if (spec === undefined) {
        return { instanceId, step: 'done', done: true, ok: false, version: '', error: '实例不在本机清单', ts: Date.now(), message: '无状态' }
      }
      try {
        const path = join(spec.dshHome, '.dsh-upgrade-status.json')
        if (!existsSync(path)) {
          return { instanceId, step: 'done', done: true, version: '', ts: Date.now(), message: '无升级记录' }
        }
        const raw = JSON.parse(readFileSync(path, 'utf8')) as UpgradeStatus
        return { ...raw, instanceId }
      } catch {
        return { instanceId, step: 'done', done: true, ok: false, version: '', error: '状态文件损坏', ts: Date.now(), message: '状态读取失败' }
      }
    }
    if (this.config.role === 'console') {
      // 实例：经 callRemote 转发到守护查（@Remote 跨实例重入，async 可 await）。
      const spec = this.config.launch?.[instanceId]
      if (spec === undefined || spec.host === undefined || spec.host === '') {
        return { instanceId, step: 'done', done: true, ok: false, version: '', error: '无守护宿主', ts: Date.now(), message: '无状态' }
      }
      try {
        const r = await this.ctx.channel.callRemote<UpgradeStatus>(spec.host, {
          namespace: 'console', method: 'getUpgradeStatus', args: { instanceId },
        }, 5_000)
        if (r.ok) return { ...(r.value as UpgradeStatus), instanceId }
        return { instanceId, step: 'done', done: true, ok: false, version: '', error: `守护查询失败: ${r.error?.code ?? 'unknown'}`, ts: Date.now(), message: '无状态' }
      } catch (e) {
        return { instanceId, step: 'done', done: true, ok: false, version: '', error: e instanceof Error ? e.message : String(e), ts: Date.now(), message: '守护不可达' }
      }
    }
    return { instanceId, step: 'done', done: true, version: '', ts: Date.now(), message: '' }
  }

  /**
   * 读文件并解析为 records：maxBytes 兜底（超限视为 truncated）+ tail 取最后 N 条
   * record（0=全文）。每非空行逐条解析（见 {@link parseLogLine}）：结构化 JSONL 行
   * 采用为 LogRecord；老 `[ISO] msg` 自由文本行宽松解析为 level:null 的 legacy 记录。
   * @param role - 该文件归属的记录角色（daemon.log → 'daemon'、console.log → 'console'、
   *   实例 stdout logs/<id>.log → 'instance'）。
   * @param path - 日志文件路径。
   * @param tail - 取文件末尾 N 条记录；0 = 全部。
   * @param maxBytes - 字节上限（>0 且文件超限 → truncated=true）。
   * @returns 解析记录（可能含 JSON 与 legacy 混合行），空/不存在/损坏文件返回空。
   */
  private readLogFromFile(role: LogRecord['role'], path: string, tail: number, maxBytes: number): LogReadResult {
    if (!existsSync(path)) return { records: [], total: 0, truncated: false }
    try {
      const st = statSync(path)
      const totalSize = st.size
      const truncated = maxBytes > 0 && totalSize > maxBytes
      // v1 简化：maxBytes 512KB 全文 readFileSync（不卡）；按字节窗口读取留 v2。
      const full = readFileSync(path, 'utf8')
      // 每条非空行 = 一条记录（JSON 或 legacy），total = 非空行数（与 shell 一致）。
      // 去重：Logger.record（JSONL）与 Logger.append（纯文本镜像）双写同一文件——JSONL
      // 事件行后紧跟的同 ts/同 msg 纯文本镜像不该在查看器里再显示一遍（同一事件只留结构化那条）。
      const lines = full.split('\n').filter((l) => l.length > 0)
      const records: LogRecord[] = []
      let prevJson: LogRecord | null = null
      for (const line of lines) {
        const rec = this.parseLogLine(role, line)
        const isMirror = prevJson !== null && rec.level === null && rec.ts !== ''
          && rec.ts === prevJson.ts && rec.msg === prevJson.msg
        if (isMirror) {
          prevJson = null // 该行是前一 JSON 事件的纯文本镜像，跳过
          continue
        }
        records.push(rec)
        prevJson = rec.level !== null ? rec : null
      }
      const sliced = tail > 0 ? records.slice(-tail) : records
      return { records: sliced, total: lines.length, truncated }
    } catch {
      return { records: [], total: 0, truncated: false }
    }
  }

  /**
   * 单行解析为 LogRecord。优先 JSON.parse：对象且含字符串 ts + msg → 采用，
   * 缺失字段补全（role 用文件归属 role，level 非法/缺省 → null，scope 缺省 → role，
   * instanceId 缺省 → undefined）。否则按老 `[ISO] msg` 自由文本宽松解析：
   * 行首 ISO-like `[...] ` 前缀作为 ts（缺省空串），余下为 msg，level:null，scope=role。
   */
  private parseLogLine(role: LogRecord['role'], line: string): LogRecord {
    let parsed: unknown
    try { parsed = JSON.parse(line) } catch { parsed = null }
    if (parsed !== null && typeof parsed === 'object') {
      const raw = parsed as Record<string, unknown>
      if (typeof raw.ts === 'string' && typeof raw.msg === 'string') {
        const level = raw.level === 'debug' || raw.level === 'info' || raw.level === 'warn' || raw.level === 'error'
          ? raw.level
          : null
        const recordRole = raw.role === 'console' || raw.role === 'daemon' || raw.role === 'instance'
          ? raw.role
          : role
        const scope = typeof raw.scope === 'string' ? raw.scope : role
        const instanceId = typeof raw.instanceId === 'string' ? raw.instanceId : undefined
        return {
          ts: raw.ts,
          role: recordRole,
          level,
          scope,
          ...(instanceId !== undefined ? { instanceId } : {}),
          msg: raw.msg,
        }
      }
    }
    // legacy `[ISO] msg`：宽松匹配行首 ISO-like 前缀，其余为正文。
    const iso = line.match(/^\[(\d{4}-\d{2}-\d{2}T[^\]]*)\]\s?(.*)$/s)
    return {
      ts: iso ? iso[1] : '',
      role,
      level: null,
      scope: role,
      msg: iso ? iso[2] : line,
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

/** 是否回环地址（hub 模式下跨机地址不由本进程探测）。 */
function isLoopbackAddr(addr: string): boolean {
  try {
    const host = new URL(addr).hostname
    return host === '127.0.0.1' || host === 'localhost' || host === '::1' || host === '[::1]'
  } catch {
    return false
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
 * 从固定中文消息推导日志级别：命中错误字面标记 → 'error'，否则 'info'。
 * 本库消息为固定中文串（无运行时自由度），故用字面标记表而非启发式/NLP。
 * warn/debug 仅在调用方语义确需时显式传入（log 的 extra.level）。
 */
function deriveLogLevel(msg: string): LogLevel {
  return /失败|拒绝|不可达|回滚失败|超时|异常|ENOENT|error/i.test(msg) ? 'error' : 'info'
}

/**
 * 进程内日志落盘：console/daemon 角色的关键事件行追加到本地 .log 文件。
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
  /** 写一条结构化 JSONL 记录（ts/role/level/scope/msg）。与 append 共用路径。 */
  record(role: 'console' | 'daemon' | 'instance', entry: { level: LogLevel; scope: string; msg: string; instanceId?: string }): void {
    const path = Logger.resolvePath(role)
    if (path === null) return
    try {
      mkdirSync(join(path, '..'), { recursive: true })
      const ts = new Date().toISOString()
      const record = JSON.stringify({
        ts,
        role,
        level: entry.level,
        scope: entry.scope,
        ...(entry.instanceId !== undefined ? { instanceId: entry.instanceId } : {}),
        msg: entry.msg,
      })
      appendFileSync(path, `${record}\n`, 'utf8')
    } catch {
      // 不能让日志挂掉主流程。
    }
  },
}

/** 类插件入口：cordis 实例化时自动注册 `ctx.console`（构造即注册，勿再 provide）。 */
export default ConsoleService
