/**
 * 当前会话来源（`readCurrentSessionId`）测试：从官方侧栏 DOM 反推选中会话 id。
 *
 * 官方会话行（本机内核 0.1.7-rc.2，`dsh-client-ui-workspace` 的 `SessionNodeItem`）=
 * `div[role="treeitem"]` + `data-row-key="session:<id>"` + `aria-selected={selected}`；
 * 内核不经公开 client 服务暴露当前选择，故这是唯一可观测来源。容错要求：官方行
 * 未渲染 / 属性缺失 / id 为空 → null（视为「无当前会话」）。
 */

import { afterEach, describe, expect, it } from 'vitest'
import { readCurrentSessionId } from '../src/client/currentSession.ts'

/** 造一行官方会话行（`aria-selected` 传字符串，覆盖 true/false/缺失）。 */
function officialRow(key: string, selected?: string): HTMLElement {
  const row = document.createElement('div')
  row.setAttribute('data-row-key', key)
  row.setAttribute('role', 'treeitem')
  if (selected !== undefined) row.setAttribute('aria-selected', selected)
  document.body.appendChild(row)
  return row
}

describe('readCurrentSessionId', () => {
  afterEach(() => { document.body.innerHTML = '' })

  it('官方未渲染任何会话行 → null', () => {
    expect(readCurrentSessionId(document)).toBeNull()
  })

  it('选中行（aria-selected="true"）→ 取 data-row-key 的 session id', () => {
    officialRow('session:abc', 'false')
    officialRow('session:xyz', 'true')
    expect(readCurrentSessionId(document)).toBe('xyz')
  })

  it('全为 aria-selected="false" → null', () => {
    officialRow('session:a', 'false')
    officialRow('session:b', 'false')
    expect(readCurrentSessionId(document)).toBeNull()
  })

  it('缺 aria-selected 属性 → null', () => {
    officialRow('session:a')
    expect(readCurrentSessionId(document)).toBeNull()
  })

  it('会话 id 为空（data-row-key="session:"）→ null', () => {
    officialRow('session:', 'true')
    expect(readCurrentSessionId(document)).toBeNull()
  })

  it('非会话行（workspace/overflow）即使选中也不取', () => {
    officialRow('workspace:g', 'true')
    officialRow('overflow:g', 'true')
    expect(readCurrentSessionId(document)).toBeNull()
  })
})
