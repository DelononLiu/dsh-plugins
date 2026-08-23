/**
 * dsh-channel 公共类型子路径（./types）——Remote 边界类型必须从非根
 * 子路径导出（typert generator 规则），供跨包消费与类型契约。
 */

/** 实例基础身份（实例服务提供者——实例首先是通信层发现的实体）。 */
export interface InstanceIdentity {
  /** 稳定实例 id。 */
  id: string
  /** 展示名。 */
  name: string
  /** 可达地址（跳转/连接用）。 */
  addr: string
  /** 在线状态（由心跳维护）。 */
  status: 'online' | 'offline'
  /** 健康状态（可选）。 */
  health?: string
  /** 发行包版本。 */
  version?: string
}
