/**
 * 实例行版本胶囊的取值与 tooltip（纯函数，供 UI 与单测共用）。
 *
 * 顺序：**自报优先**（实例在线时经通信面自报的运行内核版本 `version`），
 * 缺失才回退**磁盘 runtime 池软链**（`runtimeVersion`，离线也算得出来），
 * 两者皆缺回退占位符。tooltip 写清两个来源，缺哪个标"未上报/未登记"。
 */

/** 版本选择所需的最小形状（ConsoleInstanceViewItem 的子集）。 */
export interface VersionedInstance {
  /** 实例自报的运行内核版本（在线有；探测 identity 写入）。 */
  version?: string
  /** 磁盘 runtime 池版本（离线兜底）。 */
  runtimeVersion?: string
}

/** 版本胶囊文案：自报优先，池软链兜底，皆缺 `—`。 */
export function versionLabel(item: VersionedInstance): string {
  return item.version ?? item.runtimeVersion ?? '—'
}

/** 版本胶囊 tooltip：标注两个来源（自报 / 池软链）。 */
export function versionTitle(item: VersionedInstance): string {
  return `实例自报: ${item.version ?? '未上报'} · 池软链: ${item.runtimeVersion ?? '未登记'}`
}
