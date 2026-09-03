/**
 * dsh-console 控制台面板：主端集群控制台（settings 面板契约）。
 *
 * 照抄官方 settings 面板结构（overlay/mask/panel + nav rail + content 换页）。
 * 数据面经 ConsoleHost（typert ctx.remote.console.listInstances/controlInstance +
 * channel.brokerStatus）。v1 页签：总览 / 实例 / 主机守护 / 部署 / 升级。
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { ConsoleHost } from './types'
import type { ConsoleInstanceViewItem } from 'dsh-console/types'

// ---- 页签定义 ----
type TabId = 'overview' | 'instances' | 'hosts' | 'deploy' | 'upgrade'
const TABS: Array<{ id: TabId; label: string; icon: string }> = [
  { id: 'overview', label: '总览', icon: '▤' },
  { id: 'instances', label: '实例', icon: '☰' },
  { id: 'hosts', label: '主机 / 守护', icon: '⛁' },
  { id: 'deploy', label: '部署主机', icon: '＋' },
  { id: 'upgrade', label: '升级', icon: '⇪' },
]

/** 控制台面板 props。 */
export interface ConsolePanelProps {
  host: ConsoleHost
  onClose: () => void
}

/** 实例行（列表/升级共用）。 */
function InstanceRow(props: {
  item: ConsoleInstanceViewItem
  host: ConsoleHost
  checked?: boolean
  statusBadge?: React.ReactNode
}): React.JSX.Element {
  const { item, host, checked, statusBadge } = props
  const online = item.status === 'online'
  const canJump = online && item.addr !== '' && item.id !== 'self'
  return (
    <div className={`dsh-console-row${checked ? ' sel' : ''}`}>
      {checked !== undefined && <span className="dsh-console-chk">✓</span>}
      <span className={`dot ${online ? 'on' : 'off'}`} />
      <div className="grow">
        <div className="name">{item.name}</div>
        <div className="meta">{item.host ?? item.id}{item.self ? '（本端）' : ''} · {online ? '在线' : '离线'}</div>
      </div>
      <span className="dsh-console-ver">{item.version ?? '—'}</span>
      {statusBadge}
      {!checked && (
        <>
          {canJump && (
            <button type="button" className="dsh-console-btn" title="打开此实例" onClick={() => { window.open(item.addr, '_blank', 'noopener') }}>
              跳转⧉
            </button>
          )}
          <button type="button" className="dsh-console-btn" title={online ? '停止' : '启动'} onClick={() => { void host.controlInstance(item.id, online ? 'stop' : 'start') }}>
            {online ? '停止' : '启动'}
          </button>
          <button type="button" className="dsh-console-btn danger" title="重启" onClick={() => { void host.controlInstance(item.id, 'restart') }}>
            重启
          </button>
        </>
      )}
    </div>
  )
}

/** 统计卡。 */
function Stat(props: { value: number | string; label: string; detail: string; color?: string }): React.JSX.Element {
  return (
    <div className="dsh-console-stat">
      <div className="dsh-console-stat-n" style={props.color ? { color: props.color } : undefined}>{props.value}</div>
      <div className="dsh-console-stat-l">{props.label}</div>
      <div className="dsh-console-stat-d">{props.detail}</div>
    </div>
  )
}

