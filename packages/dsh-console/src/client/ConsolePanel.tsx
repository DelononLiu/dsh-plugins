/**
 * dsh-console 控制台面板：主端集群控制台（settings 面板契约）。
 *
 * 照抄官方 settings 面板结构（overlay/mask/panel + nav rail + content 换页）。
 * 数据面经 ConsoleHost（typert ctx.remote.console.listInstances/controlInstance +
 * channel.brokerStatus）。v1 页签：总览 / 实例 / 主机守护 / 部署 / 升级。
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { ConsoleHost } from './types'
import type { ConsoleInstanceViewItem, HostRecord, LogFileList, LogFileMeta, LogReadOptions, LogReadResult, LogTarget } from 'dsh-console/types'

// ---- 页签定义 ----
type TabId = 'overview' | 'instances' | 'hosts' | 'logs'
const TABS: Array<{ id: TabId; label: string; icon: string }> = [
  { id: 'overview', label: '总览', icon: '▤' },
  { id: 'instances', label: '实例', icon: '☰' },
  { id: 'hosts', label: '主机', icon: '⛁' },
  { id: 'logs', label: '日志', icon: '⎙' },
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
  onSelect?: () => void
  machineName?: string
  /** 该实例操作 pending 的具体文案（如"启动中…"；undefined = 无 pending）。 */
  opLabel?: string
  /** 点击启停/重启（ConsolePanel 注入 runControl）。 */
  onControl?: (id: string, op: 'start' | 'stop' | 'restart') => void
}): React.JSX.Element {
  const { item, host, checked, onSelect, machineName, opLabel, onControl } = props
  const online = item.status === 'online'
  const canJump = online && item.addr !== '' && item.id !== 'self'
  return (
    <div
      className={`dsh-console-row${checked ? ' sel' : ''}`}
      onClick={onSelect}
      style={onSelect ? { cursor: 'pointer' } : undefined}
    >
      {checked !== undefined && <span className="dsh-console-chk">✓</span>}
      <span className={`dot ${opLabel ? 'pend' : (online ? 'on' : 'off')}`} />
      <div className="grow">
        <div className="name">{item.name}</div>
        <div className="meta">{opLabel ?? (online ? '在线' : '离线')} · {machineName ?? item.host ?? item.id}{item.self ? ' · 当前实例' : ''}</div>
      </div>
      <span className="dsh-console-ver">{item.version ?? '—'}</span>
      {checked === undefined && (
        <>
          {canJump && (
            <button type="button" className="dsh-console-btn" title="打开此实例" onClick={() => { window.open(item.addr, '_blank', 'noopener') }}>
              跳转⧉
            </button>
          )}
          <button type="button" className="dsh-console-btn" disabled={!!opLabel} title={online ? '停止' : '启动'} onClick={() => { onControl?.(item.id, online ? 'stop' : 'start') }}>
            {opLabel ?? (online ? '停止' : '启动')}
          </button>
          <button type="button" className="dsh-console-btn danger" disabled={!!opLabel} title="重启" onClick={() => { onControl?.(item.id, 'restart') }}>
            {opLabel === '重启中…' ? '重启中…' : '重启'}
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
  /** 主机记录（v.hosts：含机器 name/ip，agent id 不展示）。 */
  const [hostRecords, setHostRecords] = useState<HostRecord[]>([])
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
  /** 实例页内联升级面板（升级不再独立页签——它是实例列表的批量操作）。 */
  const [showUpgrade, setShowUpgrade] = useState(false)
  // 展开升级面板：清空上次勾选，重新选择。
  // 实例启停/重启：设 pending（行内反馈）→ 下发 → toast 成败。
  // pending 保留到轮询确认目标状态（start→online / stop→offline）；超时兜底清除。
  const runControl = async (id: string, op: 'start' | 'stop' | 'restart'): Promise<void> => {
    if (opPendingRef.current?.id === id) return // 该实例已有操作进行中（读 ref 最新值）
    updateOpPending({ id, op, ts: Date.now() })
    try {
      const r = await host.controlInstance(id, op)
      if (r.ok) {
        setToast({ kind: 'ok', msg: `已下发${op === 'start' ? '启动' : op === 'stop' ? '停止' : '重启'} ${id}（执行中）` })
      } else {
        setToast({ kind: 'error', msg: `${op === 'start' ? '启动' : op === 'stop' ? '停止' : '重启'} ${id} 失败：${r.error ?? '未知原因'}` })
        updateOpPending(null) // 下发失败 → 立即清 pending
      }
    } catch (e) {
      setToast({ kind: 'error', msg: `${op} ${id} 调用异常：${e instanceof Error ? e.message : String(e)}` })
      updateOpPending(null)
    }
  }

  // pending 状态收敛检查：轮询数据里目标状态已达成 → 清 pending + ok toast（如刚启动完成）
  // 由 refreshInstances 调用（每 10s 轮询，含打开/操作后立即刷新路径）。
  const settlePending = (list: ConsoleInstanceViewItem[]): void => {
    // 从 ref 读最新 pending（refreshInstances useCallback 闭包捕获的 opPending 是旧 null）。
    const pend = opPendingRef.current
    if (!pend) return
    const cur = list.find((i) => i.id === pend.id)
    if (!cur) return
    // 收敛目标：
    //   start → 实例 online；stop → 实例 offline；restart → 实例回到 online（先停后起全程）。
    // restart 中途会先 offline（停止阶段）——此时不清 pending，等回 online 才算完成。
    const targetOk = (pend.op === 'start' && cur.status === 'online')
      || (pend.op === 'stop' && cur.status === 'offline')
      || (pend.op === 'restart' && cur.status === 'online')
    if (targetOk) {
      const label = pend.op === 'start' ? '启动' : pend.op === 'stop' ? '停止' : '重启'
      const state = cur.status === 'online' ? '在线' : '离线'
      setToast({ kind: 'ok', msg: `${label}完成：${pend.id} 已${state}` })
      updateOpPending(null)
      return
    }
    // restart 中途 offline（停止阶段）→ 若超过 30s 仍未回 online（拉起失败/停滞），
    // 视为异常：清 pending + error toast（重启了但没起来）。
    if (pend.op === 'restart' && cur.status === 'offline' && Date.now() - pend.ts > 30_000) {
      setToast({ kind: 'error', msg: `重启 ${pend.id} 未完成：实例处于离线（守护拉起失败或未就绪）` })
      updateOpPending(null)
      return
    }
    // 超时兜底（90s 未收敛 → 清 pending，避免永远转圈；状态以轮询为准）
    if (Date.now() - pend.ts > 90_000) updateOpPending(null)
  }

  const toggleUpgradePanel = (): void => {
    setShowUpgrade((v) => { if (!v) setUpgradeSel(new Set()); return !v })
  }
  /** 主机页内联部署新主机面板（引导接入守护——不占独立页签）。 */
  const [showDeploy, setShowDeploy] = useState(false)
  /** 实例操作 pending：{id, op, ts}——点击后行内 pending 直到状态收敛或超时。 */
  const [opPending, setOpPending] = useState<{ id: string; op: 'start' | 'stop' | 'restart'; ts: number } | null>(null)
  /** opPending 的 ref 镜像（settlePending 从 ref 读最新值——闭包捕获会拿到旧 null）。 */
  const opPendingRef = useRef(opPending)
  const updateOpPending = (v: { id: string; op: 'start' | 'stop' | 'restart'; ts: number } | null): void => {
    opPendingRef.current = v
    setOpPending(v)
  }
  /** 操作结果 toast：{kind: 'ok'|'error', msg}——自动消失。 */
  const [toast, setToast] = useState<{ kind: 'ok' | 'error'; msg: string } | null>(null)
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
  // 日志页签状态：实例下拉 + tail 配置 + 自动 tail 开关 + 内容缓存
  const [logTarget, setLogTarget] = useState<LogTarget>({ kind: 'daemon' })
  const [logTail, setLogTail] = useState(200)
  const [logContent, setLogContent] = useState<string>('')
  const [logTruncated, setLogTruncated] = useState(false)
  const [logTotal, setLogTotal] = useState(0)
  const [logError, setLogError] = useState<string | null>(null)
  const [logFiles, setLogFiles] = useState<LogFileList>({ daemon: null, instances: [] })
  const [logAutoTail, setLogAutoTail] = useState(false)
  const logBoxRef = useRef<HTMLDivElement>(null)

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
      setHostRecords(v.hosts ?? [])
      settlePending(v.instances ?? [])
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

  // toast 自动消失
  useEffect(() => {
    if (!toast) return
    const t = window.setTimeout(() => setToast(null), 3500)
    return () => window.clearTimeout(t)
  }, [toast])

  // 日志读取：拉取 + 自动 tail 周期（3s）+ 滚到底（仅 autoTail 开启时）。
  const fetchLog = useCallback(async (autoScroll: boolean): Promise<void> => {
    try {
      const r = await host.readLog(logTarget, { tail: logTail })
      setLogContent(r.content)
      setLogTruncated(r.truncated)
      setLogTotal(r.total)
      setLogError(null)
      if (autoScroll) {
        // 下一帧再滚到底（DOM 还没更新）
        requestAnimationFrame(() => { if (logBoxRef.current) logBoxRef.current.scrollTop = logBoxRef.current.scrollHeight })
      }
    } catch (e) {
      setLogError(e instanceof Error ? e.message : String(e))
    }
  }, [host, logTarget, logTail])

  const refreshLogFiles = useCallback(async (): Promise<void> => {
    try {
      const list = await host.listLogFiles()
      setLogFiles(list)
    } catch {
      // 不阻塞主流程：下拉回退到只剩 'daemon' target
    }
  }, [host])

  // 切换到 logs 页签：拉一次文件列表（决定下拉选项）
  // 自动 tail：3s 周期 + 滚到底
  useEffect(() => {
    if (tab !== 'logs') return
    void refreshLogFiles()
    void fetchLog(false)
    if (!logAutoTail) return
    const timer = window.setInterval(() => { void fetchLog(true) }, 3000)
    return () => window.clearInterval(timer)
  }, [tab, logTarget, logTail, logAutoTail, fetchLog, refreshLogFiles]) // eslint-disable-line react-hooks/exhaustive-deps

  const copyLog = useCallback((): void => {
    void navigator.clipboard?.writeText(logContent)
  }, [logContent])

  const scrollToBottom = useCallback((): void => {
    if (logBoxRef.current) logBoxRef.current.scrollTop = logBoxRef.current.scrollHeight
  }, [])

  const close = useCallback(() => onClose(), [onClose])
  /** host id（agent 名）→ 机器名（hostRecords 映射；未知回退 hostId）。 */
  const machineNameOf = (hostId: string | undefined): string => {
    if (!hostId) return ''
    return hostRecords.find((h) => h.id === hostId)?.name ?? hostId
  }
  /** 实例按 name 排序（复制不突变 state）。 */
  const sortedInstances = [...instances].sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'))
  const online = sortedInstances.filter((i) => i.status === 'online').length

  const hostCount = new Set(sortedInstances.map((i) => i.host ?? i.id)).size

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
            {loaded && sortedInstances.slice(0, 5).map((i) => (
              <div className="dsh-console-row" key={i.id}>
                <span className={`dot ${i.status === 'online' ? 'on' : 'off'}`} />
                <div className="grow">
                  <div className="name">{i.name} <span style={{ color: 'var(--dsw-alias-label-tertiary)', fontSize: 12 }}>· {machineNameOf(i.host) || i.id}{i.self ? ' · 当前实例' : ''}</span></div>
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
              <button type="button" className="dsh-console-btn primary" onClick={toggleUpgradePanel}>{showUpgrade ? '收起升级' : '批量升级'}</button>
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
            {showUpgrade && (
              <>
                <div className="dsh-console-toolbar">
                  <span className="hint">勾选下方实例 → 统一升级到守护发行包（当前实例不可选）</span>
                  <div className="grow" />
                  <select className="dsh-console-select" value={upgradeTarget} onChange={(e) => setUpgradeTarget(e.target.value)} title="目标发行包版本（守护以本机发行包源为实，此值写入实例记录）">
                    <option value="0.1.2-rc.1">目标：0.1.2-rc.1</option>
                  </select>
                  <button type="button" className="dsh-console-btn primary" onClick={() => { void runUpgrade() }} disabled={upgradeSel.size === 0 || upgradeBusy}>
                    {upgradeBusy ? '升级中…' : `升级所选（${upgradeSel.size}）`}
                  </button>
                  <button type="button" className="dsh-console-btn" onClick={() => setShowUpgrade(false)}>收起</button>
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
              </>
            )}
            {loaded && sortedInstances.map((i) => (
              <InstanceRow
                key={i.id}
                item={i}
                host={host}
                machineName={machineNameOf(i.host)}
                checked={showUpgrade && upgradeSel.has(i.id) ? true : undefined}
                onSelect={showUpgrade && !i.self ? () => toggleUpgradeSel(i.id) : undefined}
                opLabel={opPending?.id === i.id ? (opPending.op === 'start' ? '启动中…' : opPending.op === 'stop' ? '停止中…' : '重启中…') : undefined}
                onControl={(id, op) => { void runControl(id, op) }}
              />
            ))}
          </>
        )
      case 'hosts':
        return (
          <>
            <div className="dsh-console-toolbar">
              <span className="hint">{hostCount} 台主机</span>
              <div className="grow" />
              <button type="button" className="dsh-console-btn" onClick={() => { void refreshInstances() }} title="立即刷新（每 10s 自动）">⟳ 刷新</button>
              <button type="button" className="dsh-console-btn primary" onClick={() => setShowDeploy((v) => !v)}>{showDeploy ? '收起部署' : '＋ 部署新主机'}</button>
            </div>
            {loaded && hostRecords.length > 0 && [...hostRecords]
              .sort((a, b) => {
                const na = (a.name && a.name !== '' ? a.name : a.id).localeCompare(b.name && b.name !== '' ? b.name : b.id, 'zh-Hans-CN')
                return na
              })
              .map((hr) => {
              // 管理端宿主识别：instances 中 self（本端管理端）实例的 host = 该主机 id。
              const isConsoleHost = instances.some((i) => i.self === true && (i.host ?? i.id) === hr.id)
              const onHost = instances.filter((i) => (i.host ?? i.id) === hr.id)
              const anyOnline = onHost.some((i) => i.status === 'online')
              const displayName = hr.name && hr.name !== '' ? hr.name : (isConsoleHost ? '本机' : hr.id)
              return (
                <div className="dsh-console-row" key={hr.id}>
                  <span className={`dot ${anyOnline ? 'on' : 'off'}`} />
                  <div className="grow">
                    <div className="name">
                      {displayName}
                      <span className="dsh-console-badge" style={{ marginLeft: 8, ...(isConsoleHost
                        ? { background: 'color-mix(in srgb,var(--dsw-alias-brand-primary) 15%,transparent)', color: 'var(--dsw-alias-brand-primary)' }
                        : { background: 'var(--dsw-alias-bg-layer-2)', color: 'var(--dsw-alias-label-secondary)', border: '1px solid var(--dsw-alias-border-l1)' }) }}>
                        {isConsoleHost ? '管理主机' : '主机'}
                      </span>
                    </div>
                    <div className="meta">{hr.ip && hr.ip !== '' ? hr.ip : '—'} · {onHost.length} 个实例 · {anyOnline ? '在线' : '离线'}</div>
                  </div>
                </div>
              )
            })}
            {loaded && hostRecords.length === 0 && <div className="dsh-console-toolbar"><span className="hint">暂无主机</span></div>}
            {showDeploy && (
              <>
            <div style={{ background: 'var(--dsw-alias-bg-layer-1)', border: '1px solid var(--dsw-alias-border-l1)', borderRadius: 12, padding: '12px 14px', fontSize: 12, lineHeight: 1.9, color: 'var(--dsw-alias-label-secondary)', marginBottom: 18, whiteSpace: 'pre-line' }}>
              {'本页与「实例 → 新建实例」不重复，是两级流程：\n' +
                '① 本页：把一台还没接入的新机器引导成「守护主机」（headless daemon，负责在这台机器上托管实例）。' +
                '填好 SSH 信息点「生成引导命令」，把命令复制到目标机器执行一次即接入（本端不代跑 SSH）。\n' +
                '② 「实例 → 新建实例」：在已接入的守护主机上，一键自动部署界面实例（无需 SSH，daemon 复用本地发行包拉起）。\n' +
                '接入后的守护主机显示在本页（主机）。'}
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
            )}
          </>
        )
      case 'logs':
        return (
          <>
            <div className="dsh-console-toolbar">
              <span className="hint">来源</span>
              <select
                className="dsh-console-select"
                value={logTarget.kind === 'daemon' ? 'daemon' : `instance:${logTarget.instanceId}`}
                onChange={(e) => {
                  const v = e.target.value
                  if (v === 'daemon') setLogTarget({ kind: 'daemon' })
                  else if (v.startsWith('instance:')) setLogTarget({ kind: 'instance', instanceId: v.slice('instance:'.length) })
                }}
                title="选择要查看的日志来源（daemon = 守护自身/console.log；instance = 守护下的实例日志）"
              >
                {logFiles.daemon && <option value="daemon">daemon（自身）</option>}
                {logFiles.instances.map((f) => (
                  <option key={f.id} value={`instance:${f.id}`}>{f.id}（{Math.round(f.size / 1024)}KB）</option>
                ))}
                {!logFiles.daemon && logFiles.instances.length === 0 && <option value="daemon">daemon（无日志）</option>}
              </select>
              <span className="hint">行数</span>
              <select className="dsh-console-select" value={logTail} onChange={(e) => setLogTail(Number(e.target.value))}>
                <option value={100}>100</option>
                <option value={200}>200</option>
                <option value={500}>500</option>
                <option value={1000}>1000</option>
              </select>
              <button type="button" className="dsh-console-btn" onClick={() => { void fetchLog(false) }} title="立即读取">⟳ 重载</button>
              <label className="hint" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <input type="checkbox" checked={logAutoTail} onChange={(e) => setLogAutoTail(e.target.checked)} />
                自动 tail（3s）
              </label>
              <div className="grow" />
              <button type="button" className="dsh-console-btn" onClick={scrollToBottom} title="滚到底部">⤓ 滚到底</button>
              <button type="button" className="dsh-console-btn" onClick={copyLog} disabled={!logContent} title="复制全文">⧉ 复制</button>
            </div>
            <div className="dsh-console-toolbar" style={{ background: 'transparent', border: 'none', padding: 0, marginBottom: 8 }}>
              <span className="hint">
                {logError
                  ? <span style={{ color: 'var(--dsw-alias-state-error-primary)' }}>读取失败：{logError}</span>
                  : (logTotal > 0 ? `共 ${logTotal} 行，显示最后 ${logTail} 行${logTruncated ? '（已截断，原文件超过 512KB）' : ''}` : '暂无内容')}
              </span>
            </div>
            <div
              ref={logBoxRef}
              className="dsh-console-code"
              style={{ maxHeight: '50vh', overflow: 'auto', marginTop: 0 }}
            >
              {logContent || (logError ? '' : '（日志为空）')}
            </div>
          </>
        )
    }
  }

  return (
    <div className="dsh-console-panel-overlay" role="presentation">
      <div className="dsh-console-panel-mask" aria-hidden="true" onClick={close} />
      {toast && (
        <div className={`dsh-console-toast ${toast.kind}`} role="status">
          {toast.kind === 'ok' ? '✓ ' : '✗ '}{toast.msg}
        </div>
      )}
      <div className="dsh-console-panel" role="dialog" aria-modal="true" aria-label="dsh 控制台">
        <nav className="dsh-console-nav">
          <div className="dsh-console-nav-brand">
            <span style={{ width: 22, height: 22, borderRadius: 6, background: 'linear-gradient(135deg,#60a5fa,#818cf8)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: '#0b1220' }}>d</span>
            dsh 控制台
          </div>
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
