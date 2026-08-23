/**
 * dsh-channel 行为测试：实例注册/心跳/发现、事件总线（幂等/TTL/三平面）、
 * 实例令牌校验、控制指令回环。
 */

import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ChannelService, EVENT_TTL_MS, isHostAgent, type Config } from '../src/index.ts'

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

describe('relay 接入（broker 底座）', () => {
  it('HMAC 签名与 dsh-agent-relay 协议一致（method\\npath\\nts\\nbody）', async () => {
    const { signRequest } = await import('../src/index.ts')
    // 与 vendored sign.js 对同一输入比对：secret/method/path/ts/body
    const secret = 'test-secret'
    const sig = signRequest(secret, 'POST', '/register', 1787372832, '{"agent":"web2"}')
    // 用 vendored 的签名实现交叉验证
    const { createHmac } = await import('node:crypto')
    const expected = createHmac('sha256', secret)
      .update(`POST\n/register\n1787372832\n{"agent":"web2"}`)
      .digest('hex')
    expect(sig).toBe(expected)
  })

  it('配置 relay 后启动即保活注册（POST /register 带签名头）', async () => {
    const calls: Array<{ url: string; method: string; headers: Record<string, string>; body: string }> = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: { method?: string; headers?: Record<string, string>; body?: string }) => {
      calls.push({ url, method: init.method ?? 'GET', headers: init.headers ?? {}, body: init.body ?? '' })
      return new Response('{}', { status: 200 })
    }))
    const ch = boot({
      tokens: {},
      relay: { brokerUrl: 'http://127.0.0.1:19121', agent: 'web2', secret: 's' },
    })
    // 等待异步注册
    await new Promise((r) => setTimeout(r, 20))
    expect(calls.length).toBeGreaterThan(0)
    const reg = calls[0]
    expect(reg.url).toBe('http://127.0.0.1:19121/register')
    expect(reg.method).toBe('POST')
    expect(JSON.parse(reg.body)).toEqual({ agent: 'web2' })
    expect(reg.headers['x-relay-agent']).toBe('web2')
    expect(reg.headers['x-relay-signature']).toBeTruthy()
    vi.unstubAllGlobals()
    ch[Symbol.dispose]?.()
  })

  it('broker peers 不填充实例表（去 broker 化：发现权威源是管理端 launch/register）', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.endsWith('/peers')) {
        return new Response(JSON.stringify({ peers: [
          { agent: 'web3', online: true },
          { agent: 'web4', online: false },
        ] }), { status: 200 })
      }
      return new Response('{}', { status: 200 })
    }))
    const ch = boot({
      tokens: {},
      relay: { brokerUrl: 'http://x', agent: 'web2', secret: 's' },
    })
    // 等启动注册 + 手动触发一次周期任务（register + recv，无 peers 轮询）
    await new Promise((r) => setTimeout(r, 20))
    await (ch as unknown as { relayTick(): Promise<void> }).relayTick()
    expect(ch.get('web3')).toBeUndefined()
    expect(ch.get('web4')).toBeUndefined()
    vi.unstubAllGlobals()
    ch[Symbol.dispose]?.()
  })
})

