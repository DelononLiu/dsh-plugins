/**
 * dsh-console：管理组件（纯服务端）——主机/实例档案、生命周期、部署编排、
 * inbox/投递、总览数据。控制面：决策与编排在此，执行在远程 agent。
 *
 * 实例管理服务提供者：`InstanceRecord` 在 channel 的 `InstanceIdentity` 上
 * 扩展 owner/type/host/version；消费者（dsh-console-ui / dsh-nav）经
 * type-only import + Typert ctx.remote 消费（运行时零依赖）。
 *
 * v1 为**进程内实现**：档案与 inbox 存内存（持久化后续）；生命周期指令经
 * channel.sendControl 回环到目标实例的 agent（执行在 agent，本插件只编排
 * 与记录状态）；inbox 订阅 channel task 平面事件（系统事件消息，按 owner
 * 隔离，实例级）。
 * @module dsh-console
 */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import 'dsh-channel'
import type { InstanceIdentity } from 'dsh-channel'
import { randomUUID } from 'node:crypto'

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

/** 插件配置：无（v1 全默认；档案/inbox 内存存储）。 */
export interface Config {
  /** 保留——未来持久化后端/配额配置。 */
  _placeholder?: never
}

/** 运行时 schema。 */
export const Config = z.object({}) as z<Config>

/**
 * 管理服务（实例管理服务提供者）：档案、生命周期编排、inbox。
 * 所有插件经 `ctx.console` 查询/管理主机与实例、接收系统事件消息。
 */
export class ConsoleService extends Service {
  static Config = Config
  /** 依赖注入：ctx.channel（cordis fiber 加载时注入）。 */
  static inject = ['channel']

  /** 主机档案表。 */
  private readonly hosts = new Map<string, HostRecord>()
  /** 实例档案表（含管理扩展）。 */
  private readonly instances = new Map<string, InstanceRecord>()
  /** inbox：owner → 消息列表（实例级，按 owner 隔离）。 */
  private readonly inboxes = new Map<string, InboxMessage[]>()
  /** 订阅 channel task 平面（系统事件 → inbox）的 disposer。 */
  private readonly unsubscribe: () => void

  constructor(ctx: Context) {
    super(ctx, 'console')
    // 系统事件消息：订阅 channel task 平面，落入各 owner 的 inbox。
    this.unsubscribe = ctx.channel.subscribe('task', (event) => {
      if (event.type.startsWith('system.')) {
        this.postSystemMessage(event.type, event.payload as Record<string, unknown>)
      }
    })
    ctx.effect(() => this.unsubscribe)
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

  // --- 生命周期 / 部署编排（控制面：编排，执行在 agent） ---

  /**
   * 启停/升级实例：经 channel.sendControl 下发控制指令到目标实例的 agent，
   * 本插件记录编排意图（执行回执由 agent 经事件上报）。
   * @param instanceId - 目标实例 id。
   * @param command - 控制指令类型（stop/start/upgrade…）。
   * @param payload - 载荷（如 upgrade 的目标版本）。
   */
  controlInstance(instanceId: string, command: 'stop' | 'start' | 'upgrade', payload: Record<string, unknown> = {}): void {
    this.ctx.channel.sendControl(instanceId, { type: command, payload })
  }

  /**
   * 部署新实例（模板实例化）：登记档案并下发 deploy 指令。v1 为编排意图
   * 记录 + 指令回环；实际部署（clone 模板→新 profile→起进程）由 agent 执行。
   */
  deployInstance(record: InstanceRecord): void {
    this.setInstanceRecord(record)
    this.ctx.channel.sendControl(record.host, { type: 'deploy', payload: { instanceId: record.id, version: record.version } })
  }

  // --- inbox（系统事件消息，实例级，按 owner 隔离） ---

  /**
   * 发布系统事件消息到指定 owner 的 inbox。
   * @param owner - 归属用户。
   * @param sender - 来源实例 id。
   * @param type - 消息类型。
   * @param title - 标题。
   * @param body - 正文。
   */
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
