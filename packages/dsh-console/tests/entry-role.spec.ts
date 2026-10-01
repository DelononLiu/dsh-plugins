/**
 * 合并入口（原 dsh-channel + dsh-console）的角色分面测试。
 *
 * 核心契约：`role: 'agent'` 是被引导的执行面主机——**只挂通信面**（`ctx.channel`），
 * 不挂管理面（`ctx.console`）；其余角色两面都挂。
 */

import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { apply } from '../src/index.ts'

describe('dsh-console 合并入口的角色分面', () => {
  it("role: 'agent'：挂通信面、不挂管理面", async () => {
    const ctx = new Context()
    await ctx.plugin(apply, { role: 'agent', channel: { tokens: {} } })
    expect(ctx.get('channel')).toBeDefined()
    expect(ctx.get('console')).toBeUndefined()
  })

  it("role: 'instance'：通信面与管理面都挂", async () => {
    const ctx = new Context()
    await ctx.plugin(apply, { role: 'instance', channel: { tokens: {} } })
    expect(ctx.get('channel')).toBeDefined()
    expect(ctx.get('console')).toBeDefined()
  })
})
