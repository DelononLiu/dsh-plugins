/**
 * 布局设置页（settings.section 内容）：布局区显隐 + 工具入口。
 *
 * 样式对齐官方设置行契约（ui-conversation EnterBehaviorRow 同款）：
 * `.row`（flex、padding 16px 0、border-bottom l2）+ title 14/primary +
 * desc 12/tertiary + 右侧控件（AGENTS.md「UI 默认与官方一致」）。
 */

import { useState } from 'react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { AssemblerConfig, AssembledToolId } from '../index'

/** 设置页 section 插槽注入的 props。 */
export type LayoutControlProps = PropsRuntime<'settings.section'>

/** 布局区。 */
export const REGIONS = ['topbar', 'tabs', 'sidebar'] as const
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
}

const REGION_DESC: Record<Region, string> = {
  topbar: '实例导航入口（quick-nav）',
  tabs: '固定会话标签（dsh-tabs）',
  sidebar: '侧边栏（折叠/展开；tabs/topbar 变更需刷新页面生效）',
}

/** 默认布局。 */
const DEFAULT_LAYOUT: LayoutRecord = {
  topbar: { visible: true, order: 0 },
  tabs: { visible: true, order: 1 },
  sidebar: { visible: true, order: 2, size: '260px' },
}

/** 布局控制组件 props（含 apply 闭包注入的 settings host）。 */
export interface LayoutControlOwnProps {
  host: LayoutHost
}

/** 设置行：标题 + 描述 + 右侧控件（官方 .row 契约）。 */
function Row(props: { title: string; desc?: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '16px 0', borderBottom: '1px solid var(--dsw-alias-border-l2)' }}>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4, paddingRight: 48 }}>
        <div style={{ fontSize: 14, fontWeight: 400, lineHeight: '22px', color: 'var(--dsw-alias-label-primary)' }}>{props.title}</div>
        {props.desc !== undefined && (
          <div style={{ fontSize: 12, fontWeight: 400, lineHeight: '18px', color: 'var(--dsw-alias-label-tertiary)' }}>{props.desc}</div>
        )}
      </div>
      {props.children}
    </div>
  )
}

/** 复选框开关（官方 selector 形态：右侧控件）。 */
function Switch(props: { checked: boolean; onChange: () => void; label: string }): React.JSX.Element {
  return (
    <input
      type="checkbox"
      aria-label={props.label}
      checked={props.checked}
      onChange={props.onChange}
      style={{ width: 16, height: 16, accentColor: 'var(--dsw-alias-state-business-primary)', cursor: 'pointer', flex: 'none' }}
    />
  )
}

/**
 * 渲染「布局」设置页（settings.section 内容列）。
 * @param props - 插槽注入 props + settings host。
 */
export function LayoutControl(props: LayoutControlProps & LayoutControlOwnProps): React.JSX.Element {
  const { host } = props
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
    const current = assembler ?? { tools: {} }
    const prev = current.tools[tool]?.visible ?? true
    const next: AssemblerConfig = {
      ...current,
      tools: { ...current.tools, [tool]: { visible: !prev } },
    }
    setAssembler(next)
    host.set('assembler', next)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: '100%' }}>
      <Row title="布局" desc="各区域显隐配置；侧边栏实时生效，tab/顶部区域变更需刷新页面">
        <span />
      </Row>
      {REGIONS.map((region) => {
        const state = layout?.[region]
        const visible = state?.visible ?? true
        return (
          <Row key={region} title={REGION_LABEL[region]} desc={REGION_DESC[region]}>
            <Switch checked={visible} onChange={() => toggle(region)} label={REGION_LABEL[region]} />
          </Row>
        )
      })}
      <Row title="工具入口（侧边栏控制台上方）" desc="task-board / SSH / 技能中心的入口行摆位开关（实时生效）">
        <span />
      </Row>
      {TOOLS.map((tool) => {
        const visible = assembler?.tools[tool]?.visible ?? true
        return (
          <Row key={tool} title={TOOL_LABEL[tool]}>
            <Switch checked={visible} onChange={() => toggleTool(tool)} label={TOOL_LABEL[tool]} />
          </Row>
        )
      })}
    </div>
  )
}
