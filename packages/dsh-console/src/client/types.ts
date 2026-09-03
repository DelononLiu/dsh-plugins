/**
 * dsh-console client 共享类型：ConsoleHost（控制台数据面，apply 注入）+ 视图。
 */
import type { BrokerStatusView } from 'dsh-channel/types'
import type { BootstrapResult, ConsoleInstanceView, ControlResult, DeployInstanceRequest } from 'dsh-console/types'

/** ConsoleHost 数据源（apply 注入：typert remote 面）。 */
export interface ConsoleHost {
  listInstances(): Promise<ConsoleInstanceView>
  controlInstance(instanceId: string, command: 'stop' | 'start' | 'upgrade' | 'restart'): Promise<ControlResult>
  brokerStatus(): Promise<BrokerStatusView>
  /** 半自动部署新主机：生成 agent 部署物 + SSH 引导命令（用户执行）。 */
  bootstrapHost(instanceId: string, hostAddr: string, version?: string): Promise<BootstrapResult>
  /** 部署新实例（期望状态声明 → daemon 复用本地发行包拉起）。 */
  deployInstance(request: DeployInstanceRequest): Promise<ControlResult>
}
