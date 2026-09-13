/**
 * dsh-plan-show 的共享产物模型（host 与 client 半区共用，纯函数可测）。
 *
 * 一个 `Artifact` 撑起全部 show（plan / verify / completion），这是本插件"不逐类
 * 造私有模型"的前提：
 * - `sections`：叙述性内容（目标/影响面/风险/上下文…），保原文。
 * - `items`：可勾选/可跟踪的条目（步骤、判据、改动项），带状态与证据引用。
 * - `evidence`：证据（命令/测试/文件/日志），可用 `itemId` 挂到具体条目上。
 * - `decisions`：待用户做的选择（A/B/C 方向对比）。
 * - `openQuestions`：待定项（blocking 标记阻塞）。
 *
 * 三类 show 只是同一模型的**字段权重与默认视图**不同：
 * plan → items + decisions；verify → items × evidence 矩阵；completion → items 终态 + 范围。
 */

/** 产物类型（对应生命周期上的一次 show）。 */
export const ARTIFACT_KINDS = ['plan', 'verify', 'completion'] as const
/** 产物类型。 */
export type ArtifactKind = typeof ARTIFACT_KINDS[number]

/** 条目状态。 */
export const ITEM_STATUSES = ['todo', 'doing', 'done', 'blocked'] as const
/** 条目状态。 */
export type ItemStatus = typeof ITEM_STATUSES[number]

/** 证据结果。 */
export const EVIDENCE_RESULTS = ['pass', 'fail', 'info'] as const
/** 证据结果。 */
export type EvidenceResult = typeof EVIDENCE_RESULTS[number]

/** 小节归类。 */
export type SectionKind = 'goal' | 'steps' | 'impact' | 'risk' | 'verify' | 'context' | 'other'

/** 一个可跟踪条目。 */
export interface ArtifactItem {
  /** 稳定 id（视图 key / 证据挂载点）。 */
  id: string
  /** 条目文字。 */
  text: string
  /** 状态。 */
  status: ItemStatus
  /** 涉及文件（可选）。 */
  files?: string[]
  /** 验收判据（verify 用；缺省 = 该条目无判据）。 */
  criteria?: string
}

/** 一条证据。 */
export interface ArtifactEvidence {
  /** 稳定 id。 */
  id: string
  /** 证据种类。 */
  kind: 'command' | 'test' | 'file' | 'log' | 'link'
  /** 展示标签（如 `pnpm test`）。 */
  label: string
  /** 值（命令输出摘要 / 文件名 / URL）。 */
  value: string
  /** 结果。 */
  result: EvidenceResult
  /** 挂到哪个条目（缺省 = 产物级证据）。 */
  itemId?: string
}

/** 选择项（decisions 用）。 */
export interface ArtifactOption {
  /** 选项 id（A/B/C）。 */
  id: string
  /** 选项名。 */
  label: string
  /** 说明。 */
  detail: string
  /** 代价/风险摘要（可选）。 */
  cost?: string
}

/** 待用户做的决定。 */
export interface ArtifactDecision {
  /** 稳定 id。 */
  id: string
  /** 问题。 */
  question: string
  /** 选项。 */
  options: ArtifactOption[]
  /** 已选项 id（缺省 = 未决）。 */
  chosen?: string
}

/** 小节。 */
export interface ArtifactSection {
  /** 小节标题。 */
  title: string
  /** 归类（决定视觉权重）。 */
  kind: SectionKind
  /** 正文段（保原文）。 */
  text: string[]
  /** 要点。 */
  bullets: string[]
}

/** 一个产物。 */
export interface Artifact {
  /** 稳定 id。 */
  id: string
  /** 类型。 */
  kind: ArtifactKind
  /** 标题。 */
  title: string
  /** 一句话结论（结论先行；缺省 = 空串）。 */
  summary: string
  /** 小节。 */
  sections: ArtifactSection[]
  /** 条目。 */
  items: ArtifactItem[]
  /** 证据。 */
  evidence: ArtifactEvidence[]
  /** 待决。 */
  decisions: ArtifactDecision[]
  /** 待定问题。 */
  openQuestions: Array<{ id: string; text: string; blocking: boolean }>
  /** 原始文本（兜底展示；缺省 = 空串）。 */
  markdown: string
  /** 产出时间（epoch ms）。 */
  producedAt: number
  /** 会话 id（缺省 = 未标注）。 */
  sessionId?: string
}

