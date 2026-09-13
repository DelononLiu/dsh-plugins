/**
 * 消息内就地渲染（client 半区）：把 AI 输出里的 ```plan-show 围栏变成**图片**显示在
 * 消息流里——不用侧栏面板、不需要 agent 调工具（提示词已要求按约定围栏输出）。
 *
 * 只依赖官方**稳定 DOM 钩子**（不碰 css-modules 哈希类名）：
 * - 代码块根：`.md-code-block`（官方 `CodeBlock` 显式挂的稳定类）
 * - 语言名：`.md-code-block .infostring` 的文本
 * - 流式中：祖先带 `data-streaming` → 不渲染（官方 settled-only 语义）
 * - 原文：`.md-code-block pre code` 的文本
 *
 * 呈现照官方图片方法：`artifactImageUrl()` 产出 `data:image/svg+xml` 用 `<img>` 显示
 * （惰性图片：图里的脚本/链接不生效）；默认隐藏源码、提供 图/源码/复制 切换。
 */

import { artifactFromMarkdown, type Artifact } from '../types'
import { artifactImageUrl } from './diagram'
import { SHOW_FENCE } from '../format'

/** 已渲染标记（幂等：同一条消息重复扫描不会重复注入）。 */
export const INLINE_ATTR = 'data-dsh-show-inline'
/** 图片元素标记。 */
export const INLINE_IMG_ATTR = 'data-dsh-show-img'
/** 视图状态（`diagram` | `source`）。 */
export const INLINE_VIEW_ATTR = 'data-dsh-show-view'
/** 幂等样式标记。 */
const CSS_SELECTOR = 'style[data-plugin-css="@dsh-plan-show/inline"]'

/** 代码块根类名（官方稳定钩子）。 */
const CODE_BLOCK = '.md-code-block'
/** 语言名元素。 */
const INFOSTRING = '.infostring'

/** 源码视图标记：被隐藏的原始代码块（渲染后默认隐藏）。 */
const HIDDEN_ATTR = 'data-dsh-show-hidden'

/** 消息内联样式（官方语义 token）。 */
function inlineCss(): string {
  return `
[${INLINE_ATTR}]{margin:12px 0;border:1px solid var(--dsw-alias-border-l1);border-radius:14px;background:var(--dsw-alias-bg-layer-1);padding:10px 12px;display:flex;flex-direction:column;gap:8px}
[${INLINE_ATTR}] [data-dsh-show-bar]{display:flex;align-items:center;gap:8px}
[${INLINE_ATTR}] [data-dsh-show-title]{font-size:12px;color:var(--dsw-alias-label-tertiary);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
[${INLINE_ATTR}] button{height:24px;padding:0 10px;border:0.5px solid var(--dsw-alias-border-l3);border-radius:12px;background:transparent;color:var(--dsw-alias-label-secondary);font-family:inherit;font-size:11px;cursor:pointer}
[${INLINE_ATTR}] button:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
[${INLINE_ATTR}] button[aria-pressed='true']{background:var(--dsw-alias-button-primary-fill);border-color:transparent;color:var(--dsw-alias-label-primary-foreground)}
[${INLINE_ATTR}] [${INLINE_IMG_ATTR}]{display:block;max-width:100%;height:auto;border-radius:10px}
[${INLINE_ATTR}][${INLINE_VIEW_ATTR}='source'] [${INLINE_IMG_ATTR}]{display:none}
[${INLINE_ATTR}][${INLINE_VIEW_ATTR}='diagram'] [data-dsh-show-source]{display:none}
[${INLINE_ATTR}] [data-dsh-show-source]{font-family:var(--ds-font-family-code);font-size:12px;line-height:18px;white-space:pre-wrap;color:var(--dsw-alias-label-secondary)}
`
}

/** 幂等注入样式。 */
function injectCss(): void {
  if (typeof document === 'undefined' || document.querySelector(CSS_SELECTOR) !== null) return
  const tag = document.createElement('style')
  tag.dataset.plugin = 'dsh-plan-show'
  tag.dataset.pluginCss = '@dsh-plan-show/inline'
  tag.textContent = inlineCss()
  document.head.appendChild(tag)
}

/** 语言名（小写；取 `.infostring` 文本，缺失返回空串）。 */
export function languageOf(block: Element): string {
  return block.querySelector(INFOSTRING)?.textContent?.trim().toLowerCase() ?? ''
}

/** 代码块原文（`.md-code-block pre code` 的文本）。 */
export function sourceOf(block: Element): string {
  return block.querySelector('pre code')?.textContent ?? ''
}

/** 是否处于流式中（祖先带 `data-streaming`，值为 'false' 视为已定型）。 */
export function isStreaming(block: Element): boolean {
  const holder = block.closest('[data-streaming]')
  if (holder === null) return false
  return holder.getAttribute('data-streaming') !== 'false'
}

