/**
 * dsh-user client 测试：侧边栏用户徽标挂载（footArea 末尾 = 设置下方）。
 * 需要 DOM 环境——与 dsh-desk 组装器测试同 happy-dom 策略。
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { apply } from '../src/client/index.ts'

/** 官方 SidebarRoot.module.css 的 hash 类前缀。 */
const H = (name: string): string => `_${name}_abc123`

/** 构建官方结构侧边栏（root > logoRow/region/footArea(footerActions/settingsArea)）。 */
function buildSidebar(): HTMLElement {
  const root = document.createElement('div')
  root.dataset.pane = 'sidebar'
  root.className = H('root')

  const logoRow = document.createElement('div')
  logoRow.className = H('logoRow')

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

/** 最小 ClientContext stub（apply 只用 ctx.effect）。 */
function ctxStub(): { effect: (fn: () => () => void, label: string) => void; disposers: Array<() => void> } {
  const disposers: Array<() => void> = []
  const stub = {
    effect(fn: () => () => void, _label: string): void {
      disposers.push(fn())
    },
    disposers,
  }
  return stub
}

describe('dsh-user client 侧边栏用户徽标', () => {
  let root: HTMLElement
  let stub: { effect: (fn: () => () => void, label: string) => void; disposers: Array<() => void> }

  beforeEach(() => {
    root = buildSidebar()
    stub = ctxStub()
  })

  afterEach(() => {
    for (const d of stub.disposers) d()
    document.body.innerHTML = ''
  })

  it('注入 footArea 末尾（设置下方）的宿主容器 + 样式', () => {
    apply(stub as never)
    const foot = root.querySelector(`.${H('footArea')}`) as HTMLElement
    // MutationObserver 异步，等一个宏任务
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        const host = foot.querySelector('[data-dsh-user-badge-host]')
        expect(host).not.toBeNull()
        // 宿主在 settingsArea 之后（footArea 最后）
        expect(foot.lastElementChild).toBe(host)
        // 样式已注入
        const tag = document.querySelector('style[data-plugin-css="@dsh-user/badge"]')
        expect(tag).not.toBeNull()
        expect((tag as HTMLStyleElement).textContent ?? '').toContain('data-dsh-user-badge')
        resolve()
      }, 20)
    })
  })

  it('侧边栏未渲染时 apply 不报错（body 无 sidebar）', () => {
    document.body.innerHTML = ''
    expect(() => apply(stub as never)).not.toThrow()
  })
})
