/**
 * dsh-plan-show：AI 产物呈现层（host 面）。
 *
 * 职责（最小面，全部复用官方既有机制）：
 * 1. **模型可用工具 `show_artifact`**——agent 在任一步把结构化产物（计划 / 验收 /
 *    完成）提交进来；最少只需 `kind + title + markdown`，细节可用结构化字段补充。
 * 2. **产物存储**——按时间倒序保留最近 N 个（内存态；持久化留二期）。
 * 3. **只读 HTTP 面 `/api/plan-show/artifacts`**——浏览器半区拉取产物渲染（与
 *    dsh-console 的 `/api/console/instances` 同模式：host 出数据、client 出视图）。
 *
 * 不用投影/远程面：MVP 走"工具 + HTTP"这条我们仓库已验证的通道，投影与远程 RPC
 * 的正式对齐留二期（见 note 的架构段）。
 * @module dsh-plan-show
 */

import { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { PROMPT_SECTION, SHOW_FORMAT_PROMPT } from './format.js'
import { artifactFromMarkdown, normalizeArtifact, type Artifact, type ArtifactKind } from './types.js'

/** host 侧只读端点路径。 */
export const ARTIFACTS_PATH = '/api/plan-show/artifacts'
/** 面向模型的工具名。 */
export const TOOL_NAME = 'show_artifact'
/** 默认保留的产物个数（最新的在前）。 */
const DEFAULT_LIMIT = 50

/**
 * 需要的 host 服务：`tools`（注册 `show_artifact`）+ `systemPrompt`（登记产物格式段）。
 * `webServer` 不在此列——它是**可选**依赖，用 `ctx.inject(['webServer'], …)` 等它
 * 出现（headless profile 不装 webserver 时插件仍须能加载）。
 */
export const inject = ['tools', 'systemPrompt']

/** 工具入参（不可信 JSON 文本；结构化部分用 JSON 字符串，最小调用只用前三个）。 */
export interface ShowArtifactArgs {
  /** 产物类型：plan（方案/计划）/ verify（验收）/ completion（完成）。 */
  kind: string
  /** 标题（必填）。 */
  title: string
  /** 原始 markdown（计划/报告原文；必填其一，作为兜底展示与结构来源）。 */
  markdown?: string
  /** 一句话结论（结论先行）。 */
  summary?: string
  /** 结构化条目 JSON：`[{id?,text,status?,files?,criteria?}]`。 */
  items?: string
  /** 证据 JSON：`[{id?,kind?,label,value,result?,itemId?}]`。 */
  evidence?: string
  /** 待决 JSON：`[{id?,question,options:[{id?,label,detail,cost?}],chosen?}]`。 */
  decisions?: string
  /** 待定 JSON：`[{id?,text,blocking?}]`。 */
  openQuestions?: string
}

/** 内存产物存储（按时间倒序；同 id 覆盖）。 */
export class ArtifactStore {
  private readonly artifacts: Artifact[] = []

  /**
   * @param limit - 保留上限（超出丢最旧）。
   */
  constructor(private readonly limit: number = DEFAULT_LIMIT) {}

  /**
   * 写入一个产物（同 id 覆盖旧值，保持在最前）。
   * @param artifact - 产物。
   */
  push(artifact: Artifact): void {
    const index = this.artifacts.findIndex((entry) => entry.id === artifact.id)
    if (index >= 0) this.artifacts.splice(index, 1)
    this.artifacts.unshift(artifact)
    if (this.artifacts.length > this.limit) this.artifacts.length = this.limit
  }

  /**
   * 列出产物（最新在前）。
   * @param options - 过滤（会话 id）与条数上限。
   * @returns 产物数组（副本）。
   */
  list(options: { sessionId?: string; limit?: number } = {}): Artifact[] {
    const filtered = options.sessionId === undefined
      ? this.artifacts
      : this.artifacts.filter((entry) => entry.sessionId === options.sessionId)
    const limit = options.limit ?? filtered.length
    return filtered.slice(0, Math.max(0, limit))
  }

  /** 清空（测试与"清空面板"用）。 */
  clear(): void {
    this.artifacts.length = 0
  }
}

/** 把 JSON 字符串参数解析成数组（缺省 = 空数组；解析失败 → 面向模型的清晰错误）。 */
function parseJsonArray(field: string, raw: string | undefined): unknown[] {
  if (raw === undefined || raw.trim() === '') return []
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (cause) {
    throw new Error(`${TOOL_NAME}: ${field} 不是合法 JSON（${cause instanceof Error ? cause.message : String(cause)}）`)
  }
  if (!Array.isArray(parsed)) throw new Error(`${TOOL_NAME}: ${field} 必须是 JSON 数组`)
  return parsed
}

/**
 * 工具入参 → 产物并写入存储（纯逻辑，便于测试；工具体只做转发）。
 *
 * 最小调用：`{kind, title, markdown}` —— 结构从 markdown 的 `## 小节` 与
 * `- [ ]` 清单派生；结构化字段（items/evidence/decisions/openQuestions）可选覆盖。
 * @param store - 产物存储。
 * @param args - 工具入参。
 * @param meta - 产物元信息（会话 id）。
 * @returns 归一化后的产物。
 */
export function publishArtifact(store: ArtifactStore, args: ShowArtifactArgs, meta: { sessionId?: string } = {}): Artifact {
  const markdown = typeof args.markdown === 'string' ? args.markdown : ''
  const base = markdown.trim() === ''
    ? null
    : artifactFromMarkdown(markdown, {
        ...meta.sessionId === undefined ? {} : { sessionId: meta.sessionId },
      })
  // 结构化字段优先；调用方没给条目时，才用 markdown 派生的清单条目兜底。
  const items = parseJsonArray('items', args.items)
  const evidence = parseJsonArray('evidence', args.evidence)
  const decisions = parseJsonArray('decisions', args.decisions)
  const openQuestions = parseJsonArray('openQuestions', args.openQuestions)
  const artifact = normalizeArtifact({
    kind: args.kind,
    title: typeof args.title === 'string' && args.title.trim() !== '' ? args.title : base?.title ?? '',
    summary: args.summary ?? '',
    markdown,
    sections: base?.sections ?? [],
    items: items.length > 0 ? items : base?.items ?? [],
    evidence,
    decisions,
    openQuestions,
    ...meta.sessionId === undefined ? {} : { sessionId: meta.sessionId },
  })
  store.push(artifact)
  return artifact
}

/** 面板头部的一句话回执（工具返回给模型的内容）。 */
export function artifactReceipt(artifact: Artifact): string {
  const counts = artifact.items.length === 0
    ? `${artifact.evidence.length} 条证据`
    : `${artifact.items.length} 条目 / ${artifact.evidence.length} 证据`
  return `已呈现「${artifact.title}」（${artifact.kind}，${counts}）。用户可在侧栏「Show」面板查看。`
}

/**
 * 读取只读端点查询参数。
 * @param url - 请求 URL（含 query）。
 * @returns 过滤条件（limit 非法时回落默认）。
 */
export function parseListQuery(url: string | undefined): { sessionId?: string; limit?: number } {
  if (url === undefined) return {}
  const query = url.includes('?') ? url.slice(url.indexOf('?') + 1) : ''
  const params = new URLSearchParams(query)
  const sessionId = params.get('session')
  const limitRaw = params.get('limit')
  const limit = limitRaw === null ? undefined : Number.parseInt(limitRaw, 10)
  return {
    ...sessionId === null || sessionId === '' ? {} : { sessionId },
    ...limit === undefined || Number.isNaN(limit) ? {} : { limit },
  }
}

/** host 插件体：注册工具 + 只读端点。 */
export function apply(ctx: Context): void {
  const store = new ArtifactStore()
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

  ctx.tools.register(defineTool({
    name: TOOL_NAME,
    description:
      '把一份结构化产物呈现给用户（比大段文字更易判断）。kind: plan=方案/计划；'
      + 'verify=验收（每条判据旁给出证据）；completion=完成（改了什么/证据/遗留）。'
      + '最少传 kind + title + markdown（`## 小节` 与 `- [ ] 条目` 会被结构化）；'
      + '需要精确控制时再传 items/evidence/decisions/openQuestions（JSON 字符串数组）。'
      + '方案要用户拍板、验收要用户确认、收尾要用户接受时调用本工具。',
    parameters: {
      kind: { type: 'string', required: true, description: 'plan | verify | completion' },
      title: { type: 'string', required: true, description: '产物标题（一句话说明这是什么）' },
      markdown: { type: 'string', description: '产物原文（markdown；`## 小节`、`- [ ]/[x]/[~]/[!] 条目`）' },
      summary: { type: 'string', description: '一句话结论（结论先行，面板头部显示）' },
      items: { type: 'string', description: '条目 JSON 数组：[{id?,text,status?:todo|doing|done|blocked,files?,criteria?}]' },
      evidence: { type: 'string', description: '证据 JSON 数组：[{id?,kind?,label,value,result?:pass|fail|info,itemId?}]' },
      decisions: { type: 'string', description: '待决 JSON 数组：[{id?,question,options:[{id?,label,detail,cost?}],chosen?}]' },
      openQuestions: { type: 'string', description: '待定 JSON 数组：[{id?,text,blocking?}]' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          artifactId: { type: 'string', required: true },
          kind: { type: 'string', required: true },
          receipt: { type: 'string', required: true },
        },
      },
      render: (_args: unknown, value: unknown) => {
        const receipt = (value as { receipt?: string }).receipt ?? '已呈现'
        return [{ type: 'text', text: receipt }]
      },
    },
    execute: (args: ShowArtifactArgs) => {
      const artifact = publishArtifact(store, args)
      return Promise.resolve({ artifactId: artifact.id, kind: artifact.kind as string, receipt: artifactReceipt(artifact) })
    },
  }))
  // 只读端点：客户端面板拉取产物（webServer 可选——headless profile 不装也能跑）。
  ctx.inject(['webServer'], (injected) => {
    const dispose = injected.webServer.register({
      kind: 'exact',
      path: ARTIFACTS_PATH,
      handler: (req: IncomingMessage, res: ServerResponse) => {
        const query = parseListQuery(req.url)
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ artifacts: store.list(query) }))
      },
    })
    injected.effect(() => () => { dispose() })
  })
}
