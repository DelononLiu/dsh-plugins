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

describe('openTagEditor', () => {
  let sessionTags: { text: string; tone?: string }[]
  let anchor: HTMLElement

  const deps = () => ({
    sessionId: 's1',
    anchor,
    getTags: () => sessionTags,
    setTags: (_id: string, tags: readonly { text: string; tone?: string }[]) => {
      sessionTags = tags.map((t) => ({ ...t }))
    },
  })

  beforeEach(() => {
    document.body.innerHTML = ''
    sessionTags = []
    anchor = document.createElement('div')
    document.body.appendChild(anchor)
  })

  it('打开面板并在点外部后关闭', () => {
    openTagEditor(deps())
    expect(document.querySelector(`[${TAG_EDITOR_ATTR}]`)).not.toBeNull()
    closeTagEditor()
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

  it('面板是单例：再次打开替换前一个', () => {
    openTagEditor(deps())
    openTagEditor(deps())
    expect(document.querySelectorAll(`[${TAG_EDITOR_ATTR}]`)).toHaveLength(1)
    closeTagEditor()
  })
})