describe('relay 控制指令跨实例', () => {
  it('sendControl 到远端（非本机 agent）经 broker POST /messages', async () => {
    const calls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: { method?: string; body?: string }) => {
      calls.push(`${init.method} ${url} ${init.body ?? ''}`)
      return new Response('{}', { status: 200 })
    }))
    const ch = boot({
      tokens: {},
      relay: { brokerUrl: 'http://x', agent: 'web2', secret: 's' },
    })
    ch.onControl(() => {})
    ch.sendControl('web3', { type: 'restart-request', payload: { reason: 'test' } })
    await new Promise((r) => setTimeout(r, 20))
    const sent = calls.find((c) => c.startsWith('POST http://x/messages'))
    expect(sent).toBeTruthy()
    const msg = JSON.parse(sent!.slice(sent!.indexOf('{') || 0))
    expect(msg.to).toBe('web3')
    expect(msg.kind).toBe('request')
    expect(msg.body.command.type).toBe('restart-request')
    vi.unstubAllGlobals()
  })

  it('sendControl 到本机 agent 名走进程内回环', () => {
    const ch = boot({
      tokens: {},
      relay: { brokerUrl: 'http://x', agent: 'web2', secret: 's' },
    })
    const got: string[] = []
    ch.onControl((cmd, from) => { got.push(`${cmd.type}:${from}`) })
    ch.sendControl('web2', { type: 'ping' })
    expect(got).toEqual(['ping:web2'])
  })

  it('recv 控制指令消息触发 onControl（from 为发送方）', async () => {
    // 启动即 recv（constructor 首轮消费积压）——mock 有状态：首轮返回消息，
    // 之后返回空（模拟游标推进），避免同一条消息被重复处理。
    let recvCount = 0
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/messages?since=')) {
        recvCount++
        if (recvCount === 1) {
          return new Response(JSON.stringify({
            messages: [
              { id: 'm1', from: 'web2', type: 'control', body: { command: { id: 'c1', type: 'restart-approved', payload: {} } } },
              { id: 'm2', from: 'web2', type: 'message', body: {} },
            ],
            cursor: 'cur-1',
          }), { status: 200 })
        }
        return new Response(JSON.stringify({ messages: [], cursor: 'cur-1' }), { status: 200 })
      }
      return new Response('{}', { status: 200 })
    }))
    const ch = boot({
      tokens: {},
      relay: { brokerUrl: 'http://x', agent: 'web3', secret: 's' },
    })
    const got: string[] = []
    ch.onControl((cmd, from) => { got.push(`${cmd.type}:${from}`) })
    // 等待启动首轮 recv 完成
    await new Promise((r) => setTimeout(r, 30))
    expect(got).toEqual(['restart-approved:web2'])
    expect((ch as unknown as { relaySince: string }).relaySince).toBe('cur-1')
    vi.unstubAllGlobals()
  })
})

describe('主机守护识别（isHostAgent）', () => {
  it('host<数字> 识别为守护；其他不是', () => {
    expect(isHostAgent('host1')).toBe(true)
    expect(isHostAgent('host12')).toBe(true)
    expect(isHostAgent('web2')).toBe(false)
    expect(isHostAgent('host-lab1')).toBe(false)
    expect(isHostAgent('host')).toBe(false)
  })
})

describe('relay 游标持久化（stateFile）', () => {
  it('recv 后游标落盘，重启后从文件恢复（不再重读积压）', async () => {
    const stateFile = join(tmpdir(), `dsh-relay-state-${Date.now()}-${Math.random().toString(36).slice(2)}.json`)
    const seenUrls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      seenUrls.push(url)
      if (url.includes('/messages?since=')) {
        return new Response(JSON.stringify({ messages: [], cursor: 'cur-9' }), { status: 200 })
      }
      return new Response('{}', { status: 200 })
    }))
    // 第一轮：消费后游标写盘
    const ch1 = boot({ tokens: {}, relay: { brokerUrl: 'http://x', agent: 'web3', secret: 's', stateFile } })
    await (ch1 as unknown as { relayRecvControls(): Promise<void> }).relayRecvControls()
    expect(existsSync(stateFile)).toBe(true)
    expect(JSON.parse(readFileSync(stateFile, 'utf8'))).toEqual({ since: 'cur-9' })
    // 第二轮：新实例从文件恢复游标，recv 带 since=cur-9
    const ch2 = boot({ tokens: {}, relay: { brokerUrl: 'http://x', agent: 'web3', secret: 's', stateFile } })
    expect((ch2 as unknown as { relaySince: string }).relaySince).toBe('cur-9')
    seenUrls.length = 0
    await (ch2 as unknown as { relayRecvControls(): Promise<void> }).relayRecvControls()
    expect(seenUrls.some((u) => u.includes('since=cur-9'))).toBe(true)
    vi.unstubAllGlobals()
    rmSync(stateFile, { force: true })
  })

  it('未配置 stateFile 时游标保持内存态（不回退）', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/messages?since=')) {
        return new Response(JSON.stringify({ messages: [], cursor: 'cur-5' }), { status: 200 })
      }
      return new Response('{}', { status: 200 })
    }))
    const ch = boot({ tokens: {}, relay: { brokerUrl: 'http://x', agent: 'web3', secret: 's' } })
    await (ch as unknown as { relayRecvControls(): Promise<void> }).relayRecvControls()
    expect((ch as unknown as { relaySince: string }).relaySince).toBe('cur-5')
    vi.unstubAllGlobals()
  })
})

