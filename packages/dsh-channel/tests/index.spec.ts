/**
 * dsh-channel 行为测试：实例注册/心跳/发现、事件总线（幂等/TTL/三平面）、
 * 实例令牌校验、控制指令回环、多机（hub 注册/台账派发/worker 出站回路）。
 */

import { describe, expect, it, vi } from 'vitest'
import { instanceIdFromEnv } from '../src/index.ts'
import { Context } from '@deepseek-ai/cordis'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ChannelService, EVENT_TTL_MS, MAX_WORKER_INSTANCES, hostAgentId, isHostAgent, type Config } from '../src/index.ts'

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



describe('主机守护识别（isHostAgent / hostAgentId）', () => {
  it('规范形态 host-<id>（id 为字符串）识别为守护；旧形态 host<数字> 兼容；其他不是', () => {
    expect(isHostAgent('host-1')).toBe(true)
    expect(isHostAgent('host-lab1')).toBe(true)
    expect(isHostAgent('host1')).toBe(true) // 旧形态兼容
    expect(isHostAgent('web2')).toBe(false)
    expect(isHostAgent('host')).toBe(false)
    expect(isHostAgent('host-')).toBe(false) // 空 id 不算守护
  })

  it('hostAgentId 归一化：任意字符串 id → host-<id>；已规范/旧形态原样', () => {
    expect(hostAgentId('1')).toBe('host-1')
    expect(hostAgentId('lab1')).toBe('host-lab1')
    expect(hostAgentId('host-1')).toBe('host-1')
    expect(hostAgentId('host1')).toBe('host1')
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
    const ch = boot({ tokens: {}, })
    ch.declare({ id: 'web3', name: 'web3', addr: 'http://127.0.0.1:3083', status: 'online' })
    const r = await ch.callRemote('web3', { namespace: 'console', method: 'controlInstance', args: { instanceId: 'x', command: 'stop', payload: {} } }, 5000)
    expect(r.ok).toBe(false)
    expect((r as { error: { message: string } }).error.message).toBe('实例不在清单')
    // 未降级重发（无 POST /messages 投递；?since= 是启动 recv 轮询，非投递）
    expect(messages.some((m) => m.startsWith('POST') && m.includes('/messages'))).toBe(false)
    vi.unstubAllGlobals()
  })
})

/** 轮询等待条件成立（真实计时，超时抛错）。 */
async function until(cond: () => boolean, timeoutMs = 3000, label = 'condition'): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (cond()) return
    await new Promise((r) => setTimeout(r, 10))
  }
  throw new Error(`until: ${label} 未在 ${timeoutMs}ms 内成立`)
}

/** 把 hub 的三条路由挂到真实 http server 上（绕开官方 webServer 注入）。 */
async function startHubServer(hub: ChannelService): Promise<{ url: string; close: () => Promise<void> }> {
  const svc = hub as unknown as {
    handleHubRegister(req: IncomingMessage, res: ServerResponse): Promise<void>
    handleHubCommands(req: IncomingMessage, res: ServerResponse): Promise<void>
    handleHubResult(req: IncomingMessage, res: ServerResponse): Promise<void>
  }
  const server = createServer((req, res) => {
    const path = new URL(req.url ?? '/', 'http://localhost').pathname
    if (path === '/api/channel/register') return void svc.handleHubRegister(req, res)
    if (path === '/api/channel/commands') return void svc.handleHubCommands(req, res)
    if (path === '/api/channel/result') return void svc.handleHubResult(req, res)
    res.writeHead(404, { 'content-type': 'application/json' })
    res.end('{"ok":false}')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as AddressInfo).port
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  }
}

