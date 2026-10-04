/**
 * 实例行版本胶囊取值顺序：**自报优先，池软链兜底**，皆缺占位符
 * （`src/client/version-label.ts`）。
 */

import { describe, expect, it } from 'vitest'
import { versionLabel, versionTitle } from '../src/client/version-label.ts'

describe('versionLabel（自报优先）', () => {
  it('两者都有 → 取自报（不是池软链）', () => {
    expect(versionLabel({ version: '0.1.7-rc.2', runtimeVersion: '0.1.2-rc.1' })).toBe('0.1.7-rc.2')
  })

  it('自报缺失（离线）→ 回退池软链', () => {
    expect(versionLabel({ runtimeVersion: '0.1.2-rc.1' })).toBe('0.1.2-rc.1')
  })

  it('两者皆缺 → —', () => {
    expect(versionLabel({})).toBe('—')
  })
})

describe('versionTitle（两来源标注）', () => {
  it('标注自报与池软链；缺哪个写未上报/未登记', () => {
    expect(versionTitle({ version: '0.1.7-rc.2', runtimeVersion: '0.1.2-rc.1' })).toBe('实例自报: 0.1.7-rc.2 · 池软链: 0.1.2-rc.1')
    expect(versionTitle({ version: '0.1.7-rc.2' })).toBe('实例自报: 0.1.7-rc.2 · 池软链: 未登记')
    expect(versionTitle({})).toBe('实例自报: 未上报 · 池软链: 未登记')
  })
})
