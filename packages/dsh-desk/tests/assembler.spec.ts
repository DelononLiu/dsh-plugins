/**
 * dsh-desk 组装器测试：把全家桶 data-dsh-*-entry 入口 re-parent 到
 * 侧边栏 footArea 顶部（控制台上方），保持 taskboard → ssh → skill 顺序；
 * 自愈兼容（entry 仍在 sidebar root / body 内时不触发插件重插）。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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

/** 模拟插件注入的 entry（vendored mountSidebarEntry 产物：data-dsh-*-entry + data-dsh-part）。 */
function injectEntry(attr: string, into: HTMLElement, before: HTMLElement): HTMLElement {
  const entry = document.createElement('button')
  entry.setAttribute(attr, '')
  entry.setAttribute('data-dsh-part', 'sidebar-entry')
  entry.className = H('entry')
  // 插到固定锚点 before 之前，保持注入顺序 = DOM 顺序（真实插件按 family 顺序插入）。
  into.insertBefore(entry, before)
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
    const region = root.querySelector(`.${H('regionArea')}`) as HTMLElement
    // 插件默认落点：logoRow（新建会话行）之后、regionArea 之前
    const taskboard = injectEntry('data-dsh-taskboard-entry', root, region)
    const ssh = injectEntry('data-dsh-ssh-entry', root, region)
    const skill = injectEntry('data-dsh-skill-explorer-entry', root, region)
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

  it('entry 晚于侧边栏出现时也能摆位（MutationObserver 等待）', async () => {
    disposers.push(startToolAssembler())
    const logoRow = root.querySelector(`.${H('logoRow')}`) as HTMLElement
    const region = root.querySelector(`.${H('regionArea')}`) as HTMLElement
    // 组装器先跑（body 无 entry），插件后注入
    const taskboard = injectEntry('data-dsh-taskboard-entry', root, region)
    // 触发 observer：移动 DOM 会触发 MutationObserver 回调（异步）
    expect(parentOf(taskboard)).toBe(root)
    await vi.waitFor(() => {
      expect(parentOf(taskboard)).toBe(root.querySelector(`.${H('footArea')}`))
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

  it('折叠态（root collapsed）：entry 仍摆到 footArea、折叠 CSS 规则存在且顺序正确', () => {
    // 模拟官方折叠：root 加 collapsed hash 类（SidebarRoot `!wide && css.collapsed`）
    root.classList.add(H('collapsed'))
    const logoRow = root.querySelector(`.${H('logoRow')}`) as HTMLElement
    const region = root.querySelector(`.${H('regionArea')}`) as HTMLElement
    const taskboard = injectEntry('data-dsh-taskboard-entry', root, region)
    disposers.push(startToolAssembler())

    // 折叠态下摆位不变（footArea 顶部）
    const foot = root.querySelector(`.${H('footArea')}`) as HTMLElement
    expect(parentOf(taskboard)).toBe(foot)
    expect(foot.children[0]).toBe(taskboard)

    // 折叠 CSS：36px 圆、仅图标（label 隐藏）、rail 间距
    const css = (document.querySelector('style[data-plugin-css="@dsh-desk/tool-assembler"]') as HTMLStyleElement).textContent ?? ''
    expect(css).toContain('[class*="collapsed"] [data-dsh-part="sidebar-entry"]{width:36px;height:36px;margin:8px 0 10px;justify-content:center;gap:0;padding:0;border-radius:50%}')
    expect(css).toContain('[class*="collapsed"] [data-dsh-part="sidebar-entry"] [class*="entryLabel"]{display:none}')
    // 折叠态规则须在展开规则之后（同特异性时后者胜 → 折叠优先）
    expect(css.indexOf('[class*="collapsed"] [data-dsh-part="sidebar-entry"]{')).toBeGreaterThan(css.indexOf('[class*="footArea"] [data-dsh-part="sidebar-entry"]{'))
    // trigger 折叠恢复 rail 间距
    expect(css).toContain('[class*="collapsed"] [class*="footArea"] [class*="trigger"]{margin:8px 0 10px}')
  })

  it('通用性：运行时发现任意 data-dsh-part entry（不限三家）', async () => {
    disposers.push(startToolAssembler())
    const logoRow = root.querySelector(`.${H('logoRow')}`) as HTMLElement
    const region = root.querySelector(`.${H('regionArea')}`) as HTMLElement
    // 模拟第四家工具（未来注入型插件）
    const future = injectEntry('data-dsh-future-entry', root, region)
    await vi.waitFor(() => {
      expect(parentOf(future)).toBe(root.querySelector(`.${H('footArea')}`))
    })
  })

  it('工具排除：tools.<id>.visible=false 不摆位（留在插件原位置）', async () => {
    const logoRow = root.querySelector(`.${H('logoRow')}`) as HTMLElement
    const region = root.querySelector(`.${H('regionArea')}`) as HTMLElement
    const taskboard = injectEntry('data-dsh-taskboard-entry', root, region)
    const ssh = injectEntry('data-dsh-ssh-entry', root, region)
    // 配置：排除 ssh（tools.ssh.visible=false）
    const snapshot = { value: { assembler: { footSpacing: 2, tools: { ssh: { visible: false } } } } }
    disposers.push(startToolAssembler(snapshot))
    await vi.waitFor(() => {
      expect(parentOf(taskboard)).toBe(root.querySelector(`.${H('footArea')}`))
    })
    // ssh 不摆位：仍在 root（插件原位置）
    expect(parentOf(ssh)).toBe(root)
  })

  it('footSpacing 参数化：自定义间距写入注入 CSS', () => {
    const snapshot = { value: { assembler: { footSpacing: 5, tools: {} } } }
    disposers.push(startToolAssembler(snapshot))
    const css = (document.querySelector('style[data-plugin-css="@dsh-desk/tool-assembler"]') as HTMLStyleElement).textContent ?? ''
    expect(css).toContain('margin:5px -2px')
    expect(css).not.toContain('margin:2px -2px')
  })

  it('配置变更：排除后移回默认落点、恢复后重摆位、间距重注入 CSS', async () => {
    const logoRow = root.querySelector(`.${H('logoRow')}`) as HTMLElement
    const region = root.querySelector(`.${H('regionArea')}`) as HTMLElement
    const taskboard = injectEntry('data-dsh-taskboard-entry', root, region)
    const ssh = injectEntry('data-dsh-ssh-entry', root, region)
    // 可编程 settings：初始全可见 2px，可切到排除 ssh + 间距 4
    let value = { value: { assembler: { footSpacing: 2, tools: {} } } }
    const listeners: Array<() => void> = []
    const subscribe = (fn: () => void) => { listeners.push(fn); return () => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1) } }
    const getSnapshot = () => value
    disposers.push(startToolAssembler(getSnapshot(), subscribe, getSnapshot))

    // 初始：两个都摆到 foot
    await vi.waitFor(() => { expect(parentOf(taskboard)).toBe(root.querySelector(`.${H('footArea')}`)) })
    expect(parentOf(ssh)).toBe(root.querySelector(`.${H('footArea')}`))

    // 配置变更：排除 ssh + 间距 4 → ssh 移回 root、taskboard 留在 foot、CSS 更新
    value = { value: { assembler: { footSpacing: 4, tools: { ssh: { visible: false } } } } }
    for (const fn of [...listeners]) fn()
    await vi.waitFor(() => { expect(parentOf(ssh)).toBe(root) })
    expect(parentOf(taskboard)).toBe(root.querySelector(`.${H('footArea')}`))
    const css = (document.querySelector('style[data-plugin-css="@dsh-desk/tool-assembler"]') as HTMLStyleElement).textContent ?? ''
    expect(css).toContain('margin:4px -2px')

    // 恢复 ssh → 重新摆位回 foot
    value = { value: { assembler: { footSpacing: 4, tools: {} } } }
    for (const fn of [...listeners]) fn()
    await vi.waitFor(() => { expect(parentOf(ssh)).toBe(root.querySelector(`.${H('footArea')}`)) })
  })

  it('disposer 断开观察器（后续注入不再摆位）', async () => {
    const disposer = startToolAssembler()
    disposer()
    const logoRow = root.querySelector(`.${H('logoRow')}`) as HTMLElement
    const region = root.querySelector(`.${H('regionArea')}`) as HTMLElement
    const taskboard = injectEntry('data-dsh-taskboard-entry', root, region)
    // 给一个微任务+宏任务窗口，确认 observer 已断开、不摆位
    await new Promise<void>((resolve) => setTimeout(resolve, 20))
    expect(parentOf(taskboard)).toBe(root)
  })

  it('disposer 移除注入的样式（清理闭环）', () => {
    const disposer = startToolAssembler()
    expect(document.querySelector('style[data-plugin-css="@dsh-desk/tool-assembler"]')).not.toBeNull()
    disposer()
    expect(document.querySelector('style[data-plugin-css="@dsh-desk/tool-assembler"]')).toBeNull()
  })
})
