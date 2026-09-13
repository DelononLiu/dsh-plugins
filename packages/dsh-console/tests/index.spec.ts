/**
 * dsh-console 行为测试：主机/实例档案、生命周期编排（指令回环）、
 * inbox（系统事件消息，按 owner 隔离）。
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { createServer } from 'node:http'
import type { ChildProcess } from 'node:child_process'
import * as childProcess from 'node:child_process'
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, statSync } from 'node:fs'
import { tmpdir, homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import ChannelService from 'dsh-channel'
import { currentRuntimeVersion, importRuntime, linkRuntimeInto } from '../src/runtimes.js'
import { findInstance, loadRegistry, saveRegistry, upsertInstance } from '../src/registry.js'
import * as logView from '../src/client/logView.js'
import { listArchives as modelArchives } from '../src/lifecycle.js'
import ConsoleService, {
  applyOverrideStatus,
  resolveControlAction,
  Logger,
  resolveControlRoute,
  type InstanceRecord,
  type LogLevel,
  type LogReadResult,
  type LogRecord,
} from '../src/index.ts'

/**
 * 目录隔离：整套测试跑在临时 DSH_HOME 下——daemon 角色会把部署清单/日志写进
 * 数据根（roleDataRoot），沿用外部 DSH_HOME 会污染正在运行的环境（曾把
 * instances.json 写进 ~/.dsh-web2）并让测试互相串（上一个用例的部署清单被
 * 下一个用例恢复，断言随之失真）。
 */
let savedDshHome: string | undefined
let testDshHome = ''

beforeAll(() => { savedDshHome = process.env.DSH_HOME })
afterAll(() => {
  if (savedDshHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = savedDshHome
})

// 每个用例独立数据根：daemon 的部署清单/日志互不串联（否则上个用例 deploy 的实例
// 会被下个用例的守护恢复，断言随之失真）。
beforeEach(() => {
  testDshHome = mkdtempSync(join(tmpdir(), 'dsh-console-test-home-'))
  process.env.DSH_HOME = testDshHome
  // 注册表是实例清单的权威源，且是**主机级**文件（不是 per-instance）——测试必须把它
  // 指向临时文件，否则会把实例档案写进真实 ~/.dsh-home/registry.json。
  process.env.DSH_REGISTRY = join(testDshHome, 'registry.json')
  process.env.DSH_HOST_ID = 'master'
})
afterEach(() => {
  if (savedDshHome !== undefined) process.env.DSH_HOME = savedDshHome
  rmSync(testDshHome, { recursive: true, force: true })
})

async function boot(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(ChannelService, { tokens: { instA: 'tok-a' }, heartbeatTimeoutMs: 30000 })
  await ctx.plugin(ConsoleService, {})
  return ctx
}

const RECORD: InstanceRecord = {
  id: 'instA',
  name: 'A',
  addr: '10.0.0.1:3000',
  status: 'online',
  owner: 'alice',
  type: 'normal',
  host: 'host1',
  version: '0.0.0',
}

describe('主机/实例档案', () => {
  it('登记主机并列出', async () => {
    const ctx = await boot()
    ctx.console.registerHost({ id: 'host1', addr: '10.0.0.1', status: 'online', version: '0.0.0' })
    expect(ctx.console.listHosts()).toHaveLength(1)
    expect(ctx.console.listHosts()[0].id).toBe('host1')
  })

  it('写入/查询/列出实例档案', async () => {
    const ctx = await boot()
    ctx.console.setInstanceRecord(RECORD)
    expect(ctx.console.getInstanceRecord('instA')?.owner).toBe('alice')
    expect(ctx.console.getInstanceRecord('instA')?.type).toBe('normal')
    expect(ctx.console.listInstanceRecords()).toHaveLength(1)
  })
})

describe('生命周期/部署编排', () => {
  it('controlInstance 指令回环到 channel（agent 侧可接收）', async () => {
    const ctx = await boot()
    const received: string[] = []
    ctx.channel.onControl((cmd) => received.push(cmd.type))
    ctx.console.controlInstance('instA', 'upgrade', { to: '0.1.0' })
    expect(received).toEqual(['upgrade'])
  })

  it('deployInstance 登记档案并下发 deploy 指令（完整请求）', async () => {
    const ctx = await boot()
    const received: Array<{ type: string; payload: unknown }> = []
    ctx.channel.onControl((cmd) => received.push({ type: cmd.type, payload: cmd.payload }))
    ctx.console.deployInstance({
      host: 'host1', instanceId: 'web6', version: '0.1.2-rc.1', profile: 'web',
      dshHome: '/tmp/.dsh-web6-test', port: 3086, token: 'tok-web6', env: { DSH_RELAY_AGENT: 'web6' },
    })
    expect(ctx.console.getInstanceRecord('web6')?.version).toBe('0.1.2-rc.1')
    expect(received[0].type).toBe('deploy')
    const payload = received[0].payload as { instanceId: string; dshHome: string; port: number }
    expect(payload.instanceId).toBe('web6')
    expect(payload.dshHome).toBe('/tmp/.dsh-web6-test')
    expect(payload.port).toBe(3086)
  })

  it('bootstrapHost 生成令牌 + agent profile + SSH 引导命令（含主机别名）', async () => {
    const ctx = await boot()
    const r = ctx.console.bootstrapHost('web5', 'user@10.0.0.15', '0.1.2-rc.1', '工作机 C')
    expect(r.ok).toBe(true)
    expect(r.token).toMatch(/^[0-9a-f]{32}$/)
    expect(r.instanceId).toBe('web5')
    expect(r.alias).toBe('工作机 C')
    expect(r.profileDir).toBe('agent-web5')
    expect(r.sshCommands?.length).toBe(3)
    expect(r.sshCommands?.[0]).toContain('scp -r agent-web5 user@10.0.0.15')
    expect(r.sshCommands?.[1]).toContain('dsh bootstrap --profile agent-web5 --version 0.1.2-rc.1')
    // 别名写入部署物（随引导命令 scp 到目标机）。
    expect(readFileSync(join(process.cwd(), 'agent-web5', '.dsh-alias'), 'utf8')).toContain('工作机 C')
    // 清理：bootstrapHost 写 cwd 的 agent-web5/（测试产物，勿残留）。
    rmSync(join(process.cwd(), 'agent-web5'), { recursive: true, force: true })
  })

  it('bootstrapHost 校验非法输入', async () => {
    const ctx = await boot()
    expect(ctx.console.bootstrapHost('bad/name', 'user@host', '0.1.2-rc.1', '').ok).toBe(false)
    expect(ctx.console.bootstrapHost('web5', '10.0.0.15', '0.1.2-rc.1', '').ok).toBe(false)
  })
})

describe('inbox（系统事件消息）', () => {
  it('postMessage 按 owner 隔离', async () => {
    const ctx = await boot()
    ctx.console.postMessage('alice', 'console', 'upgrade.done', '升级完成', 'v0.1.0')
    ctx.console.postMessage('bob', 'console', 'upgrade.done', '升级完成', 'v0.1.0')
    expect(ctx.console.listInbox('alice')).toHaveLength(1)
    expect(ctx.console.listInbox('bob')).toHaveLength(1)
    expect(ctx.console.listInbox('carol')).toHaveLength(0)
  })

  it('未读数与已读标记', async () => {
    const ctx = await boot()
    ctx.console.postMessage('alice', 'console', 'task.result', '任务完成', 'ok')
    expect(ctx.console.unreadCount('alice')).toBe(1)
    const id = ctx.console.listInbox('alice')[0].id
    expect(ctx.console.markRead('alice', id)).toBe(true)
    expect(ctx.console.unreadCount('alice')).toBe(0)
    expect(ctx.console.markRead('alice', 'nope')).toBe(false)
  })

  it('channel task 平面 system.* 事件自动入 inbox', async () => {
    const ctx = await boot()
    ctx.channel.emit('task', 'system.health.alert', { owner: 'alice', sender: 'instA', title: '健康异常', body: 'cpu' })
    const list = ctx.console.listInbox('alice')
    expect(list).toHaveLength(1)
    expect(list[0].type).toBe('system.health.alert')
  })

  it('非 system.* 事件不入 inbox', async () => {
    const ctx = await boot()
    ctx.channel.emit('task', 'job.run', { owner: 'alice' })
    expect(ctx.console.listInbox('alice')).toHaveLength(0)
  })
})

describe('instance 角色（实例自退兜底，原 agent 改名）', () => {
  it('resolveControlAction：restart/stop→exit、start→running、upgrade/deploy→pending', () => {
    expect(resolveControlAction({ id: 'c', type: 'restart', payload: {} })).toBe('exit')
    expect(resolveControlAction({ id: 'c', type: 'stop', payload: {} })).toBe('exit')
    expect(resolveControlAction({ id: 'c', type: 'start', payload: {} })).toBe('running')
    expect(resolveControlAction({ id: 'c', type: 'upgrade', payload: {} })).toBe('pending')
    expect(resolveControlAction({ id: 'c', type: 'deploy', payload: {} })).toBe('pending')
  })

  it('instance 角色注册控制接收：收到 restart 指令触发 exit（mock）', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
    const ctx = new Context()
    await ctx.plugin(ChannelService, { tokens: {}, heartbeatTimeoutMs: 30000 })
    await ctx.plugin(ConsoleService, { role: 'instance' })
    // 实例已运行超过启动窗口（否则迟到指令被窗口过滤，见下一条用例）。
    ;(ctx.console as unknown as { startedAt: number }).startedAt = Date.now() - ConsoleService.STARTUP_CONTROL_GRACE_MS - 1000
    // sendControl 无 relay → 进程内回环，instance 端 onControl 收到
    ctx.channel.sendControl('instX', { type: 'restart', payload: {} })
    await new Promise((r) => setTimeout(r, 400))
    expect(exitSpy).toHaveBeenCalled()
    exitSpy.mockRestore()
  })

  it('instance 角色：发送早于本进程启动的积压 stop/restart 忽略（不自杀）', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
    const ctx = new Context()
    await ctx.plugin(ChannelService, { tokens: {}, heartbeatTimeoutMs: 30000 })
    await ctx.plugin(ConsoleService, { role: 'instance' })
    // 模拟 broker 积压补投：指令发送时间早于实例启动时刻（ts 判定积压）。
    const cmd = { id: 'old-1', type: 'restart' as const, payload: {} }
    ;(ctx.channel as unknown as { controlHandlers: Set<(c: typeof cmd & { ts: number }, i: string) => void> }).controlHandlers
      .forEach((h) => h({ ...cmd, ts: Date.now() - 60_000 }, 'host1'))
    await new Promise((r) => setTimeout(r, 400))
    expect(exitSpy).not.toHaveBeenCalled()
    // 当前指令（ts ≥ 启动时刻）照常执行。
    ctx.channel.sendControl('instX', { type: 'restart', payload: {} })
    await new Promise((r) => setTimeout(r, 400))
    expect(exitSpy).toHaveBeenCalledTimes(1)
    exitSpy.mockRestore()
  })

  it('console 角色（默认）不注册 instance 执行器：restart 指令不回环执行', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
    const ctx = await boot()
    ctx.channel.sendControl('instA', { type: 'restart', payload: {} })
    await new Promise((r) => setTimeout(r, 400))
    expect(exitSpy).not.toHaveBeenCalled()
    exitSpy.mockRestore()
  })
})

describe('控制路由（console 决策面）', () => {
  it('start：有守护→daemon（在线也发守护，绕开 broker TTL 滞后）；离线无守护→error', () => {
    expect(resolveControlRoute('start', true, 'host-lab1')).toEqual({ action: 'daemon', daemonAgent: 'host-lab1', command: 'start' })
    expect(resolveControlRoute('start', false, 'host-lab1')).toEqual({ action: 'daemon', daemonAgent: 'host-lab1', command: 'start' })
    expect(resolveControlRoute('start', true, undefined)).toEqual({ action: 'noop' })
    expect(resolveControlRoute('start', false, undefined)).toEqual({ action: 'error', reason: expect.any(String) })
  })

  it('stop：离线→noop；在线有守护→daemon；在线无守护→instance 自退', () => {
    expect(resolveControlRoute('stop', false, 'host-lab1')).toEqual({ action: 'noop' })
    expect(resolveControlRoute('stop', true, 'host-lab1')).toEqual({ action: 'daemon', daemonAgent: 'host-lab1', command: 'stop' })
    expect(resolveControlRoute('stop', true, undefined)).toEqual({ action: 'instance', command: 'stop' })
  })

  it('restart：有守护→daemon；无守护在线→instance；无守护离线→error', () => {
    expect(resolveControlRoute('restart', true, 'host-lab1')).toEqual({ action: 'daemon', daemonAgent: 'host-lab1', command: 'restart' })
    expect(resolveControlRoute('restart', false, 'host-lab1')).toEqual({ action: 'daemon', daemonAgent: 'host-lab1', command: 'restart' })
    expect(resolveControlRoute('restart', true, undefined)).toEqual({ action: 'instance', command: 'restart' })
    expect(resolveControlRoute('restart', false, undefined)).toEqual({ action: 'error', reason: expect.any(String) })
  })

  it('controlInstance：start 经守护下发（payload 带 instanceId）', async () => {
    const ctx = new Context()
    await ctx.plugin(ChannelService, { tokens: {}, heartbeatTimeoutMs: 30000 })
    await ctx.plugin(ConsoleService, { launch: { instA: { host: 'host-lab1', dshHome: '~/.dsh-a', profile: 'web' } } })
    // 守护已注册（channel 发现），否则 controlInstance 报「守护未注册」。
    ctx.channel.register({ id: 'host-lab1', name: 'host-lab1', addr: '', status: 'online' }, '')
    const received: Array<{ target: string; type: string; payload: unknown }> = []
    ctx.channel.onControl((cmd, instanceId) => received.push({ target: instanceId, type: cmd.type, payload: cmd.payload }))
    const result = ctx.console.controlInstance('instA', 'start')
    expect(result.ok).toBe(true)
    expect(received).toEqual([{ target: 'host-lab1', type: 'start', payload: { instanceId: 'instA' } }])
  })

  it('controlInstance：守护未注册（launch.host 拼错）→ 失败并说明', async () => {
    const ctx = new Context()
    await ctx.plugin(ChannelService, { tokens: {}, heartbeatTimeoutMs: 30000 })
    await ctx.plugin(ConsoleService, { launch: { instA: { host: 'host-nope', dshHome: '~/.dsh-a', profile: 'web' } } })
    const result = ctx.console.controlInstance('instA', 'start')
    expect(result.ok).toBe(false)
    expect(result.error).toContain('host-nope')
  })

  it('controlInstance：离线且无守护配置 → 失败并说明原因', async () => {
    const ctx = await boot()
    const result = ctx.console.controlInstance('instA', 'start')
    expect(result.ok).toBe(false)
    expect(result.error).toBeTruthy()
  })

  it('controlInstance：upgrade 始终投给实例本身', async () => {
    const ctx = await boot()
    const received: string[] = []
    ctx.channel.onControl((cmd) => received.push(cmd.type))
    const result = ctx.console.controlInstance('instA', 'upgrade', { to: '0.1.0' })
    expect(result.ok).toBe(true)
    expect(received).toEqual(['upgrade'])
  })
})

