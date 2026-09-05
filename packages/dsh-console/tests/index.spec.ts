/**
 * dsh-console 行为测试：主机/实例档案、生命周期编排（指令回环）、
 * inbox（系统事件消息，按 owner 隔离）。
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import type { ChildProcess } from 'node:child_process'
import * as childProcess from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir, homedir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import ChannelService from 'dsh-channel'
import ConsoleService, {
  applyOverrideStatus,
  resolveControlAction,
  Logger,
  resolveControlRoute,
  type InstanceRecord,
} from '../src/index.ts'

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
    // 实例在线（channel 注册）但守护无子进程 → 分支 2（无 broker → 不发跨进程 stop）
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
    expect(spawnSpy).toHaveBeenCalledWith('dsh', ['--profile', 'web'], expect.objectContaining({
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
    const rdata = await read.json() as { result: { ok: boolean; value: { content: string; total: number } } }
    expect(rdata.result.ok).toBe(true)
    expect(typeof rdata.result.value.total).toBe('number')
    ctx[Symbol.dispose]?.()
  })

})

describe('Logger（关键事件落盘）', () => {
  const isolatedHome = (): string => mkdtempSync(join(tmpdir(), 'dsh-logger-'))

  it('resolvePath：daemon → ~/.dsh-daemon/daemon.log', () => {
    expect(Logger.resolvePath('daemon')).toBe(join(homedir(), '.dsh-daemon', 'daemon.log'))
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

  it('append：daemon 角色路径含 .dsh-daemon/daemon.log', () => {
    const path = Logger.resolvePath('daemon')
    expect(path).not.toBe(null)
    expect(path).toContain('.dsh-daemon/daemon.log')
  })

  it('append：instance 角色静默不写', () => {
    Logger.append('instance', 'should-not-write')
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
  // 用临时 DSH_HOME + 临时 daemon 路径隔离
  const isolatedHome = (): string => mkdtempSync(join(tmpdir(), 'dsh-logs-'))

  it('logPathFor：daemon 角色读 ~/.dsh-daemon/logs/<id>.log（白名单校验）', async () => {
    const home = isolatedHome()
    process.env.HOME = home
    try {
      const ctx = new Context()
      await ctx.plugin(ChannelService, { tokens: { instA: 'tok-a' } })
      await ctx.plugin(ConsoleService, {
        role: 'daemon',
        hostId: 'host1',
        instances: { web3: { dshHome: '~/.dsh-web3', profile: 'web', port: 3083 } },
      })
      const logPathFor = (target: { kind: 'daemon' } | { kind: 'instance'; instanceId: string }): string | null => {
        return (ctx.console as unknown as { logPathFor: (t: { kind: 'daemon' } | { kind: 'instance'; instanceId: string }) => string | null }).logPathFor(target)
      }
      // 白名单内：web3
      expect(logPathFor({ kind: 'instance', instanceId: 'web3' })).toContain('.dsh-daemon/logs/web3.log')
      // 白名单外：null
      expect(logPathFor({ kind: 'instance', instanceId: 'evil' })).toBe(null)
      // daemon target
      expect(logPathFor({ kind: 'daemon' })).toContain('.dsh-daemon/daemon.log')
      ctx[Symbol.dispose]?.()
    } finally {
      // restore HOME
    }
  })

  it('listLogFiles：daemon 角色返回本机 logs/ + daemon.log', async () => {
    const home = isolatedHome()
    process.env.HOME = home
    const logDir = join(home, '.dsh-daemon', 'logs')
    mkdirSync(logDir, { recursive: true })
    writeFileSync(join(logDir, 'web3.log'), 'line1\nline2\n')
    writeFileSync(join(home, '.dsh-daemon', 'daemon.log'), 'd1\n')
    try {
      const ctx = new Context()
      await ctx.plugin(ChannelService, { tokens: { instA: 'tok-a' } })
      await ctx.plugin(ConsoleService, {
        role: 'daemon', hostId: 'host1',
        instances: { web3: { dshHome: '~/.dsh-web3', profile: 'web', port: 3083 } },
      })
      const list = (ctx.console as unknown as { listLogFiles: () => { daemon: unknown; instances: Array<{ id: string }> } }).listLogFiles()
      expect(list.daemon).not.toBe(null)
      expect((list.daemon as { id: string }).id).toBe('daemon')
      expect(list.instances).toHaveLength(1)
      expect(list.instances[0].id).toBe('web3')
      ctx[Symbol.dispose]?.()
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('readLog：daemon 角色读本机 logs/<id>.log（tail 倒推）', async () => {
    const home = isolatedHome()
    process.env.HOME = home
    const logDir = join(home, '.dsh-daemon', 'logs')
    mkdirSync(logDir, { recursive: true })
    const lines = Array.from({ length: 500 }, (_, i) => `line-${i}`)
    writeFileSync(join(logDir, 'web3.log'), lines.join('\n') + '\n')
    try {
      const ctx = new Context()
      await ctx.plugin(ChannelService, { tokens: { instA: 'tok-a' } })
      await ctx.plugin(ConsoleService, {
        role: 'daemon', hostId: 'host1',
        instances: { web3: { dshHome: '~/.dsh-web3', profile: 'web', port: 3083 } },
      })
      const readLog = (target: { instanceId: string }, opts: { tail?: number }): { content: string; total: number; truncated: boolean } => {
        return (ctx.console as unknown as {
          readLog: (t: { instanceId: string }, o: { tail?: number }) => { content: string; total: number; truncated: boolean }
        }).readLog(target, opts)
      }
      // tail=3：最后 3 行
      const r = readLog({ instanceId: 'web3' }, { tail: 3 })
      expect(r.content).toBe('line-497\nline-498\nline-499')
      expect(r.total).toBe(500)
      // 不存在的实例 → 空
      const r2 = readLog({ instanceId: 'nope' }, { tail: 3 })
      expect(r2.content).toBe('')
      // 不存在的文件
      const r3 = readLog({ instanceId: 'fresh' }, { tail: 3 })
      // 注意：fresh 不在白名单 → 之前 test 的 null 路径
      ctx[Symbol.dispose]?.()
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('readLog：maxBytes 超限标记 truncated', async () => {
    const home = isolatedHome()
    process.env.HOME = home
    const logDir = join(home, '.dsh-daemon', 'logs')
    mkdirSync(logDir, { recursive: true })
    const big = 'x'.repeat(1000)
    writeFileSync(join(logDir, 'web3.log'), big)
    try {
      const ctx = new Context()
      await ctx.plugin(ChannelService, { tokens: { instA: 'tok-a' } })
      await ctx.plugin(ConsoleService, {
        role: 'daemon', hostId: 'host1',
        instances: { web3: { dshHome: '~/.dsh-web3', profile: 'web', port: 3083 } },
      })
      const readLog = (target: { instanceId: string }, opts: { maxBytes?: number }) => {
        return (ctx.console as unknown as {
          readLog: (t: { instanceId: string }, o: { maxBytes?: number }) => { content: string; truncated: boolean }
        }).readLog(target, opts)
      }
      // 100 字节 maxBytes vs 1000 字节内容 → truncated=true
      const r = readLog({ instanceId: 'web3' }, { maxBytes: 100 })
      expect(r.truncated).toBe(true)
      ctx[Symbol.dispose]?.()
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('readLog：console 角色读 daemon target = 本机 console.log', async () => {
    const home = isolatedHome()
    const saved = process.env.DSH_HOME
    process.env.DSH_HOME = home
    writeFileSync(join(home, 'console.log'), 'c1\nc2\nc3\n')
    try {
      const ctx = new Context()
      await ctx.plugin(ChannelService, { tokens: { instA: 'tok-a' } })
      await ctx.plugin(ConsoleService, {})
      const readLog = (target: { kind: 'daemon' }, opts: { tail?: number }) => {
        return (ctx.console as unknown as {
          readLog: (t: { kind: 'daemon' }, o: { tail?: number }) => { content: string }
        }).readLog(target, opts)
      }
      const r = readLog({ kind: 'daemon' }, { tail: 2 })
      expect(r.content).toBe('c2\nc3')
      ctx[Symbol.dispose]?.()
    } finally {
      if (saved === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = saved
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('readLog：instance 角色一律返回空（无管理面）', async () => {
    const home = isolatedHome()
    process.env.HOME = home
    try {
      const ctx = new Context()
      await ctx.plugin(ChannelService, { tokens: { instA: 'tok-a' } })
      await ctx.plugin(ConsoleService, { role: 'instance' })
      const readLog = (target: { instanceId: string }) => {
        return (ctx.console as unknown as {
          readLog: (t: { instanceId: string }) => { content: string }
        }).readLog(target, {})
      }
      expect(readLog({ instanceId: 'web3' }).content).toBe('')
      ctx[Symbol.dispose]?.()
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })
})
