/**
 * dsh-my-ui 行为测试：四区布局配置（默认/自定义/单区查询）。
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { MyUiService, type Config } from '../src/index.ts'

function boot(config: Partial<Config> = {}): MyUiService {
  return new MyUiService(new Context(), {
    layout: {
      topbar: { visible: true, order: 0 },
      tabs: { visible: true, order: 1 },
      sidebar: { visible: true, order: 2, size: '260px' },
      actions: { visible: true, order: 3 },
    },
    ...config,
  })
}

describe('四区布局配置', () => {
  it('默认布局：四区可见、标准顺序', () => {
    const svc = boot()
    const layout = svc.layout()
    expect(Object.keys(layout)).toEqual(['topbar', 'tabs', 'sidebar', 'actions'])
    expect(layout.topbar.visible).toBe(true)
    expect(layout.sidebar.size).toBe('260px')
  })

  it('自定义布局覆盖（隐藏侧边栏）', () => {
    const svc = boot({ layout: { topbar: { visible: true, order: 0 }, tabs: { visible: true, order: 1 }, sidebar: { visible: false, order: 2 }, actions: { visible: true, order: 3 } } })
    expect(svc.region('sidebar').visible).toBe(false)
    expect(svc.region('topbar').visible).toBe(true)
  })

  it('单区查询', () => {
    const svc = boot()
    expect(svc.region('actions').order).toBe(3)
    expect(svc.region('sidebar').size).toBe('260px')
  })
})
