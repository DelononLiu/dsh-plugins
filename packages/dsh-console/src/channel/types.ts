/**
 * 通信面（原 dsh-channel）的实例边界类型。
 *
 * 这些类型出现在通信面的 `@Remote` 方法签名里，而 typert generator 要求边界类型
 * 从公共非根子路径导出——故由 `src/types.ts`（包的 `./types`）转发 `InstanceIdentity`。
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
  /**
   * 实例**自报的运行内核版本**（实例进程内解析自己正在跑的内核，见
   * `src/kernel-version.ts`；拿不到留空，不编造）。老实例不带该字段也合法。
   */
  version?: string
}

/**
 * 跨实例 RPC 传输层错误码（channel 是 typert 的跨主机 carrier——carrier
 * 自身故障不属于任何域方法，故由 channel 声明；参照官方 owner 扩展
 * RemoteErrorDetailsMap 的 merge-extensible 模式）。
 */
declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** 目标侧 typert gateway 未就绪（RPC 帧无法本地执行）。 */
    'gateway-unavailable': {}
    /** 跨实例 RPC 传输/执行失败（非域方法错误）。 */
    'rpc-error': { readonly cause?: string }
  }
}
