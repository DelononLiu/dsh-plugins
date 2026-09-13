/**
 * dsh-plan-show：client 插件体（浏览器半区）——消息内就地渲染。
 *
 * 主路径没有独立界面：客户端观察会话 DOM，把 AI 按约定格式输出的 ```plan-show 围栏
 * 就地渲染成图片（见 `./inline`）。侧栏入口与面板已删除——"在图/面板里看方案"退化为
 * 多一次点击，而用户要的是**在消息里直接看到**。
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { startInlineShow } from './inline.js'

/**
 * Client 插件体：启动消息观察（DOM 变化 → 定型围栏 → 就地出图）。
 * @param ctx - client 根上下文。
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => startInlineShow())
}
