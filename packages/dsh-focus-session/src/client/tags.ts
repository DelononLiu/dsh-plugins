/**
 * dsh-focus-session 会话胶囊标签（client 半区）——人工自定义标签的渲染与编辑。
 *
 * 数据：settings `dsh-focus-tags` 的 `tags` 字段（会话 id → 标签数组），由本包
 * 拥有并写入；dsh-focus-tabs 只读同一份渲染顶部标签行。
 *
 * 形状基准（照官方 css-modules 实现，不自由发挥）：
 * - 胶囊 = 官方小标签形态：`height:18px` / `border-radius:9px`（全圆）/ `font-size:11px`
 *   / 内边距 `0 6px` / `gap:4px` / `display:inline-flex`（官方 `.seat` 的 16px 全圆与
 *   `.label` 的 22px/12px 之间的会话行内小尺寸）。
 * - 配色 = 官方 token：底 `--dsw-alias-fill-tsp-secondary`、字 `--dsw-alias-label-secondary`，
 *   色调只换字色（官方状态语义色 primary）。不引入新色值。
 * - 标签编辑弹框 = 官方 Modal 契约（`ui-primitives/src/Modal.module.css`，kernel
 *   0.1.2-rc.1）：根全屏层 z1000 + 遮罩（`--dsw-alias-bg-mask-1` + `--dsw-mask-blur`）
 *   + 居中卡片 r24 / `--dsw-alias-bg-layer-2` / `--dsw-elevation-prominent` /
 *   `width:min(380px,100%)` / 标题行 `22px 14px 12px 24px` / 正文与底部行 `0 24px`；
 *   卡片内的胶囊、输入框、按钮分别用官方 Pill / Input / Button 的几何与 token。
 */

/** 可选的胶囊色调（键即 settings 里存的 tone 值）。 */
export const TAG_TONES = ['neutral', 'blue', 'green', 'amber', 'red'] as const

/** 色调键。 */
export type TagTone = typeof TAG_TONES[number]

/** 一个胶囊标签（与 host 面 SessionTag 同构）。 */
export interface SessionTag {
  /** 标签文字（显示即原文）。 */
  text: string
  /** 色调键；缺省 = 中性。 */
  tone?: string
}

/** 会话 id → 标签数组的映射。 */
export type TagMap = Record<string, SessionTag[]>

/** 幂等样式标签标记（同 dsh-desk `data-plugin-css` 约定）。 */
const CSS_TAG_SELECTOR = 'style[data-plugin-css="@dsh-focus-session/tags"]'

/** 胶囊容器标记（行内标题之后）。 */
export const TAG_LIST_ATTR = 'data-dsh-tag-list'
/** 单个胶囊标记。 */
export const TAG_ATTR = 'data-dsh-tag'
/** 编辑弹框根标记（官方 Modal `.root`：全屏层 + 居中卡片）。 */
export const TAG_EDITOR_ATTR = 'data-dsh-tag-editor'
/** 弹框遮罩标记（官方 Modal `.mask`）。 */
const TAG_MASK_ATTR = 'data-dsh-tag-mask'
/** 弹框卡片标记（官方 Modal `.dialog`）。 */
const TAG_DIALOG_ATTR = 'data-dsh-tag-dialog'
/** 标题行关闭按钮标记（官方 Modal `.close`）。 */
const TAG_CLOSE_ATTR = 'data-dsh-tag-close'
/** 弹框正文标记（官方 Modal `.body`）。 */
const TAG_BODY_ATTR = 'data-dsh-tag-body'
/** 弹框底部操作行标记（官方 Modal `.footer`）。 */
const TAG_FOOTER_ATTR = 'data-dsh-tag-footer'
/** 输入框外壳标记（官方 Input `.wrap`）。 */
const TAG_INPUT_WRAP_ATTR = 'data-dsh-tag-input-wrap'
/** 面板内输入框标记。 */
const TAG_INPUT_ATTR = 'data-dsh-tag-input'
/** 面板内已存在标签（点击删除）标记。 */
const TAG_REMOVE_ATTR = 'data-dsh-tag-remove'

/** 色调归一化：未知值回落到 neutral。 */
export function normalizeTone(tone: unknown): TagTone {
  return typeof tone === 'string' && (TAG_TONES as readonly string[]).includes(tone)
    ? tone as TagTone
    : 'neutral'
}

