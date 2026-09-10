/**
 * dsh-focus-tabs 会话 tab 状态小圆点助手：在会话 tab（button[role=tab]，文本含
 * SESSION_MARK）里维护一个前置状态小圆点，幂等同步。
 *
 * 幂等约束：dsh-focus-tabs 的 applyActive 挂在 body 级 MutationObserver（childList+
 * subtree）上，**任何结构变更都会再触发一次 applyActive**。因此本函数只在
 * 「点不存在→插入」时产生一次结构变更，收敛后（点已存在且状态相同）零变更、
 * 状态变化只改 data-state 属性（属性变更不在观察范围），避免自触发死循环。
 */

import type { RowStatusView } from './session-status'

/** 会话 tab 状态小圆点标记（幂等定位/防重复）。 */
export const TAB_STATUS_ATTR = 'data-dsh-tab-status'

/**
 * 在会话 tab 按钮内维护前置状态小圆点（幂等）：
 * - 状态相同：零 DOM 变更（原节点原样保留）；
 * - 状态变化：只改既有点的 data-state，不重建节点；
 * - 空闲（dot undefined）：移除既有圆点（一次结构变更后收敛）；本就无点则无操作。
 * 圆点插在按钮最前（编号/标题文本之前）；不触碰按钮原有文本与其余子元素。
 * @param button - 会话 tab 按钮。
 * @param view - 该会话当前状态（resolveRowStatus 结果）。
 */
export function renderTabStatusDot(button: HTMLElement, view: RowStatusView): void {
  const state = view.dot
  const dot = button.querySelector<HTMLElement>(`[${TAB_STATUS_ATTR}]`)
  if (state === undefined) {
    dot?.remove()
    return
  }
  if (dot !== null) {
    if (dot.dataset.state !== state) dot.dataset.state = state
    return
  }
  const el = document.createElement('span')
  el.setAttribute(TAB_STATUS_ATTR, '')
  el.dataset.state = state
  button.insertBefore(el, button.firstChild)
}
