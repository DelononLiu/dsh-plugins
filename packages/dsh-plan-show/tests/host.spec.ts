/**
 * host 面测试：产物存储（覆盖/上限/过滤）、工具入参 → 产物（markdown 派生 + 结构化
 * 覆盖 + JSON 错误信息）、端点查询解析、回执文案。
 */

import { describe, expect, it } from 'vitest'
import { ArtifactStore, artifactReceipt, parseListQuery, publishArtifact } from '../src/index.ts'
import { normalizeArtifact, type Artifact } from '../src/types.ts'

function artifact(id: string, sessionId?: string, producedAt = 1): Artifact {
  return normalizeArtifact({
    id,
    kind: 'plan',
    title: `T-${id}`,
    producedAt,
    ...sessionId === undefined ? {} : { sessionId },
  })
}

describe('ArtifactStore', () => {
  it('最新在前；同 id 覆盖而不是追加', () => {
    const store = new ArtifactStore()
    store.push(artifact('a'))
    store.push(artifact('b'))
    expect(store.list().map((entry) => entry.id)).toEqual(['b', 'a'])
    store.push({ ...artifact('a'), title: 'T-a2' })
    expect(store.list().map((entry) => entry.id)).toEqual(['a', 'b'])
    expect(store.list()[0].title).toBe('T-a2')
  })

  it('超出上限丢最旧', () => {
    const store = new ArtifactStore(2)
    store.push(artifact('a'))
    store.push(artifact('b'))
    store.push(artifact('c'))
    expect(store.list().map((entry) => entry.id)).toEqual(['c', 'b'])
  })

  it('按 sessionId 过滤 + limit 截断；clear 清空', () => {
    const store = new ArtifactStore()
    store.push(artifact('a', 's1'))
    store.push(artifact('b', 's2'))
    store.push(artifact('c', 's1'))
    expect(store.list({ sessionId: 's1' }).map((entry) => entry.id)).toEqual(['c', 'a'])
    expect(store.list({ limit: 1 }).map((entry) => entry.id)).toEqual(['c'])
    store.clear()
    expect(store.list()).toEqual([])
  })
})

describe('publishArtifact（工具入参 → 产物）', () => {
  it('最小调用：kind + title + markdown（小节与条目从 markdown 派生）', () => {
    const store = new ArtifactStore()
    const result = publishArtifact(store, {
      kind: 'plan',
      title: '方案：Show 层',
      markdown: '# 方案：Show 层\n\n## 步骤\n- [x] 建模\n- [ ] 视图\n',
    }, { sessionId: 's1' })
    expect(result.kind).toBe('plan')
    expect(result.sessionId).toBe('s1')
    expect(result.items.map((item) => item.status)).toEqual(['done', 'todo'])
    expect(result.sections.map((section) => section.kind)).toContain('steps')
    expect(store.list()).toHaveLength(1)
  })

  it('结构化字段覆盖 markdown 派生（精确控制条目与证据）', () => {
    const store = new ArtifactStore()
    const result = publishArtifact(store, {
      kind: 'verify',
      title: '验收',
      summary: '三条判据都有证据',
      markdown: '# 验收\n\n- [ ] 会被覆盖\n',
      items: JSON.stringify([{ id: 'i1', text: '单测', status: 'done', criteria: '全绿' }]),
      evidence: JSON.stringify([{ label: 'pnpm test', value: '121 passed', result: 'pass', itemId: 'i1' }]),
      openQuestions: JSON.stringify([{ text: '要不要接投影？', blocking: true }]),
    })
    expect(result.items).toHaveLength(1)
    expect(result.items[0].id).toBe('i1')
    expect(result.items[0].criteria).toBe('全绿')
    expect(result.evidence[0].itemId).toBe('i1')
    expect(result.openQuestions[0].blocking).toBe(true)
    expect(result.summary).toBe('三条判据都有证据')
  })

  it('JSON 字段非法 → 指出字段名的清晰错误（面向模型）', () => {
    const store = new ArtifactStore()
    expect(() => publishArtifact(store, { kind: 'plan', title: 'T', items: '{oops' })).toThrow(/items 不是合法 JSON/)
    expect(() => publishArtifact(store, { kind: 'plan', title: 'T', evidence: '{"label":"x"}' })).toThrow(/必须是 JSON 数组/)
  })
})

describe('parseListQuery', () => {
  it('解析 session/limit；非法 limit 忽略', () => {
    expect(parseListQuery('/api/plan-show/artifacts?session=s1&limit=5')).toEqual({ sessionId: 's1', limit: 5 })
    expect(parseListQuery('/api/plan-show/artifacts?limit=abc')).toEqual({})
    expect(parseListQuery(undefined)).toEqual({})
  })
})

describe('artifactReceipt', () => {
  it('有/无条目两种回执', () => {
    expect(artifactReceipt(artifact('a'))).toContain('已呈现「T-a」')
    const withItems = normalizeArtifact({
      kind: 'verify',
      title: '验收',
      items: [{ text: 'x', status: 'todo' }],
      evidence: [{ label: 'l', value: 'v', result: 'pass' }],
    })
    expect(artifactReceipt(withItems)).toContain('1 条目 / 1 证据')
  })
})
