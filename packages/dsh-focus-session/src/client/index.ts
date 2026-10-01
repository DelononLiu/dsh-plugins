/**
 * dsh-focus-session：UI·会话关注层（client 半区）——侧栏「置顶」区 + 「活跃」区。
 *
 * 本包是会话关注数据的**所有者**：钉住列表（Config 字段 `pinned`）与胶囊标签
 * （Config 字段 `tags`）都由这里读写（官方 0.1.7 设置模型：设置 = 插件自身
 * Config 的 volatile 字段，按 profile 条目 id 定位）。
 *
 * 两个侧栏区是 DOM 注入（MutationObserver + 直接插进官方侧栏，官方侧栏没有跨工作区
 * 关注区的 seat）；官方会话行「⋯」菜单里的「添加到置顶区 / 从置顶区移除」入口则走
 * **官方 slot 注册**（`sidebar.workspaces.session.menu.item`）：
 * - 置顶区（PinnedStrip）：手动钉住的会话，管理面（行尾 × 取消钉 + 拖拽排序）。
 * - 活跃区（ActiveStrip）：最近活跃的会话（`updatedAt` 降序，自动，上限 5 条）。
 * - 官方会话行菜单入口（sessionRowSlot）：会话行「⋯」菜单里的「添加到置顶区 / 从置顶区移除」
 *   ——官方图钉把会话排到它所属工作区列表前列（注册表级 pin），本入口钉入跨工作区的侧栏
 *   置顶区，两者并存。
 * - 两个区的行菜单前置官方 rename/fork（动作落官方数据面），后接我们自己的项
 *   （编辑标签、添加到置顶区/从置顶区移除；置顶由本插件承担，归档在官方行里做）。
 * - 两个区的行点击 = 官方 `uiWorkspace.openSession(SessionId(id))`（官方侧栏会话行同一入口）。
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
// 官方「已知会话 id」品牌构造（`SessionId(id)` 只做 brandString，运行时恒等）：
// 本包手里的会话 id 是 settings 里的裸字符串，喂给官方入口前按内核同款品牌函数构造。
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { startPinnedStrip } from './PinnedStrip'
import { startActiveStrip } from './ActiveStrip'
import { installSessionMenuPin } from './sessionRowSlot'
import type { OfficialSessionActionDeps } from './sessionActions'
import { tagsOf, type SessionTag, type TagMap } from './tags'
import { normalizePendingKind, type PendingInteractionKind } from './session-status'

/**
 * 需要的 client 服务：sessions + configForms + uiSession（两个区）；slots（官方会话行
 * 入口的 slot 注册）；uiWorkspace（行菜单官方动作：rename/fork）。
 */
export const inject = ['sessions', 'configForms', 'uiSession', 'slots', 'uiWorkspace']

/** 关注数据的 profile 条目 id（= host 面 FOCUS_SESSION_ENTRY_ID；字面量避免拉入 host 模块）。 */
const FOCUS_SESSION_ENTRY_ID = 'dsh-focus-session'

/**
 * 本包消费会话引用时声明的来源标签（官方 `SessionReferenceSourceMap` 只内置
 * `controllerOperation`/`gateway`；消费方经此声明扩展）。
 */
declare module '@deepseek-ai/dsh-api-session-controller/client' {
  interface SessionReferenceSourceMap {
    /** dsh-focus-session 的行菜单改名（与官方 rename 弹框同一调用路径）。 */
    dshFocusSession: unknown
  }
}

/**
 * Client 插件体：绑定本插件的配置表单 → 启动侧栏置顶区与活跃区 → 注册官方会话行入口。
 * @param ctx - client 根上下文。
 */
export function apply(ctx: ClientContext): void {
  const form = ctx.configForms.get<{ pinned: string[]; tags: TagMap }>(FOCUS_SESSION_ENTRY_ID)
  const pinnedOf = (): string[] => form.getSnapshot().value?.pinned ?? []

  /** 会话 pending 交互 kind（无则 undefined）。 */
  const pendingKindOf = (id: string): PendingInteractionKind | undefined => {
    const entry = ctx.uiSession.sessionStatus.getSnapshot().get(SessionId(id))
    return normalizePendingKind(entry?.pendingInteraction?.kind)
  }

  // —— 胶囊标签（Config 字段 `tags`）：本包拥有并写入 ——
  const tagsMapOf = (): TagMap => form.getSnapshot().value?.tags ?? {}
  /** 会话 id → 该会话标签数组的读写（删除最后一个标签时清掉该键）。 */
  const tagsApi = {
    getTags: (id: string): readonly SessionTag[] => tagsOf(tagsMapOf(), id),
    setTags: (id: string, tags: readonly SessionTag[]): void => {
      const next: TagMap = { ...tagsMapOf() }
      if (tags.length === 0) delete next[id]
      else next[id] = tags.map((tag) => ({ ...tag }))
      void form.set('tags', next)
    },
    subscribeTags: (fn: () => void): (() => void) => form.subscribe(fn),
  }

  /**
   * 官方会话动作面：fork 直接调官方 `UiWorkspace` 服务（与官方行按钮同一入口）；
   * rename 走官方同一条会话改名调用路径（官方请求 store 是 ui-workspace 私有的，
   * 故由本包弹框收集标题）。置顶由本插件承担，归档在官方行里做，不在此处。
   */
  const officialActions: OfficialSessionActionDeps = {
    fork: (sessionId) => ctx.uiWorkspace.forkSession(SessionId(sessionId)),
    displayTitleOf: (sessionId) => ctx.sessions.list.getSnapshot().byId[SessionId(sessionId)]?.displayTitle ?? sessionId,
    rename: async (sessionId, title) => {
      const result = await ctx.sessions.using(
        SessionId(sessionId),
        { source: 'dshFocusSession' },
        (reference) => reference.binding.session.rename(title),
      )
      if (!result.ok) throw new Error(result.error.message)
    },
  }

  const disposePinnedStrip = startPinnedStrip({
    getPinned: () => pinnedOf(),
    subscribeSettings: (fn) => form.subscribe(fn),
    sessions: ctx.sessions.list,
    open: (id: string) => { ctx.uiWorkspace.openSession(SessionId(id)) },
    setPinned: (ids) => { void form.set('pinned', [...ids]) },
    pendingKindOf,
    subscribePending: (fn) => ctx.uiSession.sessionStatus.subscribe(fn),
    officialActions,
    ...tagsApi,
  })
  ctx.effect(() => () => disposePinnedStrip(), 'dsh-focus-session: sidebar pinned strip')

  const disposeActiveStrip = startActiveStrip({
    sessions: ctx.sessions.list,
    open: (id: string) => { ctx.uiWorkspace.openSession(SessionId(id)) },
    getPinned: () => pinnedOf(),
    subscribeSettings: (fn) => form.subscribe(fn),
    setPinned: (ids) => { void form.set('pinned', [...ids]) },
    pendingKindOf,
    subscribePending: (fn) => ctx.uiSession.sessionStatus.subscribe(fn),
    officialActions,
    ...tagsApi,
  })
  ctx.effect(() => () => disposeActiveStrip(), 'dsh-focus-session: sidebar active strip')

  // —— 官方会话行「⋯」菜单里的「添加到置顶区 / 从置顶区移除」入口（官方 slot 注册）——
  installSessionMenuPin(ctx, {
    getPinned: () => pinnedOf(),
    subscribeSettings: (fn) => form.subscribe(fn),
    setPinned: (ids) => { void form.set('pinned', [...ids]) },
  })
}
