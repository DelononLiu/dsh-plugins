/**
 * dsh-console 控制台面板：主端集群控制台（settings 面板契约）。
 *
 * 照抄官方 settings 面板结构（overlay/mask/panel + nav rail + content 换页）。
 * 数据面经 ConsoleHost（typert ctx.remote.console.listInstances/controlInstance +
 * 版本池）。页签：总览 / 实例 / 主机守护 / 部署 / 升级。
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { ConsoleHost } from './types'
import type { ConsoleInstanceViewItem, HostRecord, LogFileList, LogFileMeta, LogReadOptions, LogReadResult, LogTarget, LogLevel, LogRecord, RuntimePoolView } from 'dsh-console/types'
import { UpgradeDialog } from './UpgradeDialog'
import * as logView from './logView'

// ---- 页签定义 ----
type TabId = 'overview' | 'instances' | 'hosts' | 'versions' | 'logs'
const TABS: Array<{ id: TabId; label: string; icon: string }> = [
  { id: 'overview', label: '总览', icon: '▤' },
  { id: 'instances', label: '实例', icon: '☰' },
  { id: 'hosts', label: '主机', icon: '⛁' },
  { id: 'versions', label: '版本', icon: '◈' },
  { id: 'logs', label: '日志', icon: '⎙' },
]

/** 实例列表静默轮询周期（ms）：部署/引导/升级后无需重开面板即可看到新状态。 */
const REFRESH_LIST_MS = 10_000

/** 日志单次读取的尾部条数（无「行数」下拉后固定此值；只读最近 N 条）。 */
const LOG_FETCH_TAIL = 1000

/** 控制台面板 props。 */
export interface ConsolePanelProps {
  host: ConsoleHost
  onClose: () => void
}

