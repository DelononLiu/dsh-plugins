/**
 * dsh-console client 共享类型：ConsoleHost（控制台数据面，apply 注入）+ 视图。
 */
import type {
  BootstrapResult, ConsoleInstanceView, ControlResult, DeployInstanceRequest,
  LogFileList, LogReadOptions, LogReadResult, RuntimePoolView, UpgradeBatchResult, UpgradeStatus,
} from 'dsh-console/types'

/** ConsoleHost 数据源（apply 注入：typert remote 面）。 */
export interface ConsoleHost {
  listInstances(): Promise<ConsoleInstanceView>
  controlInstance(instanceId: string, command: 'stop' | 'start' | 'upgrade' | 'restart'): Promise<ControlResult>
  /** 半自动部署新主机：生成 agent 部署物 + SSH 引导命令（用户执行）。 */
  bootstrapHost(instanceId: string, hostAddr: string, version?: string, alias?: string): Promise<BootstrapResult>
  /** 部署新实例（期望状态声明 → daemon 复用本地发行包拉起）。 */
  deployInstance(request: DeployInstanceRequest): Promise<ControlResult>
  /** 统一升级：多选实例 → 守护执行（快照→对齐发行包→滚动重启→失败回滚）。 */
  upgradeInstances(instanceIds: string[], version: string): Promise<UpgradeBatchResult>
  /** 列日志文件（v1：daemon 角色本机；console 角色仅自身 console.log）。 */
  listLogFiles(): Promise<LogFileList>
  /** 删除实例：停进程 → 目录归档（可恢复）→ 档案墓碑；正式 web/本机 daemon 会被拒绝。 */
  deleteInstance(instanceId: string): Promise<ControlResult>
  /** 已删除实例（墓碑）列表：UI「已删除」筛选用（默认隐藏，审计保留在档案）。 */
  listDeletedInstances(): Promise<Array<{ id: string; host: string; deletedAt: string | null; archivePath?: string; version: string | null }>>
  /** 恢复实例：归档目录移回 + 档案转回 active（CLI/UI 同一入口）。 */
  restoreInstance(instanceId: string): Promise<ControlResult>
  /** runtime 池：可用版本 + 引用它们的实例 + 内容自检（版本 = 内核版本）。 */
  listRuntimePool(): Promise<RuntimePoolView>
  /** 导入 runtime 版本到池（池不可变：同版本重复导入被拒绝）。 */
  importRuntimeVersion(version: string, source?: string): Promise<ControlResult>
  /** 删除池内 runtime 版本（被实例引用时拒绝）。 */
  removeRuntimeVersion(version: string): Promise<ControlResult>
  /** 实例模板清单（daemon 的 templateHome 下 profiles/*；创建向导用）。 */
  listTemplates(): Promise<string[]>
  /** 查实例升级状态（进度轮询；daemon 落盘状态文件，console 跨实例转发查询）。 */
  getUpgradeStatus(instanceId: string): Promise<UpgradeStatus>
  /** 读日志（target.kind: 'daemon' = 守护自身/console.log；'instance' = 指定实例）。 */
  readLog(target: { kind: 'daemon' } | { kind: 'instance'; instanceId: string }, opts: LogReadOptions): Promise<LogReadResult>
}
