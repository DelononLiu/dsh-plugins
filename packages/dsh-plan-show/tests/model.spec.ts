/**
 * 共享产物模型测试：markdown 导入、工具入参归一化（含错误信息）、验收矩阵与统计、
 * markdown 导出。这些是全部 show 的地基，必须先红后绿地钉住。
 */

import { describe, expect, it } from 'vitest'
import {
  artifactFromMarkdown,
  artifactStats,
  artifactToMarkdown,
  classifySection,
  normalizeArtifact,
  stripInline,
  verifyMatrix,
  type Artifact,
} from '../src/types.ts'

const PLAN_MD = `# 把方案可视化

## 目标 / 问题
读大段文字太累。

## 步骤
- [x] 解析 markdown
- [~] 写视图
- [ ] 接数据源
- [!] 等内核 API
1. 补单测

## 风险
- 启发式解析会退化
`

describe('classifySection / stripInline', () => {
  it('按中英关键词归类小节', () => {
    expect(classifySection('目标 / 问题')).toBe('goal')
    expect(classifySection('Steps')).toBe('steps')
    expect(classifySection('影响面')).toBe('impact')
    expect(classifySection('风险')).toBe('risk')
    expect(classifySection('验证')).toBe('verify')
    expect(classifySection('背景')).toBe('context')
    expect(classifySection('随便')).toBe('other')
  })

  it('去掉行内强调与反引号', () => {
    expect(stripInline('**粗** `码` [链](http://x)')).toBe('粗 码 链')
  })
})

describe('artifactFromMarkdown', () => {
  it('解析标题 / 小节 / 条目状态（x=done ~=doing !=blocked）', () => {
    const artifact = artifactFromMarkdown(PLAN_MD, { id: 'a1', producedAt: 1 })
    expect(artifact.title).toBe('把方案可视化')
    expect(artifact.kind).toBe('plan')
    expect(artifact.sections.map((section) => section.kind)).toEqual(['goal', 'steps', 'risk'])
    expect(artifact.items.map((item) => item.status)).toEqual(['done', 'doing', 'todo', 'blocked', 'todo'])
    expect(artifact.items[0].text).toBe('解析 markdown')
    expect(artifact.producedAt).toBe(1)
    // 编号列表也是条目，`- ` 是要点而非条目
    expect(artifact.items[4].text).toBe('补单测')
  })

  it('空输入 → 空壳产物（不抛错）', () => {
    const artifact = artifactFromMarkdown('', { id: 'a2' })
    expect(artifact.title).toBe('未命名方案')
    expect(artifact.items).toEqual([])
  })
})

describe('normalizeArtifact', () => {
  const base = { kind: 'verify', title: '验收：升级引擎' }

  it('最小入参即可（kind + title），缺省字段补齐', () => {
    const artifact = normalizeArtifact(base)
    expect(artifact.kind).toBe('verify')
    expect(artifact.items).toEqual([])
    expect(artifact.evidence).toEqual([])
    expect(artifact.summary).toBe('')
    expect(artifact.producedAt).toBeGreaterThan(0)
  })

  it('kind 非法 / title 缺失 → 面向模型的清晰错误', () => {
    expect(() => normalizeArtifact({ ...base, kind: 'nope' })).toThrow(/kind 必须是/)
    expect(() => normalizeArtifact({ kind: 'plan', title: '   ' })).toThrow(/title 必填/)
    expect(() => normalizeArtifact(null)).toThrow(/需要一个对象/)
  })

  it('条目与证据归一化：状态/结果回落、itemId 挂载、files 过滤', () => {
    const artifact = normalizeArtifact({
      ...base,
      items: [
        { text: '跑测试', status: 'weird', files: ['a.ts', 42] },
        { text: '跑构建', status: 'done', criteria: ' exit 0 ' },
      ],
      evidence: [
        { label: 'pnpm test', value: '121 passed', result: 'pass', itemId: 'i1' },
        { label: 'pnpm build', value: 'ok', result: 'nope' },
      ],
    })
    expect(artifact.items[0].status).toBe('todo')
    expect(artifact.items[0].files).toEqual(['a.ts'])
    expect(artifact.items[1].criteria).toBe('exit 0')
    expect(artifact.evidence[0].itemId).toBe('i1')
    expect(artifact.evidence[1].result).toBe('info')
    expect(artifact.evidence[1].kind).toBe('command')
  })

  it('待决/待定：非法项被丢弃而不是整体失败', () => {
    const artifact = normalizeArtifact({
      ...base,
      decisions: [
        { question: '走哪条路？', options: [{ label: 'A', detail: '快' }, { label: '' }], chosen: 'o0' },
        { question: '' },
      ],
      openQuestions: [{ text: '要不要持久化？', blocking: true }, { text: '  ' }],
    })
    expect(artifact.decisions).toHaveLength(1)
    expect(artifact.decisions[0].options).toHaveLength(1)
    expect(artifact.decisions[0].chosen).toBe('o0')
    expect(artifact.openQuestions).toEqual([{ id: 'q0', text: '要不要持久化？', blocking: true }])
  })
})

describe('verifyMatrix / artifactStats（"无证据 = 未验证"硬规则）', () => {
  const artifact: Artifact = normalizeArtifact({
    kind: 'verify',
    title: '验收',
    items: [
      { id: 'i1', text: '单测', status: 'done' },
      { id: 'i2', text: '构建', status: 'done' },
      { id: 'i3', text: '手验', status: 'todo' },
    ],
    evidence: [
      { label: 'pnpm test', value: 'ok', result: 'pass', itemId: 'i1' },
      { label: 'pnpm build', value: 'warn', result: 'info', itemId: 'i2' },
    ],
  })

  it('只有"状态 done + 至少一条 pass 证据"才算已验证', () => {
    const rows = verifyMatrix(artifact)
    expect(rows.map((row) => row.verified)).toEqual([true, false, false])
    expect(rows[0].evidence).toHaveLength(1)
    expect(rows[2].evidence).toEqual([])
  })

  it('统计口径：条目状态 + 证据数 + 已验证数', () => {
    expect(artifactStats(artifact)).toEqual({ total: 3, done: 2, doing: 0, todo: 1, blocked: 0, evidence: 2, verified: 1 })
  })
})

describe('artifactToMarkdown（导出口径）', () => {
  it('导出含标题/小节/条目状态/证据/待定，且可被重新导入', () => {
    const original = artifactFromMarkdown(PLAN_MD, { id: 'a1', producedAt: 1 })
    const artifact: Artifact = {
      ...original,
      evidence: [{ id: 'e1', kind: 'test', label: 'pnpm test', value: 'ok', result: 'pass' }],
      openQuestions: [{ id: 'q1', text: '要不要持久化？', blocking: true }],
    }
    const markdown = artifactToMarkdown(artifact)
    expect(markdown).toContain('# 把方案可视化')
    expect(markdown).toContain('- [x] 解析 markdown')
    expect(markdown).toContain('- [~] 写视图')
    expect(markdown).toContain('- [!] 等内核 API')
    expect(markdown).toContain('pnpm test: ok → pass')
    expect(markdown).toContain('阻塞：要不要持久化？')

    const reimported = artifactFromMarkdown(markdown, { id: 'a2' })
    // 回导后条目数不变（"待定"行不是复选框形态，不会被误认成条目）。
    expect(reimported.items.map((item) => item.status)).toEqual(['done', 'doing', 'todo', 'blocked', 'todo'])
  })
})