describe('多机：hub 注册（默认 deny / 归属冲突）', () => {
  it('未登记的 id 拒绝注册（默认 deny）', () => {
    const hub = boot({ mode: 'hub', tokens: { host1: 'tok-1' } })
    const ack = hub.registerWorker({ id: 'host2', instances: [] }, 'tok-2')
    expect(ack.ok).toBe(false)
    expect(ack.error).toContain('not registered')
    expect(hub.registeredWorkers()).toEqual([])
  })

  it('令牌不匹配拒绝注册', () => {
    const hub = boot({ mode: 'hub', tokens: { host1: 'tok-1' } })
    expect(hub.registerWorker({ id: 'host1', instances: [] }, 'wrong').error).toBe('token mismatch')
  })

  it('注册写入实例表与归属，状态按上报值', () => {
    const hub = boot({ mode: 'hub', tokens: { host1: 'tok-1' } })
    const ack = hub.registerWorker({ id: 'host1', instances: [
      { id: 'web3', status: 'online' },
      { id: 'web4', status: 'offline' },
    ] }, 'tok-1')
    expect(ack.ok).toBe(true)
    expect(hub.get('host1')?.status).toBe('online')
    expect(hub.get('web3')?.status).toBe('online')
    expect(hub.get('web4')?.status).toBe('offline')
    expect(hub.hostOf('web3')).toBe('host1')
  })

  it('归属冲突：他机声明已归属实例被逐个拒绝，其余照常受理', () => {
    const hub = boot({ mode: 'hub', tokens: { host1: 'tok-1', host2: 'tok-2' } })
    hub.registerWorker({ id: 'host1', instances: [{ id: 'web3', status: 'online' }] }, 'tok-1')
    const ack = hub.registerWorker({ id: 'host2', instances: [
      { id: 'web3', status: 'online' },
      { id: 'web5', status: 'online' },
    ] }, 'tok-2')
    expect(ack.ok).toBe(true)
    expect(ack.rejected).toEqual([{ id: 'web3', reason: 'already hosted by host1' }])
    expect(hub.hostOf('web3')).toBe('host1')
    expect(hub.hostOf('web5')).toBe('host2')
  })

  it('非法 id 与超量上报被拒', () => {
    const hub = boot({ mode: 'hub', tokens: { host1: 'tok-1' } })
    const many = Array.from({ length: MAX_WORKER_INSTANCES + 1 }, (_, i) => ({ id: `web${i}`, status: 'online' as const }))
    const ack = hub.registerWorker({ id: 'host1', instances: [{ id: '../etc/passwd', status: 'online' }, ...many] }, 'tok-1')
    expect(ack.rejected?.some((r) => r.id === '../etc/passwd')).toBe(true)
    expect(ack.rejected?.some((r) => r.id === '(truncated)')).toBe(true)
  })
})