/** 小节归类关键词（小写匹配；中英并列，方案两种写法都常见）。 */
const SECTION_KEYWORDS: Array<{ kind: SectionKind; words: readonly string[] }> = [
  { kind: 'goal', words: ['目标', '问题', '动机', 'goal', 'problem', 'why'] },
  { kind: 'steps', words: ['步骤', '计划', '方案', '实施', 'step', 'plan', 'approach'] },
  { kind: 'impact', words: ['影响', '改动', '文件', '范围', 'impact', 'files', 'scope'] },
  { kind: 'risk', words: ['风险', '边界', '限制', '注意', 'risk', 'caveat', 'limit'] },
  { kind: 'verify', words: ['验证', '测试', '闸门', '判据', 'verify', 'test', 'check'] },
  { kind: 'context', words: ['背景', '上下文', '现状', 'context', 'background'] },
]

/** 小节标题 → 归类。 */
export function classifySection(title: string): SectionKind {
  const lower = title.toLowerCase()
  for (const entry of SECTION_KEYWORDS) {
    if (entry.words.some((word) => lower.includes(word))) return entry.kind
  }
  return 'other'
}

/** 去行内 markdown 强调/反引号，留可读文字。 */
export function stripInline(text: string): string {
  return text
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\*\*([^*]*)\*\*/g, '$1')
    .replace(/\*([^*]*)\*/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .trim()
}

/** 复选框标记 → 条目状态。 */
function statusOfMark(mark: string): ItemStatus {
  const value = mark.trim().toLowerCase()
  if (value === 'x') return 'done'
  if (value === '~' || value === '>') return 'doing'
  if (value === '!') return 'blocked'
  return 'todo'
}

/**
 * 把 plan 类型的产物导出为 markdown（导出口径与官方计划卡一致：标题 + 小节 + 清单）。
 * @param artifact - 产物。
 * @returns markdown 文本。
 */
export function artifactToMarkdown(artifact: Artifact): string {
  const lines: string[] = [`# ${artifact.title}`]
  if (artifact.summary !== '') lines.push('', artifact.summary)
  for (const section of artifact.sections) {
    lines.push('', `## ${section.title}`)
    for (const text of section.text) lines.push('', text)
    for (const bullet of section.bullets) lines.push(`- ${bullet}`)
  }
  if (artifact.items.length > 0) {
    lines.push('', '## 条目')
    for (const item of artifact.items) {
      const mark = item.status === 'done' ? 'x' : item.status === 'doing' ? '~' : item.status === 'blocked' ? '!' : ' '
      lines.push(`- [${mark}] ${item.text}${item.criteria === undefined ? '' : `（判据：${item.criteria}）`}`)
    }
  }
  if (artifact.decisions.length > 0) {
    lines.push('', '## 待决')
    for (const decision of artifact.decisions) {
      lines.push(`- ${decision.question}${decision.chosen === undefined ? '' : `（已选 ${decision.chosen}）`}`)
      for (const option of decision.options) {
        lines.push(`  - ${option.id} ${option.label}：${option.detail}${option.cost === undefined ? '' : `（代价：${option.cost}）`}`)
      }
    }
  }
  if (artifact.evidence.length > 0) {
    lines.push('', '## 证据')
    for (const evidence of artifact.evidence) lines.push(`- ${evidence.label}: ${evidence.value} → ${evidence.result}`)
  }
  if (artifact.openQuestions.length > 0) {
    lines.push('', '## 待定')
    // 注意：这里不能用 `- [x]` 形态——回导时会被认成复选框条目。
    for (const question of artifact.openQuestions) lines.push(`- ${question.blocking ? '阻塞：' : ''}${question.text}`)
  }
  return `${lines.join('\n')}\n`
}

/**
 * markdown 方案 → plan 产物（导入/兜底路径；约定驱动，容忍格式不完美）。
 * 约定：`# 标题`、`## 小节`、`- [ ]/[x]/[~]/[!] 条目`、`1. 条目`、`- 要点`、其余正文。
 * @param markdown - 方案原文。
 * @param options - 产物元信息（id/sessionId/时间可注入，便于测试）。
 * @returns plan 产物。
 */
