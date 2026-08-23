/**
 * dsh-user 身份来源适配层：可插拔身份解析器（网关可替换的关键边界）。
 *
 * 身份令牌契约 = 网关签发、dsh-user 验签消费（JWT 标准化方向，RFC 7519）：
 * 任何网关只要认证后注入可验签的令牌，dsh-user 就能消费。当前社区
 * dsh 网关均不签发标准 JWT（clarknu/dsh-gateway 等为私有 cookie），
 * 故接口先行：`IdentityResolver` 是稳定边界，实现按网关各自适配。
 *
 * - `gateway-cookie` 实现：验 clarknu/dsh-gateway 的私有 cookie
 *   `dsh_gw_sid`（payload.签名，HMAC-SHA256 + 持久 hmacSecret）——不改
 *   vendor；将来接 APISIX 时新增 `jwt` 实现（验标准 JWT），dsh-user
 *   消费方与用户显示零改动。
 */

import { createHmac, timingSafeEqual } from 'node:crypto'
import type { User, UserRole } from './index'

/** 身份解析器接口（稳定边界）：从请求头解析当前用户；无法解析返回 undefined。 */
export interface IdentityResolver {
  /** 适配器名（诊断/日志用）。 */
  readonly name: string
  /**
   * 从请求头解析当前用户。
   * @param headers - 请求头（含网关 cookie 或注入的身份头）。
   * @returns 解析出的用户；无有效身份返回 undefined（由调用方回退静态配置）。
   */
  resolve(headers: Record<string, string | undefined> | undefined): User | undefined
}

/** 可验签令牌的通用结构（cookie 或 JWT 都满足：载荷 + 签名）。 */
export interface SignedToken {
  /** 载荷文本（cookie 为 JSON 文本；JWT 为 payload 段）。 */
  payload: string
  /** 签名（base64url）。 */
  signature: string
}

/**
 * 从原始 cookie 头中提取指定 cookie 的令牌。
 * @param cookieHeader - `Cookie: a=1; b=2` 原始头。
 * @param name - 目标 cookie 名。
 * @returns 令牌字符串；无则 undefined。
 */
export function parseCookieToken(cookieHeader: string | undefined, name: string): string | undefined {
  if (!cookieHeader) return undefined
  for (const part of cookieHeader.split(';')) {
    const trimmed = part.trim()
    const eq = trimmed.indexOf('=')
    if (eq <= 0) continue
    if (trimmed.slice(0, eq).trim() === name) return trimmed.slice(eq + 1).trim()
  }
  return undefined
}

/**
 * 解析 `payload.signature` 形式令牌（base64url 两段）。
 * @param token - 完整令牌。
 * @returns 载荷与签名；格式不符返回 undefined。
 */
export function splitSignedToken(token: string | undefined): SignedToken | undefined {
  if (!token) return undefined
  const dot = token.indexOf('.')
  if (dot <= 0 || dot === token.length - 1) return undefined
  return { payload: token.slice(0, dot), signature: token.slice(dot + 1) }
}

/** base64url 解码（容错：空串/非法返回 undefined）。 */
export function b64urlDecode(text: string): Buffer | undefined {
  if (text === '') return undefined
  try {
    return Buffer.from(text, 'base64url')
  } catch {
    return undefined
  }
}

/** 常量时间比较（签名验证防时序侧信道）。 */
export function safeEqual(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && timingSafeEqual(a, b)
}

/** gateway-cookie 适配器配置。 */
export interface GatewayCookieResolverConfig {
  /** 网关 cookie 名（clarknu/dsh-gateway 默认 `dsh_gw_sid`）。 */
  cookieName: string
  /** 会话签名密钥（gateway 持久 hmacSecret，`$DSH_HOME/gateway/state.json`）。 */
  hmacSecret: string
  /** 用户名 → 已知用户映射（gateway 账号与 dsh-user 用户表对齐；未知用户名构造 guest）。 */
  users: ReadonlyMap<string, User>
}

/**
 * clarknu/dsh-gateway cookie 验签实现：验 `dsh_gw_sid`（HMAC-SHA256）。
 * 与 gateway `auth.js` 的 verify 逻辑一致（payload.签名 + 过期校验 +
 * 用户存在性），不改 vendor——适配层复刻其验签算法。
 */
export class GatewayCookieResolver implements IdentityResolver {
  readonly name = 'gateway-cookie'

  constructor(private readonly config: GatewayCookieResolverConfig) {}

  resolve(headers: Record<string, string | undefined> | undefined): User | undefined {
    if (!headers) return undefined
    const token = parseCookieToken(headers.cookie, this.config.cookieName)
    const signed = splitSignedToken(token)
    if (!signed) return undefined
    const payloadBuf = b64urlDecode(signed.payload)
    if (!payloadBuf) return undefined
    const payloadText = payloadBuf.toString('utf8')
    // 验签：HMAC-SHA256(payload, secret)，常量时间比较
    const expected = createHmac('sha256', this.config.hmacSecret).update(payloadText).digest()
    const given = b64urlDecode(signed.signature)
    if (!given || !safeEqual(expected, given)) return undefined
    // 解析载荷 {u, exp}
    let data: { u?: unknown; exp?: unknown }
    try {
      data = JSON.parse(payloadText) as { u?: unknown; exp?: unknown }
    } catch {
      return undefined
    }
    if (typeof data.u !== 'string' || data.u === '') return undefined
    if (typeof data.exp !== 'number' || data.exp <= Date.now()) return undefined
    // 用户映射：已知用户（角色对齐）或未知用户名（guest 兜底）
    const known = this.config.users.get(data.u)
    if (known) return known
    return { id: data.u, name: data.u, roles: ['guest'] }
  }
}

/** 解析角色列表字符串（`admin,member` → UserRole[]），非法项过滤。 */
export function parseRolesHeader(value: string | undefined): UserRole[] | undefined {
  if (!value) return undefined
  const roles = value.split(',').map((r) => r.trim()).filter(isUserRole)
  return roles.length > 0 ? roles : undefined
}

function isUserRole(value: string): value is UserRole {
  return value === 'admin' || value === 'member' || value === 'guest'
}