describe('多机：指令台账与派发契约', () => {
  it('sendControl 在 hub 模式下对未注册目标显式失败（不静默丢弃）', () => {
    const hub = boot({ mode: 'hub', tokens: { host1: 'tok-1' } })
    const r = hub.sendControl('host1', { type: 'restart', payload: {} })
    expect(r.ok).toBe(false)
    expect(r.error).toContain('未注册')
  })

  it('入队后进入台账；回执落 done（幂等重复回执不覆盖）', () => {
    const hub = boot({ mode: 'hub', tokens: { host1: 'tok-1' } })
    hub.registerWorker({ id: 'host1', instances: [] }, 'tok-1')
    const r = hub.enqueueCommand('host1', { type: 'start', payload: { instanceId: 'web3' } })
    expect(r.ok).toBe(true)
    expect(hub.commandStatus(r.commandId!)?.status).toBe('pending')
    expect(hub.completeCommand(r.commandId!, { ok: true })).toBe(true)
    expect(hub.commandStatus(r.commandId!)?.status).toBe('done')
    // 重复回执：返回命中但不覆盖首个结果
    expect(hub.completeCommand(r.commandId!, { ok: false, error: 'late' })).toBe(true)
    expect(hub.commandStatus(r.commandId!)?.result).toEqual({ ok: true })
    // 未知 id
    expect(hub.completeCommand('nope', { ok: true })).toBe(false)
  })

  it('租约到期后同一指令重新可派发（at-least-once）', () => {
    const hub = boot({ mode: 'hub', tokens: { host1: 'tok-1' }, commandLeaseMs: 20 })
    hub.registerWorker({ id: 'host1', instances: [] }, 'tok-1')
    hub.enqueueCommand('host1', { type: 'stop', payload: {} })
    const claim = hub as unknown as { claimCommands(id: string): Array<{ id: string }> }
    expect(claim.claimCommands('host1')).toHaveLength(1)
    // 租约内不重复派发
    expect(claim.claimCommands('host1')).toHaveLength(0)
    return new Promise<void>((resolve) => setTimeout(() => {
      expect(claim.claimCommands('host1')).toHaveLength(1)
      resolve()
    }, 30))
  })

  it('台账落盘后新实例可恢复未完成指令（重启不丢）', () => {
    const file = join(tmpdir(), `dsh-channel-ledger-${Date.now()}-${Math.random().toString(36).slice(2)}.json`)
    const hub1 = boot({ mode: 'hub', tokens: { host1: 'tok-1' }, ledgerFile: file })
    hub1.registerWorker({ id: 'host1', instances: [] }, 'tok-1')
    const r = hub1.enqueueCommand('host1', { type: 'restart', payload: { instanceId: 'web3' } })
    const hub2 = new ChannelService(new Context(), {
      tokens: { host1: 'tok-1' }, heartbeatTimeoutMs: 30_000, mode: 'hub', ledgerFile: file,
    })
    expect(hub2.commandStatus(r.commandId!)?.status).toBe('pending')
    expect(hub2.commandStatus(r.commandId!)?.command.type).toBe('restart')
    rmSync(file, { force: true })
  })
})

describe('多机：worker 出站回路（真 HTTP 端到端）', () => {
  it('注册 → 长轮询取指令 → 本地执行 → 回执进台账', async () => {
    const hub = boot({ mode: 'hub', tokens: { host1: 'tok-1' }, pollWaitMs: 500, heartbeatTimeoutMs: 30_000 })
    const server = await startHubServer(hub)
    const worker = new ChannelService(new Context(), {
      tokens: {}, heartbeatTimeoutMs: 30_000, mode: 'worker', id: 'host1', token: 'tok-1',
      console: server.url, pollWaitMs: 500, registerIntervalMs: 200,
    })
    worker.setWorkerReport(() => [{ id: 'web3', status: 'online' }])
    const received: string[] = []
    worker.onControl((cmd) => received.push(cmd.type))
    try {
      await until(() => hub.registeredWorkers().some((w) => w.id === 'host1'), 3000, 'worker 注册')
      await until(() => hub.hostOf('web3') === 'host1', 3000, '实例归属上报')
      const r = hub.enqueueCommand('host1', { type: 'restart', payload: { instanceId: 'web3' } })
      expect(r.ok).toBe(true)
      await until(() => received.includes('restart'), 3000, '指令送达 worker')
      await until(() => hub.commandStatus(r.commandId!)?.status === 'done', 3000, '回执进台账')
    } finally {
      worker[Symbol.dispose]?.()
      await server.close()
    }
  })

  it('路由鉴权：缺头 401、未登记 403、令牌错 401', async () => {
    const hub = boot({ mode: 'hub', tokens: { host1: 'tok-1' } })
    const server = await startHubServer(hub)
    try {
      const post = (headers: Record<string, string>): Promise<Response> =>
        fetch(`${server.url}/api/channel/register`, { method: 'POST', headers, body: JSON.stringify({ id: 'host1', instances: [] }) })
      expect((await post({ 'content-type': 'application/json' })).status).toBe(401)
      expect((await post({ 'content-type': 'application/json', 'x-instance-id': 'host9', 'x-instance-token': 'x' })).status).toBe(403)
      expect((await post({ 'content-type': 'application/json', 'x-instance-id': 'host1', 'x-instance-token': 'wrong' })).status).toBe(401)
      expect((await post({ 'content-type': 'application/json', 'x-instance-id': 'host1', 'x-instance-token': 'tok-1' })).status).toBe(200)
    } finally {
      await server.close()
    }
  })

  it('回执归属校验：他机指令 id 被拒 403', async () => {
    const hub = boot({ mode: 'hub', tokens: { host1: 'tok-1', host2: 'tok-2' } })
    hub.registerWorker({ id: 'host1', instances: [] }, 'tok-1')
    hub.registerWorker({ id: 'host2', instances: [] }, 'tok-2')
    const r = hub.enqueueCommand('host1', { type: 'stop', payload: {} })
    const server = await startHubServer(hub)
    try {
      const res = await fetch(`${server.url}/api/channel/result`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-instance-id': 'host2', 'x-instance-token': 'tok-2' },
        body: JSON.stringify({ commandId: r.commandId, ok: true }),
      })
      expect(res.status).toBe(403)
      expect(hub.commandStatus(r.commandId!)?.status).not.toBe('done')
    } finally {
      await server.close()
    }
  })
})