/** 从标签映射里取某会话的标签（缺省空数组）。 */
export function tagsOf(map: TagMap | undefined, sessionId: string): SessionTag[] {
  const found = map?.[sessionId]
  return Array.isArray(found) ? found.filter((tag) => typeof tag?.text === 'string' && tag.text !== '') : []
}

/** 文本归一化：去首尾空白与前导 `#`（`#` 是显示前缀，不存进数据——否则显示成 `##功能`）。 */
function normalizeText(text: string): string {
  return text.trim().replace(/^#+/, '').trim()
}

/**
 * 胶囊的可见文字：`#` + 标签文本（标签在行首以 hashtag 形态呈现，如 `#功能 会话标题`）。
 * @param tag - 标签。
 * @returns 显示文字。
 */
export function tagLabel(tag: SessionTag): string {
  return `#${tag.text}`
}

/**
 * 加一个标签（同文本已存在时不重复；返回新数组，不改入参）。
 * @param tags - 现有标签。
 * @param text - 标签文字。
 * @param tone - 色调（缺省中性）。
 * @returns 新标签数组。
 */
export function addTag(tags: readonly SessionTag[], text: string, tone?: string): SessionTag[] {
  const value = normalizeText(text)
  if (value === '') return [...tags]
  if (tags.some((tag) => tag.text === value)) return [...tags]
  return [...tags, { text: value, ...tone === undefined ? {} : { tone } }]
}

/**
 * 移除一个标签（按文字；返回新数组，不改入参）。
 * @param tags - 现有标签。
 * @param text - 要移除的标签文字。
 * @returns 新标签数组。
 */
export function removeTag(tags: readonly SessionTag[], text: string): SessionTag[] {
  return tags.filter((tag) => tag.text !== text)
}

/** 胶囊 + 标签编辑弹框样式。 */
export function tagCss(): string {
  return [
    // 胶囊（官方小标签形态：全圆角 + 小字号 + 语义色字）；行首排列，右侧 4px 与标题分隔。
    `[${TAG_LIST_ATTR}]{flex:none;display:inline-flex;align-items:center;min-width:0;max-width:60%;overflow:hidden}`,
    `[${TAG_ATTR}]{flex:none;display:inline-flex;align-items:center;height:18px;margin-right:4px;padding:0 6px;border-radius:9px;background:var(--dsw-alias-fill-tsp-secondary);color:var(--dsw-alias-label-secondary);font-size:11px;line-height:18px;white-space:nowrap;max-width:96px;overflow:hidden;text-overflow:ellipsis}`,
    `[${TAG_ATTR}][data-tone='blue']{color:var(--dsw-alias-state-business-primary)}`,
    `[${TAG_ATTR}][data-tone='green']{color:var(--dsw-alias-state-success-primary)}`,
    `[${TAG_ATTR}][data-tone='amber']{color:var(--dsw-alias-state-warn-primary)}`,
    `[${TAG_ATTR}][data-tone='red']{color:var(--dsw-alias-state-error-primary)}`,
    // 编辑弹框 = 官方 Modal 契约（ui-primitives/src/Modal.module.css，kernel 0.1.2-rc.1）：
    // 根全屏层 z1000 + 遮罩（bg-mask-1 + mask-blur）+ 居中卡片 r24 / layer-2 /
    // elevation-prominent / width min(380px,100%) / gap 20 / padding 0 0 24px。
    `[${TAG_EDITOR_ATTR}]{position:fixed;inset:0;z-index:1000;display:flex;align-items:center;justify-content:center;padding:24px;font-family:inherit}`,
    `[${TAG_MASK_ATTR}]{position:absolute;inset:0;background:var(--dsw-alias-bg-mask-1);backdrop-filter:var(--dsw-mask-blur)}`,
    `[${TAG_DIALOG_ATTR}]{position:relative;z-index:1;display:flex;flex-direction:column;gap:20px;box-sizing:border-box;width:min(380px,100%);padding:0 0 24px;overflow:hidden;border:0;border-radius:24px;background:var(--dsw-alias-bg-layer-2);box-shadow:var(--dsw-elevation-prominent)}`,
    // 标题行（官方 .header pad l24/t22/r14/b12；标题 16/24 wt500；关闭钮 28×28 r8）。
    `[${TAG_EDITOR_ATTR}] [data-dsh-tag-header]{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:22px 14px 12px 24px}`,
    `[${TAG_EDITOR_ATTR}] [data-dsh-tag-editor-title]{margin:0;font-size:16px;line-height:24px;font-weight:500;color:var(--dsw-alias-label-primary)}`,
    `[${TAG_CLOSE_ATTR}]{flex:none;display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;padding:0;border:none;border-radius:8px;background:transparent;cursor:pointer;color:var(--dsw-alias-label-secondary)}`,
    `[${TAG_CLOSE_ATTR}]:hover{background:var(--dsw-alias-interactive-bg-hover)}`,
    // 正文（官方 .body：margin-top 20 / padding 0 24px）。
    `[${TAG_BODY_ATTR}]{display:flex;flex-direction:column;gap:12px;min-width:0;margin-top:20px;padding:0 24px}`,
    `[${TAG_EDITOR_ATTR}] [data-dsh-tag-editor-current]{display:flex;flex-wrap:wrap;gap:4px}`,
    // 已存在标签 = 官方 Pill 几何（h24 / pad 0 8px / r12 / 12-18 / layer-2 底）。
    `[${TAG_REMOVE_ATTR}]{display:inline-flex;align-items:center;gap:4px;height:24px;padding:0 8px;border:none;border-radius:12px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font-family:inherit;font-size:12px;line-height:18px;cursor:pointer}`,
    `[${TAG_REMOVE_ATTR}]:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}`,
    // 输入框 = 官方 Input 契约（.wrap h32 / pad 0 8px / 0.5px border-l4 / r8 / layer-1）。
    `[${TAG_INPUT_WRAP_ATTR}]{display:inline-flex;align-items:center;gap:6px;box-sizing:border-box;height:32px;padding:0 8px;border:0.5px solid var(--dsw-alias-border-l4);border-radius:8px;background:var(--dsw-alias-bg-layer-1)}`,
    `[${TAG_INPUT_WRAP_ATTR}]:focus-within{border-color:var(--dsw-alias-brand-primary)}`,
    `[${TAG_INPUT_ATTR}]{flex:1;min-width:0;border:none;outline:none;background:transparent;font-family:inherit;font-size:14px;line-height:22px;color:var(--dsw-alias-label-primary)}`,
    `[${TAG_INPUT_ATTR}]::placeholder{color:var(--dsw-alias-label-dimmed)}`,
    `[${TAG_EDITOR_ATTR}] [data-dsh-tag-editor-tones]{display:flex;align-items:center;gap:6px}`,
    `[${TAG_EDITOR_ATTR}] [data-dsh-tag-tone]{width:16px;height:16px;padding:0;border:0.5px solid var(--dsw-alias-border-l4);border-radius:50%;background:transparent;cursor:pointer}`,
    `[${TAG_EDITOR_ATTR}] [data-dsh-tag-tone]:hover{border-color:var(--dsw-alias-label-secondary)}`,
    `[${TAG_EDITOR_ATTR}] [data-dsh-tag-tone][data-tone='blue'][aria-pressed='true']{background:var(--dsw-alias-state-business-primary)}`,
    `[${TAG_EDITOR_ATTR}] [data-dsh-tag-tone][data-tone='green'][aria-pressed='true']{background:var(--dsw-alias-state-success-primary)}`,
    `[${TAG_EDITOR_ATTR}] [data-dsh-tag-tone][data-tone='amber'][aria-pressed='true']{background:var(--dsw-alias-state-warn-primary)}`,
    `[${TAG_EDITOR_ATTR}] [data-dsh-tag-tone][data-tone='red'][aria-pressed='true']{background:var(--dsw-alias-state-error-primary)}`,
    `[${TAG_EDITOR_ATTR}] [data-dsh-tag-tone][data-tone='neutral'][aria-pressed='true']{background:var(--dsw-alias-label-tertiary)}`,
    // 底部操作行（官方 .footer：右对齐 + gap 8 + padding 0 24px）+ 官方 Button 契约
    // （h36 / pad 0 14px / r18 / 14-22；outline = 0.5px border-l3；primary = button-primary-fill）。
    `[${TAG_FOOTER_ATTR}]{display:flex;align-items:center;justify-content:flex-end;gap:8px;padding:0 24px}`,
    `[${TAG_FOOTER_ATTR}] button{display:inline-flex;align-items:center;justify-content:center;gap:4px;height:36px;padding:0 14px;border:none;border-radius:18px;background:transparent;color:var(--dsw-alias-label-primary);font-family:inherit;font-size:14px;line-height:22px;cursor:pointer}`,
    `[${TAG_FOOTER_ATTR}] button[data-variant='outline']{border:0.5px solid var(--dsw-alias-border-l3)}`,
    `[${TAG_FOOTER_ATTR}] button[data-variant='outline']:hover{background:var(--dsw-alias-interactive-bg-hover)}`,
    `[${TAG_FOOTER_ATTR}] button[data-variant='primary']{background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground)}`,
    `[${TAG_FOOTER_ATTR}] button[data-variant='primary']:hover{background:var(--dsw-alias-button-primary-hover)}`,
  ].join('')
}

/**
 * 样式引用计数：置顶区与活跃区共用同一份标签样式，任一方卸载都不应摘掉另一方
 * 仍在使用的样式（各自独立 start/stop 时尤其如此）。
 */
let tagCssRefs = 0

/**
 * 幂等注入样式（已注入则复用）。返回释放函数——**引用计数归零才真正摘除**，
 * 且同一持有者重复调用释放只生效一次。
 * @returns 释放函数。
 */
export function injectTagCss(): () => void {
  if (typeof document === 'undefined') return () => {}
  tagCssRefs++
  let released = false
  const release = (): void => {
    if (released) return
    released = true
    tagCssRefs = Math.max(0, tagCssRefs - 1)
    if (tagCssRefs === 0) document.querySelector(CSS_TAG_SELECTOR)?.remove()
  }
  if (tagCssRefs > 1) return release
  const tag = document.createElement('style')
  tag.dataset.plugin = 'dsh-focus-session'
  tag.dataset.pluginCss = '@dsh-focus-session/tags'
  tag.textContent = tagCss()
  document.head.appendChild(tag)
  return release
}

/**
 * 幂等渲染胶囊（同内容零 DOM 写——行由 body 级 observer 驱动 sync，多余写入会
 * 造成自触发循环）。可见文字带 `#` 前缀（hashtag 形态），存的数据不带。
 * @param container - 胶囊容器（行首、标题之前）。
 * @param tags - 该会话的标签。
 * @param doc - 文档（测试注入）。
 */
export function renderTagPills(container: HTMLElement, tags: readonly SessionTag[], doc: Document): void {
  const wanted = tags.filter((tag) => tag.text !== '')
  const existing = Array.from(container.querySelectorAll<HTMLElement>(`[${TAG_ATTR}]`))
  const same = existing.length === wanted.length && existing.every((el, i) => (
    el.textContent === tagLabel(wanted[i]) && normalizeTone(el.dataset.tone) === normalizeTone(wanted[i].tone)
  ))
  if (same) return
  container.replaceChildren()
  for (const tag of wanted) {
    const pill = doc.createElement('span')
    pill.setAttribute(TAG_ATTR, '')
    pill.dataset.tone = normalizeTone(tag.tone)
    pill.textContent = tagLabel(tag)
    pill.title = tagLabel(tag)
    container.appendChild(pill)
  }
}

/** 标签编辑弹框的依赖。 */
export interface TagEditorDeps {
  /** 会话 id。 */
  sessionId: string
  /** 读该会话当前标签。 */
  getTags(sessionId: string): readonly SessionTag[]
  /** 写该会话标签（整份映射由调用方回写 settings）。 */
  setTags(sessionId: string, tags: readonly SessionTag[]): void
  /** 文档（测试注入；缺省 = 当前文档，与官方 Modal 的 `createPortal(document.body)` 同落点）。 */
  doc?: Document
}

/** 当前打开的编辑弹框（同一时刻只允许一个）。 */
let openEditor: { root: HTMLElement; dispose: () => void } | null = null

/** 关闭当前编辑弹框（若有）。 */
export function closeTagEditor(): void {
  if (openEditor === null) return
  const current = openEditor
  openEditor = null
  current.dispose()
  current.root.remove()
}

/**
 * 打开标签编辑弹框：列出当前标签（点击移除）+ 输入框（回车加标签）+ 色调选择。
 * 形态照官方 Modal 契约（遮罩 + 居中卡片 + 标题行/正文/底部操作行）；同一时刻只
 * 保留一个弹框；Esc、遮罩点击、关闭/取消/完成都关闭（标签在回车时即时写入）。
 * @param deps - 弹框依赖。
 */
export function openTagEditor(deps: TagEditorDeps): void {
  const doc = deps.doc ?? document
  closeTagEditor()
  let tone: TagTone = 'neutral'

  const root = doc.createElement('div')
  root.setAttribute(TAG_EDITOR_ATTR, '')
  root.setAttribute('role', 'presentation')

  const mask = doc.createElement('div')
  mask.setAttribute(TAG_MASK_ATTR, '')
  mask.setAttribute('aria-hidden', 'true')
  root.appendChild(mask)

  const dialog = doc.createElement('div')
  dialog.setAttribute(TAG_DIALOG_ATTR, '')
  dialog.setAttribute('role', 'dialog')
  dialog.setAttribute('aria-modal', 'true')
  dialog.setAttribute('aria-label', '编辑标签')
  root.appendChild(dialog)

  const header = doc.createElement('div')
  header.setAttribute('data-dsh-tag-header', '')
  const title = doc.createElement('h2')
  title.setAttribute('data-dsh-tag-editor-title', '')
  title.textContent = '编辑标签'
  const close = doc.createElement('button')
  close.type = 'button'
  close.setAttribute(TAG_CLOSE_ATTR, '')
  close.setAttribute('aria-label', '关闭')
  close.textContent = '✕'
  header.append(title, close)
  dialog.appendChild(header)

  const body = doc.createElement('div')
  body.setAttribute(TAG_BODY_ATTR, '')
  dialog.appendChild(body)

  const current = doc.createElement('div')
  current.setAttribute('data-dsh-tag-editor-current', '')
  body.appendChild(current)

  const inputWrap = doc.createElement('div')
  inputWrap.setAttribute(TAG_INPUT_WRAP_ATTR, '')
  const input = doc.createElement('input')
  input.setAttribute(TAG_INPUT_ATTR, '')
  input.type = 'text'
  input.placeholder = '输入标签，回车添加'
  inputWrap.appendChild(input)
  body.appendChild(inputWrap)

  const tones = doc.createElement('div')
  tones.setAttribute('data-dsh-tag-editor-tones', '')
  for (const candidate of TAG_TONES) {
    const dot = doc.createElement('button')
    dot.type = 'button'
    dot.setAttribute('data-dsh-tag-tone', '')
    dot.dataset.tone = candidate
    dot.title = candidate
    dot.setAttribute('aria-label', `色调 ${candidate}`)
    dot.setAttribute('aria-pressed', String(candidate === tone))
    dot.addEventListener('click', () => {
      tone = candidate
      for (const el of Array.from(tones.querySelectorAll<HTMLElement>('[data-dsh-tag-tone]'))) {
        el.setAttribute('aria-pressed', String(el.dataset.tone === tone))
      }
      input.focus()
    })
    tones.appendChild(dot)
  }
  body.appendChild(tones)

  const footer = doc.createElement('div')
  footer.setAttribute(TAG_FOOTER_ATTR, '')
  const cancel = doc.createElement('button')
  cancel.type = 'button'
  cancel.dataset.variant = 'outline'
  cancel.textContent = '取消'
  const done = doc.createElement('button')
  done.type = 'button'
  done.dataset.variant = 'primary'
  done.textContent = '完成'
  footer.append(cancel, done)
  dialog.appendChild(footer)

  /** 重画弹框内当前标签（点击移除）。 */
  const renderCurrent = (): void => {
    const tags = deps.getTags(deps.sessionId)
    current.replaceChildren()
    if (tags.length === 0) {
      const empty = doc.createElement('span')
      empty.textContent = '（无标签）'
      empty.style.color = 'var(--dsw-alias-label-tertiary)'
      empty.style.fontSize = '12px'
      current.appendChild(empty)
      return
    }
    for (const tag of tags) {
      const chip = doc.createElement('button')
      chip.type = 'button'
      chip.setAttribute(TAG_REMOVE_ATTR, '')
      chip.textContent = `${tag.text} ×`
      chip.title = `移除「${tag.text}」`
      chip.addEventListener('click', () => {
        deps.setTags(deps.sessionId, removeTag(deps.getTags(deps.sessionId), tag.text))
        renderCurrent()
      })
      current.appendChild(chip)
    }
  }

  input.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key !== 'Enter') return
    e.preventDefault()
    const text = input.value
    if (normalizeText(text) === '') return
    deps.setTags(deps.sessionId, addTag(deps.getTags(deps.sessionId), text, tone))
    input.value = ''
    renderCurrent()
  })
  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') closeTagEditor()
  }
  mask.addEventListener('click', () => closeTagEditor())
  close.addEventListener('click', () => closeTagEditor())
  cancel.addEventListener('click', () => closeTagEditor())
  done.addEventListener('click', () => closeTagEditor())
  doc.addEventListener('keydown', onKeyDown)

  renderCurrent()
  doc.body.appendChild(root)
  openEditor = {
    root,
    dispose: (): void => doc.removeEventListener('keydown', onKeyDown),
  }
  input.focus()
}
