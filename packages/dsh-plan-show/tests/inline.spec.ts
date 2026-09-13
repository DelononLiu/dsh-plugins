/**
 * 消息内就地渲染测试：用**官方稳定 DOM 形状**（`.md-code-block` + `.infostring`
 * + `data-streaming`）造现场，验证：流式中不渲染、定型后渲染成图片、幂等、
 * 图/源码切换、非约定语言不碰、停止时还原。
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { INLINE_ATTR, INLINE_IMG_ATTR, INLINE_VIEW_ATTR, languageOf, scanInline, sourceOf, startInlineShow } from '../src/client/inline.ts'

/** 造一个官方形状的代码块（语言名 + 源码）。 */
function codeBlock(lang: string, code: string, streaming = false): HTMLElement {
  const turn = document.createElement('div')
  if (streaming) turn.setAttribute('data-streaming', 'true')
  const block = document.createElement('div')
  block.className = 'md-code-block other-css-hash'
  const banner = document.createElement('div')
  const info = document.createElement('div')
  info.className = 'infostring'
  info.textContent = lang
  banner.appendChild(info)
  const pre = document.createElement('pre')
  const codeEl = document.createElement('code')
  codeEl.textContent = code
  pre.appendChild(codeEl)
  block.append(banner, pre)
  turn.appendChild(block)
  document.body.appendChild(turn)
  return block
}

const PLAN = '# 统一升级引擎验收\n## 步骤\n- [x] 事务\n- [~] 真机复验\n'

describe('官方 DOM 钩子解析', () => {
  beforeEach(() => { document.body.innerHTML = '' })

  it('语言名取 .infostring；原文取 pre code', () => {
    const block = codeBlock('Plan-Show', PLAN)
    expect(languageOf(block)).toBe('plan-show')
    expect(sourceOf(block)).toBe(PLAN)
  })
})

describe('scanInline', () => {
  beforeEach(() => { document.body.innerHTML = '' })

  it('定型后才渲染：流式中的围栏不渲染', () => {
    codeBlock('plan-show', PLAN, true)
    expect(scanInline(document)).toBe(0)
    expect(document.querySelector(`[${INLINE_ATTR}]`)).toBeNull()
  })

  it('渲染成惰性图片 + 隐藏源码块；标题带类型前缀', () => {
    const block = codeBlock('plan-show', PLAN)
    expect(scanInline(document)).toBe(1)
    const figure = document.querySelector<HTMLElement>(`[${INLINE_ATTR}]`)!
    const img = figure.querySelector<HTMLImageElement>(`[${INLINE_IMG_ATTR}]`)!
    expect(img.src.startsWith('data:image/svg+xml;charset=utf-8,')).toBe(true)
    expect(figure.getAttribute(INLINE_VIEW_ATTR)).toBe('diagram')
    expect(figure.querySelector('[data-dsh-show-title]')!.textContent).toContain('方案 · 统一升级引擎验收')
    expect(block.style.display).toBe('none')
    // 默认图视图 → 图片显示、源码视图隐藏（CSS 控制，这里断言状态属性）
    const svg = decodeURIComponent(img.src.slice('data:image/svg+xml;charset=utf-8,'.length))
    expect(svg).not.toContain('<script')
  })

  it('图/源码切换改状态属性', () => {
    codeBlock('plan-show', PLAN)
    scanInline(document)
    const figure = document.querySelector<HTMLElement>(`[${INLINE_ATTR}]`)!
    const [diagram, source] = Array.from(figure.querySelectorAll('button'))
    source.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(figure.getAttribute(INLINE_VIEW_ATTR)).toBe('source')
    expect(diagram.getAttribute('aria-pressed')).toBe('false')
    diagram.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(figure.getAttribute(INLINE_VIEW_ATTR)).toBe('diagram')
  })

  it('幂等：重复扫描不重复注入', () => {
    codeBlock('plan-show', PLAN)
    expect(scanInline(document)).toBe(1)
    expect(scanInline(document)).toBe(0)
    expect(document.querySelectorAll(`[${INLINE_ATTR}]`)).toHaveLength(1)
  })

  it('非约定语言不碰（ts / mermaid 保持原样）', () => {
    codeBlock('ts', 'const a = 1')
    codeBlock('mermaid', 'flowchart TD\n A --> B')
    expect(scanInline(document)).toBe(0)
    expect(document.querySelectorAll(`[${INLINE_ATTR}]`)).toHaveLength(0)
  })

  it('空围栏不渲染', () => {
    codeBlock('plan-show', '   \n')
    expect(scanInline(document)).toBe(0)
  })
})

describe('startInlineShow（观察器）', () => {
  beforeEach(() => { document.body.innerHTML = '' })

  it('后插入的定型围栏会被自动渲染；停止时清理注入并还原源码块', async () => {
    const stop = startInlineShow(document)
    const block = codeBlock('plan-show', PLAN)
    await new Promise((resolve) => { setTimeout(resolve, 0) })
    expect(document.querySelector(`[${INLINE_ATTR}]`)).not.toBeNull()

    stop()
    expect(document.querySelector(`[${INLINE_ATTR}]`)).toBeNull()
    expect(block.style.display).toBe('')
    expect(block.hasAttribute('data-dsh-show-hidden')).toBe(false)
  })
})
