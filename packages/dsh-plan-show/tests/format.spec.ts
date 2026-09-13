/**
 * 约定格式测试：围栏抽取（含未闭合 = 流式中不渲染）、提示词段包含关键约束、
 * 产物 → 围栏往返（保证"提示词要求什么"与"解析器认什么"是同一份契约）。
 */

import { describe, expect, it } from 'vitest'
import { SHOW_FENCE, SHOW_FORMAT_PROMPT, extractShowBlocks, hasShowFence, toShowFence } from '../src/format.ts'
import { artifactFromMarkdown } from '../src/types.ts'

describe('extractShowBlocks', () => {
  it('抽取已闭合围栏（语言名大小写不敏感，允许行尾标题）', () => {
    const text = [
      '先说结论。',
      '',
      '```PLAN-SHOW 方案',
      '# 标题',
      '## 步骤',
      '- [x] 一条',
      '```',
      '',
      '再看这里。',
    ].join('\n')
    const blocks = extractShowBlocks(text)
    expect(blocks).toHaveLength(1)
    expect(blocks[0].body).toBe('# 标题\n## 步骤\n- [x] 一条')
    // 偏移能定位回原文
    expect(text.slice(blocks[0].start, blocks[0].end)).toContain('## 步骤')
  })

  it('未闭合围栏不返回（流式输出中不能渲染半截图）', () => {
    const text = '```plan-show\n# 标题\n- [ ] 还没写完'
    expect(extractShowBlocks(text)).toEqual([])
    expect(hasShowFence(text)).toBe(true)
  })

  it('多个围栏都返回；非约定语言的围栏忽略', () => {
    const text = [
      '```ts',
      'const a = 1',
      '```',
      '```plan-show',
      '# A',
      '```',
      '```plan-show',
      '# B',
      '```',
    ].join('\n')
    expect(extractShowBlocks(text).map((block) => block.body)).toEqual(['# A', '# B'])
  })

  it('未被围栏包裹的普通文本不产生块（legacy 消息不会被误渲染）', () => {
    expect(extractShowBlocks('# 标题\n- [ ] 条目\n普通段落')).toEqual([])
    expect(hasShowFence('# 标题\n- [ ] 条目')).toBe(false)
  })
})

describe('SHOW_FORMAT_PROMPT（提示词契约）', () => {
  it('说明围栏名、状态标记与证据口径（渲染规则的唯一来源）', () => {
    expect(SHOW_FORMAT_PROMPT).toContain(SHOW_FENCE)
    expect(SHOW_FORMAT_PROMPT).toContain('[x]')
    expect(SHOW_FORMAT_PROMPT).toContain('[~]')
    expect(SHOW_FORMAT_PROMPT).toContain('[!]')
    expect(SHOW_FORMAT_PROMPT).toContain('证据')
    expect(SHOW_FORMAT_PROMPT).toContain('未验证')
    expect(SHOW_FORMAT_PROMPT).toContain('未闭合')
  })
})

describe('toShowFence × 解析器（往返一致）', () => {
  it('围栏里的结构能被解析器读成条目与状态', () => {
    const artifact = artifactFromMarkdown('# 方案\n## 步骤\n- [x] 完成项\n- [~] 进行项\n- [!] 阻塞项\n', { id: 'a1' })
    const text = toShowFence(artifact)
    expect(text.startsWith('```plan-show')).toBe(true)
    const blocks = extractShowBlocks(text)
    expect(blocks).toHaveLength(1)
    const parsed = artifactFromMarkdown(blocks[0].body, { id: 'a2' })
    expect(parsed.title).toBe('方案')
    expect(parsed.items.map((item) => item.status)).toEqual(['done', 'doing', 'blocked'])
  })
})