export function ConsolePanel(props: ConsolePanelProps): React.JSX.Element {
  const { host, onClose } = props
  const [tab, setTab] = useState<TabId>('overview')
  const [instances, setInstances] = useState<ConsoleInstanceViewItem[]>([])
  const [loaded, setLoaded] = useState(false)
  // 部署表单 + 生成结果
  const [deployHost, setDeployHost] = useState('')
  const [deployName, setDeployName] = useState('')
  const [deployVersion, setDeployVersion] = useState('0.1.2-rc.1')
  const [deployAlias, setDeployAlias] = useState('')
  const [deployResult, setDeployResult] = useState<{ commands: string[]; error?: string; ok: boolean } | null>(null)
  const [deployBusy, setDeployBusy] = useState(false)

  const genBootstrap = async (): Promise<void> => {
    if (!deployHost || !deployName) { setDeployResult({ ok: false, commands: [], error: '请填写主机 SSH 地址与实例名称' }); return }
    setDeployBusy(true)
    try {
      const r = await host.bootstrapHost(deployName, deployHost, deployVersion || undefined)
      setDeployResult({ ok: r.ok, commands: r.sshCommands ?? [], error: r.error })
    } catch (e) {
      setDeployResult({ ok: false, commands: [], error: e instanceof Error ? e.message : String(e) })
    } finally {
      setDeployBusy(false)
    }
  }

  // 首次打开拉实例列表
  useEffect(() => {
    let alive = true
    void host.listInstances()
      .then((v) => { if (alive) { setInstances(v.instances ?? []); setLoaded(true) } })
      .catch(() => { if (alive) setLoaded(true) })
    void host.brokerStatus().catch(() => {})
    return () => { alive = false }
  }, [host])

  // Escape 关闭 + 焦点到关闭钮（照抄官方 SettingsPanel）
  const closeRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKeyDown)
    closeRef.current?.focus()
    return () => { document.removeEventListener('keydown', onKeyDown) }
  }, [onClose])

  const close = useCallback(() => onClose(), [onClose])
  const online = instances.filter((i) => i.status === 'online').length
  const hostCount = new Set(instances.map((i) => i.host ?? i.id)).size

  const view = (): React.JSX.Element => {
    switch (tab) {
      case 'overview':
        return (
          <>
            <div className="dsh-console-stats">
              <Stat value={instances.length} label="实例总数" detail={loaded ? '刷新于刚刚' : '加载中…'} />
              <Stat value={online} label="在线" detail="含离线覆盖" color="var(--dsw-alias-state-success-primary)" />
              <Stat value={hostCount} label="主机" detail="含管理端" />
              <Stat value={0} label="部署中" detail="暂无进行中" color="var(--dsw-alias-brand-primary)" />
            </div>
            <div className="dsh-console-sect"><h3>最近事件</h3><button type="button" className="dsh-console-more" onClick={() => setTab('instances')}>查看全部 →</button></div>
            {!loaded && <div className="dsh-console-toolbar"><span className="hint">加载中…</span></div>}
            {loaded && instances.slice(0, 5).map((i) => (
              <div className="dsh-console-row" key={i.id}>
                <span className={`dot ${i.status === 'online' ? 'on' : 'off'}`} />
                <div className="grow">
                  <div className="name">{i.name} <span style={{ color: 'var(--dsw-alias-label-tertiary)', fontSize: 12 }}>· {i.host ?? i.id}</span></div>
                  <div className="meta">{i.version ?? '—'}</div>
                </div>
                <span style={{ color: i.status === 'online' ? 'var(--dsw-alias-state-success-primary)' : 'var(--dsw-alias-state-error-primary)', fontSize: 11 }}>
                  {i.status === 'online' ? '● 在线' : '● 离线'}
                </span>
              </div>
            ))}
          </>
        )
      case 'instances':
        return (
          <>
            <div className="dsh-console-toolbar">
              <span className="hint">{instances.length} 个实例</span>
              <div className="grow" />
              <button type="button" className="dsh-console-btn">新建实例</button>
              <button type="button" className="dsh-console-btn primary" onClick={() => setTab('upgrade')}>批量升级</button>
            </div>
            {loaded && instances.map((i) => <InstanceRow key={i.id} item={i} host={host} />)}
          </>
        )
      case 'hosts':
        return (
          <>
            <div className="dsh-console-toolbar">
              <span className="hint">{hostCount} 台主机</span>
              <div className="grow" />
              <button type="button" className="dsh-console-btn primary" onClick={() => setTab('deploy')}>＋ 部署主机</button>
            </div>
            {loaded && [...new Set(instances.map((i) => i.host ?? i.id))].map((h) => {
              const onHost = instances.filter((i) => (i.host ?? i.id) === h)
              const anyOnline = onHost.some((i) => i.status === 'online')
              return (
                <div className="dsh-console-row" key={h}>
                  <span className={`dot ${anyOnline ? 'on' : 'off'}`} />
                  <div className="grow">
                    <div className="name">{h} <span style={{ color: 'var(--dsw-alias-label-tertiary)', fontSize: 12 }}>· 守护 daemon</span></div>
                    <div className="meta">{onHost.length} 个实例</div>
                  </div>
                  <button type="button" className="dsh-console-btn">主机详情</button>
                </div>
              )
            })}
          </>
        )
      case 'deploy':
        return (
          <>
            <div className="dsh-console-sect"><h3>部署新主机</h3></div>
            <div className="dsh-console-formrow">
              <div className="dsh-console-field"><label>主机 SSH 地址</label><input className="dsh-console-input" placeholder="user@10.0.0.15" value={deployHost} onChange={(e) => setDeployHost(e.target.value)} /></div>
              <div className="dsh-console-field"><label>实例名称</label><input className="dsh-console-input" placeholder="web5" value={deployName} onChange={(e) => setDeployName(e.target.value)} /></div>
            </div>
            <div className="dsh-console-formrow">
              <div className="dsh-console-field"><label>发行包版本</label><input className="dsh-console-input" placeholder="0.1.2-rc.1" value={deployVersion} onChange={(e) => setDeployVersion(e.target.value)} /></div>
              <div className="dsh-console-field"><label>主机别名（可选）</label><input className="dsh-console-input" placeholder="工作机 C" value={deployAlias} onChange={(e) => setDeployAlias(e.target.value)} /></div>
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
              <button type="button" className="dsh-console-btn" onClick={() => { void genBootstrap() }} disabled={deployBusy}>{deployBusy ? '生成中…' : '生成引导命令'}</button>
            </div>
            {deployResult && !deployResult.ok && (
              <div className="dsh-console-code" style={{ color: 'var(--dsw-alias-state-error-primary)' }}>✗ {deployResult.error}</div>
            )}
            {deployResult && deployResult.ok && deployResult.commands.length > 0 && (
              <>
                <div className="dsh-console-steps">
                  {[['① 生成令牌', 'done'], ['② 推发行包', 'todo'], ['③ 启动守护', 'todo'], ['④ 实例注册', 'todo']].map(([c, s]) => (
                    <div className={`dsh-console-step ${s === 'done' ? 'done' : ''}`} key={c}><div className="b" /><div className="c">{c}</div></div>
                  ))}
                </div>
                <div style={{ marginTop: 14, display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span className="hint" style={{ fontSize: 12, color: 'var(--dsw-alias-label-secondary)' }}>在目标主机执行以下命令完成引导：</span>
                  <button type="button" className="dsh-console-btn" onClick={() => { void navigator.clipboard?.writeText(deployResult.commands.join('\n')) }}>复制全部</button>
                </div>
                <div className="dsh-console-code">{deployResult.commands.map((c) => `$ ${c}`).join('\n')}</div>
              </>
            )}
          </>
        )
      case 'upgrade':
        return (
          <>
            <div className="dsh-console-toolbar">
              <span className="hint">选择要升级的实例</span>
              <div className="grow" />
              <select className="dsh-console-select" defaultValue="0.1.2-rc.1">
                <option value="0.1.2-rc.1">目标：0.1.2-rc.1</option>
                <option value="0.1.1-rc.2">0.1.1-rc.2</option>
              </select>
              <button type="button" className="dsh-console-btn primary">升级所选（0）</button>
            </div>
            {loaded && instances.map((i) => (
              <InstanceRow key={i.id} item={i} host={host} checked statusBadge={<span className="dsh-console-badge idle">最新</span>} />
            ))}
          </>
        )
    }
  }

  return (
    <div className="dsh-console-panel-overlay" role="presentation">
      <div className="dsh-console-panel-mask" aria-hidden="true" onClick={close} />
      <div className="dsh-console-panel" role="dialog" aria-modal="true" aria-label="dsh 控制台">
        <nav className="dsh-console-nav">
          <div className="dsh-console-nav-brand">
            <span style={{ width: 22, height: 22, borderRadius: 6, background: 'linear-gradient(135deg,#60a5fa,#818cf8)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: '#0b1220' }}>d</span>
            dsh 控制台
          </div>
          <div className="dsh-console-nav-title">导航</div>
          <div className="dsh-console-nav-list">
            {TABS.map((t) => (
              <button key={t.id} type="button" className={`dsh-console-nav-cell${tab === t.id ? ' active' : ''}`} aria-current={tab === t.id ? 'true' : undefined} onClick={() => setTab(t.id)}>
                <span className="dsh-console-nav-icon" aria-hidden="true">{t.icon}</span>
                <span>{t.label}</span>
              </button>
            ))}
          </div>
          <div className="dsh-console-nav-foot">管理端 console<br />v0.1.2-rc.1 · broker OK</div>
        </nav>
        <div className="dsh-console-content">
          <div className="dsh-console-header">
            <div className="dsh-console-title">{TABS.find((t) => t.id === tab)?.label}</div>
            <button ref={closeRef} type="button" className="dsh-console-close" onClick={close} aria-label="关闭">✕</button>
          </div>
          <div className="dsh-console-options">{view()}</div>
        </div>
      </div>
    </div>
  )
}
