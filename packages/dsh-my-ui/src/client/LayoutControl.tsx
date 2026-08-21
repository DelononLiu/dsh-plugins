/**
 * 布局控制（四区开关）：经 settingsScope host 读写布局配置（真实持久化）。
 */

import { useState } from 'react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'


/** 会话头部动作插槽注入的 props。 */
export type LayoutControlProps = PropsRuntime<'settings.general.item'>

/** 四区。 */
export const REGIONS = ['topbar', 'tabs', 'sidebar', 'actions'] as const
export type Region = (typeof REGIONS)[number]

/** 单区布局。 */
export interface RegionState { visible: boolean; order: number; size?: string }
export type LayoutRecord = Record<Region, RegionState>

/** settingsScope host 契约（读快照/写字段/订阅）。 */
export interface LayoutHost {
  getSnapshot(): { value: { layout?: LayoutRecord } | undefined }
  set(field: string, value: unknown): void
  subscribe(fn: () => void): () => void
}

const REGION_LABEL: Record<Region, string> = {
  topbar: '顶部区域',
  tabs: 'tab 区',
  sidebar: '侧边栏',
  actions: '左侧按钮区',
}

/** 布局控制组件 props（含 apply 闭包注入的 settings host）。 */
export interface LayoutControlOwnProps {
  host: LayoutHost
}

/**
 * 渲染「布局」入口 + 四区开关浮层。
 * @param props - 插槽注入 props + settings host。
 */
export function LayoutControl(props: LayoutControlProps & LayoutControlOwnProps): React.JSX.Element {
  const { host } = props
  const [open, setOpen] = useState(false)
  const [layout, setLayout] = useState<LayoutRecord | undefined>(() => host.getSnapshot().value?.layout)

  // 订阅 settings 变更（其他端/页面刷新）
  useState(() => {
    host.subscribe(() => setLayout(host.getSnapshot().value?.layout))
  })

  const toggle = (region: Region): void => {
    const current = layout ?? { topbar: { visible: true, order: 0 }, tabs: { visible: true, order: 1 }, sidebar: { visible: true, order: 2, size: '260px' }, actions: { visible: true, order: 3 } }
    const next = { ...current, [region]: { ...current[region], visible: !current[region].visible } }
    setLayout(next)
    host.set('layout', next)
  }

  return (
    <span style={{ position: 'relative', display: 'inline-flex' }}>
      <button
        type="button"
        title="布局设置（四区显隐）"
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
            width: 200, padding: '8px 10px', borderRadius: 6, border: '1px solid #444',
            background: '#1e1e1e', color: '#eee', fontSize: 12,
            boxShadow: '0 4px 12px rgba(0,0,0,.35)',
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
          <div style={{ marginTop: 6, opacity: 0.6, fontSize: 11 }}>
            配置经 settings 持久化（区域显隐的跨插件协调后续）
          </div>
        </div>
      )}
    </span>
  )
}
