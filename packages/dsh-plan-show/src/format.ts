/**
 * 产物约定格式（host 与 client 共用，纯函数可测）。
 *
 * 只靠启发式猜"这段文字是不是方案"既脆又容易误判；正解是**约定一个稳定围栏**，
 * 并用提示词段告诉模型按它输出（官方 `plan-mode` 的 `plan:policy` 段就是同一手法）：
 *
 *     ```plan-show
 *     # 标题
 *     ## 步骤
 *     - [x] 已完成的一条
 *     - [~] 进行中的一条
 *     - [!] 被阻塞的一条
 *     ## 验证
 *     - [x] 判据 —— 证据：pnpm test 全绿
 *     ```
 *
 * 围栏内容 = markdown 结构（沿用 `types.ts` 的解析约定），因此解析器可以复用；
 * 渲染由 client 半区把结构画成 SVG 图片内联进消息（照官方图片化方法）。
 */

import type { Artifact } from './types'

/** 约定围栏语言名。 */
export const SHOW_FENCE = 'plan-show'

/** 提示词段名（与 host 半区注册名一致）。 */
export const PROMPT_SECTION = 'plan-show:format'

/**
 * 提示词段文本：教模型按约定格式提交产物。
 *
 * 措辞原则：说明"为什么"（用户要扫一眼判断）+ 给出最小可用格式 + 明确证据口径，
 * 不堆模板。段内容短，常驻系统提示的开销可忽略。
 */
export const SHOW_FORMAT_PROMPT = [
  '## 产物呈现（plan-show）',
  '用户要"扫一眼就判断"，不要读大段文字。需要用户判断的产物（方案/计划、验收、完成报告）请放进 ```'
  + SHOW_FENCE + ' 围栏，围栏外用正文写结论与理由，不要重复清单。',
  '围栏内容是 markdown 结构：`# 标题`、`## 小节`（目标/步骤/影响面/风险/验证）、'
  + '`- [ ] 条目`（`[x]` 完成、`[~]` 进行中、`[!]` 阻塞）。',
  '- 方案/计划：提交步骤 + 影响面 + 风险 + 待定项，便于用户批准或指出要改的点。',
  '- 验收：每条判据后面紧跟证据，写成 `- [x] 判据 —— 证据：<命令或结果>`；'
  + '**没有证据的条目会被渲染成"未验证"**，不要用"已验证"这类没有证据的说法。',
  '- 完成：改了什么、证据、遗留与未做。',
  '同一个产物只放一个围栏；围栏要一次写完整（围栏未闭合时不会渲染）。',
].join('\n')

/** 从文本里抽出的约定围栏。 */
export interface ShowBlock {
  /** 围栏正文（markdown 结构，已去首尾空行）。 */
  body: string
  /** 围栏在原文里的起始偏移（client 定位用）。 */
  start: number
  /** 围栏整体（含 ``` 行）在原文里的结束偏移。 */
  end: number
}

/** 围栏起始行：允许行首空白，语言名大小写不敏感，其后可有标题（如 ```plan-show 方案）。 */
const FENCE_OPEN = new RegExp(`^\\s*\`\`\`${SHOW_FENCE}\\b[^\\n]*$`, 'i')

/**
 * 抽取文本里**已闭合**的约定围栏（未闭合 = 还在流式输出，调用方据此不渲染）。
 * @param text - 消息原文（markdown）。
 * @returns 闭合围栏列表（按出现顺序）。
 */
export function extractShowBlocks(text: string): ShowBlock[] {
  const lines = text.split(/\r?\n/)
  const blocks: ShowBlock[] = []
  let offset = 0
  let open: { bodyStart: number; bodyLines: string[] } | null = null
  for (const line of lines) {
    const lineStart = offset
    offset += line.length + 1 // 换行按 1 计（CRLF 时略有偏差，仅用于定位提示，不影响解析）
    if (open === null) {
      if (FENCE_OPEN.test(line)) open = { bodyStart: offset, bodyLines: [] }
      continue
    }
    if (/^\s*```\s*$/.test(line)) {
      blocks.push({
        body: open.bodyLines.join('\n').replace(/^\n+|\n+$/g, ''),
        start: open.bodyStart,
        end: lineStart + line.length,
      })
      open = null
      continue
    }
    open.bodyLines.push(line)
  }
  return blocks
}

/**
 * 消息里是否含约定围栏（含未闭合）——UI 用它决定"要不要等定型后再渲染"。
 * @param text - 消息原文。
 * @returns 是否出现围栏起始行。
 */
export function hasShowFence(text: string): boolean {
  return text.split(/\r?\n/).some((line) => FENCE_OPEN.test(line))
}

/**
 * 把产物导出为约定围栏文本（面板"复制"与手工粘贴用；与解析器往返一致）。
 * @param artifact - 产物。
 * @param markdownBody - 围栏正文（缺省 = 现有 `markdown` 字段）。
 * @returns 带围栏的文本。
 */
export function toShowFence(artifact: Artifact, markdownBody?: string): string {
  const body = markdownBody ?? artifact.markdown
  return `\`\`\`${SHOW_FENCE}\n${body.replace(/\s+$/, '')}\n\`\`\`\n`
}
