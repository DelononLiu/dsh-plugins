/**
 * dsh-desk slots 控制器测试：git-graph 显隐（CSS 覆盖注入/移除/配置变更实时）。
 */

import { afterEach, describe, expect, it } from 'vitest'
import { startSlotsController } from '../src/client/SlotsController.ts'

const STYLE_SEL = 'style[data-plugin-css="@dsh-desk/slot-hider"]'

/** 构造 settings 快照（value.assembler.slots）。 */
function snapshot(slots: Record<string, { visible: boolean }> | undefined): unknown {
  return { value: { assembler: { tools: {}, slots: slots ?? {} } } }
}

describe('startSlotsController', () => {
  afterEach(() => {
    document.body.innerHTML = ''
    document.head.innerHTML = ''
  })

  it('缺省配置（无 slots）：不注入隐藏样式', () => {
    const disposer = startSlotsController(snapshot(undefined))
    expect(document.querySelector(STYLE_SEL)).toBeNull()
    disposer()
  })

  it('gitGraph.visible=false：注入隐藏规则 [data-dsh-plugin="git-graph"]{display:none}', () => {
    const disposer = startSlotsController(snapshot({ gitGraph: { visible: false } }))
    const tag = document.querySelector<HTMLStyleElement>(STYLE_SEL)
    expect(tag).not.toBeNull()
    expect(tag?.textContent).toContain('[data-dsh-plugin="git-graph"]{display:none}')
    disposer()
  })

  it('gitGraph.visible=true：不注入隐藏规则', () => {
    const disposer = startSlotsController(snapshot({ gitGraph: { visible: true } }))
    expect(document.querySelector(STYLE_SEL)).toBeNull()
    disposer()
  })

  it('配置变更实时响应：false→true 移除样式，true→false 重新注入', () => {
    let current = snapshot({ gitGraph: { visible: false } })
    let onChanged: (() => void) | undefined
    const disposer = startSlotsController(
      current,
      (fn) => {
        onChanged = fn
        return () => { onChanged = undefined }
      },
      () => current,
    )
    // 初始 false：注入
    expect(document.querySelector(STYLE_SEL)).not.toBeNull()

    // 外部改配置为 true → 触发订阅回调 → 移除样式
    current = snapshot({ gitGraph: { visible: true } })
    onChanged?.()
    expect(document.querySelector(STYLE_SEL)).toBeNull()

    // 再改回 false → 重新注入
    current = snapshot({ gitGraph: { visible: false } })
    onChanged?.()
    expect(document.querySelector(STYLE_SEL)).not.toBeNull()

    disposer()
  })

  it('disposer 移除注入的样式', () => {
    const disposer = startSlotsController(snapshot({ gitGraph: { visible: false } }))
    expect(document.querySelector(STYLE_SEL)).not.toBeNull()
    disposer()
    expect(document.querySelector(STYLE_SEL)).toBeNull()
  })
})
