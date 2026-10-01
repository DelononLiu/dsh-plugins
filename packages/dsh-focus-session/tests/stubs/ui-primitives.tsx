/**
 * 测试替身：官方 UI 基元包 `@deepseek-ai/dsh-client-ui-primitives` 的轻量替身。
 *
 * 运行时本包经 ModuleLoader 共享模块拿到官方实现（client bundle 里是
 * `require("@deepseek-ai/dsh-client-ui-primitives")`）；但官方发布的 `lib/index.js`
 * 还引用未随包发布的 `simple-icons`，且以 `.module.css` 实现样式，node/vitest 直接
 * 加载会失败。本替身只保留本插件用到的面，形态与官方一致（MenuItemButton = 一个
 * `role="menuitem"` 按钮、Tooltip = 带 title 的包裹元素、图标 = 16px svg）。
 * 真实导入名与类型由 `typecheck` 对着官方 .d.ts 把关。
 */

import type { ReactNode } from 'react'

/** 造一个占位图标组件（官方图标都是 16 viewBox、currentColor 描边的 svg）。 */
function icon(name: string): (props: { size?: number; className?: string }) => ReactNode {
  return (props) => (
    <svg
      data-stub-icon={name}
      className={props.className}
      width={props.size ?? 16}
      height={props.size ?? 16}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      aria-hidden="true"
    >
      <path d="M2 8h12" />
    </svg>
  )
}

export const IconGlobeOutlineRegular = icon('globe-outline')
export const IconPinOutlineRegular = icon('pin-outline')
export const IconPinFillRegular = icon('pin-fill')
export const IconEditOutlineRegular = icon('edit-outline')
export const IconArchiveOutlineRegular = icon('archive-outline')
export const IconUnarchiveOutlineRegular = icon('unarchive-outline')
export const IconBranchOutlineRegular = icon('branch-outline')
export const IconListPenOutlineRegular = icon('list-pen-outline')

/** 官方 `.Menu_cell` 行（本插件只用到 icon/label/onSelect/keyboard 语义）。 */
export function MenuItemButton(props: {
  children?: ReactNode
  icon?: ReactNode
  disabled?: boolean
  onSelect: () => void
}): ReactNode {
  return (
    <button type="button" role="menuitem" disabled={props.disabled === true} onClick={props.onSelect}>
      {props.icon}
      {props.children}
    </button>
  )
}

/** 官方 Tooltip（替身：title + 原样渲染触发元素）。 */
export function Tooltip(props: { label: string; children?: ReactNode }): ReactNode {
  return <span data-stub-tooltip={props.label}>{props.children}</span>
}

/** 官方 Modal（替身：body 上的对话框；开/关/描述与关闭回调语义保留）。 */
export function Modal(props: {
  open: boolean
  onClose: () => void
  title: string
  closeLabel: string
  description?: string
  children?: ReactNode
  footer?: ReactNode
}): ReactNode {
  if (!props.open) return null
  return (
    <div data-stub-modal="" role="dialog" aria-label={props.title}>
      <h2>{props.title}</h2>
      {props.description !== undefined ? <p data-stub-modal-description="">{props.description}</p> : null}
      <button type="button" aria-label={props.closeLabel} onClick={props.onClose}>✕</button>
      {props.children}
      {props.footer}
    </div>
  )
}

/** 官方 Button（替身：保留 variant 标记与原生按钮语义）。 */
export function Button(props: {
  children?: ReactNode
  variant?: string
  disabled?: boolean
  style?: Record<string, string>
  onClick?: () => void
}): ReactNode {
  return (
    <button
      type="button"
      data-variant={props.variant}
      disabled={props.disabled === true}
      style={props.style}
      onClick={props.onClick}
    >
      {props.children}
    </button>
  )
}

/** 官方 Input（替身：原生 input，value/onChange/onKeyDown/aria 透传）。 */
export function Input(props: {
  value?: string
  onChange?: (e: { target: { value: string } }) => void
  onKeyDown?: (e: { key: string; preventDefault: () => void }) => void
  placeholder?: string
  disabled?: boolean
  'aria-label'?: string
  'data-modal-autofocus'?: boolean
}): ReactNode {
  return (
    <input
      value={props.value}
      disabled={props.disabled === true}
      placeholder={props.placeholder}
      aria-label={props['aria-label']}
      data-modal-autofocus={props['data-modal-autofocus'] === true ? '' : undefined}
      onChange={(e) => { props.onChange?.({ target: { value: e.target.value } }) }}
      onKeyDown={(e) => { props.onKeyDown?.({ key: e.key, preventDefault: () => { e.preventDefault() } }) }}
    />
  )
}
