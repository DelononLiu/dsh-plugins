/**
 * dsh-console client 共享类型：ConsoleHost（控制台数据面，apply 注入）+ 视图。
 */
import type { BrokerStatusView } from 'dsh-channel/types'
import type {
  BootstrapResult, ConsoleInstanceView, ControlResult, DeployInstanceRequest,
  LogFileList, LogReadOptions, LogReadResult, UpgradeBatchResult,
} from 'dsh-console/types'

/** ConsoleHost 数据源（apply 注入：typert remote 面）。 */
export interface ConsoleHost {
  listInstances(): Promise<ConsoleInstanceView>
  controlInstance(instanceId: string, command: 'stop' | 'start' | 'upgrade' | 'restart'): Promise<ControlResult>
  brokerStatus(): Promise<BrokerStatusView>
  /** 半自动部署新主机：生成 agent 部署物 + SSH 引导命令（用户执行）。 */
  bootstrapHost(instanceId: string, hostAddr: string, version?: string, alias?: string): Promise<BootstrapResult>
  /** 部署新实例（期望状态声明 → daemon 复用本地发行包拉起）。 */
  deployInstance(request: DeployInstanceRequest): Promise<ControlResult>
  /** 统一升级：多选实例 → 守护执行（快照→对齐发行包→滚动重启→失败回滚）。 */
  upgradeInstances(instanceIds: string[], version: string): Promise<UpgradeBatchResult>
  /** 列日志文件（v1：daemon 角色本机；console 角色仅自身 console.log）。 */
  listLogFiles(): Promise<LogFileList>
  /** 读日志（target.kind: 'daemon' = 守护自身/console.log；'instance' = 指定实例）。 */
  readLog(target: { kind: 'daemon' } | { kind: 'instance'; instanceId: string }, opts: LogReadOptions): Promise<LogReadResult>
}
