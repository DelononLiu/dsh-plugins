/**
 * dsh-user 行为测试：身份解析（静态配置/网关注入/匿名）与实例授权。
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { UserService, type Config } from '../src/index.ts'
import { isTrustedGatewayRequest } from '../src/gateway-resolver.ts'

function boot(config: Partial<Config> = {}): UserService {
  const ctx = new Context()
  return new UserService(ctx, {
    users: [],
    gatewayHeaders: { userId: 'x-dsh-user-id', userRoles: 'x-dsh-user-roles' },
    gatewayCookie: { cookieName: 'dsh_gw_sid', secretFile: '', hmacSecret: '' },
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

describe('gatewayCookie：dsh_gw_sid 验签解析', () => {
  const SECRET = 'test-secret-32-bytes-xxxxxxxxxxxx'
  const users = [{ id: 'alice', name: 'Alice', roles: ['admin'] }]

  /** 经可信网关的请求头（gateway 注入 x-forwarded-proto: https）。 */
  const gwHeaders = (cookie: string): Record<string, string> => ({ cookie, 'x-forwarded-proto': 'https' })

  /** 构造 gateway 格式 cookie（与 clarknu/dsh-gateway auth.js 同算法：签名用解码后的载荷文本）。 */
  function makeCookie(username: string, expMs: number, secret = SECRET): string {
    const { createHmac } = require('node:crypto') as typeof import('node:crypto')
    const rawPayload = JSON.stringify({ u: username, exp: expMs })
    const payload = Buffer.from(rawPayload, 'utf8').toString('base64url')
    const sig = createHmac('sha256', secret).update(rawPayload).digest('base64url')
    return `dsh_gw_sid=${payload}.${sig}`
  }

  it('有效 cookie → 已知用户（角色对齐）', () => {
    const svc = boot({ users, gatewayCookie: { cookieName: 'dsh_gw_sid', secretFile: '', hmacSecret: SECRET } })
    const user = svc.current(gwHeaders(makeCookie('alice', Date.now() + 3600_000)))
    expect(user).toEqual({ id: 'alice', name: 'Alice', roles: ['admin'] })
  })

  it('有效 cookie 未知用户名 → guest', () => {
    const svc = boot({ users, gatewayCookie: { cookieName: 'dsh_gw_sid', secretFile: '', hmacSecret: SECRET } })
    const user = svc.current(gwHeaders(makeCookie('bob', Date.now() + 3600_000)))
    expect(user).toEqual({ id: 'bob', name: 'bob', roles: ['guest'] })
  })

  it('HTTP 直连（无 x-forwarded-proto: https）→ 不接受 cookie（防重放/CSRF）', () => {
    const svc = boot({ users, gatewayCookie: { cookieName: 'dsh_gw_sid', secretFile: '', hmacSecret: SECRET } })
    // 即使带有效 cookie，无可信网关头 → 拒绝（回退静态）
    const user = svc.current({ cookie: makeCookie('alice', Date.now() + 3600_000) })
    expect(user).toEqual({ id: 'alice', name: 'Alice', roles: ['admin'] }) // 静态回退而非 cookie 解析
  })

  it('过期 cookie → 拒绝（回退静态配置 alice）', () => {
    const svc = boot({ users, gatewayCookie: { cookieName: 'dsh_gw_sid', secretFile: '', hmacSecret: SECRET } })
    const user = svc.current(gwHeaders(makeCookie('alice', Date.now() - 1000)))
    expect(user).toEqual({ id: 'alice', name: 'Alice', roles: ['admin'] }) // 静态回退
  })

  it('伪造签名 → 拒绝（回退静态配置 alice）', () => {
    const svc = boot({ users, gatewayCookie: { cookieName: 'dsh_gw_sid', secretFile: '', hmacSecret: SECRET } })
    const good = makeCookie('alice', Date.now() + 3600_000)
    const forged = `${good}evil` // 篡改签名
    const user = svc.current(gwHeaders(forged))
    expect(user).toEqual({ id: 'alice', name: 'Alice', roles: ['admin'] }) // 静态回退
  })

  it('无 hmacSecret 配置 → 不启用 cookie 解析', () => {
    const svc = boot({ users, gatewayCookie: { cookieName: 'dsh_gw_sid', secretFile: '', hmacSecret: '' } })
    const user = svc.current(gwHeaders(makeCookie('alice', Date.now() + 3600_000)))
    expect(user).toEqual({ id: 'alice', name: 'Alice', roles: ['admin'] }) // 静态回退
  })

  it('secretFile 读 gateway state.json（绝对路径）', () => {
    const { writeFileSync, mkdirSync, rmSync } = require('node:fs') as typeof import('node:fs')
    const { tmpdir } = require('node:os') as typeof import('node:os')
    const { join } = require('node:path') as typeof import('node:path')
    const dir = join(tmpdir(), `dsh-user-test-${Date.now()}`)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'state.json'), JSON.stringify({ hmacSecret: SECRET }), 'utf8')
    try {
      const svc = boot({ users, gatewayCookie: { cookieName: 'dsh_gw_sid', secretFile: join(dir, 'state.json'), hmacSecret: '' } })
      const user = svc.current(gwHeaders(makeCookie('bob', Date.now() + 3600_000)))
      expect(user).toEqual({ id: 'bob', name: 'bob', roles: ['guest'] })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('secretFile 轮换后即时生效（gateway 一键吊销场景）', () => {
    const { writeFileSync, mkdirSync, rmSync } = require('node:fs') as typeof import('node:fs')
    const { tmpdir } = require('node:os') as typeof import('node:os')
    const { join } = require('node:path') as typeof import('node:path')
    const dir = join(tmpdir(), `dsh-user-test-${Date.now()}`)
    mkdirSync(dir, { recursive: true })
    const statePath = join(dir, 'state.json')
    writeFileSync(statePath, JSON.stringify({ hmacSecret: SECRET }), 'utf8')
    try {
      const svc = boot({ users, gatewayCookie: { cookieName: 'dsh_gw_sid', secretFile: statePath, hmacSecret: '' } })
      const oldCookie = makeCookie('alice', Date.now() + 3600_000) // 旧 secret 签发
      expect(svc.current(gwHeaders(oldCookie))).toEqual({ id: 'alice', name: 'Alice', roles: ['admin'] })
      // gateway 轮换 secret（一键吊销）→ 旧 cookie 立即失效（无需重启 dsh-user）
      const NEW_SECRET = 'rotated-secret-32-bytes-xxxxxxxx'
      writeFileSync(statePath, JSON.stringify({ hmacSecret: NEW_SECRET }), 'utf8')
      expect(svc.current(gwHeaders(oldCookie))).toEqual({ id: 'alice', name: 'Alice', roles: ['admin'] }) // 静态回退（旧 cookie 拒绝）
      // 新 secret 签发的 cookie 可用
      expect(svc.current(gwHeaders(makeCookie('alice', Date.now() + 3600_000, NEW_SECRET)))).toEqual({ id: 'alice', name: 'Alice', roles: ['admin'] })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('secretFile 不可读 → 回退 hmacSecret', () => {
    const svc = boot({ users, gatewayCookie: { cookieName: 'dsh_gw_sid', secretFile: '/nonexistent/state.json', hmacSecret: SECRET } })
    const user = svc.current(gwHeaders(makeCookie('alice', Date.now() + 3600_000)))
    expect(user).toEqual({ id: 'alice', name: 'Alice', roles: ['admin'] })
  })
})

describe('isTrustedGatewayRequest：来源判断（登出显示依据）', () => {
  it('x-forwarded-proto: https（经网关）→ true', () => {
    expect(isTrustedGatewayRequest({ 'x-forwarded-proto': 'https' })).toBe(true)
  })

  it('HTTP 直连（无该头）→ false', () => {
    expect(isTrustedGatewayRequest({})).toBe(false)
    expect(isTrustedGatewayRequest(undefined)).toBe(false)
  })

  it('其他值（http/伪造）→ false', () => {
    expect(isTrustedGatewayRequest({ 'x-forwarded-proto': 'http' })).toBe(false)
  })
})
