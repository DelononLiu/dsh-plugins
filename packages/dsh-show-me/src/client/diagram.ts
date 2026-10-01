/**
 * 计划 → SVG → 图片数据 URL（照官方 `ee35e40bc8` 的图片呈现方法，零第三方依赖）。
 *
 * 官方那套的做法（`packages/client/ui-primitives/src/markdown/mermaid.ts`）：
 * 1. 渲染器产出 SVG 字符串；
 * 2. 解析 SVG 根节点，把 `viewBox` 里的宽高写回 `width`/`height` 内联属性
 *    —— `<img>` 需要固有尺寸（百分比宽是给内联 SVG 用的）；
 * 3. `data:image/svg+xml;charset=utf-8,` + `encodeURIComponent(序列化结果)`
 *    作为图片源，用 `<img>` 显示 → 图中脚本与链接**永不生效**（惰性图片）；
 * 4. 只对"定型"内容渲染，加载中/失败有状态，源变化即取消。
 *
 * 我们不引 mermaid：本插件的输入是结构化产物（步骤/状态/判据/证据），直接自绘 SVG
 * 更准也更轻。配色用中性浅底 + 深字（与官方 mermaid neutral 主题同思路：图在深浅
 * 主题下都在浅色画布上）；状态色沿用官方语义 token 的十六进制等价色，因为
 * `<img>` 内的 SVG **拿不到外层 CSS 变量**——这是该方法最重要的一个坑。
 */

import type { Artifact, ArtifactItem } from '../types'

/** 画布与排版常量。 */
const PAD = 16
const COL = 360
const ROW = 34
const GAP = 10
const TITLE_H = 34
/** 中性浅底画布（官方 mermaid neutral 同思路：深浅主题都用浅底）。 */
const BG = '#ffffff'
const FG = '#1f2937'
const MUTED = '#6b7280'
const LINE = '#d1d5db'

/** 状态下色（十六进制，等价官方语义 token：success/warn/error/business/label）。 */
const STATUS_COLOR: Record<ArtifactItem['status'], string> = {
  done: '#16a34a',
  doing: '#d97706',
  blocked: '#dc2626',
  todo: '#9ca3af',
}

/** XML 文本转义（自绘 SVG 必须自己做，否则文案里的 `<`/`&` 会破图）。 */
export function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/** 单行截断（图上不折行，长文案截断后由视图里的文字版兜底）。 */
function clip(text: string, max = 42): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`
}

/** 一行：条目 +（可选）证据结论。 */
function rowOf(item: ArtifactItem, evidence: { pass: number; fail: number; total: number }): string {
  const status = STATUS_COLOR[item.status]
  const y = 0 // 由调用方 translate
  const badge = evidence.total === 0
    ? `<text x="${COL - 14}" y="${y + 21}" text-anchor="end" font-size="11" fill="${MUTED}">无证据</text>`
    : `<text x="${COL - 14}" y="${y + 21}" text-anchor="end" font-size="11" fill="${evidence.fail > 0 ? STATUS_COLOR.blocked : STATUS_COLOR.done}">证据 ${evidence.pass}/${evidence.total}${evidence.fail > 0 ? '（有失败）' : ''}</text>`
  return [
    `<circle cx="14" cy="${y + 17}" r="5" fill="${status}"/>`,
    `<text x="28" y="${y + 21}" font-size="13" fill="${FG}">${escapeXml(clip(item.text))}</text>`,
    badge,
  ].join('')
}

/**
 * 产物 → SVG 字符串（确定性输出，便于单测）。
 *
 * 只画**有结构化支撑**的东西：条目顺序 + 状态 + 证据计数；叙述性小节不塞进图里
 * （研究结论：需要精确措辞的内容留在文字版，图只承担"关系与状态"）。
 * @param artifact - 产物。
 * @returns SVG 字符串（不含 XML 声明）。
 */
export function artifactSvg(artifact: Artifact): string {
  const rows = artifact.items.map((item) => {
    const list = artifact.evidence.filter((entry) => entry.itemId === item.id)
    return {
      item,
      evidence: {
        total: list.length,
        pass: list.filter((entry) => entry.result === 'pass').length,
        fail: list.filter((entry) => entry.result === 'fail').length,
      },
    }
  })
  const height = PAD * 2 + TITLE_H + Math.max(1, rows.length) * (ROW + GAP)
  const width = PAD * 2 + COL
  const body = rows.length === 0
    ? `<text x="${PAD}" y="${PAD + TITLE_H + 20}" font-size="13" fill="${MUTED}">（这份产物没有条目）</text>`
    : rows.map((row, index) => {
        const y = PAD + TITLE_H + index * (ROW + GAP)
        return [
          `<rect x="${PAD}" y="${y}" width="${COL}" height="${ROW}" rx="8" fill="#f9fafb" stroke="${LINE}"/>`,
          `<g transform="translate(${PAD}, ${y})">${rowOf(row.item, row.evidence)}</g>`,
        ].join('')
      }).join('')
  const verified = rows.filter((row) => row.evidence.pass > 0 && row.item.status === 'done').length
  const head = `${rows.length} 条目 · 已验证 ${verified} · 证据 ${artifact.evidence.length}`
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img">`,
    `<title>${escapeXml(artifact.title)}</title>`,
    `<rect width="${width}" height="${height}" fill="${BG}"/>`,
    `<text x="${PAD}" y="${PAD + 18}" font-size="15" font-weight="600" fill="${FG}">${escapeXml(clip(artifact.title, 34))}</text>`,
    `<text x="${PAD}" y="${PAD + 32}" font-size="11" fill="${MUTED}">${escapeXml(head)}</text>`,
    body,
    '</svg>',
  ].join('')
}

/**
 * SVG 字符串 → 图片数据 URL（**官方方法的核心三步**：viewBox→固有尺寸→data URL）。
 * @param svg - 完整 SVG 字符串。
 * @returns `data:image/svg+xml;charset=utf-8,…`；解析失败抛错（调用方回落原文）。
 */
export function svgToImageDataUrl(svg: string): string {
  // 先做完整性校验：DOM 解析器（尤其 happy-dom）对残缺 XML 过于宽容，
  // 不校验就会把半截 SVG 当成图片发出去。
  if (!svg.includes('<svg') || !svg.includes('</svg>')) throw new Error('SVG 不完整')
  const root = new DOMParser().parseFromString(svg, 'image/svg+xml').documentElement
  if (root.nodeName === 'parsererror' || root.nodeName !== 'svg') throw new Error('SVG 解析失败')
  const viewBox = root.getAttribute('viewBox')
  if (viewBox !== null) {
    const parts = viewBox.split(/\s+/)
    const width = parts[2]
    const height = parts[3]
    // `<img>` 需要固有尺寸——百分比宽只对内联 SVG 有意义。
    if (width !== undefined && height !== undefined) {
      root.setAttribute('width', width)
      root.setAttribute('height', height)
    }
  }
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(root))}`
}

/**
 * 一步到位：产物 → 图片数据 URL（失败抛错，由 UI 回落原文/文字视图）。
 * @param artifact - 产物。
 * @returns 图片数据 URL。
 */
export function artifactImageUrl(artifact: Artifact): string {
  return svgToImageDataUrl(artifactSvg(artifact))
}
