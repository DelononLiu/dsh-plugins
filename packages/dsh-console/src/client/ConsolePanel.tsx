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

/** 实例列表静默轮询周期（ms）：部署/引导/升级后无需重开面板即可看到新状态。 */
const REFRESH_LIST_MS = 10_000

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
  onSelect?: () => void
}): React.JSX.Element {
  const { item, host, checked, statusBadge, onSelect } = props
  const online = item.status === 'online'
  const canJump = online && item.addr !== '' && item.id !== 'self'
  return (
    <div
      className={`dsh-console-row${checked ? ' sel' : ''}`}
      onClick={onSelect}
      style={onSelect ? { cursor: 'pointer' } : undefined}
    >
      {checked !== undefined && <span className="dsh-console-chk">✓</span>}
      <span className={`dot ${online ? 'on' : 'off'}`} />
      <div className="grow">
        <div className="name">{item.name}</div>
        <div className="meta">{item.host ?? item.id}{item.self ? '（本端）' : ''} · {online ? '在线' : '离线'}</div>
      </div>
      <span className="dsh-console-ver">{item.version ?? '—'}</span>
      {statusBadge}
      {checked === undefined && (
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
  const [lastUpdated, setLastUpdated] = useState(0)
  /** 已知守护主机（新建实例的目标下拉选项：view.hosts + 实例所属 host 去重）。 */
  const [daemonHosts, setDaemonHosts] = useState<string[]>(['host1'])
  // 部署表单 + 生成结果
  const [deployHost, setDeployHost] = useState('')
  const [deployName, setDeployName] = useState('')
  const [deployVersion, setDeployVersion] = useState('0.1.2-rc.1')
  const [deployAlias, setDeployAlias] = useState('')
  const [deployResult, setDeployResult] = useState<{ commands: string[]; error?: string; ok: boolean; instanceId?: string; alias?: string } | null>(null)
  const [deployBusy, setDeployBusy] = useState(false)
  // 新建实例（deploy 到已上线 daemon）表单
  const [showNewInst, setShowNewInst] = useState(false)
  const [newInstId, setNewInstId] = useState('')
  const [newInstPort, setNewInstPort] = useState('')
  const [newInstHost, setNewInstHost] = useState('host1')
  const [newInstResult, setNewInstResult] = useState<string | null>(null)
  const [newInstBusy, setNewInstBusy] = useState(false)
  // 统一升级：多选实例 → 目标版本 → 下发守护执行
  const [upgradeSel, setUpgradeSel] = useState<Set<string>>(new Set())
  const [upgradeTarget, setUpgradeTarget] = useState('0.1.2-rc.1')
  const [upgradeBusy, setUpgradeBusy] = useState(false)
  const [upgradeLog, setUpgradeLog] = useState<string[]>([])

  const toggleUpgradeSel = (id: string): void => {
    setUpgradeSel((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const runUpgrade = async (): Promise<void> => {
    const ids = [...upgradeSel]
    if (ids.length === 0) return
    setUpgradeBusy(true)
    setUpgradeLog([])
    try {
      const r = await host.upgradeInstances(ids, upgradeTarget)
      const lines = r.results.map((res) => res.ok ? `✓ ${res.instanceId}：已下发升级（守护将快照→对齐发行包→滚动重启）` : `✗ ${res.instanceId}：${res.error ?? 'unknown'}`)
      setUpgradeLog(lines)
    } catch (e) {
      setUpgradeLog([`✗ 升级调用失败：${e instanceof Error ? e.message : String(e)}`])
    } finally {
      setUpgradeBusy(false)
    }
  }

  const deployNewInstance = async (): Promise<void> => {
    const id = newInstId.trim()
    if (!id || !newInstPort) { setNewInstResult('请填写实例名称与端口'); return }
    setNewInstBusy(true)
    try {
      const r = await host.deployInstance({
        host: newInstHost, instanceId: id, name: id, version: '0.1.2-rc.1', profile: 'web',
        dshHome: `/home/long2015/.dsh-${id}`, port: Number(newInstPort), token: Math.random().toString(16).slice(2) + Math.random().toString(16).slice(2),
        addr: `http://127.0.0.1:${newInstPort}`, env: { DSH_RELAY_AGENT: id, DSH_CONSOLE_ADDR: 'http://127.0.0.1:3082' },
      })
      setNewInstResult(r.ok ? `已下发部署 ${id}（daemon 将拉起）` : `部署失败：${r.error ?? 'unknown'}`)
    } catch (e) {
      setNewInstResult(`部署调用失败：${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setNewInstBusy(false)
    }
  }

  const genBootstrap = async (): Promise<void> => {
    if (!deployHost || !deployName) { setDeployResult({ ok: false, commands: [], error: '请填写目标机器 SSH 地址与守护主机标识' }); return }
    setDeployBusy(true)
    try {
      const r = await host.bootstrapHost(deployName, deployHost, deployVersion || undefined, deployAlias.trim())
      setDeployResult({ ok: r.ok, commands: r.sshCommands ?? [], error: r.error, instanceId: r.instanceId, alias: r.alias })
    } catch (e) {
      setDeployResult({ ok: false, commands: [], error: e instanceof Error ? e.message : String(e) })
    } finally {
      setDeployBusy(false)
    }
  }

  // 拉取实例列表：打开即拉 + 面板期周期轮询（部署/引导/升级/外部启停后自动可见）。
  // 静默刷新（保留旧数据兜底）；broker 状态同刷新。
  const refreshInstances = useCallback(async (): Promise<void> => {
    try {
      const v = await host.listInstances()
      setInstances(v.instances ?? [])
      // 守护选项：hosts（host\d+ 守护）+ 实例所属 host 去重；空则保留默认 host1。
      const hosts = Array.from(new Set([
        ...(v.hosts ?? []).map((h) => h.id),
        ...(v.instances ?? []).map((i) => i.host ?? '').filter(Boolean),
      ]))
      if (hosts.length > 0) setDaemonHosts(hosts)
      setLoaded(true)
      setLastUpdated(Date.now())
    } catch {
      setLoaded(true) // 远端暂不可用：保留旧数据，下次轮询再试
    }
    void host.brokerStatus().catch(() => {})
  }, [host])

  useEffect(() => {
    void refreshInstances()
    const timer = window.setInterval(() => { void refreshInstances() }, REFRESH_LIST_MS)
    return () => window.clearInterval(timer)
  }, [refreshInstances])

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
              <Stat value={instances.length} label="实例总数" detail={loaded ? (lastUpdated > 0 ? new Date(lastUpdated).toLocaleTimeString('zh-CN', { hour12: false }) : '刷新于刚刚') : '加载中…'} />
              <Stat value={online} label="在线" detail="含离线覆盖" color="var(--dsw-alias-state-success-primary)" />
              <Stat value={hostCount} label="主机" detail="含管理端" />
              <Stat value={instances.length - online} label="离线" detail="含重启/停止中" color="var(--dsw-alias-state-error-primary)" />
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
              <button type="button" className="dsh-console-btn" onClick={() => { void refreshInstances() }} title="立即刷新（每 10s 自动）">⟳ 刷新</button>
              <button type="button" className="dsh-console-btn" onClick={() => setShowNewInst((v) => !v)}>{showNewInst ? '收起' : '新建实例'}</button>
              <button type="button" className="dsh-console-btn primary" onClick={() => setTab('upgrade')}>批量升级</button>
            </div>
            {showNewInst && (
              <div className="dsh-console-toolbar" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
                <div className="dsh-console-formrow">
                  <div className="dsh-console-field" style={{ marginBottom: 0 }}><label>实例名称</label><input className="dsh-console-input" placeholder="web6" value={newInstId} onChange={(e) => setNewInstId(e.target.value)} /></div>
                  <div className="dsh-console-field" style={{ marginBottom: 0 }}><label>端口</label><input className="dsh-console-input" placeholder="3086" value={newInstPort} onChange={(e) => setNewInstPort(e.target.value)} /></div>
                  <div className="dsh-console-field" style={{ marginBottom: 0 }}><label>目标守护</label>
                    <select className="dsh-console-select" value={daemonHosts.includes(newInstHost) ? newInstHost : daemonHosts[0]} onChange={(e) => setNewInstHost(e.target.value)}>
                      {daemonHosts.map((h) => <option key={h} value={h}>{h}</option>)}
                    </select>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <button type="button" className="dsh-console-btn primary" onClick={() => { void deployNewInstance() }} disabled={newInstBusy}>{newInstBusy ? '部署中…' : '部署实例'}</button>
                  {newInstResult && <span style={{ fontSize: 12, color: newInstResult.startsWith('已') || newInstResult.startsWith('下发') ? 'var(--dsw-alias-state-success-primary)' : 'var(--dsw-alias-state-error-primary)' }}>{newInstResult}</span>}
                </div>
              </div>
            )}
            {loaded && instances.map((i) => <InstanceRow key={i.id} item={i} host={host} />)}
          </>
        )
      case 'hosts':
        return (
          <>
            <div className="dsh-console-toolbar">
              <span className="hint">{hostCount} 台主机</span>
              <div className="grow" />
              <button type="button" className="dsh-console-btn" onClick={() => { void refreshInstances() }} title="立即刷新（每 10s 自动）">⟳ 刷新</button>
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
                    <div className="meta">{onHost.length} 个实例 · {anyOnline ? '在线' : '离线'}</div>
                  </div>
                </div>
              )
            })}
          </>
        )
      case 'deploy':
        return (
          <>
            <div className="dsh-console-sect"><h3>部署新主机 = 引导接入守护（半自动）</h3></div>
            <div style={{ background: 'var(--dsw-alias-bg-layer-1)', border: '1px solid var(--dsw-alias-border-l1)', borderRadius: 12, padding: '12px 14px', fontSize: 12, lineHeight: 1.9, color: 'var(--dsw-alias-label-secondary)', marginBottom: 18, whiteSpace: 'pre-line' }}>
              {'本页与「实例 → 新建实例」不重复，是两级流程：\n' +
                '① 本页：把一台还没接入的新机器引导成「守护主机」（headless daemon，负责在这台机器上托管实例）。' +
                '填好 SSH 信息点「生成引导命令」，把命令复制到目标机器执行一次即接入（本端不代跑 SSH）。\n' +
                '② 「实例 → 新建实例」：在已接入的守护主机上，一键自动部署界面实例（无需 SSH，daemon 复用本地发行包拉起）。\n' +
                '接入后的守护主机出现在「主机 / 守护」页。'}
            </div>
            <div className="dsh-console-formrow">
              <div className="dsh-console-field"><label>目标机器 SSH 地址</label><input className="dsh-console-input" placeholder="user@10.0.0.15" value={deployHost} onChange={(e) => setDeployHost(e.target.value)} /></div>
              <div className="dsh-console-field"><label>守护主机标识（agent 名）</label><input className="dsh-console-input" placeholder="host2" value={deployName} onChange={(e) => setDeployName(e.target.value)} /></div>
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
                <div className="dsh-console-code" style={{ marginTop: 14, marginBottom: 0, padding: '8px 14px' }}>
                  {deployResult.alias ? `守护主机标识：${deployResult.instanceId}（别名：${deployResult.alias}）` : `守护主机标识：${deployResult.instanceId}`}
                </div>
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
              <span className="hint">勾选实例 → 统一升级到守护发行包</span>
              <div className="grow" />
              <select className="dsh-console-select" value={upgradeTarget} onChange={(e) => setUpgradeTarget(e.target.value)} title="目标发行包版本（守护以本机发行包源为实，此值写入实例记录）">
                <option value="0.1.2-rc.1">目标：0.1.2-rc.1</option>
              </select>
              <button type="button" className="dsh-console-btn primary" onClick={() => { void runUpgrade() }} disabled={upgradeSel.size === 0 || upgradeBusy}>
                {upgradeBusy ? '升级中…' : `升级所选（${upgradeSel.size}）`}
              </button>
            </div>
            <div style={{ background: 'var(--dsw-alias-bg-layer-1)', border: '1px solid var(--dsw-alias-border-l1)', borderRadius: 12, padding: '12px 14px', fontSize: 12, lineHeight: 1.8, color: 'var(--dsw-alias-label-secondary)', marginBottom: 14 }}>
              升级动作由实例所在<b>守护主机</b>执行：先快照实例发行包（保留 3 份回滚点）→ 对齐守护发行包源 → 滚动重启 →
              健康探测；<b>任一步失败自动回滚</b>并重启。完成态以实例重新在线为准（管理端自身与守护本体不可选）。
            </div>
            {upgradeLog.length > 0 && (
              <div className="dsh-console-code" style={{ marginTop: 0, marginBottom: 14, color: upgradeLog.every((l) => l.startsWith('✓')) ? undefined : 'var(--dsw-alias-label-secondary)' }}>
                {upgradeLog.join('\n')}
              </div>
            )}
            {loaded && instances.map((i) => (
              <InstanceRow
                key={i.id}
                item={i}
                host={host}
                checked={upgradeSel.has(i.id)}
                onSelect={i.self ? undefined : () => toggleUpgradeSel(i.id)}
                statusBadge={i.self ? <span className="dsh-console-badge idle">本端</span> : undefined}
              />
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
              <button key={t.id} type="button" className={`dsh-console-nav-cell${tab === t.id ? ' active' : ''}`} aria-current={tab === t.id ? 'true' : undefined} onClick={() => { setTab(t.id); void refreshInstances() }}>
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
