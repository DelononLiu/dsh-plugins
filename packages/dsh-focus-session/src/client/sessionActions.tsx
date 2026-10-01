/**
 * dsh-focus-session 两个侧栏区（置顶区/活跃区）行菜单里的官方会话动作。
 *
 * 用户决定：行菜单只放官方的 `rename`(200) 与 `fork`(300)（项、图标、顺序、文案都照官方），
 * 我们自己的项接在后面；置顶由本插件的「添加到置顶区」承担，归档在官方行里做。
 * 本模块提供官方项的构建器与官方同款「重命名」弹框，动作落到官方数据面：
 * - **rename** → 官方 `RenameSessionMenuItem` 只把请求写进 ui-workspace 私有的
 *   `shortcutControls.rename`（无客户端服务暴露），故这里用本包自己的弹框收集标题，
 *   再经**官方同一条调用路径**改名：
 *   `sessions.using(id, { source }, ref => ref.binding.session.rename(title))`
 *   （即官方 `SessionRenameDialog` 的 `renameSession` 实现）。除弹框外观外无自研逻辑。
 * - **fork** → `ctx.uiWorkspace.forkSession`（官方 `ForkSessionMenuItem.tsx` 的同一入口）。
 *
 * 官方文案取自本机内核 0.1.7-rc.2 `ui-workspace` locale（zh）：`重命名`、`分叉会话`；
 * 图标取自官方 `ui-primitives` 导出（与官方 `session-actions/*.tsx` 一一对应）。
 */

