/**
 * dsh-user：系统层·身份模型（用户/归属/授权基础）。
 *
 * 认证已拆走社区 dsh-gateway（登录/会话/鉴权执行）；本插件只负责
 * **身份模型**——用户是谁、归属、授权查询——供所有层消费（实例归属、
 * 实例访问、投递目标、部署授权）。身份来源可插拔（v1：静态配置 + 网关
 * 注入头解析；密钥对与 shared 公钥访问在 shared 访问实现时补充）。
 * @module dsh-user
 */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { GatewayCookieResolver, type IdentityResolver } from './gateway-resolver'

/** 角色三档（v1）：admin 全权 / member 自有实例全权 + shared 按授权 / guest 被授权实例只读。 */
export type UserRole = 'admin' | 'member' | 'guest'

/** 用户身份。id 跨实例一致（身份模型唯一定义于本插件）。 */
export interface User {
  /** 稳定用户 id。 */
  id: string
  /** 展示名。 */
  name: string
  /** 角色。 */
  roles: UserRole[]
}

/** 实例访问级别。 */
export type AccessLevel = 'full' | 'read' | 'none'

declare module '@deepseek-ai/cordis' {
  interface Context {
    user: UserService
  }
}

/** shared 授权条目：{userId: 级别}。 */
export interface SharedGrant {
  [userId: string]: 'read' | 'full'
}

/** 插件配置：静态用户列表 + 网关注入头名 + 网关 cookie 验签 + shared 实例授权映射。 */
export interface Config {
  /** 静态配置的用户列表（cordis.yml 可配；网关注入模式可留空）。 */
  users: Array<{ id: string; name: string; roles: UserRole[] }>
  /** 网关注入的身份头名（认证网关注入后，本插件按名解析）。 */
  gatewayHeaders: { userId: string; userRoles: string }
  /** gateway cookie 验签（clarknu/dsh-gateway 会话）：cookie 名 + 持久签名密钥。 */
  gatewayCookie: {
    /** 网关 cookie 名（默认 `dsh_gw_sid`）。 */
    cookieName: string
    /** 会话签名密钥（gateway 持久 hmacSecret，`$DSH_HOME/gateway/state.json`）。 */
    hmacSecret: string
  }
  /** shared 实例授权：{instanceId: {userId: 'read'|'full'}}——owner 授权映射。 */
  sharedAuth: Record<string, SharedGrant>
}

/** 运行时 schema（cordis 配置校验；`as z<Config>` 使类型与 schema 一致）。 */
export const Config = z.object({
  users: z.array(z.object({
    id: z.string().required(),
    name: z.string().default(''),
    roles: z.array(z.union(['admin', 'member', 'guest'] as const)).default(['member']),
  })).default([]),
  gatewayHeaders: z.object({
    userId: z.string().default('x-dsh-user-id'),
    userRoles: z.string().default('x-dsh-user-roles'),
  }).default({ userId: 'x-dsh-user-id', userRoles: 'x-dsh-user-roles' }),
  gatewayCookie: z.object({
    cookieName: z.string().default('dsh_gw_sid'),
    hmacSecret: z.string().default(''),
  }).default({ cookieName: 'dsh_gw_sid', hmacSecret: '' }),
  sharedAuth: z.dict(z.dict(z.union(['read', 'full'] as const))).default({}),
}) as z<Config>

/** 网关注入头结构（由网关层填充后调用 {@link UserService.current}）。 */
export interface GatewayIdentity {
  userId: string
  userRoles?: string
}

/**
 * 身份模型服务。所有插件经 `ctx.user` 查询当前用户与实例访问权限。
 */
export class UserService extends Service {
  /** 运行时配置 schema（cordis 加载时校验）。 */
  static Config = Config

  /** 配置中的用户表（按 id 索引）。 */
  private readonly byId = new Map<string, User>()

  /** 身份解析器链（可插拔：网关注入头 → 网关 cookie 验签 → …；空 = 未启用）。 */
  private readonly resolvers: IdentityResolver[]

  constructor(ctx: Context, private readonly config: Config) {
    super(ctx, 'user')
    for (const entry of config.users) {
      this.byId.set(entry.id, { id: entry.id, name: entry.name, roles: entry.roles })
    }
    // 网关 cookie 验签适配器（hmacSecret 配置才启用；不改 vendor——适配层复刻验签）。
    this.resolvers = config.gatewayCookie.hmacSecret !== ''
      ? [new GatewayCookieResolver({ cookieName: config.gatewayCookie.cookieName, hmacSecret: config.gatewayCookie.hmacSecret, users: this.byId })]
      : []
  }

  /**
   * 解析当前用户：优先网关注入头 → 网关 cookie 验签 → 回退静态配置。
   * 网关注入模式下，网关认证后把用户 id 写入 `gatewayHeaders.userId` 头；
   * 网关 cookie 模式（clarknu/dsh-gateway）验 `dsh_gw_sid` 签名取用户名。
   * @param headers - 请求头（含网关注入的身份头或网关 cookie）；缺省时回退静态配置。
   * @returns 当前用户；无法解析时返回 guest 匿名用户。
   */
  current(headers?: Record<string, string | undefined>): User {
    const injected = this.resolveFromHeaders(headers)
    if (injected) return injected
    for (const resolver of this.resolvers) {
      const user = resolver.resolve(headers)
      if (user) return user
    }
    const fallback = this.byId.values().next().value
    if (fallback) return fallback
    return { id: 'anonymous', name: 'Guest', roles: ['guest'] }
  }

  /**
   * 查询某实例的访问级别：admin 全权；owner 之外按 shared 授权映射；
   * member 对自有实例全权（v1 以 sharedAuth 中 'full' 表示）；否则 none。
   * @param instanceId - 目标实例 id。
   * @param user - 访问者（通常来自 {@link current}）。
   * @returns 访问级别：'full' 可管理 / 'read' 只读 / 'none' 无权限。
   */
  instanceAccess(instanceId: string, user: User): AccessLevel {
    if (user.roles.includes('admin')) return 'full'
    const granted = this.config.sharedAuth[instanceId]?.[user.id]
    if (granted === 'full') return 'full'
    if (granted === 'read') return 'read'
    return 'none'
  }

  /**
   * 是否某实例的归属者（v1：归属映射由 console 档案持有，本插件提供
   * 查询接口——owner 判断以 sharedAuth 存在性 + 角色兜底；完整归属
   * 见 console 档案的 owner 字段）。
   * @param instanceId - 目标实例 id。
   * @param user - 访问者。
   * @returns 是否为归属者。
   */
  isOwner(instanceId: string, user: User): boolean {
    return this.config.sharedAuth[instanceId]?.[user.id] === 'full' || user.roles.includes('admin')
  }

  /** 从网关注入头解析用户；头缺失或用户未知返回 undefined。 */
  private resolveFromHeaders(headers?: Record<string, string | undefined>): User | undefined {
    if (!headers) return undefined
    const { userId, userRoles } = this.config.gatewayHeaders
    const id = headers[userId] ?? headers[userId.toLowerCase()]
    if (!id) return undefined
    const known = this.byId.get(id)
    if (known) return known
    const roles = userRoles
      ? (headers[userRoles] ?? headers[userRoles.toLowerCase()])?.split(',').filter(isUserRole)
      : undefined
    return { id, name: id, roles: roles?.length ? roles : ['member'] }
  }
}

function isUserRole(value: string): value is UserRole {
  return value === 'admin' || value === 'member' || value === 'guest'
}

/** 类插件入口：cordis 实例化时自动注册 `ctx.user`（构造即注册，勿再 provide）。 */
export default UserService
