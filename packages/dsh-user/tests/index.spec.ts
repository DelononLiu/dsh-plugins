/**
 * dsh-user 行为测试：身份解析（静态配置/网关注入/匿名）与实例授权。
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { UserService, type Config } from '../src/index.ts'

function boot(config: Partial<Config> = {}): UserService {
  const ctx = new Context()
  return new UserService(ctx, {
    users: [],
    gatewayHeaders: { userId: 'x-dsh-user-id', userRoles: 'x-dsh-user-roles' },
    sharedAuth: {},
    ...config,
  })
}

describe('current：身份解析', () => {
  it('无配置回退匿名 guest', () => {
    const svc = boot()
    expect(svc.current()).toEqual({ id: 'anonymous', name: 'Guest', roles: ['guest'] })
  })

  it('静态配置回退第一个用户', () => {
    const svc = boot({
      users: [{ id: 'alice', name: 'Alice', roles: ['admin'] }],
    })
    expect(svc.current()).toEqual({ id: 'alice', name: 'Alice', roles: ['admin'] })
  })

  it('网关注入头优先（已知用户按 id 解析）', () => {
    const svc = boot({
      users: [{ id: 'alice', name: 'Alice', roles: ['admin'] }],
    })
    const user = svc.current({ 'x-dsh-user-id': 'alice' })
    expect(user).toEqual({ id: 'alice', name: 'Alice', roles: ['admin'] })
  })

  it('网关注入头解析未知用户并读角色头', () => {
    const svc = boot()
    const user = svc.current({
      'x-dsh-user-id': 'bob',
      'x-dsh-user-roles': 'member,guest',
    })
    expect(user).toEqual({ id: 'bob', name: 'bob', roles: ['member', 'guest'] })
  })

  it('角色头非法值被过滤，缺省 member', () => {
    const svc = boot()
    const user = svc.current({ 'x-dsh-user-id': 'bob', 'x-dsh-user-roles': 'admin,root' })
    expect(user.roles).toEqual(['admin'])
  })
})

describe('instanceAccess：实例授权', () => {
  const svc = boot({
    users: [
      { id: 'admin', name: 'Admin', roles: ['admin'] },
      { id: 'owner', name: 'Owner', roles: ['member'] },
      { id: 'reader', name: 'Reader', roles: ['member'] },
      { id: 'stranger', name: 'Stranger', roles: ['member'] },
    ],
    sharedAuth: {
      instA: { owner: 'full', reader: 'read' },
    },
  })

  it('admin 对所有实例全权', () => {
    expect(svc.instanceAccess('instB', { id: 'admin', name: 'Admin', roles: ['admin'] })).toBe('full')
  })

  it('shared 授权 full → full', () => {
    expect(svc.instanceAccess('instA', { id: 'owner', name: 'Owner', roles: ['member'] })).toBe('full')
  })

  it('shared 授权 read → read', () => {
    expect(svc.instanceAccess('instA', { id: 'reader', name: 'Reader', roles: ['member'] })).toBe('read')
  })

  it('未授权 → none', () => {
    expect(svc.instanceAccess('instA', { id: 'stranger', name: 'Stranger', roles: ['member'] })).toBe('none')
    expect(svc.instanceAccess('instB', { id: 'owner', name: 'Owner', roles: ['member'] })).toBe('none')
  })

  it('guest 无授权 → none', () => {
    expect(svc.instanceAccess('instA', { id: 'guest1', name: 'G', roles: ['guest'] })).toBe('none')
  })
})

describe('isOwner：归属判断', () => {
  const svc = boot({ sharedAuth: { instA: { alice: 'full' } } })

  it('sharedAuth full 视为归属者', () => {
    expect(svc.isOwner('instA', { id: 'alice', name: 'Alice', roles: ['member'] })).toBe(true)
  })

  it('admin 视为归属者', () => {
    expect(svc.isOwner('instB', { id: 'admin', name: 'Admin', roles: ['admin'] })).toBe(true)
  })

  it('未授权非归属者', () => {
    expect(svc.isOwner('instA', { id: 'bob', name: 'Bob', roles: ['member'] })).toBe(false)
  })
})
