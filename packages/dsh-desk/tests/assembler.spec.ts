/**
 * dsh-desk 组装器测试：把全家桶 data-dsh-*-entry 入口 re-parent 到
 * 侧边栏 footArea 顶部（控制台上方），保持 taskboard → ssh → skill 顺序；
 * 自愈兼容（entry 仍在 sidebar root / body 内时不触发插件重插）。
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { startToolAssembler } from '../src/client/ToolAssembler.ts'

/** 官方 SidebarRoot.module.css 的 hash 类前缀（css-modules 形式）。 */
const H = (name: string): string => `_${name}_abc123`

/** 构建官方结构侧边栏（SidebarRoot.tsx 树）：root > logoRow/newSession/regionArea/footArea。 */
function buildSidebar(): HTMLElement {
  const root = document.createElement('div')
  root.dataset.pane = 'sidebar'
  root.className = H('root')

  const logoRow = document.createElement('div')
  logoRow.className = H('logoRow')
  const newSession = document.createElement('button')
  newSession.className = H('newSession')
  logoRow.appendChild(newSession)

  const region = document.createElement('div')
  region.className = H('regionArea')

  const foot = document.createElement('div')
  foot.className = H('footArea')
  const footerActions = document.createElement('div')
  footerActions.className = H('footerActions')
  const settingsArea = document.createElement('div')
  settingsArea.className = H('settingsArea')
  foot.append(footerActions, settingsArea)

  root.append(logoRow, region, foot)
  document.body.appendChild(root)
  return root
}

/** 模拟插件注入的 entry（vendored mountSidebarEntry 产物）。 */
function injectEntry(attr: string, into: HTMLElement, after: HTMLElement): HTMLElement {
  const entry = document.createElement('button')
  entry.setAttribute(attr, '')
  entry.className = H('entry')
  into.insertBefore(entry, after.nextSibling)
  return entry
}

/** 当前 entry 的父容器。 */
function parentOf(entry: HTMLElement): HTMLElement | null {
  return entry.parentElement
}

describe('startToolAssembler', () => {
  let root: HTMLElement
  let disposers: Array<() => void>

  beforeEach(() => {
    root = buildSidebar()
    disposers = []
  })

  afterEach(() => {
    for (const d of disposers) d()
    document.body.innerHTML = ''
  })

  it('把三个 entry 移到 footArea 顶部、footerActions 之前，保持顺序', () => {
    const logoRow = root.querySelector(`.${H('logoRow')}`) as HTMLElement
    // 插件默认落点：logoRow（新建会话行）之后、regionArea 之前
    const taskboard = injectEntry('data-dsh-taskboard-entry', root, logoRow)
    const ssh = injectEntry('data-dsh-ssh-entry', root, logoRow)
    const skill = injectEntry('data-dsh-skill-explorer-entry', root, logoRow)
    expect(parentOf(taskboard)).toBe(root)

    disposers.push(startToolAssembler())

    const foot = root.querySelector(`.${H('footArea')}`) as HTMLElement
    const footerActions = root.querySelector(`.${H('footerActions')}`) as HTMLElement
    expect(parentOf(taskboard)).toBe(foot)
    expect(parentOf(ssh)).toBe(foot)
    expect(parentOf(skill)).toBe(foot)
    // 顺序：taskboard → ssh → skill → footerActions → settingsArea
    expect(Array.from(foot.children).map((el) => el.getAttribute('data-dsh-taskboard-entry') ?? el.getAttribute('data-dsh-ssh-entry') ?? el.getAttribute('data-dsh-skill-explorer-entry') ?? el.className))
      .toEqual(['', '', '', H('footerActions'), H('settingsArea')])
    expect(foot.children[0]).toBe(taskboard)
    expect(foot.children[1]).toBe(ssh)
    expect(foot.children[2]).toBe(skill)
    expect(foot.children[3]).toBe(footerActions)
  })

  it('entry 晚于侧边栏出现时也能摆位（MutationObserver 等待）', () => {
    disposers.push(startToolAssembler())
    const logoRow = root.querySelector(`.${H('logoRow')}`) as HTMLElement
    // 组装器先跑（body 无 entry），插件后注入
    const taskboard = injectEntry('data-dsh-taskboard-entry', root, logoRow)
    // 触发 observer：移动 DOM 会触发 MutationObserver 回调
    expect(parentOf(taskboard)).toBe(root)
    // observer 是异步的，等一个宏任务
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        expect(parentOf(taskboard)).toBe(root.querySelector(`.${H('footArea')}`))
        resolve()
      }, 20)
    })
  })

  it('侧边栏尚未渲染时启动不报错（body 无 sidebar）', () => {
    document.body.innerHTML = ''
    expect(() => {
      disposers.push(startToolAssembler())
    }).not.toThrow()
  })

  it('注入 foot 区样式覆盖（对齐官方 trigger 契约，幂等）', () => {
    disposers.push(startToolAssembler())
    const tag = document.querySelector('style[data-plugin-css="@dsh-desk/tool-assembler"]')
    expect(tag).not.toBeNull()
    const css = (tag as HTMLStyleElement).textContent ?? ''
    expect(css).toContain('height:42px')
    expect(css).toContain('border-radius:12px')
    expect(css).toContain('--dsw-alias-interactive-bg-hover')
    expect(css).toContain('[class*="collapsed"] [data-dsh-part="sidebar-entry"]')
    // 间距：foot 区各行统一 2px 上下边距（行间 4px），折叠态恢复官方 rail 值
    expect(css).toContain('margin:2px -2px')
    expect(css).toContain('[class*="footArea"] [class*="trigger"]{margin:2px -2px}')
    expect(css).toContain('[class*="collapsed"] [class*="footArea"] [class*="trigger"]{margin:8px 0 10px}')
    // 幂等：再次启动不重复注入
    const before = document.querySelectorAll('style[data-plugin-css="@dsh-desk/tool-assembler"]').length
    disposers.push(startToolAssembler())
    expect(document.querySelectorAll('style[data-plugin-css="@dsh-desk/tool-assembler"]').length).toBe(before)
  })

  it('disposer 断开观察器（后续注入不再摆位）', () => {
    const disposer = startToolAssembler()
    disposer()
    const logoRow = root.querySelector(`.${H('logoRow')}`) as HTMLElement
    const taskboard = injectEntry('data-dsh-taskboard-entry', root, logoRow)
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        expect(parentOf(taskboard)).toBe(root)
        resolve()
      }, 20)
    })
  })
})