import { createElement, useState, type ReactNode } from 'react'
import { flushSync } from 'react-dom'
import { createRoot, type Root } from 'react-dom/client'
import {
  Button, IconBranchOutlineRegular, IconEditOutlineRegular,
  IconGlobeOutlineRegular, Input, Modal,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { RowMenuItem } from './menu'

/** 官方 rename 菜单行文案（zh）。 */
export const OFFICIAL_RENAME_LABEL = '重命名'
/** 官方 fork 菜单行文案（zh）。 */
export const OFFICIAL_FORK_LABEL = '分叉会话'

/** 我们的置顶菜单行文案（未钉）。 */
export const FOCUS_PIN_LABEL = '添加到置顶区'
/** 我们的置顶菜单行文案（已钉）。 */
export const FOCUS_UNPIN_LABEL = '从置顶区移除'

/** 重命名弹框根标记。 */
export const RENAME_DIALOG_ATTR = 'data-dsh-rename-dialog'

/** 官方会话动作的客户端可达面（由 index.ts 从官方服务装配；测试注入假实现）。 */
export interface OfficialSessionActionDeps {
  /** 官方 fork（`ctx.uiWorkspace.forkSession`）。 */
  fork(sessionId: string): Promise<void>
  /** 该会话当前标题（重命名弹框初值）。 */
  displayTitleOf(sessionId: string): string
  /** 官方同路径改名（`ctx.sessions.using(...)`）。 */
  rename(sessionId: string, title: string): Promise<void>
}

/** 我们的关注区钉数据（与两个侧栏区共用同一份 settings 通道）。 */
export interface FocusPinDeps {
  /** 读我们的钉住列表（settings `pinned`）。 */
  getPinned(): readonly string[]
  /** 写我们的钉住列表。 */
  setPinned(ids: readonly string[]): void
}

/**
 * 关注区行菜单里的官方项：rename（官方 order 200）与 fork（官方 order 300），
 * 顺序照官方。pin（置顶会话）与 archive（归档会话）按用户要求**不放进关注区菜单**
 * ——置顶由本插件的「添加到置顶区」承担，归档在官方行里做。动作落到
 * {@link OfficialSessionActionDeps} 的官方数据面。
 * @param sessionId - 目标会话。
 * @param deps - 官方动作面。
 * @returns 菜单行数组（可直接拼在菜单前部）。
 */
export function officialSessionMenuItems(sessionId: string, deps: OfficialSessionActionDeps): RowMenuItem[] {
  const items: RowMenuItem[] = []
  // 官方 rename 行 order 200：弹框收集标题（官方请求 store 私有），提交走官方改名调用。
  items.push({
    id: 'rename',
    label: OFFICIAL_RENAME_LABEL,
    icon: createElement(IconEditOutlineRegular, {}),
    onSelect: () => {
      openRenameDialog({
        sessionId,
        currentTitle: deps.displayTitleOf(sessionId),
        rename: deps.rename,
      })
    },
  })
  // 官方 fork 行 order 300：在最后一个已完成回合上分叉，子会话由 Host 列表送回。
  items.push({
    id: 'fork',
    label: OFFICIAL_FORK_LABEL,
    icon: createElement(IconBranchOutlineRegular, {}),
    onSelect: () => {
      void deps.fork(sessionId).catch((reason: unknown) => {
        console.warn('dsh-focus-session: official fork rejected:', reason)
      })
    },
  })
  return items
}

/**
 * 我们的「添加到置顶区 / 从置顶区移除」菜单行（官方项之后；与官方 pin 数据独立、并存）。
 * @param sessionId - 目标会话。
 * @param deps - 我们的钉数据。
 * @returns 菜单行。
 */
export function focusSessionPinMenuItem(sessionId: string, deps: FocusPinDeps): RowMenuItem {
  const pinned = [...new Set(deps.getPinned().map((id) => String(id)))].includes(sessionId)
  return {
    id: 'focus-pin',
    label: pinned ? FOCUS_UNPIN_LABEL : FOCUS_PIN_LABEL,
    icon: createElement(IconGlobeOutlineRegular, {}),
    onSelect: () => {
      const current = [...new Set(deps.getPinned().map((id) => String(id)))]
      deps.setPinned(
        current.includes(sessionId)
          ? current.filter((id) => id !== sessionId)
          : [...current, sessionId],
      )
    },
  }
}

/** 当前打开的改名弹框（单例）。 */
let activeRename: { root: Root; container: HTMLElement } | null = null

/** 关闭改名弹框（若有）。 */
export function closeRenameDialog(): void {
  const current = activeRename
  if (current === null) return
  activeRename = null
  // 从 React 事件处理器里同步 unmount 会打断本次提交，排到微任务。
  queueMicrotask(() => { current.root.unmount(); current.container.remove() })
}

/** 改名弹框选项。 */
export interface RenameDialogOptions {
  /** 目标会话。 */
  sessionId: string
  /** 当前标题（初值）。 */
  currentTitle: string
  /** 官方同路径改名。 */
  rename(sessionId: string, title: string): Promise<void>
  /** 文档（测试注入）。 */
  doc?: Document
}

/**
 * 打开改名弹框（官方 `Modal`/`Button`/`Input` 基元，替官方私有请求 store 的落点）。
 * @param options - 目标会话、初值、改名回调。
 */
export function openRenameDialog(options: RenameDialogOptions): void {
  const doc = options.doc ?? document
  closeRenameDialog()
  const container = doc.createElement('div')
  container.setAttribute(RENAME_DIALOG_ATTR, '')
  doc.body.appendChild(container)
  const root = createRoot(container)
  activeRename = { root, container }
  flushSync(() => {
    root.render(createElement(RenameDialog, { ...options, onClose: closeRenameDialog }))
  })
}

/**
 * 改名弹框体：标题输入 + 取消/重命名，回车提交；提交中禁用，失败就地显示错误。
 * @param props - 目标会话、初值、改名回调、关闭回调。
 * @returns 官方 Modal 树。
 */
function RenameDialog(props: {
  sessionId: string
  currentTitle: string
  rename(sessionId: string, title: string): Promise<void>
  onClose(): void
}): ReactNode {
  const [draft, setDraft] = useState(props.currentTitle)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const trimmed = draft.trim()
  const blocked = busy || trimmed === ''
  const cancel = (): void => { if (!busy) props.onClose() }
  const confirm = (): void => {
    if (blocked) return
    setBusy(true)
    setError(null)
    void props.rename(props.sessionId, trimmed).then(
      () => { props.onClose() },
      (reason: unknown) => {
        setBusy(false)
        setError(reason instanceof Error ? reason.message : String(reason))
      },
    )
  }
  return (
    <Modal
      open
      onClose={cancel}
      closeLabel="关闭"
      title="重命名会话"
      footer={(
        <>
          <Button variant="outline" disabled={busy} onClick={cancel}>取消</Button>
          <Button variant="primary" disabled={blocked} onClick={confirm}>重命名</Button>
        </>
      )}
    >
      <Input
        value={draft}
        aria-label="会话名称"
        data-modal-autofocus
        disabled={busy}
        onChange={(e) => { setDraft(e.target.value); setError(null) }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); confirm() }
        }}
      />
      {error !== null ? <div role="alert">{error}</div> : null}
    </Modal>
  )
}

