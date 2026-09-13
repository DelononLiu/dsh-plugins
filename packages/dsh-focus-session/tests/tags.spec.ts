/**
 * dsh-focus-session 胶囊标签测试：色调归一化、标签读写纯函数、胶囊幂等渲染
 * （同内容零 DOM 写）、编辑面板（添加/移除/关闭）。
 */

import { beforeEach, describe, expect, it } from 'vitest'
import {
  TAG_ATTR,
  TAG_EDITOR_ATTR,
  TAG_LIST_ATTR,
  TAG_TONES,
  addTag,
  closeTagEditor,
  injectTagCss,
  normalizeTone,
  openTagEditor,
  removeTag,
  renderTagPills,
  tagCss,
  tagLabel,
  tagsOf,
} from '../src/client/tags.ts'

describe('normalizeTone', () => {
  it('已知色调原样返回', () => {
    for (const tone of TAG_TONES) expect(normalizeTone(tone)).toBe(tone)
  })

  it('未知/空值回落到 neutral', () => {
    expect(normalizeTone(undefined)).toBe('neutral')
    expect(normalizeTone('purple')).toBe('neutral')
    expect(normalizeTone(42)).toBe('neutral')
  })
})

describe('tagsOf', () => {
  it('缺省返回空数组', () => {
    expect(tagsOf(undefined, 'a')).toEqual([])
    expect(tagsOf({}, 'a')).toEqual([])
  })

  it('返回该会话标签并剔除空文本项', () => {
    const map = { a: [{ text: '重要' }, { text: '' }] }
    expect(tagsOf(map, 'a')).toEqual([{ text: '重要' }])
  })
})

describe('tagLabel', () => {
  it('可见文字带 # 前缀（数据不带）', () => {
    expect(tagLabel({ text: '功能' })).toBe('#功能')
  })
})

describe('addTag / removeTag', () => {
  it('添加标签（带色调）且不改入参', () => {
    const before: { text: string; tone?: string }[] = []
    const after = addTag(before, ' 重要 ', 'blue')
    expect(after).toEqual([{ text: '重要', tone: 'blue' }])
    expect(before).toEqual([])
  })

  it('空文本或重复标签不添加', () => {
    expect(addTag([], '   ')).toEqual([])
    const one = [{ text: '重要' }]
    expect(addTag(one, '重要')).toEqual(one)
  })

  it('输入带 # 前缀时按原文存储（# 只是显示前缀）', () => {
    expect(addTag([], '  #功能  ')).toEqual([{ text: '功能' }])
    expect(addTag([], '##功能')).toEqual([{ text: '功能' }])
  })

  it('按文字移除标签', () => {
    const tags = [{ text: '重要' }, { text: '待办' }]
    expect(removeTag(tags, '重要')).toEqual([{ text: '待办' }])
    expect(removeTag(tags, '不存在')).toEqual(tags)
  })
})

describe('renderTagPills', () => {
  let container: HTMLElement

  beforeEach(() => {
    document.body.innerHTML = ''
    container = document.createElement('span')
    container.setAttribute(TAG_LIST_ATTR, '')
    document.body.appendChild(container)
  })

  it('渲染胶囊文字与色调', () => {
    renderTagPills(container, [{ text: '重要', tone: 'blue' }, { text: '无色调' }], document)
    const pills = Array.from(container.querySelectorAll(`[${TAG_ATTR}]`))
    expect(pills.map((el) => el.textContent)).toEqual(['#重要', '#无色调'])
    expect(pills[0].getAttribute('data-tone')).toBe('blue')
    expect(pills[1].getAttribute('data-tone')).toBe('neutral')
  })

  it('同内容重复渲染零 DOM 写（幂等，防 observer 自触发）', () => {
    renderTagPills(container, [{ text: '重要', tone: 'blue' }], document)
    const before = container.firstElementChild
    renderTagPills(container, [{ text: '重要', tone: 'blue' }], document)
    expect(container.firstElementChild).toBe(before)
  })

  it('内容变化时重建', () => {
    renderTagPills(container, [{ text: '重要' }], document)
    renderTagPills(container, [{ text: '待办', tone: 'amber' }], document)
    const pills = Array.from(container.querySelectorAll(`[${TAG_ATTR}]`))
    expect(pills.map((el) => el.textContent)).toEqual(['#待办'])
    expect(pills[0].getAttribute('data-tone')).toBe('amber')
  })

  it('空标签清空容器', () => {
    renderTagPills(container, [{ text: '重要' }], document)
    renderTagPills(container, [], document)
    expect(container.querySelectorAll(`[${TAG_ATTR}]`)).toHaveLength(0)
  })
})