export function artifactFromMarkdown(
  markdown: string,
  options: { id?: string; sessionId?: string; producedAt?: number } = {},
): Artifact {
  const sections: ArtifactSection[] = []
  const items: ArtifactItem[] = []
  let title = ''
  let current: ArtifactSection | null = null
  const ensure = (): ArtifactSection => {
    if (current === null) {
      current = { title: '', kind: 'other', text: [], bullets: [] }
      sections.push(current)
    }
    return current
  }
  for (const rawLine of markdown.split(/\r?\n/)) {
    const trimmed = rawLine.trim()
    if (trimmed === '') continue
    if (trimmed.startsWith('# ') && !trimmed.startsWith('## ')) {
      if (title === '') title = stripInline(trimmed.slice(2))
      continue
    }
    if (trimmed.startsWith('## ')) {
      const sectionTitle = stripInline(trimmed.slice(3))
      current = { title: sectionTitle, kind: classifySection(sectionTitle), text: [], bullets: [] }
      sections.push(current)
      continue
    }
    const checkbox = /^[-*]\s+\[(.*?)\]\s*(.*)$/.exec(trimmed)
    const ordered = /^\d+[.)]\s+(.*)$/.exec(trimmed)
    const bullet = /^[-*]\s+(.*)$/.exec(trimmed)
    const section = ensure()
    if (checkbox !== null) {
      items.push({ id: `i${items.length}`, text: stripInline(checkbox[2]), status: statusOfMark(checkbox[1]) })
      continue
    }
    if (ordered !== null) {
      items.push({ id: `i${items.length}`, text: stripInline(ordered[1]), status: 'todo' })
      continue
    }
    if (bullet !== null) {
      section.bullets.push(stripInline(bullet[1]))
      continue
    }
    section.text.push(stripInline(trimmed))
  }
  return {
    id: options.id ?? `a${Date.now().toString(36)}`,
    kind: 'plan',
    title: title === '' ? '未命名方案' : title,
    summary: '',
    sections,
    items,
    evidence: [],
    decisions: [],
    openQuestions: [],
    markdown,
    producedAt: options.producedAt ?? Date.now(),
    ...options.sessionId === undefined ? {} : { sessionId: options.sessionId },
  }
}

/**
 * 校验并归一化一个来自工具参数的产物（工具入参是不可信 JSON）。
 * @param raw - 未知输入（期望对象）。
 * @returns 归一化产物；输入不可用 → 抛错（错误信息面向模型，指出哪个字段不行）。
 */
