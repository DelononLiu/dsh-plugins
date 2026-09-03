/**
 * dsh-console 行为测试：主机/实例档案、生命周期编排（指令回环）、
 * inbox（系统事件消息，按 owner 隔离）。
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import type { ChildProcess } from 'node:child_process'
import * as childProcess from 'node:child_process'
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import ChannelService from 'dsh-channel'
import ConsoleService, {
  applyOverrideStatus,
  resolveControlAction,
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

  it('bootstrapHost 生成令牌 + agent profile + SSH 引导命令', async () => {
    const ctx = await boot()
    const r = ctx.console.bootstrapHost('web5', 'user@10.0.0.15', '0.1.2-rc.1')
    expect(r.ok).toBe(true)
    expect(r.token).toMatch(/^[0-9a-f]{32}$/)
    expect(r.instanceId).toBe('web5')
    expect(r.profileDir).toBe('agent-web5')
    expect(r.sshCommands?.length).toBe(3)
    expect(r.sshCommands?.[0]).toContain('scp -r agent-web5 user@10.0.0.15')
    expect(r.sshCommands?.[1]).toContain('dsh bootstrap --profile agent-web5 --version 0.1.2-rc.1')
    // 清理：bootstrapHost 写 cwd 的 agent-web5/（测试产物，勿残留）。
    rmSync(join(process.cwd(), 'agent-web5'), { recursive: true, force: true })
  })

  it('bootstrapHost 校验非法输入', async () => {
    const ctx = await boot()
    expect(ctx.console.bootstrapHost('bad/name', 'user@host', '0.1.2-rc.1').ok).toBe(false)
    expect(ctx.console.bootstrapHost('web5', '10.0.0.15', '0.1.2-rc.1').ok).toBe(false)
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

  it('直连探测：可达 → heartbeat 续期保持 online；不可达 → 不续期', async () => {
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
    expect(ctx.channel.get('web3')?.status).toBe('online')
    // 不可达 → 不续期（但声明仍在线；sweep 才会标离线）
    reachable = false
    await consoleSvc.probeLaunch()
    expect(ctx.channel.get('web3')?.status).toBe('online') // lastSeen 未刷新，但未到 sweep 窗口
    vi.unstubAllGlobals()
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
})
