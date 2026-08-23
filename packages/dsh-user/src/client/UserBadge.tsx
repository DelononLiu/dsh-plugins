/**
 * 侧边栏用户徽标组件：拉当前用户（GET /api/user/me）渲染名称 + 角色。
 * 只消费身份模型，不依赖具体网关实现（身份来源差异在 host 适配层）。
 *
 * 登出：经网关（HTTPS，x-forwarded-proto=https 场景下当前页即网关域）时
 * 显示登出按钮，点击跳同源 /logout（gateway 清 cookie 后 302 回 /login）。
 * HTTP 直连 web2 无登录态（静态兜底）——不显示登出。
 */

import { useEffect, useState } from 'react'

/** 身份模型用户（与 host User 结构一致；viaGateway 由 host 判断）。 */
export interface MeUser {
  id: string
  name: string
  roles: string[]
  /** 请求是否经可信网关（host 据 x-forwarded-proto: https 判断）。 */
  viaGateway?: boolean
}

const ROLE_LABEL: Record<string, string> = { admin: '管理员', member: '成员', guest: '访客' }

/** 登出图标（官方 SVG stroke 风格，16px）。 */
function LogoutIcon(): React.JSX.Element {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9.5 2.5h-6a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h6" />
      <path d="M13.5 8h-8M11 5.5 13.5 8 11 10.5" />
    </svg>
  )
}

/** 用户图标（人形，官方 SVG stroke 风格）。 */
function UserIcon(): React.JSX.Element {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="8" cy="5" r="2.75" />
      <path d="M3.5 13.5c.6-2.4 2.4-3.75 4.5-3.75s3.9 1.35 4.5 3.75" />
    </svg>
  )
}

/** 组件：拉当前用户并渲染名称 + 角色徽标（经网关时附登出按钮）。 */
export function UserBadge(): React.JSX.Element {
  const [me, setMe] = useState<MeUser | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    const timer = window.setTimeout(() => controller.abort(), 5000)
    fetch('/api/user/me', { signal: controller.signal })
      .then((r) => (r.ok ? r.json() as Promise<MeUser> : null))
      .then((user) => { if (user) setMe(user) })
      .catch(() => { /* 端点不可用/超时：不显示 */ })
    return () => { controller.abort(); window.clearTimeout(timer) }
  }, [])
  if (!me) return <></>
  const roleText = me.roles[0] ? (ROLE_LABEL[me.roles[0]] || me.roles[0]) : undefined
  // 经网关（host 判定 viaGateway）时显示登出；HTTP 直连（静态兜底）无登录态不显示。
  const viaGateway = me.viaGateway === true
  return (
    <div data-dsh-user-badge title={`${me.id}（${me.name}）`}>
      <span data-dsh-user-icon aria-hidden="true"><UserIcon /></span>
      <span data-dsh-user-name>{me.id || me.name}</span>
      {roleText && <span data-dsh-user-role>{roleText}</span>}
      {viaGateway && (
        <button
          type="button"
          data-dsh-user-logout
          title="退出登录"
          aria-label="退出登录"
          onClick={() => { window.location.href = '/logout' }}
        >
          <LogoutIcon />
        </button>
      )}
    </div>
  )
}
