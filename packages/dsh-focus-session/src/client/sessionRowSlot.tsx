/**
 * dsh-focus-session 官方会话行的「添加到置顶区」入口（client 半区，**官方 slot 注册**）。
 *
 * 与官方置顶的分工（按本机内核 0.1.7-rc.2 的 `dsh-client-ui-workspace` 源码/类型核实）：
 * - 官方行级图钉把会话 id 写进 `dsh-workspace` registry 的注册表级 `pinnedSessionIds`
 *   集合（`ctx.workspaces.list` 快照 / `ui-workspace` 的 `pinInjected.pinSession`），
 *   效果 = 会话在**它所属的工作区分组/平铺列表内**排到非置顶会话之前，会话仍留在
 *   原工作区。
 * - 本入口钉的是 dsh-focus-session 的 settings `pinned`，效果 = 会话出现在侧栏
 *   **跨工作区的独立「置顶区」**里。两者数据独立、语义不同、并存，互不调用。
 *
 * 落点（官方 `ui-workspace/src/client/index.ts` 向 `ctx.slots` 声明的
 * `sidebar.workspaces.session.menu.item` list slot）：官方 `pin`(100) / `rename`(200) /
 * `fork`(300) / `archive`(400)；第三方在 500+ 追加，本入口用 order 500。入口只在会话
 * 行「⋯」菜单里，不在行 hover 动作区（`sidebar.workspaces.session.row.action`）加图标。
 *
 * 形态照官方对应项：菜单行 = 官方 `MenuItemButton`（16px 图标 + 文案）。图标复用官方图标
 * 集导出：官方 pin 已占用 `IconPinOutline/FillRegular`，本入口用 `IconGlobeOutlineRegular`
 * 区分「跨工作区」语义，文案为「添加到置顶区 / 从置顶区移除」。
 *
 * 文件名沿用 `sessionRowSlot`：注册的仍是官方会话行的 slot（行「⋯」菜单）。
 */

import { createElement, useEffect, useState, type ReactNode } from 'react'
import { IconGlobeOutlineRegular, MenuItemButton } from '@deepseek-ai/dsh-client-ui-primitives'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only：拉入 ctx.slots（renderer）与 slot 名的 SlotMap 声明（ui-workspace）。
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'

/** 官方会话行「⋯」菜单 slot 名（ui-workspace 声明）。 */
export const ROW_MENU_SLOT = 'sidebar.workspaces.session.menu.item'
/** 本入口在官方菜单行中的 order（官方 archive=400 之后）。 */
export const ROW_MENU_ORDER = 500
/** 注册 id（本包命名空间；官方契约要求包名命名空间，勿复用官方 id）。 */
export const ROW_MENU_ENTRY_ID = 'dsh-focus-session/global-pin'

/** 未钉时的菜单/aria 文案（点 = 钉入我们的置顶区）。 */
export const ROW_MENU_PIN_LABEL = '添加到置顶区'
/** 已钉时的菜单/aria 文案（点 = 移出）。 */
export const ROW_MENU_UNPIN_LABEL = '从置顶区移除'

/** 本入口的依赖（与两个侧栏区共用同一份钉数据，不新建模型）。 */
export interface SessionRowPinDeps {
  /** 读取钉住列表（settings `pinned`）。 */
  getPinned(): readonly string[]
  /** 订阅钉住列表变更（其它入口钉/取消钉后菜单状态跟着变）。 */
  subscribeSettings(fn: () => void): () => void
  /** 写回钉住列表（settings.set('pinned', …)）。 */
  setPinned(ids: readonly string[]): void
}

/** 切换我们的置顶：未钉→追加（去重）、已钉→移除（与两个侧栏区同一份数据）。 */
function toggleGlobalPin(deps: SessionRowPinDeps, sessionId: string): void {
  const pinned = [...new Set(deps.getPinned().map((id) => String(id)))]
  if (!pinned.includes(sessionId)) {
    deps.setPinned([...pinned, sessionId])
    return
  }
  deps.setPinned(pinned.filter((id) => id !== sessionId))
}

/** 订阅我们的钉住列表，返回该会话是否已钉（React 侧的最小绑定）。 */
function useGlobalPinned(deps: SessionRowPinDeps, sessionId: string): boolean {
  const [pinned, setPinned] = useState(() => deps.getPinned().map((id) => String(id)).includes(sessionId))
  useEffect(() => {
    const read = (): boolean => deps.getPinned().map((id) => String(id)).includes(sessionId)
    setPinned(read())
    return deps.subscribeSettings(() => { setPinned(read()) })
  }, [deps, sessionId])
  return pinned
}

/** 菜单行 props（官方 owner share + 菜单开合 hook + 本插件 deps）。 */
export type GlobalPinMenuItemProps =
  PropsRuntime<typeof ROW_MENU_SLOT> & { deps: SessionRowPinDeps }

/**
 * 官方会话行「⋯」菜单里的「添加到置顶区」行（官方 `MenuItemButton` 形态，排在官方行之后）。
 * @param props - 行 owner share + 菜单开合 hook + 本插件 deps。
 * @returns 菜单行。
 */
export function GlobalPinMenuItem(props: GlobalPinMenuItemProps): ReactNode {
  const sessionId = String(props.sessionId)
  const pinned = useGlobalPinned(props.deps, sessionId)
  const [, setMenuOpen] = props.useMenuOpenState()
  return createElement(
    MenuItemButton,
    {
      icon: createElement(IconGlobeOutlineRegular, {}),
      children: pinned ? ROW_MENU_UNPIN_LABEL : ROW_MENU_PIN_LABEL,
      onSelect: () => {
        setMenuOpen(false)
        toggleGlobalPin(props.deps, sessionId)
      },
    },
  )
}

/**
 * 把「添加到置顶区 / 从置顶区移除」注册进官方会话行「⋯」菜单（`sidebar.workspaces.session.menu.item`；
 * 等 slot 声明就绪；卸载随调用方 fiber 的 `ctx.slots.inject` 生命周期级联）。
 * @param ctx - client 根上下文（需 inject `slots`）。
 * @param deps - 钉住列表读写/订阅（与两个侧栏区共用同一 deps 通道）。
 */
export function installSessionMenuPin(ctx: ClientContext, deps: SessionRowPinDeps): void {
  ctx.slots.inject(ROW_MENU_SLOT, () => ctx.slots.register(
    { name: ROW_MENU_SLOT, id: ROW_MENU_ENTRY_ID, order: ROW_MENU_ORDER },
    (props) => createElement(GlobalPinMenuItem, { ...props, deps }),
  ))
}