export function normalizeArtifact(raw: unknown): Artifact {
  if (typeof raw !== 'object' || raw === null) throw new Error('show_artifact: 需要一个对象参数')
  const input = raw as Record<string, unknown>
  const kind = input.kind
  if (typeof kind !== 'string' || !(ARTIFACT_KINDS as readonly string[]).includes(kind)) {
    throw new Error(`show_artifact: kind 必须是 ${ARTIFACT_KINDS.join(' | ')}`)
  }
  const title = typeof input.title === 'string' && input.title.trim() !== '' ? input.title.trim() : null
  if (title === null) throw new Error('show_artifact: title 必填且不能为空')
  const itemsRaw = Array.isArray(input.items) ? input.items : []
  const items: ArtifactItem[] = itemsRaw.map((entry, index) => {
    if (typeof entry !== 'object' || entry === null) throw new Error(`show_artifact: items[${index}] 必须是对象`)
    const item = entry as Record<string, unknown>
    if (typeof item.text !== 'string' || item.text.trim() === '') throw new Error(`show_artifact: items[${index}].text 必填`)
    const status = typeof item.status === 'string' && (ITEM_STATUSES as readonly string[]).includes(item.status)
      ? item.status as ItemStatus
      : 'todo'
    return {
      id: typeof item.id === 'string' && item.id !== '' ? item.id : `i${index}`,
      text: item.text.trim(),
      status,
      ...Array.isArray(item.files) ? { files: item.files.filter((file): file is string => typeof file === 'string') } : {},
      ...typeof item.criteria === 'string' && item.criteria.trim() !== '' ? { criteria: item.criteria.trim() } : {},
    }
  })
  const evidenceRaw = Array.isArray(input.evidence) ? input.evidence : []
  const evidence: ArtifactEvidence[] = evidenceRaw.map((entry, index) => {
    if (typeof entry !== 'object' || entry === null) throw new Error(`show_artifact: evidence[${index}] 必须是对象`)
    const item = entry as Record<string, unknown>
    if (typeof item.label !== 'string' || item.label.trim() === '') throw new Error(`show_artifact: evidence[${index}].label 必填`)
    const result = typeof item.result === 'string' && (EVIDENCE_RESULTS as readonly string[]).includes(item.result)
      ? item.result as EvidenceResult
      : 'info'
    return {
      id: typeof item.id === 'string' && item.id !== '' ? item.id : `e${index}`,
      kind: typeof item.kind === 'string' && ['command', 'test', 'file', 'log', 'link'].includes(item.kind)
        ? item.kind as ArtifactEvidence['kind']
        : 'command',
      label: item.label.trim(),
      value: typeof item.value === 'string' ? item.value : '',
      result,
      ...typeof item.itemId === 'string' && item.itemId !== '' ? { itemId: item.itemId } : {},
    }
  })
  return {
    id: typeof input.id === 'string' && input.id !== '' ? input.id : `a${Date.now().toString(36)}`,
    kind: kind as ArtifactKind,
    title,
    summary: typeof input.summary === 'string' ? input.summary.trim() : '',
    sections: Array.isArray(input.sections)
      ? input.sections.flatMap((entry) => {
          if (typeof entry !== 'object' || entry === null) return []
          const section = entry as Record<string, unknown>
          const sectionTitle = typeof section.title === 'string' ? section.title.trim() : ''
          if (sectionTitle === '') return []
          return [{
            title: sectionTitle,
            kind: classifySection(sectionTitle),
            text: Array.isArray(section.text) ? section.text.filter((t): t is string => typeof t === 'string') : [],
            bullets: Array.isArray(section.bullets) ? section.bullets.filter((t): t is string => typeof t === 'string') : [],
          }]
        })
      : [],
    items,
    evidence,
    decisions: Array.isArray(input.decisions)
      ? input.decisions.flatMap((entry, index) => {
          if (typeof entry !== 'object' || entry === null) return []
          const decision = entry as Record<string, unknown>
          if (typeof decision.question !== 'string' || decision.question.trim() === '') return []
          const options = Array.isArray(decision.options)
            ? decision.options.flatMap((option, oi) => {
                if (typeof option !== 'object' || option === null) return []
                const value = option as Record<string, unknown>
                if (typeof value.label !== 'string' || value.label.trim() === '') return []
                return [{
                  id: typeof value.id === 'string' && value.id !== '' ? value.id : `o${oi}`,
                  label: value.label.trim(),
                  detail: typeof value.detail === 'string' ? value.detail : '',
                  ...typeof value.cost === 'string' && value.cost !== '' ? { cost: value.cost } : {},
                }]
              })
            : []
          return [{
            id: typeof decision.id === 'string' && decision.id !== '' ? decision.id : `d${index}`,
            question: decision.question.trim(),
            options,
            ...typeof decision.chosen === 'string' && decision.chosen !== '' ? { chosen: decision.chosen } : {},
          }]
        })
      : [],
    openQuestions: Array.isArray(input.openQuestions)
      ? input.openQuestions.flatMap((entry, index) => {
          if (typeof entry !== 'object' || entry === null) return []
          const question = entry as Record<string, unknown>
          if (typeof question.text !== 'string' || question.text.trim() === '') return []
          return [{
            id: typeof question.id === 'string' && question.id !== '' ? question.id : `q${index}`,
            text: question.text.trim(),
            blocking: question.blocking === true,
          }]
        })
      : [],
    markdown: typeof input.markdown === 'string' ? input.markdown : '',
    producedAt: typeof input.producedAt === 'number' ? input.producedAt : Date.now(),
    ...typeof input.sessionId === 'string' && input.sessionId !== '' ? { sessionId: input.sessionId } : {},
  }
}

/** 条目 × 证据矩阵的一行（verify 视图用）。 */
export interface VerifyRow {
  /** 条目。 */
  item: ArtifactItem
  /** 挂在该条目上的证据。 */
  evidence: ArtifactEvidence[]
  /** 是否已验收（至少一条 pass 证据且状态 done）。 */
  verified: boolean
}

/**
 * 生成验收矩阵（verify 视图的核心派生）：每个条目带上它的证据，并判定是否已验收。
 * 没有任何证据的条目标 `verified=false`——"没有证据 = 未验证"，这是本插件的硬规则。
 * @param artifact - 产物。
 * @returns 矩阵行（顺序同 items）。
 */
export function verifyMatrix(artifact: Artifact): VerifyRow[] {
  return artifact.items.map((item) => {
    const evidence = artifact.evidence.filter((entry) => entry.itemId === item.id)
    const hasPass = evidence.some((entry) => entry.result === 'pass')
    return { item, evidence, verified: hasPass && item.status === 'done' }
  })
}

/** 产物的完成度统计（面板头部与看板用）。 */
export function artifactStats(artifact: Artifact): { total: number; done: number; doing: number; todo: number; blocked: number; evidence: number; verified: number } {
  const rows = verifyMatrix(artifact)
  return {
    total: artifact.items.length,
    done: artifact.items.filter((item) => item.status === 'done').length,
    doing: artifact.items.filter((item) => item.status === 'doing').length,
    todo: artifact.items.filter((item) => item.status === 'todo').length,
    blocked: artifact.items.filter((item) => item.status === 'blocked').length,
    evidence: artifact.evidence.length,
    verified: rows.filter((row) => row.verified).length,
  }
}
