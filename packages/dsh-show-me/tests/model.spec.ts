/**
 * 产物模型测试：markdown 导入、小节归类、条目状态。这些是全部 show 的地基，
 * 必须先红后绿地钉住。
 */

import { describe, expect, it } from 'vitest'
import {
  artifactFromMarkdown,
  classifySection,
  stripInline,
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

