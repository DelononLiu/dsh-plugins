/**
 * dsh-focus-session：UI·会话关注层（client 半区）——侧栏「置顶」区 + 「活跃」区。
 *
 * 本包是会话关注数据的**所有者**：钉住列表（Config 字段 `pinned`）与胶囊标签
 * （Config 字段 `tags`）都由这里读写（官方 0.1.7 设置模型：设置 = 插件自身
 * Config 的 volatile 字段，按 profile 条目 id 定位）；dsh-focus-tabs 只读同一份
 * 数据渲染顶部会话 tab 行，因此两处天然同步（钉序/标签变化双方自动跟随）。
 *
 * 两个区都是 DOM 注入（抄 dsh-desk 工具入口组装器先例，不占官方 slot）：
 * - 置顶区（PinnedStrip）：手动钉住的会话，管理面（行尾 × 取消钉 + 拖拽排序）。
 * - 活跃区（ActiveStrip）：最近活跃的会话（`updatedAt` 降序，自动，上限 5 条）。
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { startPinnedStrip } from './PinnedStrip'
import { startActiveStrip } from './ActiveStrip'
import { tagsOf, type SessionTag, type TagMap } from './tags'
import { normalizePendingKind, type SummaryRow, type PendingInteractionKind } from './session-status'

/** 需要的 client 服务：sessions + configForms + uiSession（两个区都是 DOM 注入）。 */
export const inject = ['sessions', 'configForms', 'uiSession']

/** 关注数据的 profile 条目 id（= host 面 FOCUS_SESSION_ENTRY_ID；字面量避免拉入 host 模块）。 */
const FOCUS_SESSION_ENTRY_ID = 'dsh-focus-session'

/** 会话列表最小契约（绕开官方 dsh-session 的 host SessionStore 漂移）。 */
interface FocusSessionsList {
  getSnapshot(): { current: string | undefined; ids: readonly string[]; byId: Record<string, SummaryRow> }
  subscribe(fn: () => void): () => void
}
interface FocusSessions {
  list: FocusSessionsList
  open(id: string): void
}
function sessionsOf(ctx: { sessions: unknown }): FocusSessions {
  return ctx.sessions as FocusSessions
}

/**
 * Client 插件体：绑定本插件的配置表单 → 启动侧栏置顶区与活跃区。
 * @param ctx - client 根上下文。
 */
export function apply(ctx: ClientContext): void {
  const form = ctx.configForms.get<{ pinned: string[]; tags: TagMap }>(FOCUS_SESSION_ENTRY_ID)
  const pinnedOf = (): string[] => form.getSnapshot().value?.pinned ?? []

  /** 会话 pending 交互 kind（无则 undefined）。 */
  const pendingKindOf = (id: string): PendingInteractionKind | undefined => {
    const entry = ctx.uiSession.sessionStatus.getSnapshot().get(id as never) as { pendingInteraction?: { kind?: string } } | undefined
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

  const disposePinnedStrip = startPinnedStrip({
    getPinned: () => pinnedOf(),
    subscribeSettings: (fn) => form.subscribe(fn),
    sessions: sessionsOf(ctx).list,
    open: (id: string) => { sessionsOf(ctx).open(id as never) },
    setPinned: (ids) => { void form.set('pinned', [...ids]) },
    pendingKindOf,
    subscribePending: (fn) => ctx.uiSession.sessionStatus.subscribe(fn),
    ...tagsApi,
  })
  ctx.effect(() => () => disposePinnedStrip(), 'dsh-focus-session: sidebar pinned strip')

  const disposeActiveStrip = startActiveStrip({
    sessions: sessionsOf(ctx).list,
    open: (id: string) => { sessionsOf(ctx).open(id as never) },
    getPinned: () => pinnedOf(),
    subscribeSettings: (fn) => form.subscribe(fn),
    setPinned: (ids) => { void form.set('pinned', [...ids]) },
    pendingKindOf,
    subscribePending: (fn) => ctx.uiSession.sessionStatus.subscribe(fn),
    ...tagsApi,
  })
  ctx.effect(() => () => disposeActiveStrip(), 'dsh-focus-session: sidebar active strip')
}
