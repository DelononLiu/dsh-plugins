/**
 * 侧边栏用户徽标组件：拉当前用户（GET /api/user/me）渲染名称 + 角色。
 * 只消费身份模型，不依赖具体网关实现（身份来源差异在 host 适配层）。
 */

import { useEffect, useState } from 'react'

/** 身份模型用户（与 host User 结构一致）。 */
export interface MeUser {
  id: string
  name: string
  roles: string[]
}

const ROLE_LABEL: Record<string, string> = { admin: '管理员', member: '成员', guest: '访客' }

/** 组件：拉当前用户并渲染名称 + 角色徽标。 */
export function UserBadge(): React.JSX.Element {
  const [me, setMe] = useState<MeUser | null>(null)
  useEffect(() => {
    let cancelled = false
    fetch('/api/user/me')
      .then((r) => (r.ok ? r.json() as Promise<MeUser> : null))
      .then((user) => { if (!cancelled && user) setMe(user) })
      .catch(() => { /* 端点不可用：不显示 */ })
    return () => { cancelled = true }
  }, [])
  if (!me) return <></>
  const roleText = me.roles[0] ? (ROLE_LABEL[me.roles[0]] || me.roles[0]) : undefined
  return (
    <div data-dsh-user-badge title={`${me.name}（${me.id}）`}>
      <span data-dsh-user-name>{me.name || me.id}</span>
      {roleText && <span data-dsh-user-role>{roleText}</span>}
    </div>
  )
}
