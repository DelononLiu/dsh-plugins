/**
 * dsh-show-me 的产物模型（client 半区使用，纯函数可测）。
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
export type ArtifactKind = 'plan' | 'verify' | 'completion'

/** 条目状态。 */
export type ItemStatus = 'todo' | 'doing' | 'done' | 'blocked'

/** 证据结果。 */
export type EvidenceResult = 'pass' | 'fail' | 'info'

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