describe('离线覆盖（UI 即时显示，绕开 broker TTL 滞后）', () => {
  it('无覆盖 → 原状态，不过期', () => {
    expect(applyOverrideStatus('online', undefined, 0, 15000)).toEqual({ status: 'online', expired: false })
    expect(applyOverrideStatus('offline', undefined, 0, 15000)).toEqual({ status: 'offline', expired: false })
  })

  it('stop 覆盖：强制 offline；实例真离线（channel offline）→ 过期可清', () => {
    const ov = { op: 'stop' as const, ts: 1000 }
    expect(applyOverrideStatus('online', ov, 2000, 15000)).toEqual({ status: 'offline', expired: false })
    expect(applyOverrideStatus('offline', ov, 2000, 15000)).toEqual({ status: 'offline', expired: true })
  })

  it('restart 覆盖：窗口内强制 offline；窗口后过期回到 channel 状态', () => {
    const ov = { op: 'restart' as const, ts: 1000 }
    expect(applyOverrideStatus('online', ov, 2000, 15000)).toEqual({ status: 'offline', expired: false })
    expect(applyOverrideStatus('online', ov, 20000, 15000)).toEqual({ status: 'online', expired: true })
    expect(applyOverrideStatus('offline', ov, 20000, 15000)).toEqual({ status: 'offline', expired: true })
  })
})

/** 构造一个伪子进程（EventEmitter + exitCode/kill/unref）。 */function fakeChild(exitCode: number | null = null): ChildProcess {
  const child = new EventEmitter() as unknown as ChildProcess
  Object.defineProperty(child, 'exitCode', { value: exitCode, writable: true })
  ;(child as { kill: ReturnType<typeof vi.fn> }).kill = vi.fn(() => true)
  ;(child as { unref: ReturnType<typeof vi.fn> }).unref = vi.fn()
  return child
}

/** 替换 ConsoleService 的 spawn 实现（返回伪子进程），返回 spy。 */
function mockSpawn(child: ChildProcess): ReturnType<typeof vi.fn> {
  const fn = vi.fn(() => child)
  ConsoleService.spawnImpl = fn as unknown as typeof childProcess.spawn
  return fn
}

async function bootDaemon(config: Record<string, unknown>): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(ChannelService, { tokens: {}, heartbeatTimeoutMs: 30000 })
  await ctx.plugin(ConsoleService, { role: 'daemon', hostId: 'lab1', instances: { web3: { dshHome: '~/.dsh-web3', profile: 'web' } }, ...config })
  return ctx
}