describe('多机：worker 回执真实结果（handler 结果 → 台账）', () => {
  it('handler 返回 ok=false → 台账 failed 且带原因', async () => {
    const hub = boot({ mode: 'hub', tokens: { host1: 'tok-1' }, pollWaitMs: 300 })
    const server = await startHubServer(hub)
    const worker = new ChannelService(new Context(), {
      tokens: {}, heartbeatTimeoutMs: 30_000, mode: 'worker', id: 'host1', token: 'tok-1',
      console: server.url, pollWaitMs: 300, registerIntervalMs: 200,
    })
    worker.onControl(() => ({ ok: false, error: '实例有操作进行中（busy）' }))
    try {
      await until(() => hub.registeredWorkers().some((w) => w.id === 'host1'), 3000, 'worker 注册')
      const r = hub.enqueueCommand('host1', { type: 'start', payload: { instanceId: 'web3' } })
      await until(() => hub.commandStatus(r.commandId!)?.status === 'failed', 3000, '失败回执')
      expect(hub.commandStatus(r.commandId!)?.result).toEqual({ ok: false, error: '实例有操作进行中（busy）' })
    } finally {
      worker[Symbol.dispose]?.()
      await server.close()
    }
  })

  it('handler 抛错 → 台账 failed（消息为抛错原因）', async () => {
    const hub = boot({ mode: 'hub', tokens: { host1: 'tok-1' }, pollWaitMs: 300 })
    const server = await startHubServer(hub)
    const worker = new ChannelService(new Context(), {
      tokens: {}, heartbeatTimeoutMs: 30_000, mode: 'worker', id: 'host1', token: 'tok-1',
      console: server.url, pollWaitMs: 300, registerIntervalMs: 200,
    })
    worker.onControl(() => { throw new Error('磁盘满') })
    try {
      await until(() => hub.registeredWorkers().some((w) => w.id === 'host1'), 3000, 'worker 注册')
      const r = hub.enqueueCommand('host1', { type: 'stop', payload: { instanceId: 'web3' } })
      await until(() => hub.commandStatus(r.commandId!)?.status === 'failed', 3000, '抛错回执')
      expect(hub.commandStatus(r.commandId!)?.result?.error).toContain('磁盘满')
    } finally {
      worker[Symbol.dispose]?.()
      await server.close()
    }
  })

  it('handler 返回非结果值（如 Array.push 的长度）→ 视为已受理', async () => {
    const hub = boot({ mode: 'hub', tokens: { host1: 'tok-1' }, pollWaitMs: 300 })
    const server = await startHubServer(hub)
    const worker = new ChannelService(new Context(), {
      tokens: {}, heartbeatTimeoutMs: 30_000, mode: 'worker', id: 'host1', token: 'tok-1',
      console: server.url, pollWaitMs: 300, registerIntervalMs: 200,
    })
    const seen: string[] = []
    worker.onControl((cmd) => seen.push(cmd.type))
    try {
      await until(() => hub.registeredWorkers().some((w) => w.id === 'host1'), 3000, 'worker 注册')
      const r = hub.enqueueCommand('host1', { type: 'restart', payload: { instanceId: 'web3' } })
      await until(() => hub.commandStatus(r.commandId!)?.status === 'done', 3000, '已受理回执')
      expect(seen).toEqual(['restart'])
      expect(hub.commandStatus(r.commandId!)?.result).toEqual({ ok: true, detail: '已受理' })
    } finally {
      worker[Symbol.dispose]?.()
      await server.close()
    }
  })

  it('审计：入队记录 actor，落盘后仍可查', () => {
    const file = join(tmpdir(), `dsh-channel-ledger-actor-${Date.now()}.json`)
    const hub = boot({ mode: 'hub', tokens: { host1: 'tok-1' }, ledgerFile: file })
    hub.registerWorker({ id: 'host1', instances: [] }, 'tok-1')
    const r = hub.enqueueCommand('host1', { type: 'restart', payload: {} }, 'alice')
    expect(hub.commandStatus(r.commandId!)?.actor).toBe('alice')
    const restored = new ChannelService(new Context(), {
      tokens: { host1: 'tok-1' }, heartbeatTimeoutMs: 30_000, mode: 'hub', ledgerFile: file,
    })
    expect(restored.commandStatus(r.commandId!)?.actor).toBe('alice')
    rmSync(file, { force: true })
  })

  it('版本上报：注册载荷的 version 进实例表', () => {
    const hub = boot({ mode: 'hub', tokens: { host1: 'tok-1' } })
    hub.registerWorker({
      id: 'host1',
      version: '0.1.2-rc.1',
      instances: [{ id: 'web3', status: 'online', version: '0.1.2-rc.1' }],
    }, 'tok-1')
    expect(hub.get('host1')?.version).toBe('0.1.2-rc.1')
    expect(hub.get('web3')?.version).toBe('0.1.2-rc.1')
  })
})

