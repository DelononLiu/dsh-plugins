/**
 * dsh-console-ui：总览/管理界面（client 半区）。
 *
 * v1 可见 UI：在左侧栏底部（sidebar.footer.action，设置上方）注册
 * 「Console」徽标按钮入口。数据面（实例列表/控制指令/broker 状态经
 * console 服务 HTTP 端点）在 Typert 远程化接入后补全。
 *
 * 控制台入口只对管理端（console 角色）显示：/api/console/* 端点只由
 * console 角色挂载，client 启动时探测该端点，200 才注册入口——
 * 非管理端（instance/daemon 角色）不显示控制台按钮。
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { ConsoleBadge } from './ConsoleBadge'

/**
 * sidebar.footer.action 插槽类型扩展（官方 sidebar 包未在公开 types 暴露
 * SlotMap 扩展，消费方自行声明，与官方 contract/slots.d.ts 一致）。
 */
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    'sidebar.footer.action': {
      kind: 'list'
      scope: 'root'
      owner: { wide: boolean }
    }
  }
}

/** 需要的 client 服务：插槽注册（sidebar footer 插槽需 sidebar 已加载）。 */
export const inject = ['slots']

/**
 * Client 插件体：管理端注册侧栏底部「Console」入口（非管理端不注册）。
 * @param ctx - client 根上下文。
 */
export function apply(ctx: ClientContext): void {
  // 探测管理端控制端点：只有 console 角色挂 /api/console/instances。
  void fetch('/api/console/instances')
    .then((r) => {
      if (!r.ok) return
      ctx.slots.inject(
        'sidebar.footer.action',
        () => ctx.slots.register({
          name: 'sidebar.footer.action',
          id: 'console-ui',
          order: 120,
        }, ConsoleBadge),
      )
    })
    .catch(() => { /* 端点不可用：非管理端，控制台入口不注册 */ })
}
