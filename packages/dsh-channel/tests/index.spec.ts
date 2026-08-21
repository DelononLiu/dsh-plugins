/**
 * dsh-channel 行为测试：实例注册/心跳/发现、事件总线（幂等/TTL/三平面）、
 * 实例令牌校验、控制指令回环。
 */

import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { ChannelService, EVENT_TTL_MS, type Config } from '../src/index.ts'

function boot(config: Partial<Config> = {}): ChannelService {
  return new ChannelService(new Context(), {
    tokens: { instA: 'tok-a' },
    heartbeatTimeoutMs: 30_000,
    ...config,
  })
}

const IDENTITY = { id: 'instA', name: 'A', addr: '10.0.0.1:3000', status: 'online' as const }

describe('实例注册/心跳/发现', () => {
  it('注册后在线并可发现', () => {
    const ch = boot()
    ch.register(IDENTITY, 'tok-a')
    expect(ch.list()).toEqual([{ ...IDENTITY, status: 'online' }])
    expect(ch.get('instA')?.status).toBe('online')
  })

  it('令牌不匹配拒绝注册', () => {
    const ch = boot()
    expect(() => ch.register(IDENTITY, 'wrong')).toThrow('token mismatch')
    expect(ch.list()).toEqual([])
  })

  it('未知实例心跳抛错', () => {
    const ch = boot()
    expect(() => ch.heartbeat('nope', 'tok-a')).toThrow('unknown instance')
  })

  it('心跳超时判定离线', async () => {
    // 真实短超时 + 等待（fake timers 与 setInterval 交互不稳，用真实计时）。
    const ch = boot({ heartbeatTimeoutMs: 50 })
    ch.register(IDENTITY, 'tok-a')
    await new Promise((r) => setTimeout(r, 150))
    expect(ch.get('instA')?.status).toBe('offline')
  })

  it('心跳刷新后保持在线', async () => {
    const ch = boot({ heartbeatTimeoutMs: 100 })
    ch.register(IDENTITY, 'tok-a')
    await new Promise((r) => setTimeout(r, 60))
    ch.heartbeat('instA', 'tok-a')
    await new Promise((r) => setTimeout(r, 60))
    expect(ch.get('instA')?.status).toBe('online')
  })
})

describe('事件总线', () => {
  it('emit 投递到订阅者（进程内）', () => {
    const ch = boot()
    const seen: string[] = []
    ch.subscribe('task', (e) => seen.push(`${e.plane}:${e.type}`))
    ch.emit('task', 'job.done', { ok: true })
    expect(seen).toEqual(['task:job.done'])
  })

  it('三平面独立订阅', () => {
    const ch = boot()
    const control: string[] = []
    const task: string[] = []
    ch.subscribe('control', (e) => control.push(e.type))
    ch.subscribe('task', (e) => task.push(e.type))
    ch.emit('control', 'stop', {})
    ch.emit('task', 'run', {})
    expect(control).toEqual(['stop'])
    expect(task).toEqual(['run'])
  })

  it('ack 幂等：首次 true 重复 false', () => {
    const ch = boot()
    const id = ch.emit('task', 'run', {})
    expect(ch.ack(id)).toBe(true)
    expect(ch.ack(id)).toBe(false)
  })

  it('取消订阅后不再接收', () => {
    const ch = boot()
    const seen: string[] = []
    const dispose = ch.subscribe('task', (e) => seen.push(e.type))
    ch.emit('task', 'a', {})
    dispose()
    ch.emit('task', 'b', {})
    expect(seen).toEqual(['a'])
  })

  it('emit 返回唯一事件 id', () => {
    const ch = boot()
    const a = ch.emit('session', 'sync', {})
    const b = ch.emit('session', 'sync', {})
    expect(a).not.toBe(b)
    expect(EVENT_TTL_MS).toBe(7 * 24 * 3600_000)
  })
})

describe('控制指令', () => {
  it('sendControl 回环到接收者并带幂等 id', () => {
    const ch = boot()
    const received: Array<{ type: string; id: string; target: string }> = []
    ch.onControl((cmd, instanceId) => received.push({ type: cmd.type, id: cmd.id, target: instanceId }))
    ch.sendControl('instA', { type: 'upgrade', payload: { to: '0.2.0' } })
    expect(received).toHaveLength(1)
    expect(received[0].type).toBe('upgrade')
    expect(received[0].target).toBe('instA')
    expect(received[0].id).toBeTruthy()
  })

  it('无接收者时静默（回环无目标即丢弃）', () => {
    const ch = boot()
    expect(() => ch.sendControl('instA', { type: 'stop', payload: {} })).not.toThrow()
  })
})