describe('实例 id 的 env 载体：新名 DSH_CHANNEL_ID 优先、旧名 DSH_RELAY_AGENT 兼容读', () => {
  it('新名优先；只有旧名时回落；都为空 → undefined', () => {
    expect(instanceIdFromEnv({ DSH_CHANNEL_ID: 'new-id', DSH_RELAY_AGENT: 'old-id' })).toBe('new-id')
    expect(instanceIdFromEnv({ DSH_RELAY_AGENT: 'old-id' })).toBe('old-id')
    expect(instanceIdFromEnv({ DSH_CHANNEL_ID: '' , DSH_RELAY_AGENT: 'old-id' })).toBe('old-id')
    expect(instanceIdFromEnv({})).toBe(undefined)
    expect(instanceIdFromEnv({ DSH_CHANNEL_ID: '' })).toBe(undefined)
  })
})

describe('broker 退场（批 5）：公共面已删净', () => {
  it('channel 不再暴露 brokerStatus（不留传输后端扩展点，多机走 hub/worker）', () => {
    const ch = boot({})
    expect((ch as unknown as Record<string, unknown>).brokerStatus).toBe(undefined)
  })
})

describe('本地回环回传执行结论（批 6b）：区分"已下发"与"被拒"', () => {
  it('同步 handler 返回 ok:false → 派发结果带 outcome 且可判失败', () => {
    const ch = boot({})
    ch.onControl(() => ({ ok: false, error: '版本不在池' }))
    const r = ch.sendControl('instA', { type: 'deploy', payload: { instanceId: 'instA' } })
    expect(r.ok).toBe(true) // 派发本身成功
    expect(r.outcome?.ok).toBe(false) // 但执行结论是失败
    expect(r.outcome?.error).toBe('版本不在池')
  })

  it('异步 handler（返回 Promise）不阻塞派发：outcome 留空，结论走台账', () => {
    const ch = boot({})
    ch.onControl(async () => ({ ok: false, error: '稍后才知道' }))
    const r = ch.sendControl('instA', { type: 'stop', payload: { instanceId: 'instA' } })
    expect(r.ok).toBe(true)
    expect(r.outcome).toBe(undefined)
  })
})