/** 构建内联图块（幂等：已存在则返回既有节点）。 */
function buildFigure(doc: Document, artifact: Artifact, source: string): HTMLElement {
  const figure = doc.createElement('figure')
  figure.setAttribute(INLINE_ATTR, '')
  figure.setAttribute(INLINE_VIEW_ATTR, 'diagram')

  const bar = doc.createElement('div')
  bar.setAttribute('data-dsh-show-bar', '')
  const title = doc.createElement('span')
  title.setAttribute('data-dsh-show-title', '')
  title.textContent = `${artifact.kind === 'verify' ? '验收' : artifact.kind === 'completion' ? '完成' : '方案'} · ${artifact.title}`
  bar.appendChild(title)

  const diagram = doc.createElement('button')
  diagram.type = 'button'
  diagram.textContent = '图'
  const sourceBtn = doc.createElement('button')
  sourceBtn.type = 'button'
  sourceBtn.textContent = '源码'
  const copy = doc.createElement('button')
  copy.type = 'button'
  copy.textContent = '复制'
  const sync = (): void => {
    const showing = figure.getAttribute(INLINE_VIEW_ATTR) === 'diagram'
    diagram.setAttribute('aria-pressed', String(showing))
    sourceBtn.setAttribute('aria-pressed', String(!showing))
  }
  diagram.addEventListener('click', () => { figure.setAttribute(INLINE_VIEW_ATTR, 'diagram'); sync() })
  sourceBtn.addEventListener('click', () => { figure.setAttribute(INLINE_VIEW_ATTR, 'source'); sync() })
  copy.addEventListener('click', () => { void navigator.clipboard?.writeText(source) })
  bar.append(diagram, sourceBtn, copy)
  figure.appendChild(bar)

  const image = doc.createElement('img')
  image.setAttribute(INLINE_IMG_ATTR, '')
  image.alt = `${artifact.title}（结构化图）`
  try {
    image.src = artifactImageUrl(artifact)
  } catch {
    // 画图失败：直接退到源码视图（绝不给空白图）
    figure.setAttribute(INLINE_VIEW_ATTR, 'source')
  }
  figure.appendChild(image)

  const sourceBlock = doc.createElement('div')
  sourceBlock.setAttribute('data-dsh-show-source', '')
  sourceBlock.textContent = source
  figure.appendChild(sourceBlock)
  sync()
  return figure
}

/**
 * 扫描并就地渲染（幂等、可重复调用）。返回本次渲染的块数。
 *
 * 判定顺序：语言必须是约定围栏 → 必须不在流式中 → 同一条消息只渲染一次。
 * @param doc - 文档（测试注入）。
 * @returns 本次新渲染的块数。
 */
export function scanInline(doc: Document = document): number {
  injectCss()
  let rendered = 0
  for (const block of Array.from(doc.querySelectorAll<HTMLElement>(CODE_BLOCK))) {
    if (languageOf(block) !== SHOW_FENCE) continue
    const host = block.parentElement
    if (host === null) continue
    if (host.querySelector(`[${INLINE_ATTR}]`) !== null) continue
    if (isStreaming(block)) continue
    const source = sourceOf(block)
    if (source.trim() === '') continue
    let artifact: Artifact
    try {
      artifact = artifactFromMarkdown(source, { id: `inline-${Math.random().toString(36).slice(2, 8)}` })
    } catch {
      continue
    }
    host.insertBefore(buildFigure(doc, artifact, source), block.nextSibling)
    // 默认看图：隐藏原始代码块（切到"源码"时我们的源码视图已有一份，无需还原）
    block.setAttribute(HIDDEN_ATTR, '')
    block.style.display = 'none'
    rendered++
  }
  return rendered
}

/**
 * 启动消息观察：DOM 变化后（微任务合并）就地渲染约定围栏。
 * @param doc - 文档（测试注入）。
 * @returns 停止函数（断开观察并清理注入节点与隐藏标记）。
 */
export function startInlineShow(doc: Document = document): () => void {
  injectCss()
  let scheduled = false
  const run = (): void => {
    scheduled = false
    scanInline(doc)
  }
  const observer = new MutationObserver(() => {
    if (scheduled) return
    scheduled = true
    queueMicrotask(run)
  })
  observer.observe(doc.body, { childList: true, subtree: true, characterData: true })
  run()
  return () => {
    observer.disconnect()
    for (const figure of Array.from(doc.querySelectorAll<HTMLElement>(`[${INLINE_ATTR}]`))) figure.remove()
    for (const block of Array.from(doc.querySelectorAll<HTMLElement>(`[${HIDDEN_ATTR}]`))) {
      block.removeAttribute(HIDDEN_ATTR)
      block.style.display = ''
    }
  }
}
