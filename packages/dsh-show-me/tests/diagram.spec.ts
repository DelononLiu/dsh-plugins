/**
 * 图片化呈现的测试：SVG 生成（状态/证据/转义）、`viewBox → 固有尺寸 → data URL`
 * 三步法、以及失败回落。这三步是照官方 `ee35e40bc8` 的图片方法抄的核心。
 */

import { describe, expect, it } from 'vitest'
import { artifactImageUrl, artifactSvg, escapeXml, svgToImageDataUrl } from '../src/client/diagram.ts'
import { normalizeArtifact, type Artifact } from '../src/types.ts'

function artifact(): Artifact {
  return normalizeArtifact({
    kind: 'verify',
    title: '统一升级引擎 v1 验收',
    items: [
      { id: 'i1', text: '升级事务（快照/对齐/滚动重启）', status: 'done' },
      { id: 'i2', text: '失败自动回滚', status: 'done' },
      { id: 'i3', text: '真机闭环复验', status: 'doing' },
      { id: 'i4', text: '阻塞项 <需要人确认>', status: 'blocked' },
    ],
    evidence: [
      { label: 'daemon 日志', value: 'ok', result: 'pass', itemId: 'i1' },
      { label: 'pnpm test', value: '49 passed', result: 'pass', itemId: 'i2' },
      { label: 'pnpm build', value: 'boom', result: 'fail', itemId: 'i3' },
    ],
  })
}

describe('escapeXml', () => {
  it('转义 XML 元字符（文案里的尖括号不能破图）', () => {
    expect(escapeXml('a < b & c "d" \'e\'')).toBe('a &lt; b &amp; c &quot;d&quot; &apos;e&apos;')
  })
})

describe('artifactSvg', () => {
  it('画布尺寸来自条目数，viewBox 与 rect 一致', () => {
    const a = artifact()
    const svg = artifactSvg(a)
    expect(svg).toContain('viewBox="0 0 392 ')
    expect(svg).toMatch(/<rect width="392" height="\d+" fill="#ffffff"\/>/)
    // 每条目一个圆角行 + 一个状态点
    expect(svg.match(/rx="8" fill="#f9fafb"/g)).toHaveLength(4)
  })

  it('状态用固有色（img 内 SVG 拿不到外层 CSS 变量）', () => {
    const svg = artifactSvg(artifact())
    expect(svg).toContain('fill="#16a34a"') // done
    expect(svg).toContain('fill="#d97706"') // doing
    expect(svg).toContain('fill="#dc2626"') // blocked
  })

  it('证据计数：有证据显示 pass/total，无证据显式写"无证据"，有失败标出', () => {
    const svg = artifactSvg(artifact())
    expect(svg).toContain('证据 1/1')
    expect(svg).toContain('证据 0/1（有失败）')
    expect(svg).toContain('无证据')
  })

  it('标题与条目文案被转义（`<需要人确认>` 不会破图）', () => {
    const svg = artifactSvg(artifact())
    expect(svg).toContain('&lt;需要人确认&gt;')
    expect(svg).not.toContain('<需要人确认>')
  })

  it('没有条目时给明确占位而不是空图', () => {
    const svg = artifactSvg(normalizeArtifact({ kind: 'plan', title: '空方案' }))
    expect(svg).toContain('（这份产物没有条目）')
  })
})

describe('svgToImageDataUrl（官方图片方法的核心三步）', () => {
  it('viewBox 宽高写回内联属性（<img> 需要固有尺寸）', () => {
    const url = svgToImageDataUrl('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 36"><rect width="120" height="36"/></svg>')
    expect(url.startsWith('data:image/svg+xml;charset=utf-8,')).toBe(true)
    const svg = decodeURIComponent(url.slice('data:image/svg+xml;charset=utf-8,'.length))
    expect(svg).toContain('width="120"')
    expect(svg).toContain('height="36"')
  })

  it('产物 → 图片 URL 全程可用，且是惰性图片（无脚本/链接元素）', () => {
    const url = artifactImageUrl(artifact())
    const svg = decodeURIComponent(url.slice('data:image/svg+xml;charset=utf-8,'.length))
    expect(svg).toContain('<svg')
    expect(svg).toContain('统一升级引擎 v1 验收')
    expect(svg).not.toContain('<script')
    expect(svg).not.toContain('<a ')
    expect(svg).not.toContain('xlink:href')
  })

  it('非法 SVG 抛错（调用方据此回落原文）', () => {
    expect(() => svgToImageDataUrl('<svg')).toThrow()
  })
})