describe('injectTagCss', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    document.head.innerHTML = ''
  })

  it('两个持有者共享一份样式；一方释放不摘除，归零才摘除', () => {
    const releaseA = injectTagCss()
    const releaseB = injectTagCss()
    expect(document.querySelectorAll('style[data-plugin-css="@dsh-focus-session/tags"]')).toHaveLength(1)
    releaseA()
    expect(document.querySelector('style[data-plugin-css="@dsh-focus-session/tags"]')).not.toBeNull()
    releaseB()
    expect(document.querySelector('style[data-plugin-css="@dsh-focus-session/tags"]')).toBeNull()
  })

  it('同一持有者重复释放只生效一次', () => {
    const release = injectTagCss()
    const other = injectTagCss()
    release()
    release()
    expect(document.querySelector('style[data-plugin-css="@dsh-focus-session/tags"]')).not.toBeNull()
    other()
    expect(document.querySelector('style[data-plugin-css="@dsh-focus-session/tags"]')).toBeNull()
  })
})

describe('openTagEditor（官方 Modal 契约）', () => {
  let sessionTags: { text: string; tone?: string }[]

  const deps = () => ({
    sessionId: 's1',
    doc: document,
    getTags: () => sessionTags,
    setTags: (_id: string, tags: readonly { text: string; tone?: string }[]) => {
      sessionTags = tags.map((t) => ({ ...t }))
    },
  })

  const css = (): string => tagCss()
  const dialog = (): HTMLElement => document.querySelector<HTMLElement>('[data-dsh-tag-dialog]')!

  beforeEach(() => {
    document.body.innerHTML = ''
    sessionTags = []
  })

  it('弹框结构照官方 Modal：遮罩 + 居中卡片（标题行/正文/底部操作行）', () => {
    openTagEditor(deps())
    expect(document.querySelector(`[${TAG_EDITOR_ATTR}]`)).not.toBeNull()
    expect(document.querySelector('[data-dsh-tag-mask]')).not.toBeNull()
    const card = dialog()
    expect(card.getAttribute('role')).toBe('dialog')
    expect(card.getAttribute('aria-modal')).toBe('true')
    expect(card.querySelector('[data-dsh-tag-header] h2')?.textContent).toBe('编辑标签')
    expect(card.querySelector('[data-dsh-tag-close]')).not.toBeNull()
    expect(card.querySelector('[data-dsh-tag-body]')).not.toBeNull()
    const footer = card.querySelector('[data-dsh-tag-footer]')!
    expect(footer.querySelectorAll('button')).toHaveLength(2)
    closeTagEditor()
    expect(document.querySelector(`[${TAG_EDITOR_ATTR}]`)).toBeNull()
  })

  it('样式含官方 Modal / Input / Button 度量', () => {
    const text = css()
    expect(text).toContain('z-index:1000')
    expect(text).toContain('border-radius:24px')
    expect(text).toContain('width:min(380px,100%)')
    expect(text).toContain('gap:20px')
    expect(text).toContain('--dsw-alias-bg-mask-1')
    expect(text).toContain('--dsw-mask-blur')
    expect(text).toContain('--dsw-elevation-prominent')
    expect(text).toContain('height:32px')      // 官方 Input .wrap
    expect(text).toContain('border-radius:8px')
    expect(text).toContain('height:36px')      // 官方 Button .md
    expect(text).toContain('border-radius:18px')
    expect(text).toContain('--dsw-alias-button-primary-fill')
  })

  it('遮罩点击 / Esc / 完成 都关闭弹框', () => {
    openTagEditor(deps())
    document.querySelector<HTMLElement>('[data-dsh-tag-mask]')!
      .dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(document.querySelector(`[${TAG_EDITOR_ATTR}]`)).toBeNull()

    openTagEditor(deps())
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(document.querySelector(`[${TAG_EDITOR_ATTR}]`)).toBeNull()

    openTagEditor(deps())
    dialog().querySelector<HTMLButtonElement>('[data-dsh-tag-footer] button[data-variant="primary"]')!
      .dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(document.querySelector(`[${TAG_EDITOR_ATTR}]`)).toBeNull()
  })

  it('输入回车添加标签（带所选色调）', () => {
    openTagEditor(deps())
    const panel = document.querySelector<HTMLElement>(`[${TAG_EDITOR_ATTR}]`)!
    panel.querySelector<HTMLElement>('[data-dsh-tag-tone][data-tone="green"]')!
      .dispatchEvent(new MouseEvent('click', { bubbles: true }))
    const input = panel.querySelector<HTMLInputElement>('[data-dsh-tag-input]')!
    input.value = '重要'
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    expect(sessionTags).toEqual([{ text: '重要', tone: 'green' }])
    expect(input.value).toBe('')
    closeTagEditor()
  })

  it('点击当前标签移除', () => {
    sessionTags = [{ text: '重要' }, { text: '待办' }]
    openTagEditor(deps())
    const remove = document.querySelectorAll<HTMLElement>('[data-dsh-tag-remove]')
    expect(remove).toHaveLength(2)
    remove[0].dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(sessionTags).toEqual([{ text: '待办' }])
    closeTagEditor()
  })

  it('弹框是单例：再次打开替换前一个（Esc 监听不残留）', () => {
    openTagEditor(deps())
    openTagEditor(deps())
    expect(document.querySelectorAll(`[${TAG_EDITOR_ATTR}]`)).toHaveLength(1)
    closeTagEditor()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(document.querySelector(`[${TAG_EDITOR_ATTR}]`)).toBeNull()
  })
})

