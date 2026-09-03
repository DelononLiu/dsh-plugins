/**
 * dsh-console 公共类型子路径（./types）——Remote 边界类型必须从非根
 * 子路径导出（typert generator 规则），供跨包消费与类型契约。
 */

/** 实例特殊类型（可扩展枚举，已定）。 */
export type InstanceType = 'normal' | 'shared' | 'host'

/** 实例管理档案：在通信层实例身份上扩展管理概念。 */
export interface InstanceRecord {
  /** 稳定实例 id。 */
  id: string
  /** 展示名。 */
  name: string
  /** 可达地址。 */
  addr: string
  /** 在线状态。 */
  status: 'online' | 'offline'
  /** 健康状态（可选）。 */
  health?: string
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

/** 控制指令结果。 */
export interface ControlResult {
  ok: boolean
  error?: string
  /** 已下发指令的幂等 id。 */
  commandId?: string
}

/** 实例列表视图元素（管理面板：独立于档案的展示形态——host/self/离线覆盖）。 */
export interface ConsoleInstanceViewItem {
  /** 稳定实例 id。 */
  id: string
  /** 展示名。 */
  name: string
  /** 可达地址（launch 配置补充，跳转用）。 */
  addr: string
  /** 在线状态（含离线覆盖）。 */
  status: 'online' | 'offline'
  /** 发行包版本。 */
  version?: string
  /** 归属者用户 id（全部实例皆 personal）。 */
  owner?: string
  /** 实例类型。 */
  type?: 'normal' | 'shared' | 'host'
  /** 所属主机名（launch 配置补充）。 */
  host?: string
  /** 当前实例（管理端自己，UI 跳转排除）。 */
  self?: boolean
}

/** 实例列表视图（管理面板：实例 + 主机守护分开）。 */
export interface ConsoleInstanceView {
  /** 实例列表（不含 host-* 守护）。 */
  instances: ConsoleInstanceViewItem[]
  /** 主机守护（host<id>，UI 分别呈现）。 */
  hosts: HostRecord[]
}

/** 新主机引导结果（半自动部署：生成部署物 + SSH 引导命令，用户执行）。 */
export interface BootstrapResult {
  ok: boolean
  error?: string
  /** 实例令牌（32 hex；仅引导前可见一次）。 */
  token?: string
  /** 实例 id（agent-<id> 部署物名）。 */
  instanceId?: string
  /** 生成的 agent profile 目录名。 */
  profileDir?: string
  /** SSH 引导命令序列（scp 推 profile → ssh 起 headless daemon → 注册）。 */
  sshCommands?: string[]
}

/**
 * 部署新实例请求（console → daemon，期望状态声明）。
 * daemon 复用本地已装发行包：建 dshHome + patch 实例化 + daemonStart。
 */
export interface DeployInstanceRequest {
  /** 目标 daemon 的 relay agent 名（如 host1）。 */
  host: string
  /** 新实例 id（如 web6）。 */
  instanceId: string
  /** 实例展示名（缺省 = instanceId）。 */
  name?: string
  /** 发行包版本（实例 profile 版本引用）。 */
  version: string
  /** 实例 profile 名（如 web）。 */
  profile: string
  /** 实例 DSH_HOME 目录（如 ~/.dsh-web6）。 */
  dshHome: string
  /** 实例访问地址（跳转用，如 http://127.0.0.1:3086）。 */
  addr?: string
  /** 实例访问端口（webserver；如 3086）。 */
  port?: number
  /** 实例令牌（32 hex，注册/心跳校验；daemon 写入实例 patch）。 */
  token: string
  /** 额外环境变量（如 DSH_RELAY_AGENT/DSH_CONSOLE_ADDR）。 */
  env?: Record<string, string>
}