describe('daemon 角色（主机守护）', () => {
  afterEach(() => {
    ConsoleService.spawnImpl = childProcess.spawn
    ConsoleService.upgradeApplyError = undefined
    vi.useRealTimers()
  })

  it('start：spawn 清单内实例（env 合并 DSH_HOME + 实例 env）', async () => {
    const child = fakeChild()
    const spawnSpy = mockSpawn(child)
    const ctx = new Context()
    await ctx.plugin(ChannelService, { tokens: {}, heartbeatTimeoutMs: 30000 })
    await ctx.plugin(ConsoleService, {
      role: 'daemon',
      hostId: 'lab1',
      instances: { web3: { dshHome: '~/.dsh-web3', profile: 'web', env: { DSH_RELAY_AGENT: 'web3' } } },
    })
    ctx.channel.sendControl('host-lab1', { type: 'start', payload: { instanceId: 'web3' } })
    await new Promise((r) => setTimeout(r, 20))
    // 有档案版本且池内有该版本 → 用**池内 CLI** 启动（R7：实例按引用版本跑，而不是守护/PATH 的 CLI）
    expect(spawnSpy).toHaveBeenCalledWith('dsh', ['--profile', 'web'], expect.objectContaining({
      env: expect.objectContaining({ DSH_HOME: '~/.dsh-web3', DSH_RELAY_AGENT: 'web3' }),
      detached: true,
    }))
  })

  it('start：已在运行则忽略（幂等，不重复 spawn）', async () => {
    const child = fakeChild()
    const spawnSpy = mockSpawn(child)
    const ctx = await bootDaemon({ instances: { web3: { dshHome: '~/.dsh-web3', profile: 'web' } } })
    ctx.channel.sendControl('host-lab1', { type: 'start', payload: { instanceId: 'web3' } })
    await new Promise((r) => setTimeout(r, 20))
    ctx.channel.sendControl('host-lab1', { type: 'start', payload: { instanceId: 'web3' } })
    await new Promise((r) => setTimeout(r, 20))
    expect(spawnSpy).toHaveBeenCalledTimes(1)
  })

  it('start：清单外实例拒绝（不 spawn）', async () => {
    const spawnSpy = mockSpawn(fakeChild())
    const ctx = await bootDaemon({})
    ctx.channel.sendControl('host-lab1', { type: 'start', payload: { instanceId: 'intruder' } })
    await new Promise((r) => setTimeout(r, 20))
    expect(spawnSpy).not.toHaveBeenCalled()
  })

  it('stop：守护拉起的子进程 kill SIGTERM，宽限后 SIGKILL', async () => {
    vi.useFakeTimers()
    const child = fakeChild()
    mockSpawn(child)
    const ctx = await bootDaemon({ instances: { web3: { dshHome: '~/.dsh-web3', profile: 'web' } } })
    ctx.channel.sendControl('host-lab1', { type: 'start', payload: { instanceId: 'web3' } })
    ctx.channel.sendControl('host-lab1', { type: 'stop', payload: { instanceId: 'web3' } })
    expect((child as unknown as { kill: ReturnType<typeof vi.fn> }).kill).toHaveBeenCalledWith('SIGTERM')
    // 宽限后仍未退出 → SIGKILL
    Object.defineProperty(child, 'exitCode', { value: null })
    vi.advanceTimersByTime(5000)
    expect((child as unknown as { kill: ReturnType<typeof vi.fn> }).kill).toHaveBeenCalledWith('SIGKILL')
  })

  it('stop：非守护拉起的在线实例，无 broker → 本机端口定位 kill（lsof）', async () => {
    const execMock = vi.fn((_cmd: string, cb: (e: Error | null, s: string) => void) => cb(null, '12345\n'))
    ConsoleService.execImpl = execMock as unknown as typeof childProcess.exec
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => undefined as never)
    const ctx = await bootDaemon({ instances: { web3: { dshHome: '~/.dsh-web3', profile: 'web', port: 3083 } } })
    ctx.channel.sendControl('host-lab1', { type: 'stop', payload: { instanceId: 'web3' } })
    await new Promise((r) => setTimeout(r, 50))
    expect(execMock).toHaveBeenCalledWith('lsof -ti tcp:3083 -sTCP:LISTEN', expect.anything())
    expect(killSpy).toHaveBeenCalledWith(12345, 'SIGTERM')
    ConsoleService.execImpl = childProcess.exec
    killSpy.mockRestore()
  })

  it('restart 守护拉起的实例：kill，exit 前不 spawn，exit 后 spawn 一次', async () => {
    const child = fakeChild()
    const spawnSpy = mockSpawn(child)
    const ctx = await bootDaemon({ instances: { web3: { dshHome: '~/.dsh-web3', profile: 'web' } } })
    ctx.channel.sendControl('host-lab1', { type: 'start', payload: { instanceId: 'web3' } })
    await new Promise((r) => setTimeout(r, 20))
    ctx.channel.sendControl('host-lab1', { type: 'restart', payload: { instanceId: 'web3' } })
    expect((child as unknown as { kill: ReturnType<typeof vi.fn> }).kill).toHaveBeenCalledWith('SIGTERM')
    // exit 前不 spawn（避免端口冲突）
    expect(spawnSpy).toHaveBeenCalledTimes(1)
    child.emit('exit', 0, null)
    await new Promise((r) => setTimeout(r, 20))
    expect(spawnSpy).toHaveBeenCalledTimes(2)
  })

  it('daemon 角色自动注册 instances 清单进 channel（本机实例，addr 用 127.0.0.1:port）', async () => {
    const ctx = await bootDaemon({ instances: { web3: { dshHome: '~/.dsh-web3', profile: 'web', port: 3083 } } })
    const inst = ctx.channel.get('web3')
    expect(inst?.status).toBe('online')
    expect(inst?.addr).toBe('http://127.0.0.1:3083')
  })

  it('restart 非守护拉起的在线实例，无 broker：固定窗口后拉起（端口 kill 由 stop 测试覆盖）', async () => {
    vi.useFakeTimers()
    const spawnSpy = mockSpawn(fakeChild())
    ConsoleService.execImpl = ((_cmd: string, cb: (e: Error | null, s: string) => void) => cb(null, '')) as unknown as typeof childProcess.exec
    // 无 port（daemonStartAfterStop 走固定窗口，fake timers 可控；端口 kill 已由 stop 测试覆盖）
    const ctx = await bootDaemon({ instances: { web3: { dshHome: '~/.dsh-web3', profile: 'web' } } })
    // 实例在线（显式心跳——无端口条目不再"声明即在线"）但守护无子进程 → 分支 2（无 broker → 不发跨进程 stop）
    ctx.channel.heartbeat('web3', '')
    ctx.channel.sendControl('host-lab1', { type: 'restart', payload: { instanceId: 'web3' } })
    expect(spawnSpy).not.toHaveBeenCalled()
    // 固定窗口（STOP_SELF_EXIT_WAIT_MS=35000）后拉起
    await vi.advanceTimersByTimeAsync(35000)
    expect(spawnSpy).toHaveBeenCalledTimes(1)
    ConsoleService.execImpl = childProcess.exec
  })

  it('busy 锁：积压两条 restart → 只处理一次（不重复 spawn）', async () => {
    const child = fakeChild()
    const spawnSpy = mockSpawn(child)
    const ctx = await bootDaemon({ instances: { web3: { dshHome: '~/.dsh-web3', profile: 'web' } } })
    ctx.channel.sendControl('host-lab1', { type: 'start', payload: { instanceId: 'web3' } })
    await new Promise((r) => setTimeout(r, 20))
    ctx.channel.sendControl('host-lab1', { type: 'restart', payload: { instanceId: 'web3' } })
    ctx.channel.sendControl('host-lab1', { type: 'restart', payload: { instanceId: 'web3' } })
    ctx.channel.sendControl('host-lab1', { type: 'start', payload: { instanceId: 'web3' } })
    child.emit('exit', 0, null)
    await new Promise((r) => setTimeout(r, 20))
    // 1 (start) + 1 (restart 后 spawn)；第二条 restart 与 restart 期间的 start 被 busy 锁忽略
    expect(spawnSpy).toHaveBeenCalledTimes(2)
  })

  it('spawn error：children 清理 + 解锁，后续 start 可恢复', async () => {
    const child = fakeChild()
    const spawnSpy = mockSpawn(child)
    const ctx = await bootDaemon({ instances: { web3: { dshHome: '~/.dsh-web3', profile: 'web' } } })
    ctx.channel.sendControl('host-lab1', { type: 'start', payload: { instanceId: 'web3' } })
    await new Promise((r) => setTimeout(r, 20))
    child.emit('error', new Error('ENOENT'))
    // 清理后再 start → 重新 spawn（不被死条目阻塞）
    ctx.channel.sendControl('host-lab1', { type: 'start', payload: { instanceId: 'web3' } })
    await new Promise((r) => setTimeout(r, 20))
    expect(spawnSpy).toHaveBeenCalledTimes(2)
  })

  it('restart watchdog：kill 后进程始终不退 → 超时解锁（下次 restart 仍工作）', async () => {
    vi.useFakeTimers()
    const child = fakeChild()
    const spawnSpy = mockSpawn(child)
    const ctx = await bootDaemon({ instances: { web3: { dshHome: '~/.dsh-web3', profile: 'web' } } })
    ctx.channel.sendControl('host-lab1', { type: 'start', payload: { instanceId: 'web3' } })
    ctx.channel.sendControl('host-lab1', { type: 'restart', payload: { instanceId: 'web3' } })
    // 进程不退（不 emit exit）→ watchdog 超时解锁
    await vi.advanceTimersByTimeAsync(20000)
    // 解锁后再次 restart（旧进程已退出）→ 清单实例注册 online → 走自退分支，
    // 固定窗口（STOP_SELF_EXIT_WAIT_MS=35000）后拉起
    Object.defineProperty(child, 'exitCode', { value: 0 })
    ctx.channel.sendControl('host-lab1', { type: 'restart', payload: { instanceId: 'web3' } })
    await vi.advanceTimersByTimeAsync(35000)
    expect(spawnSpy).toHaveBeenCalledTimes(2)
  })

  it('deploy：动态加入运行时清单并 spawn 新实例（复用本地发行包）', async () => {
    const child = fakeChild()
    const spawnSpy = mockSpawn(child)
    const ctx = await bootDaemon({})
    // console 端组装完整 deploy 请求 → daemon 收（channel 回环到 onControl）。
    ctx.console.deployInstance({
      host: 'host1', instanceId: 'web6', version: '0.1.2-rc.1', profile: 'web',
      dshHome: '/tmp/.dsh-web6-deploy', port: 3086, token: 'tok-web6', env: { DSH_RELAY_AGENT: 'web6' },
    })
    await new Promise((r) => setTimeout(r, 30))
    expect(spawnSpy).toHaveBeenCalledWith(
      join(process.env.HOME ?? '', '.dsh-runtimes', '0.1.2-rc.1', 'node_modules', '.bin', 'dsh'),
      ['--profile', 'web'],
      expect.objectContaining({
      env: expect.objectContaining({ DSH_HOME: '/tmp/.dsh-web6-deploy', DSH_RELAY_AGENT: 'web6' }),
      detached: true,
    }))
    // 动态实例后续可被 stop/restart（instanceSpec 命中运行时清单）。
    ctx.channel.sendControl('host-lab1', { type: 'stop', payload: { instanceId: 'web6' } })
  })

  it('deploy：重复部署同一 id 幂等忽略（不清单已有）', async () => {
    const child = fakeChild()
    const spawnSpy = mockSpawn(child)
    const ctx = await bootDaemon({})
    const req = {
      host: 'host1', instanceId: 'web6', version: '0.1.2-rc.1', profile: 'web',
      dshHome: '/tmp/.dsh-web6-idem', port: 3086, token: 'tok-web6',
    }
    ctx.console.deployInstance(req)
    await new Promise((r) => setTimeout(r, 20))
    ctx.console.deployInstance(req)
    await new Promise((r) => setTimeout(r, 20))
    expect(spawnSpy).toHaveBeenCalledTimes(1)
  })

  it('upgrade：快照 → 对齐发行包源 → spawn（离线实例，patch 保留 + 版本标记）', async () => {
    vi.useFakeTimers()
    const tmp = mkdtempSync(join(tmpdir(), 'dsh-upgrade-ok-'))
    try {
      // 发行包源（守护 templateHome）。
      const src = join(tmp, 'src', 'profiles', 'web')
      mkdirSync(src, { recursive: true })
      writeFileSync(join(src, 'package.json'), '{"release":"SRC"}\n')
      writeFileSync(join(src, 'cordis.yml'), '[]\n')
      // 实例 home（升级前 = OLD）。
      const inst = join(tmp, 'inst', 'profiles', 'web')
      mkdirSync(inst, { recursive: true })
      writeFileSync(join(inst, 'package.json'), '{"release":"OLD"}\n')
      writeFileSync(join(inst, 'cordis.patch.yml'), '# 实例 patch（保留）\n')
      const spawnSpy = mockSpawn(fakeChild())
      const ctx = await bootDaemon({ templateHome: join(tmp, 'src') })
      // 运行时加入未声明实例（channel 无该 id → 离线直启分支，无端口走健康宽限）。
      ;(ctx.console as unknown as { runtimeInstances: Map<string, { dshHome: string; profile: string }> })
        .runtimeInstances.set('web9', { dshHome: join(tmp, 'inst'), profile: 'web' })
      ctx.channel.sendControl('host-lab1', { type: 'upgrade', payload: { instanceId: 'web9', version: '0.1.2-rc.1' } })
      await vi.advanceTimersByTimeAsync(16_000)
      // 发行包对齐源；实例 patch 保留；版本标记写入。
      expect(readFileSync(join(inst, 'package.json'), 'utf8')).toContain('SRC')
      expect(readFileSync(join(inst, 'cordis.patch.yml'), 'utf8')).toContain('# 实例 patch')
      expect(JSON.parse(readFileSync(join(inst, '.dsh-release.json'), 'utf8')).version).toBe('0.1.2-rc.1')
      // 快照一份（含升级前 OLD，即回滚点）。
      const snapDir = join(tmp, 'inst', '.dsh-upgrade-snapshots', 'web9')
      const snaps = readdirSync(snapDir)
      expect(snaps).toHaveLength(1)
      expect(readFileSync(join(snapDir, snaps[0], 'package.json'), 'utf8')).toContain('OLD')
      expect(spawnSpy).toHaveBeenCalledWith('dsh', ['--profile', 'web'], expect.objectContaining({
        env: expect.objectContaining({ DSH_HOME: join(tmp, 'inst') }),
        detached: true,
      }))
    } finally {
      vi.useRealTimers()
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('upgrade：应用失败自动回滚（快照恢复、无重启、事件带 rolledBack）', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'dsh-upgrade-rb-'))
    try {
      const src = join(tmp, 'src', 'profiles', 'web')
      mkdirSync(src, { recursive: true })
      writeFileSync(join(src, 'package.json'), '{"release":"SRC"}\n')
      const inst = join(tmp, 'inst', 'profiles', 'web')
      mkdirSync(inst, { recursive: true })
      writeFileSync(join(inst, 'package.json'), '{"release":"OLD"}\n')
      writeFileSync(join(inst, 'cordis.patch.yml'), '# patch\n')
      const spawnSpy = mockSpawn(fakeChild())
      ConsoleService.upgradeApplyError = new Error('注入的应用失败')
      const ctx = await bootDaemon({ templateHome: join(tmp, 'src') })
      ;(ctx.console as unknown as { runtimeInstances: Map<string, { dshHome: string; profile: string }> })
        .runtimeInstances.set('web9', { dshHome: join(tmp, 'inst'), profile: 'web' })
      const events: Array<{ type: string; payload: Record<string, unknown> }> = []
      ctx.channel.subscribe('task', (e) => events.push({ type: e.type, payload: e.payload as Record<string, unknown> }))
      ctx.channel.sendControl('host-lab1', { type: 'upgrade', payload: { instanceId: 'web9', version: '0.1.1-rc.2' } })
      await new Promise((r) => setTimeout(r, 30))
      // 回滚恢复升级前状态（发行包与 patch 原样、无版本标记）；失败路径不重启。
      expect(readFileSync(join(inst, 'package.json'), 'utf8')).toContain('OLD')
      expect(existsSync(join(inst, '.dsh-release.json'))).toBe(false)
      expect(spawnSpy).not.toHaveBeenCalled()
      const result = events.find((e) => e.type === 'system.upgrade.result')
      expect(result).toBeTruthy()
      expect(result!.payload.ok).toBe(false)
      expect(result!.payload.rolledBack).toBe(true)
      expect(result!.payload.version).toBe('0.1.1-rc.2')
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('upgrade：守护子进程 kill→exit→拉起（滚动重启分支 1）', async () => {
    vi.useFakeTimers()
    const tmp = mkdtempSync(join(tmpdir(), 'dsh-upgrade-b1-'))
    try {
      const src = join(tmp, 'src', 'profiles', 'web')
      mkdirSync(src, { recursive: true })
      writeFileSync(join(src, 'package.json'), '{"release":"SRC"}\n')
      const inst = join(tmp, 'inst', 'profiles', 'web')
      mkdirSync(inst, { recursive: true })
      writeFileSync(join(inst, 'package.json'), '{"release":"OLD"}\n')
      const child = fakeChild()
      const killSpy = child as unknown as { kill: ReturnType<typeof vi.fn> }
      const spawnSpy = mockSpawn(child)
      const ctx = await bootDaemon({ templateHome: join(tmp, 'src'), instances: { web9: { dshHome: join(tmp, 'inst'), profile: 'web' } } })
      // 先由守护拉起（children 有子进程）→ upgrade 走 kill→exit→再拉起。
      ctx.channel.sendControl('host-lab1', { type: 'start', payload: { instanceId: 'web9' } })
      expect(spawnSpy).toHaveBeenCalledTimes(1)
      ctx.channel.sendControl('host-lab1', { type: 'upgrade', payload: { instanceId: 'web9', version: '0.1.2-rc.1' } })
      expect(killSpy.kill).toHaveBeenCalledWith('SIGTERM')
      child.emit('exit', 0, null)
      // 健康宽限（无端口）15s
      await vi.advanceTimersByTimeAsync(16_000)
      expect(spawnSpy).toHaveBeenCalledTimes(2)
      expect(readFileSync(join(inst, 'package.json'), 'utf8')).toContain('SRC')
      expect(JSON.parse(readFileSync(join(inst, '.dsh-release.json'), 'utf8')).version).toBe('0.1.2-rc.1')
    } finally {
      vi.useRealTimers()
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('upgrade：在线非守护实例 → 端口定位 kill 后拉起（分支 2）', async () => {
    vi.useFakeTimers()
    const tmp = mkdtempSync(join(tmpdir(), 'dsh-upgrade-b2-'))
    const origPortFree = ConsoleService.portFreeImpl
    try {
      const src = join(tmp, 'src', 'profiles', 'web')
      mkdirSync(src, { recursive: true })
      writeFileSync(join(src, 'package.json'), '{"release":"SRC"}\n')
      const inst = join(tmp, 'inst', 'profiles', 'web')
      mkdirSync(inst, { recursive: true })
      writeFileSync(join(inst, 'package.json'), '{"release":"OLD"}\n')
      const port = 52000 + Math.floor(Math.random() * 500)
      const execMock = vi.fn((_cmd: string, cb: (e: Error | null, s: string) => void) => cb(null, '')) // 无占用进程 → 端口视为已空闲
      ConsoleService.execImpl = execMock as unknown as typeof childProcess.exec
      ConsoleService.portFreeImpl = async () => true // 确定性：端口恒空闲（绕开真实网络探测）
      const spawnSpy = mockSpawn(fakeChild())
      const ctx = await bootDaemon({ templateHome: join(tmp, 'src'), instances: { web9: { dshHome: join(tmp, 'inst'), profile: 'web', port } } })
      // 实例在线（constructor declare）但守护无子进程 → 分支 2：lsof 无 pid → 端口即空闲 → 拉起。
      ctx.channel.sendControl('host-lab1', { type: 'upgrade', payload: { instanceId: 'web9', version: '0.1.2-rc.1' } })
      expect(execMock).toHaveBeenCalledWith(`lsof -ti tcp:${port} -sTCP:LISTEN`, expect.anything())
      // 健康探测：端口恒空闲（无监听者）→ 80×500ms 后走"子进程存活视为健康"兜底。
      await vi.advanceTimersByTimeAsync(42_000)
      expect(spawnSpy).toHaveBeenCalledTimes(1)
      expect(readFileSync(join(inst, 'package.json'), 'utf8')).toContain('SRC')
    } finally {
      ConsoleService.execImpl = childProcess.exec
      ConsoleService.portFreeImpl = origPortFree
      vi.useRealTimers()
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('upgrade：kill 后进程不退 → watchdog 解锁继续（不永久挂起）', async () => {
    vi.useFakeTimers()
    const tmp = mkdtempSync(join(tmpdir(), 'dsh-upgrade-wd-'))
    try {
      const src = join(tmp, 'src', 'profiles', 'web')
      mkdirSync(src, { recursive: true })
      writeFileSync(join(src, 'package.json'), '{"release":"SRC"}\n')
      const inst = join(tmp, 'inst', 'profiles', 'web')
      mkdirSync(inst, { recursive: true })
      writeFileSync(join(inst, 'package.json'), '{"release":"OLD"}\n')
      const child = fakeChild()
      const killSpy = child as unknown as { kill: ReturnType<typeof vi.fn> }
      const spawnSpy = mockSpawn(child)
      const ctx = await bootDaemon({ templateHome: join(tmp, 'src'), instances: { web9: { dshHome: join(tmp, 'inst'), profile: 'web' } } })
      ctx.channel.sendControl('host-lab1', { type: 'start', payload: { instanceId: 'web9' } })
      ctx.channel.sendControl('host-lab1', { type: 'upgrade', payload: { instanceId: 'web9', version: '0.1.2-rc.1' } })
      expect(killSpy.kill).toHaveBeenCalledWith('SIGTERM')
      // 子进程始终不退：宽限(8s)补 SIGKILL；watchdog(20s)解锁 → 继续 spawn + 健康宽限(15s)。
      await vi.advanceTimersByTimeAsync(9_000)
      expect(killSpy.kill).toHaveBeenCalledWith('SIGKILL')
      // SIGKILL 后进程退出（模拟）→ watchdog 解锁后 daemonStart 重新拉起。
      Object.defineProperty(child, 'exitCode', { value: 0 })
      await vi.advanceTimersByTimeAsync(27_000)
      expect(spawnSpy).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('saveReleaseSnapshot：滚动保留 3 份（删最旧）', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'dsh-upgrade-snap-'))
    try {
      const ctx = await bootDaemon({})
      const svc = ctx.console as unknown as { saveReleaseSnapshot(root: string, home: string): string }
      const root = join(tmp, 'snaps')
      const home = join(tmp, 'home')
      mkdirSync(home, { recursive: true })
      writeFileSync(join(home, 'p'), 'x')
      for (let i = 0; i < 5; i++) {
        svc.saveReleaseSnapshot(root, home)
        await new Promise((r) => setTimeout(r, 3)) // Date.now() 毫秒去重
      }
      const kept = readdirSync(root).filter((d) => /^\d+$/.test(d))
      expect(kept).toHaveLength(3)
      // 保留的是最新三份（排序后即断言删掉了最旧两份）。
      const sorted = [...kept].sort((a, b) => Number(b) - Number(a))
      expect(sorted).toHaveLength(3)
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })
})

describe('统一升级（console 编排）', () => {
  it('upgradeInstances：按 launch.host 路由到守护并下发 payload', async () => {
    const ctx = new Context()
    await ctx.plugin(ChannelService, { tokens: {}, heartbeatTimeoutMs: 30000 })
    await ctx.plugin(ConsoleService, { launch: { host1: { host: 'host1' }, webA: { host: 'host1', addr: 'http://127.0.0.1:3083' } } })
    const received: Array<{ type: string; payload?: unknown }> = []
    ctx.channel.onControl((cmd) => received.push({ type: cmd.type, payload: cmd.payload }))
    const r = ctx.console.upgradeInstances(['webA'], '0.1.2-rc.1')
    expect(r.results).toHaveLength(1)
    expect(r.results[0].ok).toBe(true)
    expect(received[0]?.type).toBe('upgrade')
    expect((received[0]?.payload as { instanceId: string; version: string }).instanceId).toBe('webA')
    expect((received[0]?.payload as { instanceId: string; version: string }).version).toBe('0.1.2-rc.1')
  })

  it('upgradeInstances：守护未注册 / 无宿主 / 守护本体 → 逐条失败并说明', async () => {
    const ctx = new Context()
    await ctx.plugin(ChannelService, { tokens: {}, heartbeatTimeoutMs: 30000 })
    await ctx.plugin(ConsoleService, { launch: { webA: { host: 'labX', addr: 'http://127.0.0.1:3083' } } })
    const r = ctx.console.upgradeInstances(['webA', 'host1', 'orphan'], '0.1.2-rc.1')
    expect(r.results).toEqual([
      { instanceId: 'webA', ok: false, error: '目标守护 labX 未注册' },
      { instanceId: 'host1', ok: false, error: '守护主机本体不支持升级（v1）：请升级其下实例' },
      { instanceId: 'orphan', ok: false, error: '无守护宿主（launch/档案未配 host）' },
    ])
    // 空目标版本 → 拒绝。
    const empty = ctx.console.upgradeInstances(['orphan2'], '')
    expect(empty.results[0]?.ok).toBe(false)
    expect(empty.results[0]?.error).toContain('目标版本为空')
  })
})

describe('review 修复回归（去 broker 化边界）', () => {
  it('instance 角色经 env DSH_RELAY_AGENT 识别本机：直连本体 restart 短路自退（无守护/无 broker）', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
    const prev = process.env.DSH_RELAY_AGENT
    process.env.DSH_RELAY_AGENT = 'web3'
    const ctx = new Context()
    await ctx.plugin(ChannelService, { tokens: {}, heartbeatTimeoutMs: 30000 })
    await ctx.plugin(ConsoleService, { role: 'instance' })
    // 已运行超过窗口（RPC 面窗口兜底）
    ;(ctx.console as unknown as { startedAt: number }).startedAt = Date.now() - ConsoleService.STARTUP_CONTROL_GRACE_MS - 1000
    const result = (ctx.console as unknown as { controlInstance(id: string, c: string, p: object): unknown }).controlInstance('web3', 'restart', {})
    await new Promise((r) => setTimeout(r, 400))
    expect(exitSpy).toHaveBeenCalled()
    expect((result as { ok: boolean }).ok).toBe(true)
    exitSpy.mockRestore()
    if (prev === undefined) delete process.env.DSH_RELAY_AGENT; else process.env.DSH_RELAY_AGENT = prev
  })

  it('daemon 角色不短路自己（env id 不触发自杀）', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
    const prev = process.env.DSH_RELAY_AGENT
    process.env.DSH_RELAY_AGENT = 'host1'
    const ctx = await bootDaemon({ instances: { web3: { dshHome: '~/.dsh-web3', profile: 'web' } } })
    const result = (ctx.console as unknown as { controlInstance(id: string, c: string, p: object): unknown }).controlInstance('host1', 'restart', {})
    await new Promise((r) => setTimeout(r, 400))
    expect(exitSpy).not.toHaveBeenCalled()
    expect((result as { ok: boolean }).ok).toBe(false) // 无守护配置 → 显式失败，不自杀
    exitSpy.mockRestore()
    if (prev === undefined) delete process.env.DSH_RELAY_AGENT; else process.env.DSH_RELAY_AGENT = prev
  })

  it('直连探测：可达 → heartbeat 续期保持 online；不可达 → 立即 setStatus(offline)（不假绿）', async () => {
    let reachable = true
    vi.stubGlobal('fetch', vi.fn(async () => {
      if (!reachable) throw new Error('ECONNREFUSED')
      return new Response('{}', { status: 200 })
    }))
    const ctx = new Context()
    await ctx.plugin(ChannelService, { tokens: {}, heartbeatTimeoutMs: 30000 })
    await ctx.plugin(ConsoleService, { launch: { web3: { host: 'host1', addr: 'http://127.0.0.1:3083', dshHome: 'x', profile: 'web' } } })
    const consoleSvc = ctx.console as unknown as { probeLaunch(): Promise<void> }
    await consoleSvc.probeLaunch()
    await new Promise((r) => setTimeout(r, 20))
    expect(ctx.channel.get('web3')?.status).toBe('online')
    // 不可达 → 立即标离线（探测结果驱动——不等 sweep 窗口，消除假绿）
    reachable = false
    await consoleSvc.probeLaunch()
    await new Promise((r) => setTimeout(r, 20))
    expect(ctx.channel.get('web3')?.status).toBe('offline')
    // 恢复可达 → 再探回 online
    reachable = true
    await consoleSvc.probeLaunch()
    await new Promise((r) => setTimeout(r, 20))
    expect(ctx.channel.get('web3')?.status).toBe('online')
    vi.unstubAllGlobals()
  })

  it('构造后立即首轮 probe：launch 中不可达实例即刻 offline（重启不假绿）', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED') }))
    const ctx = new Context()
    await ctx.plugin(ChannelService, { tokens: {}, heartbeatTimeoutMs: 30000 })
    // 构造即首轮 probe——不可达的 web3/web4 应立即转 offline，不等 15s interval 首拍 + 30s sweep。
    await ctx.plugin(ConsoleService, {
      launch: {
        web3: { host: 'host1', addr: 'http://127.0.0.1:3083', dshHome: 'x', profile: 'web' },
        web4: { host: 'host1', addr: 'http://127.0.0.1:3084', dshHome: 'x', profile: 'web' },
      },
    })
    // 等首轮 probe 的异步 fetch 完成（构造内立即调用，非 interval 15s）
    await new Promise((r) => setTimeout(r, 50))
    expect(ctx.channel.get('web3')?.status).toBe('offline')
    expect(ctx.channel.get('web4')?.status).toBe('offline')
    vi.unstubAllGlobals()
  })


  it('listInstances：host 条目带 name/ip → hosts 返回机器名/IP（不暴露 agent 名语义）', async () => {
    const ctx = new Context()
    await ctx.plugin(ChannelService, { tokens: {}, heartbeatTimeoutMs: 30000 })
    await ctx.plugin(ConsoleService, {
      launch: {
        host1: { host: 'host1', name: '本机开发机', ip: '127.0.0.1', addr: 'http://127.0.0.1:3089' },
        web2: { host: 'host1', addr: 'http://127.0.0.1:3082' },
      },
    })
    const view = (ctx.console as unknown as { listInstances(): { hosts: Array<{ id: string; name?: string; ip?: string }> } }).listInstances()
    const h1 = view.hosts.find((h) => h.id === 'host1')
    expect(h1).toBeDefined()
    expect(h1?.name).toBe('本机开发机')
    expect(h1?.ip).toBe('127.0.0.1')
    ctx[Symbol.dispose]?.()
  })

  it('daemon 控制端口：client-request 信封 → controlInstance/listInstances 回执', async () => {
    const port = 41100 + Math.floor(Math.random() * 500)
    const ctx = await bootDaemon({
      instances: { web3: { dshHome: '~/.dsh-web3', profile: 'web', port: 3083 } },
      controlPort: port,
    })
    // 等 server 起来
    await new Promise((r) => setTimeout(r, 100))
    const res = await fetch(`http://127.0.0.1:${port}/api/console/listInstances`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: 't1', method: 'console/listInstances', payload: { args: {} } }),
    })
    const data = await res.json() as { result: { ok: boolean; value: { instances: Array<{ id: string }> } } }
    expect(data.result.ok).toBe(true)
    expect(data.result.value.instances.map((i) => i.id)).toContain('web3')
    // 坏信封 → 400 + bad-request
    const bad = await fetch(`http://127.0.0.1:${port}/api/console/listInstances`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'nope' }),
    })
    expect(bad.status).toBe(400)
    ctx[Symbol.dispose]?.()
  })
  it('daemon 控制端口：日志面 client-request 信封 → listLogFiles/readLog 回执', async () => {
    const port = 42100 + Math.floor(Math.random() * 500)
    const ctx = await bootDaemon({
      instances: { web3: { dshHome: '~/.dsh-web3', profile: 'web', port: 3083 } },
      controlPort: port,
    })
    // 等 server 起来
    await new Promise((r) => setTimeout(r, 100))
    // listLogFiles：无参数 → 回执 ok + daemon/instances 结构
    const list = await fetch(`http://127.0.0.1:${port}/api/console/listLogFiles`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: 'l1', method: 'console/listLogFiles', payload: { args: {} } }),
    })
    const ldata = await list.json() as { result: { ok: boolean; value: { daemon: { id: string } | null; instances: Array<{ id: string }> } } }
    expect(ldata.result.ok).toBe(true)
    expect(Array.isArray(ldata.result.value.instances)).toBe(true)
    // readLog：{ target: daemon, opts: { tail } } → 回执 ok
    const read = await fetch(`http://127.0.0.1:${port}/api/console/readLog`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'client-request', rpcId: 'l2', method: 'console/readLog',
        payload: { args: { target: { kind: 'daemon' }, opts: { tail: 3 } } },
      }),
    })
    const rdata = await read.json() as { result: { ok: boolean; value: { records: LogRecord[]; total: number; truncated: boolean } } }
    expect(rdata.result.ok).toBe(true)
    expect(typeof rdata.result.value.total).toBe('number')
    ctx[Symbol.dispose]?.()
  })

})

