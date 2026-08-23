/**
 * dsh-desk slots 型插件显隐控制器：订阅 `assembler.slots.<id>.visible` 配置，
 * 对官方插槽 occupant（无 entry 元素可搬、位置由官方宿主决定）做**显隐**——
 * 通过 CSS 覆盖隐藏（与工具入口组装器同机制），配置恢复时移除覆盖。
 *
 * 范围（源码确认，2026-08）：v1 只做 **git-graph**（会话前分支选择 chip +
 * 图谱对话框，`data-dsh-plugin="git-graph"` 稳定标记）。better-sidebar 是
 * 整体工作台框架（自带面板 toggle），不纳入组装——它自己的配置管。
 *
 * 机制：`[data-dsh-plugin="git-graph"]{display:none}` 同时覆盖 chip 与 dialog；
 * 选择器限定 data-dsh-plugin（vendored 稳定标记），与组装器 CSS 覆盖同契约。
 */

import type { AssembledSlotId, AssemblerConfig } from '../index'

/** slots 型插件的 DOM 标记（vendored 稳定 data 属性，源码确认）。 */
const SLOT_SELECTORS: Record<AssembledSlotId, string> = {
  gitGraph: '[data-dsh-plugin="git-graph"]',
}

/** 隐藏规则 style 标签的幂等标记。 */
const STYLE_TAG = 'style[data-plugin-css="@dsh-desk/slot-hider"]'

/** 读取 slots 配置（缺省全部可见）。 */
function resolveSlots(snapshot: unknown): AssemblerConfig['slots'] {
  const value = snapshot as { value?: { assembler?: AssemblerConfig } } | undefined
  return value?.value?.assembler?.slots ?? {}
}

/** slots 控制器 disposer。 */
export type SlotsControllerDisposer = () => void

/**
 * 启动 slots 型插件显隐控制器：订阅配置变更，按 slots.<id>.visible 注入/移除
 * 隐藏 CSS。
 * @param snapshot - 当前 settings 快照（读 slots 配置；可传 undefined 用默认）。
 * @param subscribe - settings 订阅入口（配置变更时重读并应用）。
 * @param getSnapshot - settings 快照读取（配合 subscribe）。
 * @returns disposer（退订 + 移除注入的 style）。
 */
export function startSlotsController(
  snapshot?: unknown,
  subscribe?: (fn: () => void) => () => void,
  getSnapshot?: () => unknown,
): SlotsControllerDisposer {
  let hiddenCss = ''

  /** 应用当前配置：为 visible=false 的 slot 生成隐藏规则。 */
  const apply = (useLive = false): void => {
    const slots = resolveSlots(useLive && getSnapshot !== undefined ? getSnapshot() : snapshot)
    const rules: string[] = []
    for (const [id, selector] of Object.entries(SLOT_SELECTORS) as Array<[AssembledSlotId, string]>) {
      if (slots[id]?.visible === false) rules.push(`${selector}{display:none}`)
    }
    const next = rules.join('')
    if (next === hiddenCss) return
    hiddenCss = next
    const tag = document.querySelector<HTMLStyleElement>(STYLE_TAG)
    if (next === '') {
      tag?.remove()
    } else {
      if (tag === null) {
        const el = document.createElement('style')
        el.dataset.plugin = 'dsh-desk'
        el.dataset.pluginCss = '@dsh-desk/slot-hider'
        document.head.appendChild(el)
        el.textContent = next
      } else {
        tag.textContent = next
      }
    }
  }

  apply(false)
  const unsubscribe = subscribe === undefined ? () => {} : subscribe(() => apply(true))
  return () => {
    unsubscribe()
    document.querySelector<HTMLStyleElement>(STYLE_TAG)?.remove()
    hiddenCss = ''
  }
}
