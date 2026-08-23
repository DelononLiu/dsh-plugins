/**
 * 布局控制（四区开关 + 组装器配置）：经 settingsScope host 读写布局/组装器配置。
 *
 * 样式对齐官方设计语言（ConsoleBadge 面板同款）：浮动层 bg-layer-2 +
 * shadow-lv2 + 圆角 8 + border-l2 + token 文字色（AGENTS.md「UI 默认与官方一致」）。
 */

import { useState } from 'react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { AssemblerConfig, AssembledToolId } from '../index'

/** 会话头部动作插槽注入的 props。 */
export type LayoutControlProps = PropsRuntime<'settings.general.item'>

/** 四区。 */
export const REGIONS = ['topbar', 'tabs', 'sidebar', 'actions'] as const
export type Region = (typeof REGIONS)[number]

/** 单区布局。 */
export interface RegionState { visible: boolean; order: number; size?: string }
export type LayoutRecord = Record<Region, RegionState>

/** 组装器工具（与 host AssemblerConfig 对齐）。 */
export const TOOLS: AssembledToolId[] = ['taskboard', 'ssh', 'skill']
const TOOL_LABEL: Record<AssembledToolId, string> = {
  taskboard: '任务看板',
  ssh: 'SSH',
  skill: '技能中心',
}

/** settingsScope host 契约（读快照/写字段/订阅）。 */
export interface LayoutHost {
  getSnapshot(): { value: { layout?: LayoutRecord; assembler?: AssemblerConfig } | undefined }
  set(field: string, value: unknown): void
  subscribe(fn: () => void): () => void
}

const REGION_LABEL: Record<Region, string> = {
  topbar: '顶部区域',
  tabs: 'tab 区',
  sidebar: '侧边栏',
  actions: '左侧按钮区',
}

/** 默认布局。 */
const DEFAULT_LAYOUT: LayoutRecord = {
  topbar: { visible: true, order: 0 },
  tabs: { visible: true, order: 1 },
  sidebar: { visible: true, order: 2, size: '260px' },
  actions: { visible: true, order: 3 },
}

/** 布局控制组件 props（含 apply 闭包注入的 settings host）。 */
export interface LayoutControlOwnProps {
  host: LayoutHost
}

/**
 * 渲染「布局」入口 + 四区开关 + 组装器配置浮层。
 * @param props - 插槽注入 props + settings host。
 */
export function LayoutControl(props: LayoutControlProps & LayoutControlOwnProps): React.JSX.Element {
  const { host } = props
  const [open, setOpen] = useState(false)
  const [layout, setLayout] = useState<LayoutRecord | undefined>(() => host.getSnapshot().value?.layout)
  const [assembler, setAssembler] = useState<AssemblerConfig | undefined>(() => host.getSnapshot().value?.assembler)

  // 订阅 settings 变更（其他端/页面刷新）
  useState(() => {
    host.subscribe(() => {
      const snap = host.getSnapshot().value
      setLayout(snap?.layout)
      setAssembler(snap?.assembler)
    })
  })

  const toggle = (region: Region): void => {
    const current = layout ?? DEFAULT_LAYOUT
    const next = { ...current, [region]: { ...current[region], visible: !current[region].visible } }
    setLayout(next)
    host.set('layout', next)
  }

  const toggleTool = (tool: AssembledToolId): void => {
    const current = assembler ?? { footSpacing: 2, tools: {} }
    const prev = current.tools[tool]?.visible ?? true
    const next: AssemblerConfig = {
      ...current,
      tools: { ...current.tools, [tool]: { visible: !prev } },
    }
    setAssembler(next)
    host.set('assembler', next)
  }

  const setSpacing = (value: number): void => {
    const current = assembler ?? { footSpacing: 2, tools: {} }
    const next: AssemblerConfig = { ...current, footSpacing: value }
    setAssembler(next)
    host.set('assembler', next)
  }

  return (
    <span style={{ position: 'relative', display: 'inline-flex' }}>
      <button
        type="button"
        title="布局与工具设置"
        onClick={() => setOpen((v) => !v)}
        style={{
          display: 'inline-flex', alignItems: 'center', padding: '2px 8px',
          borderRadius: 4, border: '1px solid currentColor', background: 'transparent',
          color: 'inherit', fontSize: 12, cursor: 'pointer',
        }}
      >
        布局
      </button>
      {open && (
        <div
          style={{
            position: 'absolute', top: 'calc(100% + 4px)', right: 0, zIndex: 1000,
            width: 240, padding: '8px 10px',
            // 官方设计语言：层级背景 + 官方阴影 + 官方圆角/边框层级（同 ConsoleBadge 面板）
            borderRadius: 8,
            border: '1px solid var(--dsw-alias-border-l2)',
            background: 'var(--dsw-alias-bg-layer-2)',
            color: 'var(--dsw-alias-label-primary)',
            fontSize: 12,
            boxShadow: 'var(--dsw-shadow-lv2)',
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 6 }}>布局（四区显隐）</div>
          {REGIONS.map((region) => {
            const state = layout?.[region]
            const visible = state?.visible ?? true
            return (
              <label key={region} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={visible}
                  onChange={() => toggle(region)}
                />
                {REGION_LABEL[region]}
              </label>
            )
          })}
          <div style={{ marginTop: 8, paddingTop: 6, borderTop: '1px solid var(--dsw-alias-border-l2)', fontWeight: 600, marginBottom: 4 }}>
            工具入口（侧边栏 foot 区）
          </div>
          {TOOLS.map((tool) => {
            const visible = assembler?.tools[tool]?.visible ?? true
            return (
              <label key={tool} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={visible}
                  onChange={() => toggleTool(tool)}
                />
                {TOOL_LABEL[tool]}
              </label>
            )
          })}
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
            <span style={{ flex: 1 }}>foot 区间距</span>
            <input
              type="number"
              min={0}
              max={8}
              value={assembler?.footSpacing ?? 2}
              onChange={(e) => setSpacing(Number(e.target.value))}
              style={{ width: 48, background: 'transparent', color: 'inherit', border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 4, padding: '1px 4px' }}
            />
          </label>
          <div style={{ marginTop: 6, opacity: 0.6, fontSize: 11 }}>
            配置经 settings 持久化（四区显隐/tool 摆位/foot 间距）
          </div>
        </div>
      )}
    </span>
  )
}
