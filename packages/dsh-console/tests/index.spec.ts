/**
 * dsh-console 行为测试：主机/实例档案、生命周期编排（指令回环）、
 * inbox（系统事件消息，按 owner 隔离）。
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import ChannelService from 'dsh-channel'
import ConsoleService, { type InstanceRecord } from '../src/index.ts'

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

  it('deployInstance 登记档案并下发 deploy 指令', async () => {
    const ctx = await boot()
    const received: Array<{ type: string; payload: unknown }> = []
    ctx.channel.onControl((cmd) => received.push({ type: cmd.type, payload: cmd.payload }))
    ctx.console.deployInstance(RECORD)
    expect(ctx.console.getInstanceRecord('instA')?.version).toBe('0.0.0')
    expect(received[0].type).toBe('deploy')
    expect((received[0].payload as { instanceId: string }).instanceId).toBe('instA')
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
