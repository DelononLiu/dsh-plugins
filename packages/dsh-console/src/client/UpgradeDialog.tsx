/**
 * 升级对话框：点实例行「⋯ → 升级」打开——实例信息 + 4 步进度 + 过程日志 + 结果。
 * 点「开始升级」→ 调 console.upgradeInstances([id]) 下发守护 → 轮询
 * getUpgradeStatus（1s）直到 done；daemon 落盘状态文件驱动进度。
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { ConsoleInstanceViewItem } from 'dsh-console/types'
import type { ConsoleHost } from './types'
import type { UpgradeStep } from 'dsh-console/types'

/** 步骤展示。 */
const STEPS: Array<{ id: UpgradeStep; label: string }> = [
  { id: 'snapshot', label: '快照' },
  { id: 'align', label: '对齐发行包' },
  { id: 'restart', label: '滚动重启' },
  { id: 'health', label: '健康探测' },
]

/** 步骤 → 展示序号（rollback 归快照位展示为失败态；done 为终点）。 */
const STEP_INDEX: Record<UpgradeStep, number> = { snapshot: 0, align: 1, restart: 2, health: 3, rollback: 0, done: 4 }

export interface UpgradeDialogProps {
  item: ConsoleInstanceViewItem
  host: ConsoleHost
  version: string
  onClose: () => void
}

export function UpgradeDialog(props: UpgradeDialogProps): React.JSX.Element {
  const { item, host, version, onClose } = props
  const [status, setStatus] = useState<{ step: UpgradeStep; done: boolean; ok?: boolean; error?: string; rolledBack?: boolean; message: string } | null>(null)
  const [logs, setLogs] = useState<string[]>([])
  const [busy, setBusy] = useState(false)      // 开始升级下发中
  const [running, setRunning] = useState(false) // 升级已发起（轮询中）
  const startedRef = useRef(false)

  // 开始升级：下发 → 进入轮询。
  const startUpgrade = useCallback(async (): Promise<void> => {
    if (startedRef.current) return
    startedRef.current = true
    setBusy(true)
    try {
      const r = await host.upgradeInstances([item.id], version)
      const res = r.results[0]
      if (res?.ok) {
        setRunning(true)
      } else {
        setLogs((p) => [...p, `✗ 下发失败：${res?.error ?? '未知原因'}`])
        setStatus({ step: 'done', done: true, ok: false, error: res?.error, message: `下发失败：${res?.error ?? ''}` })
      }
    } catch (e) {
      setLogs((p) => [...p, `✗ 下发异常：${e instanceof Error ? e.message : String(e)}`])
      setStatus({ step: 'done', done: true, ok: false, error: e instanceof Error ? e.message : String(e), message: '下发异常' })
    } finally {
      setBusy(false)
    }
  }, [host, item.id, version])

  // 轮询状态（running 时 1s）；新 message 追加日志。
  const poll = useCallback(async (): Promise<void> => {
    if (!startedRef.current) return
    try {
      const s = await host.getUpgradeStatus(item.id)
      const next = { step: s.step, done: s.done, ok: s.ok, error: s.error, rolledBack: s.rolledBack, message: s.message }
      setStatus(next)
      setLogs((prev) => (prev.length > 0 && prev[prev.length - 1] === s.message ? prev : [...prev, s.message]))
      if (s.done) setRunning(false)
    } catch {
      setLogs((p) => [...p, '⚠ 状态查询失败（守护可能不可达）'])
      setRunning(false)
    }
  }, [host, item.id])

  useEffect(() => {
    if (!running) return
    void poll()
    const timer = window.setInterval(() => { void poll() }, 1000)
    return () => window.clearInterval(timer)
  }, [running, poll])

  const cur = status
  const done = cur?.done === true
  const ok = cur?.ok === true
  const failed = done && !ok
  const failIdx = failed && cur ? STEP_INDEX[cur.step] : -1

  return (
    <div className="dsh-console-panel-overlay" role="presentation">
      <div className="dsh-console-panel-mask" aria-hidden="true" onClick={onClose} />
      <div className="dsh-console-panel" role="dialog" aria-modal="true" aria-label="升级实例" style={{ width: 'min(560px, calc(100vw - 48px))', height: 'auto', maxHeight: 'calc(100vh - 140px)', overflow: 'auto' }}>
        <div className="dsh-console-upgrade" style={{ padding: 22, width: '100%', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="dsh-console-upgrade-head" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--dsw-alias-label-primary)' }}>升级 {item.name}</div>
              <div style={{ fontSize: 12, color: 'var(--dsw-alias-label-secondary)', marginTop: 3 }}>
                当前 {item.version || '—'} → <b>{version}</b> · {item.host || '—'}
              </div>
            </div>
            <button type="button" className="dsh-console-close" onClick={onClose} aria-label="关闭">✕</button>
          </div>

          {!startedRef.current && (
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="dsh-console-btn primary" disabled={busy} onClick={() => { void startUpgrade() }}>
                {busy ? '下发中…' : '开始升级'}
              </button>
              <span className="hint" style={{ fontSize: 12, color: 'var(--dsw-alias-label-tertiary)', alignSelf: 'center' }}>
                由守护主机执行：快照 → 对齐发行包 → 滚动重启 → 健康探测，失败自动回滚
              </span>
            </div>
          )}

          {startedRef.current && (
            <div className="dsh-console-steps" style={{ display: 'flex', gap: 6 }}>
              {STEPS.map((s) => {
                const idx = STEP_INDEX[s.id]
                const finished = cur ? (done ? idx <= (ok ? 99 : failIdx) : idx < STEP_INDEX[cur.step] || cur.step === 'health') : false
                const active = cur && !done ? idx === STEP_INDEX[cur.step] : false
                const cls = done && ok ? 'done' : (failed && idx <= failIdx ? 'fail' : active ? 'doing' : finished ? 'done' : '')
                return (
                  <div className={`dsh-console-step ${cls}`} key={s.id} style={{ flex: 1 }}>
                    <div className="b">{done && ok ? '✓' : (failed && idx <= failIdx ? '✗' : (finished || active ? '●' : '○'))}</div>
                    <div className="c">{s.label}</div>
                  </div>
                )
              })}
            </div>
          )}

          {(cur?.message || logs.length > 0) && (
            <div className="dsh-console-upgrade-log" style={{ fontSize: 12, color: 'var(--dsw-alias-label-secondary)', background: 'var(--dsw-alias-bg-layer-1)', border: '1px solid var(--dsw-alias-border-l1)', borderRadius: 10, padding: '10px 12px', lineHeight: 1.8, maxHeight: 180, overflow: 'auto' }}>
              {logs.map((l, i) => (
                <div key={i}>{l}</div>
              ))}
            </div>
          )}

          {done && (
            <div style={{ fontSize: 13, fontWeight: 600, color: ok ? 'var(--dsw-alias-state-success-primary)' : 'var(--dsw-alias-state-error-primary)' }}>
              {ok ? `✓ 升级完成 → ${version}` : `✗ 升级失败${cur?.rolledBack ? '（已回滚）' : ''}：${cur?.error ?? ''}`}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