/** 实例行（列表/升级共用）。 */
function InstanceRow(props: {
  item: ConsoleInstanceViewItem
  host: ConsoleHost
  machineName?: string
  /** 该实例操作 pending 的具体文案（如"启动中…"；undefined = 无 pending）。 */
  opLabel?: string
  /** 点击启停/重启（ConsolePanel 注入 runControl）。 */
  onControl?: (id: string, op: 'start' | 'stop' | 'restart') => void
  /** 点击行尾「⋯」菜单项（onMore 存在才显示菜单；本端不显示）。 */
  onMore?: (action: string, id: string) => void
}): React.JSX.Element {
  const { item, host, machineName, opLabel, onControl, onMore } = props
  const online = item.status === 'online'
  const canJump = online && item.addr !== '' && item.id !== 'self'
  // 行尾「⋯」菜单展开状态（单开：记录展开的实例 id 由 ConsolePanel 管理更简——
  // 这里用本地 state，点击其它行自然收起？多行各自独立——用 id 匹配外部更干净，见 onMore 语义）。
  const [menuOpen, setMenuOpen] = useState(false)
  // 操作列固定宽度、按"列"渲染：版本胶囊 / 跳转 / 启停 / 重启 / ⋯ 五个槽位
  // 在每行里都存在（不可用 disabled 灰显留位占），保证三行同名列横坐标一致。
  const canMore = !!onMore
  return (
    <div className="dsh-console-row">
      <span className={`dot ${opLabel ? 'pend' : (online ? 'on' : 'off')}`} />
      <div className="grow">
        <div className="name">{item.name}</div>
        <div className="meta">{opLabel ?? (online ? '在线' : '离线')} · {machineName ?? item.host ?? item.id}{item.self ? ' · 当前实例' : ''}</div>
      </div>
      <span className="dsh-console-ver" title={item.version ?? ''}>{item.version ?? '—'}</span>
      <button
        type="button"
        className="dsh-console-btn dsh-console-act"
        disabled={!canJump}
        title={canJump ? '打开此实例' : (online ? '当前实例不可跳转' : '实例离线，跳转不可用')}
        onClick={() => { window.open(item.addr, '_blank', 'noopener') }}
      >
        跳转⧉
      </button>
      <button
        type="button"
        className="dsh-console-btn dsh-console-act"
        disabled={!!opLabel}
        title={online ? '停止' : '启动'}
        onClick={() => { onControl?.(item.id, online ? 'stop' : 'start') }}
      >
        {opLabel ?? (online ? '停止' : '启动')}
      </button>
      <button
        type="button"
        className="dsh-console-btn dsh-console-act danger"
        disabled={!!opLabel}
        title="重启"
        onClick={() => { onControl?.(item.id, 'restart') }}
      >
        {opLabel === '重启中…' ? '重启中…' : '重启'}
      </button>
      <div className="dsh-console-act dsh-console-act-more" style={{ position: 'relative' }}>
        <button
          type="button"
          className="dsh-console-btn dsh-console-act-btn"
          disabled={!canMore}
          title={canMore ? '更多操作' : '当前实例不可操作'}
          onClick={() => { if (canMore) setMenuOpen((v) => !v) }}
        >⋯</button>
        {canMore && menuOpen && (
          <>
            {/* 点击外部关闭 */}
            <div style={{ position: 'fixed', inset: 0, zIndex: 1999 }} onClick={() => setMenuOpen(false)} />
            <div style={{ position: 'absolute', right: 0, top: 'calc(100% + 4px)', zIndex: 2000, minWidth: 160, background: 'var(--dsw-alias-bg-layer-2)', border: '1px solid var(--dsw-alias-border-l1)', borderRadius: 10, boxShadow: 'var(--dsw-shadow-lv2)', padding: 4 }}>
              <button type="button" className="dsh-console-menu-item" onClick={() => { setMenuOpen(false); onMore!('upgrade', item.id) }}>
                升级到 0.1.2-rc.1
              </button>
              <button
                type="button"
                className="dsh-console-menu-item"
                onClick={() => { setMenuOpen(false); onMore!('delete', item.id) }}
                title="停止进程并把目录归档（可从命令行恢复）；正式 web 与本机 daemon 会被拒绝"
              >
                删除实例…
              </button>
            </div>
          </>
        )}
      </div>
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
  /** 升级对话框目标实例（null = 关闭）。 */
  const [upgradeTarget, setUpgradeTarget] = useState<ConsoleInstanceViewItem | null>(null)
  const [newInstId, setNewInstId] = useState('')
  const [newInstPort, setNewInstPort] = useState('')
  const [newInstHost, setNewInstHost] = useState('host1')
  /** 模板（创建时快照；清单来自宿主 listTemplates，不硬编码模板名）。 */
  const [newInstTemplate, setNewInstTemplate] = useState('dev')
  /** 创建时选的内核版本（必选；默认池内最新，见 runtime 池模型）。 */
  const [newInstVersion, setNewInstVersion] = useState('')
  /** runtime 池视图（版本页签 + 创建向导共用）。 */
  const [pool, setPool] = useState<RuntimePoolView | null>(null)
  const [templates, setTemplates] = useState<string[]>([])
  const [poolInput, setPoolInput] = useState('')
  /** 已删除实例筛选（墓碑默认隐藏；恢复走 CLI，UI 只读展示）。 */
  const [showDeleted, setShowDeleted] = useState(false)
  const [deleted, setDeleted] = useState<Array<{ id: string; host: string; deletedAt: string | null; archivePath?: string; version: string | null }>>([])
  const [poolBusy, setPoolBusy] = useState(false)
  const [newInstResult, setNewInstResult] = useState<string | null>(null)
  const [newInstBusy, setNewInstBusy] = useState(false)
  // 日志页签状态：来源 + 级别过滤 + 模糊搜索（行数/只看错误/跟随已移除）
  const [logTarget, setLogTarget] = useState<LogTarget>({ kind: 'daemon' })
  const [logRecords, setLogRecords] = useState<LogRecord[]>([])
  const [logTruncated, setLogTruncated] = useState(false)
  const [logTotal, setLogTotal] = useState(0)
  const [logError, setLogError] = useState<string | null>(null)
  const [logFiles, setLogFiles] = useState<LogFileList>({ daemon: null, instances: [] })
  const [logMinLevel, setLogMinLevel] = useState<'all' | 'error' | 'warn' | 'info'>('all')
  const [logQuery, setLogQuery] = useState('')
  /** 只看管理事件（category='admin'：状态变更与失败异常；见实例模型 note）。 */
  const [logAdminOnly, setLogAdminOnly] = useState(false)


  /** 删除实例（停进程 + 目录归档，可恢复）：破坏性操作，先二次确认。 */
  const runDelete = async (id: string): Promise<void> => {
    if (!window.confirm(`删除实例 ${id}？\n\n会停止进程并把目录归档（可从命令行恢复；正式 web 与本机 daemon 会被拒绝）。`)) return
    try {
      const r = await host.deleteInstance(id)
      setToast(r.ok ? { kind: 'ok', msg: r.detail ?? `已删除 ${id}` } : { kind: 'error', msg: `删除失败：${r.error ?? 'unknown'}` })
      await refreshInstances()
    } catch (e) {
      setToast({ kind: 'error', msg: `删除调用失败：${e instanceof Error ? e.message : String(e)}` })
    }
  }

  /** 读已删除实例（墓碑）：默认不显示，开启筛选时拉取。 */
  const loadDeleted = useCallback(async (): Promise<void> => {
    try {
      setDeleted(await host.listDeletedInstances())
    } catch {
      setDeleted([])
    }
  }, [host])

  /** 读 runtime 池 + 模板清单（best-effort：老宿主无此面时降级为空）。 */
  const loadPool = useCallback(async (): Promise<void> => {
    try {
      const p = await host.listRuntimePool()
      setPool(p)
      setNewInstVersion((cur) => (cur !== '' ? cur : (p.versions.length > 0 ? p.versions[p.versions.length - 1].version : '')))
    } catch {
      setPool(null)
    }
    try {
      const ts = await host.listTemplates()
      if (ts.length > 0) setTemplates(ts)
    } catch { /* 模板面不可用：保留默认值 */ }
  }, [host])

  const importVersion = async (): Promise<void> => {
    const v = poolInput.trim()
    if (v === '') return
    setPoolBusy(true)
    try {
      const r = await host.importRuntimeVersion(v)
      setToast(r.ok ? { kind: 'ok', msg: `已导入 runtime ${v}` } : { kind: 'error', msg: `导入失败：${r.error ?? 'unknown'}` })
      if (r.ok) setPoolInput('')
      await loadPool()
    } catch (e) {
      setToast({ kind: 'error', msg: `导入调用失败：${e instanceof Error ? e.message : String(e)}` })
    } finally {
      setPoolBusy(false)
    }
  }

  const removeVersion = async (v: string): Promise<void> => {
    setPoolBusy(true)
    try {
      const r = await host.removeRuntimeVersion(v)
      setToast(r.ok ? { kind: 'ok', msg: `已删除 runtime ${v}` } : { kind: 'error', msg: `删除失败：${r.error ?? 'unknown'}` })
      await loadPool()
    } catch (e) {
      setToast({ kind: 'error', msg: `删除调用失败：${e instanceof Error ? e.message : String(e)}` })
    } finally {
      setPoolBusy(false)
    }
  }

  const deployNewInstance = async (): Promise<void> => {
    const id = newInstId.trim()
    if (!id || !newInstPort) { setNewInstResult('请填写实例名称与端口'); return }
    if (newInstVersion === '') { setNewInstResult('池内没有可用版本：先到「版本」页签导入一个 runtime 版本'); return }
    // 目标守护必须来自真实守护列表（受控 select 的显示值可能与 state 不一致，这里以真实列表为准）
    const targetHost = daemonHosts.includes(newInstHost) ? newInstHost : (daemonHosts[0] ?? '')
    if (targetHost === '') { setNewInstResult('没有可用守护：请先启动目标主机的 daemon'); return }
    setNewInstBusy(true)
    try {
      const r = await host.deployInstance({
        host: targetHost, instanceId: id, name: id, version: newInstVersion, profile: newInstTemplate,
        dshHome: `/home/long2015/.dsh-home/instance-${id}`, port: Number(newInstPort), token: Math.random().toString(16).slice(2) + Math.random().toString(16).slice(2),
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
      if (hosts.length > 0) {
        setDaemonHosts(hosts)
        // 受控 select：显示第一项、state 还停在初始 'host1' 时，提交的就是不存在的守护（实测报
        // "目标 host1 无本机接收者"）→ 列表变化即把非法值纠正为真实守护。
        setNewInstHost((cur) => (hosts.includes(cur) ? cur : hosts[0]))
      }
      setLoaded(true)
      setLastUpdated(Date.now())
    } catch {
      setLoaded(true) // 远端暂不可用：保留旧数据，下次轮询再试
    }
  }, [host])

  useEffect(() => { void loadPool() }, [loadPool])

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

  const logBoxRef = useRef<HTMLDivElement>(null)
  // 日志读取：拉取结构化 records（固定加载末尾 N 条），取完滚到底让最新日志可见。
  const fetchLog = useCallback(async (): Promise<void> => {
    try {
      const r = await host.readLog(logTarget, { tail: LOG_FETCH_TAIL })
      setLogRecords(r.records ?? [])
      setLogTruncated(r.truncated)
      setLogTotal(r.total)
      // 跨实例读取失败会带 error（不是"没有日志"）——原样显示原因，别静默成空列表
      setLogError(r.error ?? null)
      // 默认显示最新：下一帧滚到底（DOM 尚未更新）。
      requestAnimationFrame(() => {
        if (logBoxRef.current) logBoxRef.current.scrollTop = logBoxRef.current.scrollHeight
      })
    } catch (e) {
      setLogError(e instanceof Error ? e.message : String(e))
    }
  }, [host, logTarget])

  const refreshLogFiles = useCallback(async (): Promise<void> => {
    try {
      const list = await host.listLogFiles()
      setLogFiles(list)
    } catch {
      // 不阻塞主流程：下拉回退到只剩 'daemon' target
    }
  }, [host])

  // 进入 logs 页签：拉一次文件列表（决定下拉选项）+ 拉一次日志；之后手动「刷新」。
  useEffect(() => {
    if (tab !== 'logs') return
    void refreshLogFiles()
    void fetchLog()
  }, [tab, logTarget, fetchLog, refreshLogFiles]) // eslint-disable-line react-hooks/exhaustive-deps

  // 日志查看器可见行（级别 + 模糊搜索过滤后）——渲染用。
  const visibleLogRecords = logView.filterRecords(logRecords, {
    minLevel: logMinLevel,
    query: logQuery,
    errorsOnly: false,
    ...(logAdminOnly ? { categoryOnly: 'admin' } : {}),
  })

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
              <button
                type="button"
                className="dsh-console-btn"
                title="已删除实例默认隐藏（档案永久保留作审计）；恢复用命令行 restoreInstance"
                onClick={() => { const next = !showDeleted; setShowDeleted(next); if (next) void loadDeleted() }}
              >
                {showDeleted ? '隐藏已删除' : `已删除 ${deleted.length > 0 ? deleted.length : ''}`.trim()}
              </button>
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
                  <div className="dsh-console-field" style={{ marginBottom: 0 }}><label>模板</label>
                    <select className="dsh-console-select" value={newInstTemplate} onChange={(e) => setNewInstTemplate(e.target.value)}>
                      {(templates.length > 0 ? templates : [newInstTemplate]).map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                  <div className="dsh-console-field" style={{ marginBottom: 0 }}><label>内核版本</label>
                    <select className="dsh-console-select" value={newInstVersion} onChange={(e) => setNewInstVersion(e.target.value)}>
                      {newInstVersion === '' && <option value="">（池内无版本）</option>}
                      {(pool?.versions ?? []).map((v) => <option key={v.version} value={v.version}>{v.version}</option>)}
                    </select>
                  </div>
                  <button type="button" className="dsh-console-btn primary" onClick={() => { void deployNewInstance() }} disabled={newInstBusy || daemonHosts.length === 0} title={daemonHosts.length === 0 ? '没有可用守护（先在目标主机上启动 daemon）' : undefined}>{newInstBusy ? '部署中…' : '部署实例'}</button>
                  {newInstResult && <span style={{ fontSize: 12, color: newInstResult.startsWith('已') || newInstResult.startsWith('下发') ? 'var(--dsw-alias-state-success-primary)' : 'var(--dsw-alias-state-error-primary)' }}>{newInstResult}</span>}
                </div>
              </div>
            )}
            {showDeleted && (
              <>
                <div className="dsh-console-sect"><h3>已删除（{deleted.length}）</h3></div>
                {deleted.length === 0 && <div className="dsh-console-toolbar"><span className="hint">没有已删除实例</span></div>}
                {deleted.map((d) => (
                  <div className="dsh-console-row" key={`${d.host}/${d.id}`}>
                    <span className="dot off" />
                    <div className="grow">
                      <div className="name">{d.id} <span style={{ color: 'var(--dsw-alias-label-tertiary)', fontSize: 12 }}>· 已删除 {d.deletedAt !== null ? new Date(d.deletedAt).toLocaleString('zh-CN', { hour12: false }) : ''}</span></div>
                      <div style={{ color: 'var(--dsw-alias-label-tertiary)', fontSize: 12 }}>
                        {d.archivePath !== undefined ? `归档：${d.archivePath}（可用 restoreInstance 恢复）` : '无归档'}
                      </div>
                    </div>
                  </div>
                ))}
              </>
            )}
            {loaded && sortedInstances.map((i) => (
              <InstanceRow
                key={i.id}
                item={i}
                host={host}
                machineName={machineNameOf(i.host)}
                opLabel={opPending?.id === i.id ? (opPending.op === 'start' ? '启动中…' : opPending.op === 'stop' ? '停止中…' : '重启中…') : undefined}
                onControl={(id, op) => { void runControl(id, op) }}
                onMore={i.self ? undefined : (action, id) => {
                  if (action === 'delete') { void runDelete(id); return }
                  const inst = sortedInstances.find((x) => x.id === id)
                  if (inst) setUpgradeTarget(inst)
                }}
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
      case 'versions':
        return (
          <>
            <div className="dsh-console-toolbar">
              <span className="hint">runtime 池：{pool?.poolPath ?? '（不可用）'} · 版本 = 内核版本，池只增不改</span>
              <button type="button" className="dsh-console-btn" onClick={() => { void loadPool() }}>⟳ 刷新</button>
            </div>
            <div className="dsh-console-sect"><h3>导入版本</h3></div>
            <div className="dsh-console-row">
              <div className="grow">
                <div className="dsh-console-field" style={{ marginBottom: 0 }}>
                  <label>版本号（dsh 版本，如 0.1.2-rc.1）</label>
                  <input className="dsh-console-input" placeholder="0.1.2-rc.1" value={poolInput} onChange={(e) => setPoolInput(e.target.value)} />
                </div>
              </div>
              <button type="button" className="dsh-console-btn primary" disabled={poolBusy || poolInput.trim() === ''} onClick={() => { void importVersion() }}>
                {poolBusy ? '处理中…' : '导入版本'}
              </button>
            </div>
            <div className="dsh-console-sect"><h3>池内版本（{(pool?.versions ?? []).length}）</h3></div>
            {(pool?.versions ?? []).length === 0 && (
              <div className="dsh-console-toolbar"><span className="hint">池为空：先导入一个版本，创建实例时才能选内核版本</span></div>
            )}
            {(pool?.versions ?? []).map((v) => (
              <div className="dsh-console-row" key={v.version}>
                <span className={`dot ${v.ok ? 'on' : 'off'}`} />
                <div className="grow">
                  <div className="name">{v.version}{v.ok ? '' : ' · 自检失败'}</div>
                  <div style={{ color: 'var(--dsw-alias-label-tertiary)', fontSize: 12 }}>
                    {v.inUseBy.length > 0 ? `被引用：${v.inUseBy.join(', ')}` : '无实例引用'}{v.error !== undefined ? ` · ${v.error}` : ''}
                  </div>
                </div>
                <button
                  type="button"
                  className="dsh-console-btn"
                  disabled={v.inUseBy.length > 0 || poolBusy}
                  title={v.inUseBy.length > 0 ? '被实例引用，禁止删除' : '删除该版本'}
                  onClick={() => { void removeVersion(v.version) }}
                >
                  删除
                </button>
              </div>
            ))}
          </>
        )
      case 'logs':
        // 结构化日志查看器：来源/级别 = 标签在上、值在下；值行含 模糊搜索 + 刷新；
        // （行数/只看错误/跟随/复制/滚到底 已移除）。可见行在组件顶层派生，此处只渲染。
        return (
          <>
            <div className="dsh-console-toolbar" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 10 }}>
              {/* 标签行：来源 / 级别（宽度对齐下方值行） */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <span className="hint" style={{ width: 150 }}>来源</span>
                <span className="hint" style={{ width: 150 }}>级别</span>
              </div>
              {/* 值行：来源/级别 + 模糊搜索 + 刷新 */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <select
                  className="dsh-console-select"
                  style={{ width: 150 }}
                  value={logTarget.kind === 'daemon' ? 'daemon' : `instance:${logTarget.instanceId}`}
                  onChange={(e) => {
                    const v = e.target.value
                    if (v === 'daemon') setLogTarget({ kind: 'daemon' })
                    else if (v.startsWith('instance:')) setLogTarget({ kind: 'instance', instanceId: v.slice('instance:'.length) })
                  }}
                  title="选择日志来源（daemon = 守护自身/console.log；instance = 守护下实例日志）"
                >
                  {logFiles.daemon && <option value="daemon">daemon（自身）</option>}
                  {logFiles.instances.map((f) => (
                    <option key={f.id} value={`instance:${f.id}`}>{f.id}（{Math.round(f.size / 1024)}KB）</option>
                  ))}
                  {!logFiles.daemon && logFiles.instances.length === 0 && <option value="daemon">daemon（无日志）</option>}
                </select>
                <select
                  className="dsh-console-select"
                  style={{ width: 150 }}
                  value={logMinLevel}
                  onChange={(e) => setLogMinLevel(e.target.value as typeof logMinLevel)}
                >
                  <option value="all">全部</option>
                  <option value="error">仅 error</option>
                  <option value="warn">warn 及以上</option>
                  <option value="info">info 及以上</option>
                </select>
                <span className="hint">搜索</span>
                <input
                  className="dsh-console-input"
                  type="text"
                  placeholder="模糊搜索：消息 / role / 实例 / scope…"
                  value={logQuery}
                  onChange={(e) => setLogQuery(e.target.value)}
                  style={{ flex: 1, minWidth: 140 }}
                />
                <label className="hint" style={{ display: 'flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }} title="只显示状态变更与失败异常（category=admin）">
                  <input type="checkbox" checked={logAdminOnly} onChange={(e) => setLogAdminOnly(e.target.checked)} />
                  只看管理事件
                </label>
                <button type="button" className="dsh-console-btn" onClick={() => { void fetchLog() }} title="重新读取最新日志">⟳ 刷新</button>
              </div>
            </div>

            {/* 状态行 */}
            <div className="dsh-console-toolbar" style={{ background: 'transparent', border: 'none', padding: 0, marginBottom: 8 }}>
              <span className="hint">
                {logError
                  ? <span style={{ color: 'var(--dsw-alias-state-error-primary)' }}>读取失败：{logError}</span>
                  : (logTotal > 0
                      ? `共 ${logTotal} 行，显示 ${visibleLogRecords.length} 行${logTruncated ? '（已截断，原文件超过 512KB）' : ''}`
                      : '暂无日志')}
              </span>
            </div>

            {/* 日志列表容器：每条记录一行，时间 级别 正文 拼接（紧凑；级别空则不显示标签） */}
            <div ref={logBoxRef} className="dsh-console-log" style={{ maxHeight: '50vh', overflow: 'auto' }}>
              {visibleLogRecords.length > 0 ? (
                visibleLogRecords.map((rec, idx) => (
                  <div key={idx} className={`dsh-console-log-line${rec.level === 'error' ? ' err' : ''}`}>
                    <span className="dsh-console-log-time">{logView.formatRowTime(rec.ts)}</span>
                    {rec.level && <span className={`dsh-console-log-lv ${rec.level}`}>{rec.level}</span>}
                    <span className="dsh-console-log-body">
                      {logQuery.trim() !== ''
                        ? logView.splitByQuery(rec.msg, logQuery).map((seg, i) =>
                            seg.match ? <mark key={i} className="dsh-console-log-hit">{seg.text}</mark> : <span key={i}>{seg.text}</span>)
                        : rec.msg}
                    </span>
                  </div>
                ))
              ) : (
                <div style={{ padding: 12, textAlign: 'center', color: 'var(--dsw-alias-label-tertiary)' }}>
                  {logError ? '' : (logQuery ? '无匹配记录' : '暂无日志')}
                </div>
              )}
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
      {upgradeTarget && (
        <UpgradeDialog
          item={upgradeTarget}
          host={host}
          version="0.1.2-rc.1"
          onClose={() => setUpgradeTarget(null)}
        />
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
          <div className="dsh-console-nav-foot">管理端 console<br />{instances.length} 实例 · {(pool?.versions ?? []).length} 个 runtime</div>
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
