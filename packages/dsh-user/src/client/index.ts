/**
 * dsh-user client 半区：侧边栏底部用户显示（设置按钮下方）。
 *
 * 只消费身份模型（GET /api/user/me → ctx.user.current()），不依赖具体
 * 网关实现——换 APISIX/其他网关后显示不变（身份来源差异在 host 适配层）。
 *
 * 落点：官方 footArea（footerActions → settingsArea）末尾——设置下方。
 * 官方 slots 无此 seat（sidebar.settings 单占用），故用 MutationObserver
 * 等 footArea 渲染后 DOM 注入（同 dsh-desk 组装器机制；dsh-user 是系统层
 * 不依赖 UI 层，自实现轻量注入）。
 */

import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { UserBadge } from './UserBadge'

const USER_BADGE_CSS = [
  // 对齐官方 foot 按钮契约（ui-settings-general .trigger）：42px 行、12px 圆角、primary 文字。
  '[class*="footArea"] [data-dsh-user-badge]{box-sizing:border-box;flex:none;display:flex;align-items:center;gap:8px;width:calc(100% + 4px);min-height:42px;margin:2px -2px;padding:0 10px 0 8px;border-radius:12px;color:var(--dsw-alias-label-secondary);font-family:inherit;font-size:14px;line-height:22px;overflow:hidden}',
  '[class*="footArea"] [data-dsh-user-badge] [data-dsh-user-name]{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  '[class*="footArea"] [data-dsh-user-badge] [data-dsh-user-icon]{flex:none;display:inline-flex;align-items:center;justify-content:center;color:var(--dsw-alias-label-secondary)}',
  '[class*="footArea"] [data-dsh-user-badge] [data-dsh-user-role]{flex:none;font-size:11px;line-height:16px;padding:0 6px;border-radius:6px;background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}',
  // 登出按钮：官方 icon-button 契约（28px 圆、hover 圆形背景、secondary 墨）。
  '[class*="footArea"] [data-dsh-user-badge] [data-dsh-user-logout]{flex:none;display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;padding:0;border:none;border-radius:50%;background:transparent;cursor:pointer;color:var(--dsw-alias-label-secondary)}',
  '[class*="footArea"] [data-dsh-user-badge] [data-dsh-user-logout]:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}',
  '[class*="collapsed"] [data-dsh-user-badge]{display:none}',
].join('')

/** 幂等注入样式。 */
function injectUserBadgeCss(): void {
  if (typeof document === 'undefined' || document.querySelector('style[data-plugin-css="@dsh-user/badge"]')) return
  const tag = document.createElement('style')
  tag.dataset.plugin = 'dsh-user'
  tag.dataset.pluginCss = '@dsh-user/badge'
  tag.textContent = USER_BADGE_CSS
  document.head.appendChild(tag)
}

/** 侧边栏根（与 vendored sidebarRoot() 同策略）。 */
function sidebarRoot(): HTMLElement | null {
  const column = document.querySelector('[data-pane="sidebar"], [class*="sidebarCol"]')
  if (column === null) return null
  return column.querySelector('[class*="logoRow"]')?.parentElement
    ?? (column.firstElementChild as HTMLElement | null)
}

/**
 * 把用户徽标注入 footArea 末尾（设置下方）。MutationObserver 等待 + 自愈。
 * @returns disposer。
 */
function mountUserBadge(): () => void {
  injectUserBadgeCss()
  let host: HTMLElement | undefined
  let rootNode: ReturnType<typeof createRoot> | undefined
  const mount = (): void => {
    const root = sidebarRoot()
    if (root === null) return
    const foot = root.querySelector('[class*="footArea"]')
    if (foot === null) return
    if (host !== undefined && host.isConnected) return
    // 重建：旧 host 已脱离 DOM（官方重渲染/插件卸载）——清理旧 root 再注入
    if (rootNode !== undefined) {
      rootNode.unmount()
      rootNode = undefined
    }
    host = document.createElement('div')
    host.dataset.dshUserBadgeHost = ''
    rootNode = createRoot(host)
    rootNode.render(createElement(UserBadge))
    foot.appendChild(host)
  }
  mount()
  const observer = new MutationObserver(() => { mount() })
  observer.observe(document.body, { childList: true, subtree: true })
  return () => {
    observer.disconnect()
    rootNode?.unmount()
  }
}

/** Client 插件体：挂载侧边栏用户徽标。 */
export function apply(ctx: ClientContext): void {
  const disposer = mountUserBadge()
  ctx.effect(() => disposer, 'dsh-user: sidebar user badge')
}
