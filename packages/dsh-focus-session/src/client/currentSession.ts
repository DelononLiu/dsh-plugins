/**
 * 当前会话的来源：**读官方侧栏 DOM 反推**。
 *
 * 内核没有通过公开 client 服务暴露「当前选择」——`ctx.sessions.list` 的快照
 * （`SessionListState`）只有会话集合/投影，ui-workspace 的 selection store 是私有的，
 * `SessionRowOwnerProps` 也只有 `{ sessionId, displayTitle }`。唯一可观测来源是官方
 * 会话行自身渲染出的选中态（本机内核 0.1.7-rc.2，
 * `@deepseek-ai/dsh-client-ui-workspace/lib/client.js` 的 `SessionNodeItem`）：
 *
 * - 行 = `div[role="treeitem"]`，`data-row-key="session:<id>"`，
 *   `aria-selected={selected}`，其中 `selected = node.id === currentId`；
 * - 选中类官方 CSS Module 的 `_selected`（`.sessionRow:hover, .sessionRow._selected
 *   { background: var(--dsw-alias-interactive-bg-hover) }`）。
 *
 * 故「当前会话」= 侧栏里 `[data-row-key^="session:"][aria-selected="true"]` 那行
 * 的 id。官方行未渲染 / 属性缺失 / id 为空一律视为**无当前会话**（不标记任何行）。
 */

/** 官方当前会话行选择器（`aria-selected="true"` 即 current；无选中时无匹配）。 */
export const OFFICIAL_SELECTED_ROW_SELECTOR = '[data-row-key^="session:"][aria-selected="true"]'

/** 官方 `data-row-key` 的会话前缀。 */
const SESSION_ROW_KEY_PREFIX = 'session:'

/**
 * 从官方侧栏 DOM 反推当前会话 id（裸字符串）。
 * @param doc - 宿主文档。
 * @returns 当前会话 id；官方行未渲染 / 缺 `data-row-key` / id 为空 → null。
 */
export function readCurrentSessionId(doc: Document): string | null {
  const row = doc.querySelector(OFFICIAL_SELECTED_ROW_SELECTOR)
  if (row === null) return null
  const key = row.getAttribute('data-row-key')
  if (key === null || !key.startsWith(SESSION_ROW_KEY_PREFIX)) return null
  const id = key.slice(SESSION_ROW_KEY_PREFIX.length)
  return id === '' ? null : id
}