describe('callRemote 直连（请求-响应，broker 仅兜底）', () => {
  it('直连成功：解析 server-response 业务结果', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      type: 'server-response', rpcId: 'x',
      result: { ok: true, value: { ok: true } },
    }), { status: 200 })))
    const ch = boot({ tokens: {} })
    ch.declare({ id: 'web3', name: 'web3', addr: 'http://127.0.0.1:3083', status: 'online' })
    const r = await ch.callRemote('web3', { namespace: 'console', method: 'listInstances', args: {} }, 5000)
    expect(r).toEqual({ ok: true, value: { ok: true } })
    vi.unstubAllGlobals()
  })

  it('业务 4xx（带 server-response 信封）不降级重发', async () => {
    const messages: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: { method?: string; body?: string }) => {
      if (String(url).includes('/api/')) {
        // 目标已处理：业务失败 → HTTP 400 + server-response 信封（业务结果）
        return new Response(JSON.stringify({
          type: 'server-response', rpcId: 'x',
          result: { ok: false, error: { code: 'control-error', message: '实例不在清单', details: {} } },
        }), { status: 400 })
      }
      messages.push(`${init?.method} ${url}`)
      return new Response('{}', { status: 200 })
    }))
    const ch = boot({ tokens: {}, relay: { brokerUrl: 'http://x', agent: 'web2', secret: 's' } })
    ch.declare({ id: 'web3', name: 'web3', addr: 'http://127.0.0.1:3083', status: 'online' })
    const r = await ch.callRemote('web3', { namespace: 'console', method: 'controlInstance', args: { instanceId: 'x', command: 'stop', payload: {} } }, 5000)
    expect(r.ok).toBe(false)
    expect((r as { error: { message: string } }).error.message).toBe('实例不在清单')
    // 未降级重发（无 POST /messages 投递；?since= 是启动 recv 轮询，非投递）
    expect(messages.some((m) => m.startsWith('POST') && m.includes('/messages'))).toBe(false)
    vi.unstubAllGlobals()
  })

  it('直连传输失败（网络错误）→ 降级 broker 兜底投递', async () => {
    const messages: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: { method?: string; body?: string }) => {
      if (String(url).includes('/api/')) throw new Error('ECONNREFUSED')
      messages.push(`${init?.method} ${url}`)
      return new Response('{}', { status: 200 })
    }))
    const ch = boot({ tokens: {}, relay: { brokerUrl: 'http://x', agent: 'web2', secret: 's' } })
    ch.declare({ id: 'web3', name: 'web3', addr: 'http://127.0.0.1:3083', status: 'online' })
    // 降级投递后无回执（broker 帧异步回执）→ 超时 reject，吸收即可
    const p = ch.callRemote('web3', { namespace: 'console', method: 'listInstances', args: {} }, 500)
    p.catch(() => { /* 超时预期 */ })
    await new Promise((r) => setTimeout(r, 30))
    expect(messages.some((m) => m.includes('/messages'))).toBe(true)
    vi.unstubAllGlobals()
  })

  it('无 relay 时直连失败 → 降级抛"relay 未配置"', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED') }))
    const ch = boot({ tokens: {} })
    ch.declare({ id: 'web3', name: 'web3', addr: 'http://127.0.0.1:3083', status: 'online' })
    await expect(ch.callRemote('web3', { namespace: 'console', method: 'listInstances', args: {} }, 500))
      .rejects.toThrow('relay 未配置')
    vi.unstubAllGlobals()
  })
})