describe('Logger（关键事件落盘）', () => {
  const isolatedHome = (): string => mkdtempSync(join(tmpdir(), 'dsh-logger-'))

  it('resolvePath：daemon → ~/.dsh-daemon/daemon.log（DSH_HOME 缺省 fallback）', () => {
    const saved = process.env.DSH_HOME
    delete process.env.DSH_HOME
    try {
      expect(Logger.resolvePath('daemon')).toBe(join(homedir(), '.dsh-daemon', 'daemon.log'))
    } finally {
      if (saved === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = saved
    }
  })

  it('resolvePath：daemon 优先 DSH_HOME env（统一按数据根，非硬编码 homedir）', () => {
    const saved = process.env.DSH_HOME
    process.env.DSH_HOME = '/tmp/dsh-daemon-custom'
    try {
      // daemon 数据根 = DSH_HOME（不再写死 ~/.dsh-daemon）
      expect(Logger.resolvePath('daemon')).toBe('/tmp/dsh-daemon-custom/daemon.log')
    } finally {
      if (saved === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = saved
    }
  })

  it('resolvePath：console → DSH_HOME/console.log；缺省 ~/.dsh/console.log', () => {
    const saved = process.env.DSH_HOME
    try {
      process.env.DSH_HOME = '/tmp/test-dsh-home'
      expect(Logger.resolvePath('console')).toBe('/tmp/test-dsh-home/console.log')
    } finally {
      if (saved === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = saved
    }
    const saved2 = process.env.DSH_HOME
    delete process.env.DSH_HOME
    expect(Logger.resolvePath('console')).toBe(join(homedir(), '.dsh', 'console.log'))
    if (saved2 !== undefined) process.env.DSH_HOME = saved2
  })

  it('resolvePath：instance → null（不落盘）', () => {
    expect(Logger.resolvePath('instance')).toBe(null)
  })

  it('append：console 角色写 DSH_HOME/console.log（带 ISO 时间戳）', () => {
    const home = isolatedHome()
    const saved = process.env.DSH_HOME
    process.env.DSH_HOME = home
    try {
      Logger.append('console', 'test-event-x')
      const content = readFileSync(join(home, 'console.log'), 'utf8')
      expect(content).toMatch(/^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\] test-event-x\n$/)
    } finally {
      if (saved === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = saved
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('append：daemon 角色路径含 .dsh-daemon/daemon.log（DSH_HOME 缺省 fallback）', () => {
    const saved = process.env.DSH_HOME
    delete process.env.DSH_HOME
    try {
      const path = Logger.resolvePath('daemon')
      expect(path).not.toBe(null)
      expect(path).toContain('.dsh-daemon/daemon.log')
    } finally {
      if (saved === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = saved
    }
  })

  it('append：instance 角色静默不写', () => {
    Logger.append('instance', 'should-not-write')
  })

  it('record：console 角色写合法 JSONL（ts/role/level/scope/msg，instanceId 可省略）', () => {
    const home = isolatedHome()
    const saved = process.env.DSH_HOME
    process.env.DSH_HOME = home
    try {
      Logger.record('console', { level: 'error', scope: 'upgrade', msg: '升级失败，回滚快照' })
      const lines = readFileSync(join(home, 'console.log'), 'utf8').split('\n').filter((l) => l.length > 0)
      expect(lines).toHaveLength(1)
      const rec = JSON.parse(lines[0]) as LogRecord
      expect(rec.ts).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
      expect(rec.role).toBe('console')
      expect(rec.level).toBe('error')
      expect(rec.scope).toBe('upgrade')
      expect(rec.msg).toBe('升级失败，回滚快照')
      expect('instanceId' in rec).toBe(false)
      // 带 instanceId → JSONL 保留该键
      Logger.record('console', { level: 'info', scope: 'instance', msg: 'x', instanceId: 'web3' })
      const rec2 = JSON.parse(readFileSync(join(home, 'console.log'), 'utf8').split('\n').filter(Boolean)[1]) as LogRecord
      expect(rec2.instanceId).toBe('web3')
    } finally {
      if (saved === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = saved
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('record：instance 角色静默不写（resolvePath null）', () => {
    const saved = process.env.DSH_HOME
    process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'dsh-rec-inst-'))
    try {
      expect(() => Logger.record('instance', { level: 'error', scope: 'daemon', msg: 'x' })).not.toThrow()
    } finally {
      if (saved === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = saved
    }
  })

  it('record：权限错/EACCES 静默吞（不挂主流程）', () => {
    const saved = process.env.DSH_HOME
    process.env.DSH_HOME = '/proc/1'
    try {
      expect(() => Logger.record('console', { level: 'info', scope: 'console', msg: 'no-perm' })).not.toThrow()
    } finally {
      if (saved === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = saved
    }
  })

  it('append：权限错/EACCES 静默吞（不挂主流程）', () => {
    const saved = process.env.DSH_HOME
    process.env.DSH_HOME = '/proc/1'
    try {
      expect(() => Logger.append('console', 'no-perm')).not.toThrow()
    } finally {
      if (saved === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = saved
    }
  })
})

describe('日志（@Remote readLog / listLogFiles）', () => {
  // roleDataRoot 以 DSH_HOME 为数据根——必须隔离 DSH_HOME（仅设 HOME 会读到真实 ~/.dsh-*）。
  // daemon 文件落在 <DSH_HOME>/daemon.log 与 <DSH_HOME>/logs/<id>.log；console 为 <DSH_HOME>/console.log。
  const isolatedHome = (): string => mkdtempSync(join(tmpdir(), 'dsh-logs-'))

  const bootDaemon = async (home: string): Promise<Context> => {
    const ctx = new Context()
    await ctx.plugin(ChannelService, { tokens: { instA: 'tok-a' } })
    await ctx.plugin(ConsoleService, {
      role: 'daemon', hostId: 'host1',
      instances: { web3: { dshHome: '~/.dsh-web3', profile: 'web', port: 3083 } },
    })
    return ctx
  }

  /** 在临时 DSH_HOME 内执行 fn；结束后还原 env 并删目录。 */
  const withDshHome = async (fn: (home: string) => Promise<void>): Promise<void> => {
    const home = isolatedHome()
    const saved = process.env.DSH_HOME
    process.env.DSH_HOME = home
    try {
      await fn(home)
    } finally {
      if (saved === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = saved
      rmSync(home, { recursive: true, force: true })
    }
  }

  const daemonReadLog = (ctx: Context) => (target: { instanceId: string }, opts: { tail?: number; maxBytes?: number }): LogReadResult =>
    (ctx.console as unknown as { readLog: (t: { instanceId: string }, o: { tail?: number; maxBytes?: number }) => Promise<LogReadResult> }).readLog(target, opts)

  it('logPathFor：daemon 角色读 DSH_HOME/logs/<id>.log（白名单校验）', async () => {
    await withDshHome(async (home) => {
      const ctx = await bootDaemon(home)
      const logPathFor = (target: { kind: 'daemon' } | { kind: 'instance'; instanceId: string }): string | null => {
        return (ctx.console as unknown as { logPathFor: (t: { kind: 'daemon' } | { kind: 'instance'; instanceId: string }) => string | null }).logPathFor(target)
      }
      // 白名单内：web3
      expect(logPathFor({ kind: 'instance', instanceId: 'web3' })).toBe(join(home, 'logs', 'web3.log'))
      // 白名单外：null（防任意文件读）
      expect(logPathFor({ kind: 'instance', instanceId: 'evil' })).toBe(null)
      // daemon target
      expect(logPathFor({ kind: 'daemon' })).toBe(join(home, 'daemon.log'))
      ctx[Symbol.dispose]?.()
    })
  })

  it('listLogFiles：daemon 角色返回本机 logs/ + daemon.log', async () => {
    await withDshHome(async (home) => {
      mkdirSync(join(home, 'logs'), { recursive: true })
      writeFileSync(join(home, 'logs', 'web3.log'), 'line1\nline2\n')
      writeFileSync(join(home, 'daemon.log'), 'd1\n')
      const ctx = await bootDaemon(home)
      const list = (ctx.console as unknown as { listLogFiles: () => { daemon: { id: string } | null; instances: Array<{ id: string }> } }).listLogFiles()
      expect(list.daemon).not.toBe(null)
      expect((list.daemon as { id: string }).id).toBe('daemon')
      expect(list.instances).toHaveLength(1)
      expect(list.instances[0].id).toBe('web3')
      ctx[Symbol.dispose]?.()
    })
  })

  it('readLog：daemon 角色读本机 logs/<id>.log（legacy 行 → records；tail 取最后 N 条）', async () => {
    await withDshHome(async (home) => {
      mkdirSync(join(home, 'logs'), { recursive: true })
      const lines = Array.from({ length: 500 }, (_, i) => `line-${i}`)
      writeFileSync(join(home, 'logs', 'web3.log'), lines.join('\n') + '\n')
      const ctx = await bootDaemon(home)
      const readLog = daemonReadLog(ctx)
      // tail=3：最后 3 条 record（纯文本无 ISO 前缀 → ts 空、msg 保留）
      const r = await readLog({ instanceId: 'web3' }, { tail: 3 })
      expect(r.records.map((rec) => rec.msg)).toEqual(['line-497', 'line-498', 'line-499'])
      expect(r.records[0].role).toBe('instance')   // 实例 stdout 文件 → role='instance'
      expect(r.records[0].level).toBe(null)
      expect(r.total).toBe(500)
      // 白名单外实例 → 空 records（whitelist guard，不读真实路径）
      const r2 = await readLog({ instanceId: 'nope' }, { tail: 3 })
      expect(r2.records).toEqual([])
      expect(r2.total).toBe(0)
      expect(r2.truncated).toBe(false)
      ctx[Symbol.dispose]?.()
    })
  })

  it('readLog：maxBytes 超限标记 truncated', async () => {
    await withDshHome(async (home) => {
      mkdirSync(join(home, 'logs'), { recursive: true })
      const big = 'x'.repeat(1000)
      writeFileSync(join(home, 'logs', 'web3.log'), big)
      const ctx = await bootDaemon(home)
      const readLog = daemonReadLog(ctx)
      // 100 字节 maxBytes vs 1000 字节内容 → truncated=true
      const r = await readLog({ instanceId: 'web3' }, { maxBytes: 100 })
      expect(r.truncated).toBe(true)
      // 1 个非空行 → 1 条 record（total 仍按非空行计，与截断标志独立）
      expect(r.records).toHaveLength(1)
      expect(r.records[0].msg).toBe(big)
      ctx[Symbol.dispose]?.()
    })
  })

  it('readLog：console 角色读 daemon target = 本机 console.log', async () => {
    await withDshHome(async (home) => {
      writeFileSync(join(home, 'console.log'), 'c1\nc2\nc3\n')
      const ctx = new Context()
      await ctx.plugin(ChannelService, { tokens: { instA: 'tok-a' } })
      await ctx.plugin(ConsoleService, {})
      const readLog = async (opts: { tail?: number }): Promise<LogReadResult> =>
        (ctx.console as unknown as { readLog: (t: { kind: 'daemon' }, o: { tail?: number }) => Promise<LogReadResult> }).readLog({ kind: 'daemon' }, opts)
      const r = await readLog({ tail: 2 })
      expect(r.records.map((rec) => rec.msg)).toEqual(['c2', 'c3'])
      expect(r.records[0].role).toBe('console')   // console.log → role='console'
      expect(r.records[0].level).toBe(null)
      ctx[Symbol.dispose]?.()
    })
  })

  it('readLog：instance 角色一律返回空（无管理面）', async () => {
    await withDshHome(async (home) => {
      const ctx = new Context()
      await ctx.plugin(ChannelService, { tokens: { instA: 'tok-a' } })
      await ctx.plugin(ConsoleService, { role: 'instance' })
      const readLog = (target: { instanceId: string }): LogReadResult =>
        (ctx.console as unknown as { readLog: (t: { instanceId: string }, o: Record<string, never>) => Promise<LogReadResult> }).readLog(target, {})
      const r = await readLog({ instanceId: 'web3' })
      expect(r.records).toEqual([])
      expect(r.total).toBe(0)
      ctx[Symbol.dispose]?.()
    })
  })

  it('混合文件：JSONL 结构化行 + 老 [ISO] msg 文本行都解析成 records', async () => {
    await withDshHome(async (home) => {
      mkdirSync(join(home, 'logs'), { recursive: true })
      const jsonLine = JSON.stringify({
        ts: '2024-01-01T00:00:00.000Z', role: 'daemon', level: 'warn', scope: 'upgrade', msg: 'JSON 结构化行',
      })
      writeFileSync(join(home, 'logs', 'web3.log'),
        `${jsonLine}\n[2024-06-01T12:00:00.000Z] 老文本记录\n无前缀的裸文本\n`)
      const ctx = await bootDaemon(home)
      const readLog = daemonReadLog(ctx)
      const r = await readLog({ instanceId: 'web3' }, { tail: 0 })
      expect(r.total).toBe(3)
      expect(r.records).toHaveLength(3)
      // JSON 行：字段原样保留（ts/role/level/scope/msg）
      expect(r.records[0]).toMatchObject({
        ts: '2024-01-01T00:00:00.000Z', role: 'daemon', level: 'warn', scope: 'upgrade', msg: 'JSON 结构化行',
      })
      expect('instanceId' in r.records[0]).toBe(false)
      // 老 [ISO] msg 行：ISO 前缀 → ts，余下 → msg，level:null，role=文件归属
      expect(r.records[1]).toMatchObject({
        ts: '2024-06-01T12:00:00.000Z', role: 'instance', level: null, scope: 'instance', msg: '老文本记录',
      })
      // 无前缀裸文本：ts 空串
      expect(r.records[2]).toMatchObject({ ts: '', role: 'instance', level: null, scope: 'instance', msg: '无前缀的裸文本' })
      ctx[Symbol.dispose]?.()
    })
  })

  it('去重：JSONL 事件行后紧跟的同 ts/同 msg 纯文本镜像只保留结构化那条', async () => {
    await withDshHome(async (home) => {
      mkdirSync(join(home, 'logs'), { recursive: true })
      const ts = '2024-01-01T00:00:00.000Z'
      const msg = '控制 instA start → 失败'
      const jsonLine = JSON.stringify({ ts, role: 'daemon', level: 'error', scope: 'control', msg })
      // Logger.record（JSONL）后 Logger.append（[ts] msg 纯文本镜像）双写同文件。
      writeFileSync(join(home, 'logs', 'web3.log'), `${jsonLine}\n[${ts}] ${msg}\n`)
      const ctx = await bootDaemon(home)
      const readLog = daemonReadLog(ctx)
      const r = await readLog({ instanceId: 'web3' }, { tail: 0 })
      // total = 非空行数（2）；镜像行被去重 → records 只留结构化那条。
      expect(r.total).toBe(2)
      expect(r.records).toHaveLength(1)
      expect(r.records[0]).toMatchObject({ ts, role: 'daemon', level: 'error', scope: 'control', msg })
      ctx[Symbol.dispose]?.()
    })
  })

  it('Logger.record → readLog 回读（console 角色，JSONL round-trip，level/scope/role/msg 保留）', async () => {
    await withDshHome(async (home) => {
      // 直接 record（不经 log/append），console.log 应恰为 2 条 JSONL。
      Logger.record('console', { level: 'error', scope: 'daemon', msg: '升级失败，自动回滚' })
      Logger.record('console', { level: 'info', scope: 'upgrade', msg: '发行包已对齐守护源' })
      const ctx = new Context()
      await ctx.plugin(ChannelService, { tokens: { instA: 'tok-a' } })
      await ctx.plugin(ConsoleService, {})
      const readLog = (opts: { tail?: number }): LogReadResult =>
        (ctx.console as unknown as { readLog: (t: { kind: 'daemon' }, o: { tail?: number }) => Promise<LogReadResult> }).readLog({ kind: 'daemon' }, opts)
      const r = await readLog({ tail: 0 })
      expect(r.total).toBe(2)
      expect(r.records).toHaveLength(2)
      expect(r.records[0]).toMatchObject({ role: 'console', level: 'error', scope: 'daemon', msg: '升级失败，自动回滚' })
      expect(r.records[0].ts).toMatch(/^\d{4}-\d{2}-\d{2}T/)
      expect(r.records[1]).toMatchObject({ role: 'console', level: 'info', scope: 'upgrade', msg: '发行包已对齐守护源' })
      ctx[Symbol.dispose]?.()
    })
  })

  it('Logger.record：带 instanceId 时 JSONL 保留 instanceId；tail 取最后 N 条', async () => {
    await withDshHome(async (home) => {
      for (let i = 0; i < 5; i++) {
        Logger.record('console', { level: 'info', scope: 'instance', msg: `记录-${i}`, instanceId: 'web3' })
      }
      const ctx = new Context()
      await ctx.plugin(ChannelService, { tokens: { instA: 'tok-a' } })
      await ctx.plugin(ConsoleService, {})
      const readLog = (opts: { tail?: number }): LogReadResult =>
        (ctx.console as unknown as { readLog: (t: { kind: 'daemon' }, o: { tail?: number }) => Promise<LogReadResult> }).readLog({ kind: 'daemon' }, opts)
      const r = await readLog({ tail: 2 })
      expect(r.total).toBe(5)
      expect(r.records).toHaveLength(2)
      expect(r.records.map((rec) => rec.msg)).toEqual(['记录-3', '记录-4'])
      expect(r.records[0].instanceId).toBe('web3')
      ctx[Symbol.dispose]?.()
    })
  })
})

describe('升级状态（daemon 落盘 + @Remote getUpgradeStatus）', () => {
  const isolatedHome = (): string => mkdtempSync(join(tmpdir(), 'dsh-upstat-'))

  it('daemon：getUpgradeStatus 读实例 home 状态文件；无记录返回无状态', async () => {
    const tmp = isolatedHome()
    try {
      const ctx = new Context()
      await ctx.plugin(ChannelService, { tokens: {}, heartbeatTimeoutMs: 30000 })
      await ctx.plugin(ConsoleService, {
        role: 'daemon', hostId: 'host1',
        instances: { web3: { dshHome: join(tmp, 'web3'), profile: 'web3' } },
      })
      const svc = ctx.console as unknown as { getUpgradeStatus(id: string): Promise<{ step: string; done: boolean; message: string; ok?: boolean }> }
      // 无状态文件 → done + 无记录
      const none = await svc.getUpgradeStatus('web3')
      expect(none.done).toBe(true)
      expect(none.message).toContain('无')
      // 清单外实例
      const evil = await svc.getUpgradeStatus('evil')
      expect(evil.done).toBe(true)
      expect(evil.ok).toBe(false)
      ctx[Symbol.dispose]?.()
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('daemon：状态文件可读（模拟升级写入后查询）', async () => {
    const tmp = isolatedHome()
    const web3 = join(tmp, 'web3')
    mkdirSync(join(web3, 'profiles', 'web3'), { recursive: true })
    try {
      const ctx = new Context()
      await ctx.plugin(ChannelService, { tokens: {}, heartbeatTimeoutMs: 30000 })
      await ctx.plugin(ConsoleService, {
        role: 'daemon', hostId: 'host1',
        instances: { web3: { dshHome: web3, profile: 'web3' } },
      })
      // 模拟 daemon 升级中落盘状态
      writeFileSync(join(web3, '.dsh-upgrade-status.json'), JSON.stringify({
        instanceId: 'web3', step: 'align', done: false, version: '0.1.2-rc.1', ts: Date.now(), message: '对齐守护发行包源…',
      }))
      const svc = ctx.console as unknown as { getUpgradeStatus(id: string): Promise<{ step: string; done: boolean; message: string; version?: string }> }
      const s = await svc.getUpgradeStatus('web3')
      expect(s.step).toBe('align')
      expect(s.done).toBe(false)
      expect(s.message).toContain('对齐')
      ctx[Symbol.dispose]?.()
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })
})

describe('多机 hub（worker 注册 → 归属/状态/台账派发）', () => {
  /** hub 模式：console 收注册（channel 侧 registerWorker 即路由处理内核）。 */
  async function bootHub(launch?: Record<string, { host?: string; addr?: string }>): Promise<Context> {
    const ctx = new Context()
    await ctx.plugin(ChannelService, {
      tokens: { host2: 'tok-2' }, heartbeatTimeoutMs: 30_000, mode: 'hub', pollWaitMs: 200,
    })
    await ctx.plugin(ConsoleService, { ...(launch !== undefined ? { launch } : {}) })
    return ctx
  }

  it('worker 注册：实例归属与状态落档案，主机上线并入 inbox', async () => {
    const ctx = await bootHub()
    const ack = ctx.channel.registerWorker({ id: 'host2', instances: [
      { id: 'web3', status: 'online' },
      { id: 'web4', status: 'offline' },
    ] }, 'tok-2')
    expect(ack.ok).toBe(true)
    const view = ctx.console.listInstances()
    const web3 = view.instances.find((i) => i.id === 'web3')
    expect(web3?.host).toBe('host2')
    expect(web3?.status).toBe('online')
    expect(view.instances.find((i) => i.id === 'web4')?.status).toBe('offline')
    // 守护（host2）作为主机条目呈现，且归属指向自己
    expect(view.hosts.find((h) => h.id === 'host2')?.status).toBe('online')
    // inbox：注册事件可见
    expect(ctx.console.listInbox('admin').some((m) => m.type === 'system.host.register')).toBe(true)
    // 档案持久：注册实例写入 InstanceRecord（host 归档）
    expect(ctx.console.getInstanceRecord('web3')?.host).toBe('host2')
  })

  it('注册后再注册（保活）刷新状态且不重复投 inbox 之外的副作用', async () => {
    const ctx = await bootHub()
    ctx.channel.registerWorker({ id: 'host2', instances: [{ id: 'web3', status: 'online' }] }, 'tok-2')
    ctx.channel.registerWorker({ id: 'host2', instances: [{ id: 'web3', status: 'offline' }] }, 'tok-2')
    expect(ctx.console.getInstanceRecord('web3')?.status).toBe('offline')
  })

  it('controlInstance 经台账派发（ok + commandId，状态 pending）', async () => {
    const ctx = await bootHub({ webA: { host: 'host2' } })
    await ctx.channel.registerWorker({ id: 'host2', instances: [{ id: 'webA', status: 'online' }] }, 'tok-2')
    const r = ctx.console.controlInstance('webA', 'restart')
    expect(r.ok).toBe(true)
    expect(r.commandId).toBeTruthy()
    expect(ctx.channel.commandStatus(r.commandId!)?.status).toBe('pending')
    expect(ctx.channel.commandStatus(r.commandId!)?.targetId).toBe('host2')
  })

  it('controlInstance 守护未注册 → 显式失败（不回环、不静默）', async () => {
    const ctx = await bootHub({ webB: { host: 'host9' } })
    const r = ctx.console.controlInstance('webB', 'start')
    expect(r.ok).toBe(false)
    expect(r.error).toContain('host9')
  })

  it('upgradeInstances 按注册归属派发；未注册守护逐条失败', async () => {
    const ctx = await bootHub({ webA: { host: 'host2' }, webB: { host: 'host9' } })
    await ctx.channel.registerWorker({ id: 'host2', instances: [{ id: 'webA', status: 'online' }] }, 'tok-2')
    const r = ctx.console.upgradeInstances(['webA', 'webB'], '0.1.2-rc.1')
    expect(r.results[0].ok).toBe(true)
    expect(r.results[1].ok).toBe(false)
    expect(r.results[1].error).toContain('host9')
    const pending = ctx.channel.ledgerSnapshot()
    expect(pending).toHaveLength(1)
    expect(pending[0].command.type).toBe('upgrade')
  })

  it('deployInstance 派发失败即失败，且不留下无主的档案', async () => {
    const ctx = await bootHub()
    const r = ctx.console.deployInstance({
      host: 'host9', instanceId: 'web6', version: '0.1.2-rc.1', profile: 'web',
      dshHome: '/tmp/.dsh-web6-hub', port: 3086, token: 'tok-web6',
    })
    expect(r.ok).toBe(false)
    expect(ctx.console.getInstanceRecord('web6')).toBeUndefined()
    // 注册守护后同一请求成功
    ctx.channel.registerWorker({ id: 'host2', instances: [] }, 'tok-2')
    const ok = ctx.console.deployInstance({
      host: 'host2', instanceId: 'web6', version: '0.1.2-rc.1', profile: 'web',
      dshHome: '/tmp/.dsh-web6-hub', port: 3086, token: 'tok-web6',
    })
    expect(ok.ok).toBe(true)
    expect(ctx.console.getInstanceRecord('web6')?.host).toBe('host2')
  })

  it('hub 模式探测跳过跨机与已注册目标（状态权威来自注册上报）', async () => {
    const ctx = await bootHub({ webA: { host: 'host2', addr: 'http://10.0.0.12:3083' }, webLocal: { addr: 'http://127.0.0.1:3088' } })
    await ctx.channel.registerWorker({ id: 'host2', instances: [{ id: 'webA', status: 'online' }] }, 'tok-2')
    const svc = ctx.console as unknown as { probeLaunch(): void }
    svc.probeLaunch() // 不应把已注册实例标离线（跨机地址不由本进程判定）
    await new Promise((r) => setTimeout(r, 30))
    expect(ctx.channel.get('webA')?.status).toBe('online')
  })
})

describe('多机 P1b（部署清单持久化 / 对账 / 回执真实结果 / 审计）', () => {
  it('deploy 落盘清单；新守护进程从清单恢复（不再"清单丢、进程变孤儿"）', async () => {
    const ctx = await bootDaemon({})
    ctx.console.deployInstance({
      host: 'host1', instanceId: 'web6', version: '0.1.2-rc.1', profile: 'web',
      dshHome: '/tmp/.dsh-web6-persist', port: 3086, token: 'tok-web6',
    })
    await new Promise((r) => setTimeout(r, 20))
    // 实例档案落**注册表**（唯一权威；此前是 daemon 私有的 instances.json）
    const regFile = process.env.DSH_REGISTRY!
    expect(existsSync(regFile)).toBe(true)
    const entry = JSON.parse(readFileSync(regFile, 'utf8')).instances['master/web6']
    expect(entry.port).toBe(3086)
    expect(entry.home).toBe('/tmp/.dsh-web6-persist')
    expect(entry.profileDir).toBe('web')
    expect(entry.version).toBe('0.1.2-rc.1')
    expect(entry.layout).toBe('home')
    // 新守护（同 DSH_HOME）恢复清单：白名单/端口定位/上报都能看见部署出来的实例
    const ctx2 = await bootDaemon({})
    mkdirSync(join(process.env.DSH_HOME!, 'logs'), { recursive: true })
    writeFileSync(join(process.env.DSH_HOME!, 'logs', 'web6.log'), 'x\n')
    expect(ctx2.console.listLogFiles().instances.map((m) => m.id)).toContain('web6')
    // 对账含端口探测（每实例最长 2s），须等任务完成而非猜时间窗。
    await ctx2.console.reconcileReady()
    expect(ctx2.console.reconcileResult().some((r) => r.id === 'web6')).toBe(true)
  })

  it('启动对账报告疑似孤儿（有日志但不在清单）', async () => {
    mkdirSync(join(process.env.DSH_HOME!, 'logs'), { recursive: true })
    writeFileSync(join(process.env.DSH_HOME!, 'logs', 'ghost9.log'), 'x\n')
    const ctx = await bootDaemon({})
    await ctx.console.reconcileReady()
    const orphan = ctx.console.reconcileResult().find((r) => r.id === 'ghost9')
    expect(orphan?.state).toBe('orphan')
  })

  it('守护回执真实结果：busy 与未知实例都不再假报成功', async () => {
    const ctx = await bootDaemon({})
    const svc = ctx.console as unknown as {
      handleDaemonControl(cmd: unknown, from: string): { ok: boolean; error?: string; detail?: string }
      ops: Map<string, string>
    }
    // busy：实例已有操作在跑
    svc.ops.set('web3', 'restarting')
    const busy = svc.handleDaemonControl({ id: 'c1', type: 'start', payload: { instanceId: 'web3' }, ts: Date.now() }, 'hub')
    expect(busy.ok).toBe(false)
    expect(busy.error).toContain('busy')
    svc.ops.delete('web3')
    // 不在本机清单
    const unknown = svc.handleDaemonControl({ id: 'c2', type: 'stop', payload: { instanceId: 'nope' }, ts: Date.now() }, 'hub')
    expect(unknown.ok).toBe(false)
    expect(unknown.error).toContain('不在本机清单')
  })

  it('注册上报版本 → 实例与主机档案可查（升级编排依据）', async () => {
    const ctx = new Context()
    await ctx.plugin(ChannelService, {
      tokens: { host2: 'tok-2' }, heartbeatTimeoutMs: 30_000, mode: 'hub', pollWaitMs: 100,
    })
    await ctx.plugin(ConsoleService, {})
    ctx.channel.registerWorker({
      id: 'host2',
      version: '0.1.2-rc.1',
      instances: [{ id: 'web3', status: 'online', version: '0.1.1-rc.2' }],
    }, 'tok-2')
    expect(ctx.console.getInstanceRecord('web3')?.version).toBe('0.1.1-rc.2')
    // 主机档案带守护发行包版本（UI 主机表 version 列）
    const hostRecord = ctx.console.listInstanceRecords().find((r) => r.id === 'host2')
    expect(hostRecord?.version).toBe('0.1.2-rc.1')
  })

  it('审计：控制指令 actor 随台账条目记录（显式身份走 HTTP 面）', async () => {
    const ctx = new Context()
    await ctx.plugin(ChannelService, {
      tokens: { host2: 'tok-2' }, heartbeatTimeoutMs: 30_000, mode: 'hub', pollWaitMs: 100,
    })
    await ctx.plugin(ConsoleService, { launch: { webA: { host: 'host2' } } })
    ctx.channel.registerWorker({ id: 'host2', instances: [{ id: 'webA', status: 'online' }] }, 'tok-2')
    const svc = ctx.console as unknown as {
      controlInstanceAs(instanceId: string, command: string, payload: object, actor: string): { ok: boolean; commandId?: string }
    }
    const r = svc.controlInstanceAs('webA', 'restart', {}, 'alice')
    expect(r.ok).toBe(true)
    expect(ctx.channel.commandStatus(r.commandId!)?.actor).toBe('alice')
    // @Remote 面（无身份）→ system
    const viaRemote = ctx.console.controlInstance('webA', 'start')
    expect(ctx.channel.commandStatus(viaRemote.commandId!)?.actor).toBe('system')
  })
})

describe('runtime 池：创建引用 + 升级 = 切引用（批 3）', () => {
  afterEach(() => {
    ConsoleService.spawnImpl = childProcess.spawn
    ConsoleService.upgradeApplyError = undefined
  })

  /** 造一份官方 CLI 安装（含一个自研包，验证它不被链接）。 */
  function fakeCli(dir: string, version: string): string {
    const nm = join(dir, 'node_modules')
    for (const name of ['dsh', 'dsh-base', 'dsh-web-app']) {
      mkdirSync(join(nm, '@deepseek-ai', name), { recursive: true })
      writeFileSync(join(nm, '@deepseek-ai', name, 'package.json'), JSON.stringify({ name: `@deepseek-ai/${name}`, version }))
    }
    mkdirSync(join(nm, 'dsh-console'), { recursive: true })
    writeFileSync(join(nm, 'dsh-console', 'package.json'), JSON.stringify({ name: 'dsh-console', version: '0.0.0' }))
    return dir
  }

  function importIntoPool(tmp: string, version: string): void {
    process.env.DSH_RUNTIMES = join(tmp, 'runtimes')
    const r = importRuntime({ version, source: fakeCli(join(tmp, `cli-${version}`), version) })
    expect(r.ok).toBe(true)
  }

  it('创建实例：官方包软链到池、自研包保持实例内、档案记版本', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'dsh-rt-create-'))
    try {
      importIntoPool(tmp, '0.1.2-rc.1')
      const dshHome = join(dirname(process.env.DSH_REGISTRY!), 'instance-a') // 新布局根 = 注册表所在目录
      mockSpawn(fakeChild())
      const ctx = await bootDaemon({})
      const r = ctx.console.deployInstance({
        host: 'host1', instanceId: 'instance-a', version: '0.1.2-rc.1', profile: 'dev',
        dshHome, port: 3090, token: 'tok-a',
      })
      expect(r.ok).toBe(true)
      const profileDir = join(dshHome, 'profiles', 'dev')
      expect(lstatSync(join(profileDir, 'node_modules', '@deepseek-ai', 'dsh')).isSymbolicLink()).toBe(true)
      expect(currentRuntimeVersion(profileDir)).toBe('0.1.2-rc.1')
      // 池里只有官方半区：池内若有自研包也不该被搬进实例
      expect(existsSync(join(profileDir, 'node_modules', 'dsh-console'))).toBe(false)
      const entry = JSON.parse(readFileSync(process.env.DSH_REGISTRY!, 'utf8')).instances['master/instance-a']
      expect(entry.version).toBe('0.1.2-rc.1')
    } finally {
      delete process.env.DSH_RUNTIMES
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('新布局实例必须引用池内版本：版本不在池 → 显式失败（不建半成品）', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'dsh-rt-nopool-'))
    try {
      process.env.DSH_RUNTIMES = join(tmp, 'runtimes')
      const dshHome = join(dirname(process.env.DSH_REGISTRY!), 'instance-b')
      mockSpawn(fakeChild())
      const ctx = await bootDaemon({})
      const r = ctx.console.deployInstance({
        host: 'host1', instanceId: 'instance-b', version: '0.1.2-rc.1', profile: 'dev',
        dshHome, port: 3091, token: 'tok-b',
      })
      // 批 6b 后：同进程回环会把守护的拒绝结论回传，因此 ok 就是真实结论
      expect(r.ok).toBe(false)
      expect(r.error).toMatch(/必须引用池内 runtime 版本/)
      // 并且没有半成品
      expect(existsSync(join(dshHome, 'profiles', 'dev', 'package.json'))).toBe(false)
      expect(existsSync(process.env.DSH_REGISTRY!)).toBe(false) // 未落地 → 档案里不该有任何条目
    } finally {
      delete process.env.DSH_RUNTIMES
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('升级 = 切引用：不拷目录、不落快照，只把软链指向新版本并同步档案', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'dsh-rt-switch-'))
    vi.useFakeTimers()
    try {
      importIntoPool(tmp, '0.1.2-rc.1')
      importIntoPool(tmp, '0.1.1-rc.2')
      const profileDir = join(tmp, 'inst', 'profiles', 'dev')
      mkdirSync(join(profileDir, 'node_modules', '@deepseek-ai'), { recursive: true })
      expect(linkRuntimeInto(profileDir, '0.1.2-rc.1').ok).toBe(true)
      const spawnSpy = mockSpawn(fakeChild())
      const ctx = await bootDaemon({})
      ;(ctx.console as unknown as { runtimeInstances: Map<string, { dshHome: string; profile: string; version?: string }> })
        .runtimeInstances.set('inst-a', { dshHome: join(tmp, 'inst'), profile: 'dev', version: '0.1.2-rc.1' })
      ctx.channel.sendControl('host-lab1', { type: 'upgrade', payload: { instanceId: 'inst-a', version: '0.1.1-rc.2' } })
      await vi.advanceTimersByTimeAsync(16_000)
      expect(currentRuntimeVersion(profileDir)).toBe('0.1.1-rc.2')
      // 切引用模式不落快照目录（回滚点 = 旧引用），也不重拷发行包
      expect(existsSync(join(tmp, 'inst', '.dsh-upgrade-snapshots'))).toBe(false)
      expect(spawnSpy).toHaveBeenCalled()
      // 档案同步：注册表里的版本 = 切换后的引用
      const entry = JSON.parse(readFileSync(process.env.DSH_REGISTRY!, 'utf8')).instances['master/inst-a']
      expect(entry.version).toBe('0.1.1-rc.2')
    } finally {
      vi.useRealTimers()
      delete process.env.DSH_RUNTIMES
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('升级失败 → 切回旧引用（回滚 = 切软链），事件带 rolledBack', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'dsh-rt-rollback-'))
    try {
      importIntoPool(tmp, '0.1.2-rc.1')
      importIntoPool(tmp, '0.1.1-rc.2')
      const profileDir = join(tmp, 'inst', 'profiles', 'dev')
      mkdirSync(join(profileDir, 'node_modules', '@deepseek-ai'), { recursive: true })
      linkRuntimeInto(profileDir, '0.1.2-rc.1')
      mockSpawn(fakeChild())
      const reg0 = loadRegistry()
      upsertInstance(reg0, { id: 'inst-a', host: 'master', home: join(tmp, 'inst'), profileDir: 'dev', layout: 'home', version: '0.1.2-rc.1' })
      saveRegistry(reg0)
      ConsoleService.upgradeApplyError = new Error('注入的切换失败')
      const ctx = await bootDaemon({})
      ;(ctx.console as unknown as { runtimeInstances: Map<string, { dshHome: string; profile: string; version?: string }> })
        .runtimeInstances.set('inst-a', { dshHome: join(tmp, 'inst'), profile: 'dev', version: '0.1.2-rc.1' })
      const events: Array<{ type: string; payload: Record<string, unknown> }> = []
      ctx.channel.subscribe('task', (e) => events.push({ type: e.type, payload: e.payload as Record<string, unknown> }))
      ctx.channel.sendControl('host-lab1', { type: 'upgrade', payload: { instanceId: 'inst-a', version: '0.1.1-rc.2' } })
      await new Promise((r) => setTimeout(r, 60))
      expect(currentRuntimeVersion(profileDir)).toBe('0.1.2-rc.1')
      const result = events.find((e) => e.type === 'system.upgrade.result')
      expect(result!.payload.ok).toBe(false)
      expect(result!.payload.rolledBack).toBe(true)
      const entry = JSON.parse(readFileSync(process.env.DSH_REGISTRY!, 'utf8')).instances['master/inst-a']
      expect(entry.version).toBe('0.1.2-rc.1')
    } finally {
      delete process.env.DSH_RUNTIMES
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('目标版本不在池 → 显式失败（不静默改引用）', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'dsh-rt-notarget-'))
    try {
      importIntoPool(tmp, '0.1.2-rc.1')
      const profileDir = join(tmp, 'inst', 'profiles', 'dev')
      mkdirSync(join(profileDir, 'node_modules', '@deepseek-ai'), { recursive: true })
      linkRuntimeInto(profileDir, '0.1.2-rc.1')
      mockSpawn(fakeChild())
      const ctx = await bootDaemon({})
      ;(ctx.console as unknown as { runtimeInstances: Map<string, { dshHome: string; profile: string; version?: string }> })
        .runtimeInstances.set('inst-a', { dshHome: join(tmp, 'inst'), profile: 'dev', version: '0.1.2-rc.1' })
      ctx.channel.sendControl('host-lab1', { type: 'upgrade', payload: { instanceId: 'inst-a', version: '9.9.9' } })
      await new Promise((r) => setTimeout(r, 60))
      expect(currentRuntimeVersion(profileDir)).toBe('0.1.2-rc.1')
    } finally {
      delete process.env.DSH_RUNTIMES
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('listTemplates：读 templateHome 下的 profiles/*（模板清单不硬编码在 UI）', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'dsh-templates-'))
    try {
      const root = join(tmp, 'profiles')
      for (const name of ['master', 'dev', 'explorer', 'minimal', 'junk-no-pkg']) {
        mkdirSync(join(root, name), { recursive: true })
      }
      for (const name of ['master', 'dev', 'explorer', 'minimal']) {
        writeFileSync(join(root, name, 'package.json'), '{}\n')
      }
      mockSpawn(fakeChild())
      const ctx = await bootDaemon({ templateHome: tmp })
      expect(ctx.console.listTemplates()).toEqual(['dev', 'explorer', 'master', 'minimal'])
      // 无 templateHome（老部署）→ 空清单，不抛
      const ctx2 = await bootDaemon({})
      expect(ctx2.console.listTemplates()).toEqual([])
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('runtime 池 @Remote 面：listRuntimePool 列出池内版本与引用关系；导入/删除走同一入口', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'dsh-pool-remote-'))
    try {
      process.env.DSH_RUNTIMES = join(tmp, 'runtimes')
      expect(importRuntime({ version: '0.1.2-rc.1', source: fakeCli(join(tmp, 'cli'), '0.1.2-rc.1') }).ok).toBe(true)
      mockSpawn(fakeChild())
      const ctx = await bootDaemon({})
      const view = ctx.console.listRuntimePool()
      expect(view.versions.map((v) => v.version)).toEqual(['0.1.2-rc.1'])
      expect(view.versions[0].ok).toBe(true)
      expect(view.versions[0].inUseBy).toEqual([])
      // 重复导入 = 池不可变 → 拒绝
      const dup = ctx.console.importRuntimeVersion('0.1.2-rc.1')
      expect(dup.ok).toBe(false)
      expect(dup.error).toMatch(/已存在|不可变/)
      // 无引用 → 可删
      expect(ctx.console.removeRuntimeVersion('0.1.2-rc.1').ok).toBe(true)
      expect(ctx.console.listRuntimePool().versions).toEqual([])
    } finally {
      delete process.env.DSH_RUNTIMES
      rmSync(tmp, { recursive: true, force: true })
    }
  })
})

describe('删除实例（批 4）：归档可恢复 + 默认实例拒删', () => {
  afterEach(() => {
    ConsoleService.spawnImpl = childProcess.spawn
  })

  /** 造一个已登记的新布局实例（目录 + 注册表条目）。 */
  function seedInstance(id: string, over: Record<string, unknown> = {}): string {
    const home = join(dirname(process.env.DSH_REGISTRY!), `instance-${id}`)
    mkdirSync(join(home, 'profiles', 'dev'), { recursive: true })
    writeFileSync(join(home, 'profiles', 'dev', 'package.json'), '{"x":1}\n')
    const reg = loadRegistry()
    upsertInstance(reg, { id, host: 'master', home, profileDir: 'dev', layout: 'home', version: '0.1.2-rc.1', ...over })
    saveRegistry(reg)
    return home
  }

  it('删除 = 目录归档 + 档案墓碑；restore 把目录移回并转回 active', async () => {
    const home = seedInstance('instance-a')
    mockSpawn(fakeChild())
    const ctx = await bootDaemon({})
    const del = await ctx.console.deleteInstance('instance-a')
    expect(del.ok).toBe(true)
    expect(existsSync(home)).toBe(false)
    expect(findInstance(loadRegistry(), 'instance-a')!.status).toBe('deleted')
    expect(modelArchives('instance-a')).toHaveLength(1)
    const back = ctx.console.restoreInstance('instance-a')
    expect(back.ok).toBe(true)
    expect(existsSync(join(home, 'profiles', 'dev', 'package.json'))).toBe(true)
    expect(findInstance(loadRegistry(), 'instance-a')!.status).toBe('active')
  })

  it('正式 web（3080）与本机 daemon 的删除请求被拒，且不改动任何东西', async () => {
    const webHome = join(process.env.HOME ?? '', '.dsh')
    const daemonHome = seedInstance('daemon', { role: 'daemon' })
    // 同一次读取里加第二条再存盘（两次独立 load/save 会互相覆盖）
    const reg = loadRegistry()
    upsertInstance(reg, { id: 'web', host: 'master', home: webHome, profileDir: 'web', layout: 'legacy', role: 'console' })
    saveRegistry(reg)
    mockSpawn(fakeChild())
    const ctx = await bootDaemon({})
    const rWeb = await ctx.console.deleteInstance('web')
    expect(rWeb.ok).toBe(false)
    expect(rWeb.error).toMatch(/3080|禁止删除/)
    expect(findInstance(loadRegistry(), 'web')!.status).toBe('active')
    const rDaemon = await ctx.console.deleteInstance('daemon')
    expect(rDaemon.ok).toBe(false)
    expect(rDaemon.error).toMatch(/daemon.*禁止删除|执行面/)
    expect(existsSync(daemonHome)).toBe(true)
    expect(findInstance(loadRegistry(), 'daemon')!.status).toBe('active')
  })

  it('不在注册表的实例：删除显式失败（不静默通过）', async () => {
    mockSpawn(fakeChild())
    const ctx = await bootDaemon({})
    const r = await ctx.console.deleteInstance('nope')
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/不在注册表/)
  })
})

describe('已删除实例（墓碑）列表（批 7）', () => {
  afterEach(() => {
    ConsoleService.spawnImpl = childProcess.spawn
  })

  it('默认不在实例列表，墓碑里能查到（含归档路径与删除时间）', async () => {
    const home = join(dirname(process.env.DSH_REGISTRY!), 'instance-gone')
    mkdirSync(join(home, 'profiles', 'dev'), { recursive: true })
    const reg = loadRegistry()
    upsertInstance(reg, { id: 'instance-gone', host: 'master', home, profileDir: 'dev', layout: 'home', version: '0.1.2-rc.1' })
    saveRegistry(reg)
    mockSpawn(fakeChild())
    const ctx = await bootDaemon({})
    expect((await ctx.console.deleteInstance('instance-gone')).ok).toBe(true)
    const tombstones = ctx.console.listDeletedInstances()
    expect(tombstones.map((t) => t.id)).toEqual(['instance-gone'])
    expect(tombstones[0].deletedAt).toBeTruthy()
    expect(tombstones[0].archivePath).toMatch(/\.archive\/instance-gone-\d+$/)
    expect(tombstones[0].version).toBe('0.1.2-rc.1')
    // 实例列表（活跃）里不再出现
    expect(ctx.console.listInstances().instances.map((i) => i.id)).not.toContain('instance-gone')
  })
})

describe('管理事件（批 6）：category=admin + 日志滚动 + 查看器筛选', () => {
  afterEach(() => {
    ConsoleService.spawnImpl = childProcess.spawn
    delete process.env.DSH_LOG_MAX_BYTES
  })

  function readRecords(): Array<{ category?: string; level: string; msg: string }> {
    // 路径按角色取（bootDaemon = daemon 角色 → daemon.log），不写死文件名
    const file = Logger.resolvePath('daemon')!
    if (!existsSync(file)) return []
    // 文件里既有 JSONL 记录也有纯文本镜像行（Logger.append）——只取能解析的 JSONL
    return readFileSync(file, 'utf8').split('\n').filter((l) => l.length > 0)
      .flatMap((l) => { try { return [JSON.parse(l) as { category?: string; level: string; msg: string }] } catch { return [] } })
  }

  it('状态变更操作落 category=admin 事件（含目标与结果）', async () => {
    mockSpawn(fakeChild())
    const ctx = await bootDaemon({})
    const home = join(dirname(process.env.DSH_REGISTRY!), 'instance-ev')
    mkdirSync(join(home, 'profiles', 'dev'), { recursive: true })
    const reg = loadRegistry()
    upsertInstance(reg, { id: 'instance-ev', host: 'master', home, profileDir: 'dev', layout: 'home', version: '0.1.2-rc.1' })
    saveRegistry(reg)
    expect((await ctx.console.deleteInstance('instance-ev')).ok).toBe(true)
    // 幂等失败也要留痕（不是只记成功）
    expect((await ctx.console.deleteInstance('instance-ev')).ok).toBe(false)
    const admins = readRecords().filter((r) => r.category === 'admin')
    expect(admins.length).toBeGreaterThanOrEqual(2)
    expect(admins.some((r) => r.msg.includes('delete') && r.msg.includes('instance-ev') && r.msg.includes('成功'))).toBe(true)
    expect(admins.some((r) => r.level === 'error' && r.msg.includes('失败'))).toBe(true)
  })

  it('只读动作（查看实例/版本池）不产生管理事件', async () => {
    mockSpawn(fakeChild())
    const ctx = await bootDaemon({})
    ctx.console.listInstances()
    ctx.console.listRuntimePool()
    expect(readRecords().filter((r) => r.category === 'admin')).toEqual([])
  })

  it('日志超上限即滚动到 <file>.1（默认 100MB 可配）', () => {
    process.env.DSH_LOG_MAX_BYTES = '200'
    Logger.record('console', { level: 'info', scope: 'test', msg: 'x'.repeat(300) })
    const file = Logger.resolvePath('console')!
    expect(existsSync(file)).toBe(true)
    expect(statSync(file).size).toBeGreaterThan(200) // 已写入（本次不滚动）
    Logger.record('console', { level: 'info', scope: 'test', msg: 'y'.repeat(50) })
    // 第二次写入前先滚动：旧内容进 .1，新文件只有第二条
    expect(existsSync(`${file}.1`)).toBe(true)
    expect(readFileSync(`${file}.1`, 'utf8')).toContain('x'.repeat(50))
    expect(readFileSync(file, 'utf8')).toContain('y'.repeat(50))
  })

  it('查看器：categoryOnly 只留管理事件', () => {
    const records = [
      { ts: '2026-01-01T00:00:00.000Z', role: 'console' as const, level: 'info' as const, scope: 'deploy', msg: '普通日志' },
      { ts: '2026-01-01T00:00:01.000Z', role: 'console' as const, level: 'info' as const, scope: 'admin-event', category: 'admin', msg: 'system delete a → 成功' },
    ]
    const out = logView.filterRecords(records, { minLevel: 'all', query: '', errorsOnly: false, categoryOnly: 'admin' })
    expect(out).toHaveLength(1)
    expect(out[0].category).toBe('admin')
  })
})

describe('跨守护读日志（批 6b）：结果与失败都回传，不再空返回', () => {
  it('console 角色转发到守护 → 返回守护的结果；失败 → 带 error；无宿主信息 → 明确原因', async () => {
    const ctx = new Context()
    await ctx.plugin(ChannelService, { tokens: {}, heartbeatTimeoutMs: 30_000 })
    await ctx.plugin(ConsoleService, { launch: { web9: { host: 'host9', addr: 'http://127.0.0.1:3099' } } })
    const svc = ctx.console as unknown as { readLog(t: unknown, o: unknown): Promise<LogReadResult> }
    const channel = ctx.channel as unknown as { callRemote: (...a: unknown[]) => Promise<unknown> }
    const spy = vi.spyOn(channel, 'callRemote').mockResolvedValueOnce({
      ok: true,
      value: { records: [{ ts: '2026-01-01T00:00:00.000Z', role: 'instance', level: 'info', scope: 'web9', msg: 'from-daemon' }], total: 1, truncated: false },
    })
    const ok = await svc.readLog({ kind: 'instance', instanceId: 'web9' }, { tail: 10 })
    expect(ok.records.map((r) => r.msg)).toEqual(['from-daemon'])
    expect(ok.error).toBe(undefined)
    expect(spy).toHaveBeenCalled()

    // 转发失败：必须是"读失败"而不是"没有日志"
    spy.mockRejectedValueOnce(new Error('connect ECONNREFUSED 127.0.0.1:3099'))
    const failed = await svc.readLog({ kind: 'instance', instanceId: 'web9' }, { tail: 10 })
    expect(failed.records).toEqual([])
    expect(failed.error).toMatch(/ECONNREFUSED/)

    // 守护返回失败包装
    spy.mockResolvedValueOnce({ ok: false, error: { code: 'internal', message: '守护内部错误' } })
    const wrapped = await svc.readLog({ kind: 'instance', instanceId: 'web9' }, { tail: 10 })
    expect(wrapped.error).toMatch(/守护内部错误/)

    // 无 launch 宿主信息 → 点明原因
    const noSpec = await svc.readLog({ kind: 'instance', instanceId: 'nope' }, { tail: 10 })
    expect(noSpec.error).toMatch(/无守护宿主信息/)
    spy.mockRestore()
  })
})

describe('创建流程：模板 → 装依赖 → 链接池（端到端验收发现的缺口）', () => {
  afterEach(() => {
    ConsoleService.spawnImpl = childProcess.spawn
    delete process.env.DSH_RUNTIMES
  })

  it('模板声明依赖时会先安装，再链接池（顺序不能反：install 会覆盖池软链）', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'dsh-create-order-'))
    try {
      process.env.DSH_RUNTIMES = join(tmp, 'runtimes')
      // 池里放一个官方版本
      const cliNm = join(tmp, 'cli', 'node_modules')
      for (const name of ['dsh', 'dsh-base']) {
        mkdirSync(join(cliNm, '@deepseek-ai', name), { recursive: true })
        writeFileSync(join(cliNm, '@deepseek-ai', name, 'package.json'), JSON.stringify({ name: `@deepseek-ai/${name}`, version: '0.1.2-rc.1' }))
      }
      expect(importRuntime({ version: '0.1.2-rc.1', source: join(tmp, 'cli') }).ok).toBe(true)
      // 模板：带自研依赖的三件套（模拟 profiles/dev）
      const templateHome = join(tmp, 'templates')
      const tpl = join(templateHome, 'profiles', 'dev')
      mkdirSync(tpl, { recursive: true })
      writeFileSync(join(tpl, 'package.json'), JSON.stringify({ name: 'dsh-profile-dev', dependencies: { 'dsh-desk': 'link:/tmp/nope' } }))
      writeFileSync(join(tpl, 'cordis.patch.yml'), '[]\n')
      mkdirSync(join(tpl, 'node_modules', 'dsh-desk'), { recursive: true }) // 真装出来的样子
      const calls: Array<{ dir: string; linked: boolean }> = []
      ConsoleService.installImpl = (dir) => {
        // 安装时必须还没有池软链（顺序断言）
        const linkedAlready = existsSync(join(dir, 'node_modules', '@deepseek-ai', 'dsh'))
          && lstatSync(join(dir, 'node_modules', '@deepseek-ai', 'dsh')).isSymbolicLink()
        calls.push({ dir, linked: linkedAlready })
      }
      mockSpawn(fakeChild())
      const ctx = await bootDaemon({ templateHome })
      const dshHome = join(dirname(process.env.DSH_REGISTRY!), 'instance-order')
      const r = ctx.console.deployInstance({ host: 'host1', instanceId: 'instance-order', version: '0.1.2-rc.1', profile: 'dev', dshHome, port: 3092, token: 't' })
      expect(r.ok).toBe(true)
      expect(calls).toHaveLength(1)
      expect(calls[0].linked).toBe(false) // 装依赖时尚未链接池
      // 装完后池链接生效
      expect(currentRuntimeVersion(join(dshHome, 'profiles', 'dev'))).toBe('0.1.2-rc.1')
      // profile 根入口列表必须存在（模板不带它，缺了实例起不来）
      expect(existsSync(join(dshHome, 'profiles', 'dev', 'cordis.yml'))).toBe(true)
    } finally {
      ConsoleService.installImpl = (profileDir) => {
        execFileSync('npm', ['install', '--no-audit', '--no-fund', '--loglevel', 'error'], { cwd: profileDir, stdio: 'pipe' })
      }
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('依赖装不上 → 显式失败，不留"目录在但起不来"的半成品', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'dsh-create-instfail-'))
    try {
      process.env.DSH_RUNTIMES = join(tmp, 'runtimes')
      const cliNm = join(tmp, 'cli', 'node_modules', '@deepseek-ai', 'dsh')
      mkdirSync(cliNm, { recursive: true })
      writeFileSync(join(cliNm, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh', version: '0.1.2-rc.1' }))
      importRuntime({ version: '0.1.2-rc.1', source: join(tmp, 'cli') })
      const tpl = join(tmp, 'templates', 'profiles', 'dev')
      mkdirSync(tpl, { recursive: true })
      writeFileSync(join(tpl, 'package.json'), JSON.stringify({ name: 'dsh-profile-dev', dependencies: { 'dsh-desk': 'link:/tmp/nope' } }))
      writeFileSync(join(tpl, 'cordis.patch.yml'), '[]\n')
      ConsoleService.installImpl = () => { throw new Error('npm ERR! 网络不可达') }
      mockSpawn(fakeChild())
      const ctx = await bootDaemon({ templateHome: join(tmp, 'templates') })
      const dshHome = join(dirname(process.env.DSH_REGISTRY!), 'instance-fail')
      const r = ctx.console.deployInstance({ host: 'host1', instanceId: 'instance-fail', version: '0.1.2-rc.1', profile: 'dev', dshHome, port: 3093, token: 't' })
      expect(r.ok).toBe(false)
      expect(r.error).toMatch(/依赖安装失败/)
    } finally {
      ConsoleService.installImpl = (profileDir) => {
        execFileSync('npm', ['install', '--no-audit', '--no-fund', '--loglevel', 'error'], { cwd: profileDir, stdio: 'pipe' })
      }
      rmSync(tmp, { recursive: true, force: true })
    }
  })
})

describe('templateHome 兼容两种布局（端到端暴露的语义二义）', () => {
  afterEach(() => {
    ConsoleService.spawnImpl = childProcess.spawn
    delete process.env.DSH_RUNTIMES
  })

  it('templateHome 指向模板目录（工程 profiles/）或含 profiles/ 的 home，模板清单都对', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'dsh-tpl-base-'))
    try {
      mockSpawn(fakeChild())
      // (a) 工程 profiles/ 直接作为 templateHome（子目录即模板）
      const asDir = join(tmp, 'profiles')
      for (const n of ['dev', 'minimal']) {
        mkdirSync(join(asDir, n), { recursive: true })
        writeFileSync(join(asDir, n, 'package.json'), '{}')
      }
      const ctx1 = await bootDaemon({ templateHome: asDir })
      expect(ctx1.console.listTemplates()).toEqual(['dev', 'minimal'])
      // (b) 老配置：含 profiles/ 的 home
      const asHome = join(tmp, 'web3-home')
      mkdirSync(join(asHome, 'profiles', 'web3'), { recursive: true })
      writeFileSync(join(asHome, 'profiles', 'web3', 'package.json'), '{}')
      const ctx2 = await bootDaemon({ templateHome: asHome })
      expect(ctx2.console.listTemplates()).toEqual(['web3'])
      // (c) 未配置 → 空清单（不抛）
      const ctx3 = await bootDaemon({})
      expect(ctx3.console.listTemplates()).toEqual([])
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })
})

describe('控制端口：绑定结果必须是真的（不许乐观日志）', () => {
  afterEach(() => {
    ConsoleService.spawnImpl = childProcess.spawn
  })

  it('空闲端口 → controlServerStatus 报 up:true', async () => {
    // 先探一个空闲端口（controlPort=0 是 falsy：配置判读上等于"未配置"，服务不会启）
    const probe = createServer(() => {})
    await new Promise<void>((r) => probe.listen(0, '127.0.0.1', () => r()))
    const freePort = (probe.address() as { port: number }).port
    await new Promise<void>((r) => probe.close(() => r()))
    mockSpawn(fakeChild())
    const ctx = await bootDaemon({ controlPort: freePort })
    await new Promise((r) => setTimeout(r, 50))
    expect(ctx.console.controlServerStatus().up).toBe(true)
  })

  it('端口被占用 → 报 up:false 且带 EADDRINUSE（此前只会打一行乐观的"就绪"）', async () => {
    // 先占住一个端口
    const squatter = createServer(() => {})
    await new Promise<void>((r) => squatter.listen(0, '127.0.0.1', () => r()))
    const port = (squatter.address() as { port: number }).port
    try {
      mockSpawn(fakeChild())
      const ctx = await bootDaemon({ controlPort: port })
      await new Promise((r) => setTimeout(r, 100))
      const st = ctx.console.controlServerStatus()
      expect(st.up).toBe(false)
      expect(st.error).toMatch(/EADDRINUSE/)
    } finally {
      await new Promise<void>((r) => squatter.close(() => r()))
    }
  })
})


describe('删除路由（review 阻塞项回归）：console 角色 → 派发到 launch 配置的守护名', () => {
  afterEach(() => {
    ConsoleService.spawnImpl = childProcess.spawn
  })

  it('用 launch 的 host（守护 agent 名）而不是 host-<hostname>；且异步删除不谎报成功', async () => {
    mockSpawn(fakeChild())
    const ctx = new Context()
    await ctx.plugin(ChannelService, { tokens: {}, heartbeatTimeoutMs: 30_000 })
    await ctx.plugin(ConsoleService, { launch: { web9: { host: 'host-master', addr: 'http://127.0.0.1:3089' } } })
    // 注册表里的 host 是**机器标识**，与守护 agent 名不同（review 实测踩到）
    const home = join(dirname(process.env.DSH_REGISTRY!), 'instance-web9')
    mkdirSync(join(home, 'profiles', 'dev'), { recursive: true })
    const reg = loadRegistry()
    upsertInstance(reg, { id: 'web9', host: 'DELONON-THINK', home, profileDir: 'dev', layout: 'home', version: '0.1.2-rc.1' })
    saveRegistry(reg)
    // 守护必须在 channel 里有 addr，才走直连 RPC（否则走本地回环 → 无接收者 → 显式失败）
    ctx.channel.register({ id: 'host-master', name: 'host-master', addr: 'http://127.0.0.1:3089', status: 'online' }, 'tok-master')
    const calls: string[] = []
    ConsoleService.fetchImpl = (async (url: string) => { calls.push(String(url)); return new Response(JSON.stringify({ result: { ok: true, value: { ok: true } } }), { status: 200 }) }) as unknown as typeof fetch
    const r = await ctx.console.deleteInstance('web9')
    expect(r.ok).toBe(true)
    expect(r.detail ?? '').toMatch(/已下发/)
    // 目标 = launch 的 host-master（不是 host-DELONON-THINK）
    expect(calls[0]).toContain('http://127.0.0.1:3089/api/console/')
    // 不许谎报成功：管理事件必须记「已受理」而不是「成功」
    const logFile = Logger.resolvePath('console')!
    const admins = readFileSync(logFile, 'utf8').split('\n').filter((l) => l.includes('admin-event'))
    expect(admins.some((l) => l.includes('已受理'))).toBe(true)
    expect(admins.some((l) => l.includes('→ 成功'))).toBe(false)
    ConsoleService.fetchImpl = fetch
  })

  it('守护不可达（无 addr、无本机接收者）→ 显式失败，不谎报成功', async () => {
    mockSpawn(fakeChild())
    const ctx = new Context()
    await ctx.plugin(ChannelService, { tokens: {}, heartbeatTimeoutMs: 30_000 })
    await ctx.plugin(ConsoleService, { launch: { web9: { host: 'host-nope' } } })
    const home = join(dirname(process.env.DSH_REGISTRY!), 'instance-web9b')
    mkdirSync(join(home, 'profiles', 'dev'), { recursive: true })
    const reg = loadRegistry()
    upsertInstance(reg, { id: 'web9', host: 'DELONON-THINK', home, profileDir: 'dev', layout: 'home' })
    saveRegistry(reg)
    const r = await ctx.console.deleteInstance('web9')
    expect(r.ok).toBe(false)
    expect(r.error ?? '').toMatch(/无本机接收者|无守护宿主/)
    expect(existsSync(home)).toBe(true) // 目录与档案原样
    expect(findInstance(loadRegistry(), 'web9')!.status).toBe('active')
  })
})

describe('目标守护解析（用户报错回归）：legacy 实例只有机器标识时的回退', () => {
  afterEach(() => {
    ConsoleService.spawnImpl = childProcess.spawn
  })

  it('legacy 实例：launch 无该实例、channel 无归属 → 回退到本机唯一守护（host-master）', async () => {
    mockSpawn(fakeChild())
    const ctx = new Context()
    await ctx.plugin(ChannelService, { tokens: {}, heartbeatTimeoutMs: 30_000 })
    await ctx.plugin(ConsoleService, { launch: { 'host-master': { host: 'host-master', addr: 'http://127.0.0.1:3089' } } })
    ctx.channel.register({ id: 'host-master', name: 'host-master', addr: 'http://127.0.0.1:3089', status: 'online' }, 'tok')
    // legacy 实例：home 在 ~/.dsh-webX，档案 host 是机器标识，launch 里没有它
    const home = join(process.env.HOME ?? '', '.dsh-webX')
    mkdirSync(join(home, 'profiles', 'webX'), { recursive: true })
    const reg = loadRegistry()
    upsertInstance(reg, { id: 'webX', host: 'DELONON-THINK', home, profileDir: 'webX', layout: 'legacy', role: 'console' })
    saveRegistry(reg)
    const calls: string[] = []
    ConsoleService.fetchImpl = (async (url: string) => { calls.push(String(url)); return new Response(JSON.stringify({ result: { ok: true, value: { ok: true } } }), { status: 200 }) }) as unknown as typeof fetch
    const r = await ctx.console.deleteInstance('webX')
    expect(r.ok).toBe(true)
    expect(calls[0]).toContain('http://127.0.0.1:3089/api/console/')  // 不是 host-DELONON-THINK
    ConsoleService.fetchImpl = fetch
  })

  it('没有任何守护 → 显式失败并列出已知守护（便于自查）', async () => {
    mockSpawn(fakeChild())
    const ctx = new Context()
    await ctx.plugin(ChannelService, { tokens: {}, heartbeatTimeoutMs: 30_000 })
    await ctx.plugin(ConsoleService, {})
    const home = join(process.env.HOME ?? '', '.dsh-webY')
    mkdirSync(join(home, 'profiles', 'webY'), { recursive: true })
    const reg = loadRegistry()
    upsertInstance(reg, { id: 'webY', host: 'DELONON-THINK', home, profileDir: 'webY', layout: 'legacy' })
    saveRegistry(reg)
    const r = await ctx.console.deleteInstance('webY')
    expect(r.ok).toBe(false)
    expect(r.error ?? '').toMatch(/无法确定目标守护|已知守护/)
  })
})

describe('用户报错回归：UI 传了不存在的守护名（host1）', () => {
  afterEach(() => {
    ConsoleService.spawnImpl = childProcess.spawn
  })

  it('console 角色：request.host=host1 但已知守护是 host-master → 自动纠偏并派发', async () => {
    mockSpawn(fakeChild())
    const ctx = new Context()
    await ctx.plugin(ChannelService, { tokens: {}, heartbeatTimeoutMs: 30_000 })
    await ctx.plugin(ConsoleService, { launch: { 'host-master': { host: 'host-master', addr: 'http://127.0.0.1:3089' } } })
    ctx.channel.register({ id: 'host-master', name: 'host-master', addr: 'http://127.0.0.1:3089', status: 'online' }, 'tok')
    const calls: string[] = []
    ConsoleService.fetchImpl = (async (url: string) => { calls.push(String(url)); return new Response(JSON.stringify({ result: { ok: true, value: { ok: true } } }), { status: 200 }) }) as unknown as typeof fetch
    const r = ctx.console.deployInstance({
      host: 'host1', instanceId: 'mytest', version: '0.1.2-rc.1', profile: 'dev',
      dshHome: join(tmpdir(), 'instance-mytest'), port: 3096, token: 't',
    })
    expect(r.ok).toBe(true)
    expect(calls[0]).toContain('http://127.0.0.1:3089/api/console/')   // 纠偏到真实守护
    ConsoleService.fetchImpl = fetch
  })

  it('没有任何已知守护 → 失败信息列出可用守护（便于自查）', async () => {
    mockSpawn(fakeChild())
    const ctx = new Context()
    await ctx.plugin(ChannelService, { tokens: {}, heartbeatTimeoutMs: 30_000 })
    await ctx.plugin(ConsoleService, {})
    const r = ctx.console.deployInstance({
      host: 'host1', instanceId: 'mytest2', version: '0.1.2-rc.1', profile: 'dev',
      dshHome: join(tmpdir(), 'instance-mytest2'), port: 3096, token: 't',
    })
    expect(r.ok).toBe(false)
    expect(r.error ?? '').toMatch(/不是已知守护|无本机接收者|可用/)
  })
})

describe('状态来源（在跑实例不得显示离线）', () => {
  it('deploy 拉起的实例登记进 channel 实例表（否则 probe 的 heartbeat 抛 unknown 被吞→永久离线）', async () => {
    const child = fakeChild()
    mockSpawn(child)
    const ctx = await bootDaemon({})
    ctx.console.deployInstance({
      host: 'host1', instanceId: 'web6', version: '0.1.2-rc.1', profile: 'web',
      dshHome: '/tmp/.dsh-web6-status', port: 3086, token: 'tok-web6',
    })
    await new Promise((r) => setTimeout(r, 20))
    expect(ctx.channel.get('web6')?.status).toBe('online')
    const svc = ctx.console as unknown as { localInstanceReport(): Array<{ id: string; status: string }> }
    expect(svc.localInstanceReport().find((i) => i.id === 'web6')?.status).toBe('online')
  })

  it('状态同步：从宿主守护拉本机视图 → 在跑实例并入实例表且视图在线', async () => {
    const ctx = new Context()
    await ctx.plugin(ChannelService, { tokens: {}, heartbeatTimeoutMs: 30_000 })
    await ctx.plugin(ConsoleService, { launch: { 'host-master': { host: 'host-master', addr: 'http://127.0.0.1:3089' } } })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      result: {
        ok: true,
        value: { instances: [
          { id: 'web1234', addr: 'http://127.0.0.1:31234', status: 'online' },
          { id: 'web5', addr: 'http://127.0.0.1:3085', status: 'offline' },
        ] },
      },
    }), { status: 200 })))
    try {
      const svc = ctx.console as unknown as { syncHostStatuses(): Promise<void> }
      await svc.syncHostStatuses()
      expect(ctx.channel.get('web1234')?.status).toBe('online')
      expect(ctx.channel.get('web5')?.status).toBe('offline')
      const view = ctx.console.listInstances()
      expect(view.instances.find((i) => i.id === 'web1234')?.status).toBe('online')
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('本机守护自启 + 幽灵行（daemon 是 ~/.dsh 下与 web 平级的 profile）', () => {
  afterEach(() => {
    ConsoleService.spawnImpl = childProcess.spawn
    ConsoleService.fetchImpl = fetch
    delete process.env.DSH_CHANNEL_ID
    delete process.env.DSH_SESSION_ID
  })

  /** 守护控制面不可达（fetch 抛错）= 守护没在跑。 */
  function unreachable(): void {
    ConsoleService.fetchImpl = (async () => { throw new Error('ECONNREFUSED') }) as unknown as typeof fetch
  }

  /** 可达（守护已在跑）。 */
  function reachable(): void {
    ConsoleService.fetchImpl = (async () => new Response(JSON.stringify({ result: { ok: true, value: { instances: [] } } }), { status: 200 })) as unknown as typeof fetch
  }

  async function bootConsole(launch: Record<string, unknown>): Promise<Context> {
    const ctx = new Context()
    await ctx.plugin(ChannelService, { tokens: {}, heartbeatTimeoutMs: 30_000 })
    await ctx.plugin(ConsoleService, { launch })
    return ctx
  }

  const autoHost = { host: 'host-master', addr: 'http://127.0.0.1:3089', autoStart: true, profile: 'daemon' }

  it('守护不可达 → 同一 DSH_HOME 拉起 `--profile daemon`（身份 = host-master）', async () => {
    const spawnSpy = mockSpawn(fakeChild())
    unreachable()
    // 管理端自己的身份/会话变量必须剔除：继承 DSH_CHANNEL_ID=web 会让守护顶掉管理端 id。
    process.env.DSH_CHANNEL_ID = 'web'
    process.env.DSH_SESSION_ID = 'sess-1'
    await bootConsole({ 'host-master': autoHost })
    await new Promise((r) => setTimeout(r, 20))
    expect(spawnSpy).toHaveBeenCalledTimes(1)
    const [bin, args, opts] = spawnSpy.mock.calls[0] as [string, string[], { env: Record<string, string>; detached: boolean }]
    expect(bin).toBe('dsh')
    expect(args).toEqual(['--profile', 'daemon'])
    // DSH_HOME 继承管理端（守护与 web 同 home、不同 profile），身份必须是守护 agent 名。
    expect(opts.env.DSH_HOME).toBe(testDshHome)
    expect(opts.env.DSH_CHANNEL_ID).toBe('host-master')
    expect(opts.env.DSH_SESSION_ID).toBeUndefined()
    expect(opts.detached).toBe(true)
  })

  it('守护已在跑（控制面可达）→ 不拉起', async () => {
    const spawnSpy = mockSpawn(fakeChild())
    reachable()
    await bootConsole({ 'host-master': autoHost })
    await new Promise((r) => setTimeout(r, 20))
    expect(spawnSpy).not.toHaveBeenCalled()
  })

  it('未配 autoStart 的守护条目 → 不自启（多机守护由目标主机常驻）', async () => {
    const spawnSpy = mockSpawn(fakeChild())
    unreachable()
    await bootConsole({ 'host-master': { host: 'host-master', addr: 'http://127.0.0.1:3089' } })
    await new Promise((r) => setTimeout(r, 20))
    expect(spawnSpy).not.toHaveBeenCalled()
  })

  it('拉起后宽限窗口内不重复拉起（守护启动非瞬时，防拉起风暴）', async () => {
    const spawnSpy = mockSpawn(fakeChild())
    unreachable()
    const ctx = await bootConsole({ 'host-master': autoHost })
    await new Promise((r) => setTimeout(r, 20))
    const svc = ctx.console as unknown as { ensureLocalDaemons(): Promise<void> }
    await svc.ensureLocalDaemons()
    await svc.ensureLocalDaemons()
    expect(spawnSpy).toHaveBeenCalledTimes(1)
  })

  it('注册表里的守护档案（role: daemon）不并入实例列表——它是执行面自身，不是实例', async () => {
    const ctx = await bootConsole({})
    const reg = loadRegistry()
    upsertInstance(reg, {
      id: 'daemon', host: 'master', home: process.env.DSH_HOME ?? '', profileDir: 'daemon',
      layout: 'profile', role: 'daemon',
    })
    upsertInstance(reg, {
      id: 'web9', host: 'master', home: '/tmp/.dsh-web9', profileDir: 'web9', layout: 'legacy', role: 'instance',
    })
    saveRegistry(reg)
    const ids = ctx.console.listInstances().instances.map((i) => i.id)
    // 守护无 port/addr，并进实例表就只是一行永远"离线"的幽灵行（用户实测报障）。
    expect(ids).not.toContain('daemon')
    // 普通实例仍按注册表权威源并入（本条语义未被误伤）。
    expect(ids).toContain('web9')
  })
})
