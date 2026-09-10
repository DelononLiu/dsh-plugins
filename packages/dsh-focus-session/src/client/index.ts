/**
 * dsh-focus-session：UI·会话关注层（client 半区）——侧栏「置顶」区 + 「活跃」区。
 *
 * 本包是会话关注数据的**所有者**：钉住列表（`dsh-focus-pinned`）与胶囊标签
 * （`dsh-focus-tags`）都由这里读写；dsh-focus-tabs 只读同一份 settings 渲染顶部
 * 会话 tab 行，因此两处天然同步（钉序/标签变化双方自动跟随）。
 *
 * 两个区都是 DOM 注入（抄 dsh-desk 工具入口组装器先例，不占官方 slot）：
 * - 置顶区（PinnedStrip）：手动钉住的会话，管理面（行尾 × 取消钉 + 拖拽排序）。
 * - 活跃区（ActiveStrip）：最近活跃的会话（`updatedAt` 降序，自动，上限 5 条）。
 *
 * 迁移：本包从 dsh-tabs 拆出前，钉住数据存在 `dsh-tabs-pinned`。首次加载时若
 * 新命名空间为空而旧的有值，一次性搬过来，用户既有钉不丢。
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { startPinnedStrip } from './PinnedStrip'
import { startActiveStrip } from './ActiveStrip'
import { tagsOf, type SessionTag, type TagMap } from './tags'
import { planPinMigration } from './pin-migration'
import { normalizePendingKind, type SummaryRow, type PendingInteractionKind } from './session-status'

/** 需要的 client 服务：sessions + settingsScope + uiSession（两个区都是 DOM 注入）。 */
export const inject = ['sessions', 'settingsScope', 'uiSession']

/** 钉住列表 settings 命名空间。 */
const PINNED_NS = 'dsh-focus-pinned'
/** 拆分前的旧钉住命名空间（一次性迁移源）。 */
const LEGACY_PINNED_NS = 'dsh-tabs-pinned'
/** 胶囊标签命名空间（本包拥有并写入；dsh-focus-tabs 只读同一份）。 */
const TAGS_NS = 'dsh-focus-tags'

/** settingsScope 绑定的钉住值。 */
interface PinnedValue { pinned?: string[] }

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
 * Client 插件体：迁移旧钉数据 → 启动侧栏置顶区与活跃区。
 * @param ctx - client 根上下文。
 */
export function apply(ctx: ClientContext): void {
  const settings = ctx.settingsScope.bind<{ pinned: string[] }>({ namespace: PINNED_NS })
  const legacy = ctx.settingsScope.bind<{ pinned: string[] }>({ namespace: LEGACY_PINNED_NS })
  const pinnedOf = (): string[] => (settings.getSnapshot().value as PinnedValue | undefined)?.pinned ?? []

  // —— 一次性迁移：旧命名空间 `dsh-tabs-pinned` → `dsh-focus-pinned` ——
  // 决策见 planPinMigration（须等旧 scope 就绪；搬走后清空旧值防复活）。
  let migrated = false
  const tryMigrate = (): void => {
    if (migrated) return
    const snapshot = legacy.getSnapshot() as { status?: string; value?: PinnedValue }
    const plan = planPinMigration(pinnedOf(), snapshot.status, snapshot.value?.pinned ?? [])
    if (!plan.done) return
    if (plan.pinned.length > 0) settings.set('pinned', plan.pinned)
    if (plan.clearLegacy) legacy.set('pinned', [])
    migrated = true
  }
  const unsubLegacyMigration = legacy.subscribe(tryMigrate)
  ctx.effect(() => () => unsubLegacyMigration(), 'dsh-focus-session: legacy pin migration')
  tryMigrate()

  /** 会话 pending 交互 kind（无则 undefined）。 */
  const pendingKindOf = (id: string): PendingInteractionKind | undefined => {
    const entry = ctx.uiSession.pendingInteractions.getSnapshot().get(id as never) as { kind?: string } | undefined
    return normalizePendingKind(entry?.kind)
  }

  // —— 胶囊标签（settings `dsh-focus-tags`）：本包拥有并写入 ——
  const tagsScope = ctx.settingsScope.bind<{ tags: TagMap }>({ namespace: TAGS_NS })
  const tagsMapOf = (): TagMap => (tagsScope.getSnapshot().value as { tags?: TagMap } | undefined)?.tags ?? {}
  /** 会话 id → 该会话标签数组的读写（删除最后一个标签时清掉该键）。 */
  const tagsApi = {
    getTags: (id: string): readonly SessionTag[] => tagsOf(tagsMapOf(), id),
    setTags: (id: string, tags: readonly SessionTag[]): void => {
      const next: TagMap = { ...tagsMapOf() }
      if (tags.length === 0) delete next[id]
      else next[id] = tags.map((tag) => ({ ...tag }))
      tagsScope.set('tags', next)
    },
    subscribeTags: (fn: () => void): (() => void) => tagsScope.subscribe(fn),
  }

  const disposePinnedStrip = startPinnedStrip({
    getPinned: () => pinnedOf(),
    subscribeSettings: (fn) => settings.subscribe(fn),
    sessions: sessionsOf(ctx).list,
    open: (id: string) => { sessionsOf(ctx).open(id as never) },
    setPinned: (ids) => settings.set('pinned', [...ids]),
    pendingKindOf,
    subscribePending: (fn) => ctx.uiSession.pendingInteractions.subscribe(fn),
    ...tagsApi,
  })
  ctx.effect(() => () => disposePinnedStrip(), 'dsh-focus-session: sidebar pinned strip')

  const disposeActiveStrip = startActiveStrip({
    sessions: sessionsOf(ctx).list,
    open: (id: string) => { sessionsOf(ctx).open(id as never) },
    getPinned: () => pinnedOf(),
    subscribeSettings: (fn) => settings.subscribe(fn),
    setPinned: (ids) => settings.set('pinned', [...ids]),
    pendingKindOf,
    subscribePending: (fn) => ctx.uiSession.pendingInteractions.subscribe(fn),
    ...tagsApi,
  })
  ctx.effect(() => () => disposeActiveStrip(), 'dsh-focus-session: sidebar active strip')
}
