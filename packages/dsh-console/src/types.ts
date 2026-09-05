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
  /** 主机 id（内部键，可能为 agent 名——UI 不直接展示）。 */
  id: string
  /** 机器地址（守护控制/访问地址，内部用；IP 展示见 ip）。 */
  addr: string
  /** 机器友好名（launch hosts.name；如"本机开发机"）。 */
  name?: string
  /** 机器 IP（launch hosts.ip；如 192.168.1.5）。 */
  ip?: string
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
  /** 主机别名（可选；写入部署物 .dsh-alias，随引导命令传到目标机）。 */
  alias?: string
  /** 生成的 agent profile 目录名。 */
  profileDir?: string
  /** SSH 引导命令序列（scp 推 profile → ssh 起 headless daemon → 注册）。 */
  sshCommands?: string[]
}

/** 升级批次条目结果（单实例；console 编排视角：下发/路由结果）。 */
export interface UpgradeItemResult {
  /** 实例 id。 */
  instanceId: string
  /** 下发/路由是否成功（ok=true 仅代表已交给守护执行；完成经实例状态/事件呈现）。 */
  ok: boolean
  /** 失败原因（未路由/守护不可达等）。 */
  error?: string
}

/** 统一升级批次结果（一次选多个实例 → 各实例下发结果）。 */
export interface UpgradeBatchResult {
  results: UpgradeItemResult[]
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

/** 日志文件元信息（listLogFiles 元素）。 */
export interface LogFileMeta {
  /** 日志标识（实例 id 或 'daemon'）。 */
  id: string
  /** 文件路径（debug/展示用；非读取接口参数）。 */
  path: string
  /** 文件大小（字节）。 */
  size: number
  /** 最后修改时间（epoch ms）。 */
  mtime: number
}

/** 日志读取目标：守护自身 or 指定实例（白名单由 role.instances/launch 校验）。 */
export type LogTarget =
  | { kind: 'daemon' }
  | { kind: 'instance'; instanceId: string }

/** 日志读取选项。 */
export interface LogReadOptions {
  /** 从文件尾部倒推 N 行（默认 200，0=全文）。 */
  tail?: number
  /** 最大字节数（默认 512KB，0=不限）。 */
  maxBytes?: number
}

/** 日志读取结果。 */
export interface LogReadResult {
  /** 文件内容（已截断/截行后）。 */
  content: string
  /** 原始总行数（content 行数 ≤ total）。 */
  total: number
  /** 是否被 maxBytes 截断（true=内容不全）。 */
  truncated: boolean
}

/** 日志列表视图：守护 + 实例（实例列表由 launch 顺序稳定）。 */
export interface LogFileList {
  /** 守护自身日志（如有；可能 null = 未生成过）。 */
  daemon: LogFileMeta | null
  /** 实例日志列表（按 launch 配置顺序；缺日志文件 = 跳过）。 */
  instances: LogFileMeta[]
}

/** 升级事务步骤（进度展示顺序）。 */
export type UpgradeStep =
  | 'snapshot'   // 快照（升级前状态 = 回滚点）
  | 'align'      // 对齐守护发行包源
  | 'restart'    // 滚动重启
  | 'health'     // 健康探测
  | 'rollback'   // 失败回滚
  | 'done'       // 完成（成功或失败终态）

/** 升级状态（daemon 落盘 + console @Remote 查询）。 */
export interface UpgradeStatus {
  /** 实例 id。 */
  instanceId: string
  /** 当前步骤（进度条用）。 */
  step: UpgradeStep
  /** 步骤是否完成。 */
  done: boolean
  /** 目标版本。 */
  version: string
  /** 是否成功（终态）。 */
  ok?: boolean
  /** 错误/回滚信息（失败时）。 */
  error?: string
  /** 是否已回滚。 */
  rolledBack?: boolean
  /** 本步骤开始时间（epoch ms）。 */
  ts: number
  /** 最近事件消息（过程日志用，如"快照完成"）。 */
  message: string
}
