/**
 * dsh-show-me：复杂内容呈现层（host 面，只做约定格式 + 提示词段）。
 *
 * 本插件把"内容复杂到读不下去"的呈现收敛成一条约定：AI 在消息里写 ```show-me 围栏，
 * 客户端就地渲染成图。host 半区只负责把这条约定登记为提示词段；围栏 → 图片的渲染
 * 全部在 client 半区（src/client/**）。
 * @module dsh-show-me
 */

import { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { PROMPT_SECTION, SHOW_FORMAT_PROMPT } from './format.js'

/** 需要的 host 服务：`systemPrompt`（登记围栏格式约定段）。 */
export const inject = ['systemPrompt']

/** host 插件体：登记提示词段。 */
export function apply(ctx: Context): void {
  // 提示词段：告诉模型按约定围栏输出产物——只靠启发式猜"这段是不是方案"既脆又易误判。
  // 位置紧跟计划策略（PLAN_POLICY: 500）——它约束的正是"怎么把产物交给用户判断"。
  ctx.systemPrompt.section({
    name: PROMPT_SECTION,
    // 数字 order 而非 getSectionOrder()：本仓 profile 里解析到的 system-prompt 是
    // 0.1.1-rc.2（peer 漂移），没有该方法；PromptSection 的类型只要求 number。
    // 500 = 计划策略位（rc.1 的 PLAN_POLICY 同一槽位），紧随其后。
    order: 501,
    text: () => SHOW_FORMAT_PROMPT,
  })
}
