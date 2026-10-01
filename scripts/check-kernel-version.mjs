#!/usr/bin/env node
/**
 * dsh 内核版本检测：官方 npm 是否已发布高于仓库基线的版本。
 *
 * 基线的权威源 = `profiles/<模板>/dsh.lock.json` 的 `kernel` 字段（发行包 = 内核
 * 版本锁定组合，见 docs/architecture.md §4）。本脚本只**发现**新版本，不升级——
 * 升级走 `.agents/skills/dsh-kernel-upgrade`（隔离实例验证 + 整体 bump）。
 *
 * 用法：
 *   node scripts/check-kernel-version.mjs            # 报告模式（人工查看）
 *   node scripts/check-kernel-version.mjs --check    # 闸门模式（有新版本/漂移即非零）
 *   DSH_NPM_REGISTRY=<url> node scripts/…            # 覆盖 registry（内网镜像）
 *
 * 退出码：
 *   0  报告模式完成；或闸门模式：无新版本、无漂移
 *   1  闸门模式发现新版本，或发现仓库内漂移（kernel 与官方 bundle 版本不一致）
 *   2  检测失败（registry 不可达 / 响应无法解析）——**不算**"没有新版本"
 */

import { readdir, readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** 内核包名（基线以此为版本轴）。 */
export const KERNEL_PACKAGE = '@deepseek-ai/dsh'

const DEFAULT_REGISTRY = 'https://registry.npmjs.org'
const TIMEOUT_MS = 15000
/** 官方包作用域：`bundles` 里这些包跟随内核版本整体推进。 */
const OFFICIAL_SCOPE = '@deepseek-ai/'

/** 退出码语义（调用方判据，勿改数值而不改文档）。 */
export const EXIT = { ok: 0, outdated: 1, failed: 2 }

/**
 * 解析版本号（支持 `1.2.3` 与 `1.2.3-<预发布段>`；预发布段按 `.` 切分）。
 * @param value - 版本字符串。
 * @returns 解析结果；无法解析时 null（调用方决定报错还是跳过）。
 */
export function parseVersion(value) {
  const m = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(String(value ?? '').trim())
  if (m === null) return null
  return { major: +m[1], minor: +m[2], patch: +m[3], pre: m[4] === undefined ? [] : m[4].split('.') }
}

/**
 * semver 序比较（预发布 < 正式；预发布逐段比较，数字段按数值、数字段 < 字母段）。
 * @returns -1 | 0 | 1。
 */
export function compareVersions(a, b) {
  const pa = parseVersion(a)
  const pb = parseVersion(b)
  if (pa === null || pb === null) throw new Error(`invalid version: ${pa === null ? a : b}`)
  for (const key of ['major', 'minor', 'patch']) {
    if (pa[key] !== pb[key]) return pa[key] < pb[key] ? -1 : 1
  }
  if (pa.pre.length === 0 || pb.pre.length === 0) {
    if (pa.pre.length === pb.pre.length) return 0
    return pa.pre.length === 0 ? 1 : -1
  }
  const n = Math.min(pa.pre.length, pb.pre.length)
  for (let i = 0; i < n; i += 1) {
    const x = pa.pre[i]
    const y = pb.pre[i]
    const xn = /^\d+$/.test(x)
    const yn = /^\d+$/.test(y)
    if (xn && yn) {
      if (+x !== +y) return +x < +y ? -1 : 1
      continue
    }
    if (xn !== yn) return xn ? -1 : 1
    if (x !== y) return x < y ? -1 : 1
  }
  if (pa.pre.length === pb.pre.length) return 0
  return pa.pre.length < pb.pre.length ? -1 : 1
}

/**
 * 读仓库内各 profile 模板的版本基线。
 *
 * 同时做两项机械漂移检测（版本锁是人写的，靠自觉对齐必然漂）：
 * ① 各 profile 的 `kernel` 是否一致；② 官方 bundle 版本是否等于该 profile 的 kernel。
 *
 * @param repoRoot - 仓库根目录（含 profiles/）。
 * @returns `{ profiles, baseline, kernelDrift, bundleDrift }`；baseline = 各 profile 中最高 kernel 版本。
 */
export async function readPinned(repoRoot) {
  const dir = join(repoRoot, 'profiles')
  const entries = await readdir(dir, { withFileTypes: true })
  const profiles = []
  for (const entry of entries.filter((e) => e.isDirectory()).map((e) => e.name).sort()) {
    let lock
    try {
      lock = JSON.parse(await readFile(join(dir, entry, 'dsh.lock.json'), 'utf8'))
    } catch {
      continue // 无 lock 的目录不是模板
    }
    const m = /^(@?[^@]+)@(.+)$/.exec(String(lock.kernel ?? ''))
    if (m === null) throw new Error(`profiles/${entry}/dsh.lock.json 的 kernel 字段无法解析：${String(lock.kernel)}`)
    const bundles = lock.bundles ?? {}
    profiles.push({
      profile: entry,
      version: m[2],
      bundleDrift: Object.entries(bundles)
        .filter(([name, version]) => name.startsWith(OFFICIAL_SCOPE) && version !== m[2])
        .map(([name, version]) => ({ name, version })),
    })
  }
  if (profiles.length === 0) throw new Error(`profiles/ 下没有可解析的 dsh.lock.json：${dir}`)
  const baseline = profiles.map((p) => p.version).reduce((hi, v) => (compareVersions(v, hi) > 0 ? v : hi))
  return {
    profiles,
    baseline,
    kernelDrift: profiles.filter((p) => p.version !== baseline).map((p) => ({ profile: p.profile, version: p.version })),
    bundleDrift: profiles.flatMap((p) => p.bundleDrift.map((d) => ({ profile: p.profile, ...d }))),
  }
}

/**
 * 拉取 npm registry 元数据（dist-tags + 已发布版本清单）。
 * @param pkg - 包名。
 * @param opts - `{ registry, fetchImpl, timeoutMs }`（测试注入用）。
 */
export async function fetchPublished(pkg, opts = {}) {
  const registry = String(opts.registry ?? DEFAULT_REGISTRY).replace(/\/+$/, '')
  const doFetch = opts.fetchImpl ?? globalThis.fetch
  const res = await doFetch(`${registry}/${pkg}`, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(opts.timeoutMs ?? TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`registry HTTP ${res.status}${res.statusText === '' ? '' : ` ${res.statusText}`}`)
  const body = await res.json()
  return { distTags: body['dist-tags'] ?? {}, versions: Object.keys(body.versions ?? {}) }
}

/**
 * 已发布版本中严格高于基线的版本（降序）。
 * @param baseline - 仓库基准版本。
 * @param versions - registry 返回的版本清单。
 */
export function newerVersions(baseline, versions) {
  return versions
    .filter((v) => parseVersion(v) !== null && compareVersions(v, baseline) > 0)
    .sort((a, b) => compareVersions(b, a))
}

/** 某版本命中的 dist-tag 名（`0.2.0-rc.2` → `['latest','next']`）。 */
export function tagsOf(version, distTags) {
  return Object.entries(distTags).filter(([, v]) => v === version).map(([name]) => name)
}

/**
 * 组装报告（纯函数：网络与文件读写在调用方）。
 * @param pinned - {@link readPinned} 结果。
 * @param published - {@link fetchPublished} 结果。
 */
export function buildReport(pinned, published) {
  const newer = newerVersions(pinned.baseline, published.versions)
  return {
    package: KERNEL_PACKAGE,
    baseline: pinned.baseline,
    profiles: pinned.profiles,
    drift: { kernel: pinned.kernelDrift, bundle: pinned.bundleDrift },
    distTags: published.distTags,
    newer,
    latest: newer[0] ?? null,
  }
}

/** 渲染人读报告（纯函数）。 */
export function formatReport(report) {
  const lines = [`dsh 内核版本检测 · npm ${report.package}`]
  lines.push(`  仓库基线 ${report.baseline}（profiles: ${report.profiles.map((p) => p.profile).join(', ')}）`)
  const tags = Object.entries(report.distTags).sort(([a], [b]) => a.localeCompare(b))
  lines.push(`  registry dist-tags：${tags.length === 0 ? '（无）' : tags.map(([k, v]) => `${k}=${v}`).join(' · ')}`)
  if (report.latest === null) {
    lines.push('  ✓ 无高于基线的发布版本')
  } else {
    lines.push(`  ⬆ 有新版本 ${report.newer.length} 个（高于基线）：`)
    for (const v of report.newer) {
      const hit = tagsOf(v, report.distTags)
      lines.push(`     ${v}${hit.length === 0 ? '' : `  ← ${hit.join(', ')}`}`)
    }
    lines.push('  → 升级请走 .agents/skills/dsh-kernel-upgrade（隔离实例验证，勿直接改基线）')
  }
  const drift = [...report.drift.kernel.map((d) => `profiles/${d.profile}：kernel ${d.version}`),
    ...report.drift.bundle.map((d) => `profiles/${d.profile}：${d.name} ${d.version}`)]
  if (drift.length > 0) {
    lines.push(`  ⚠ 仓库内漂移（应与基线 ${report.baseline} 一致）：`)
    for (const d of drift) lines.push(`     ${d}`)
  }
  return lines.join('\n')
}

/** 帮助文本（`--help`）。 */
const USAGE = `用法：node scripts/check-kernel-version.mjs [--check] [--repo <dir>] [--registry <url>]

  （无参数）        报告模式：打印基线与官方发布版本
  --check          闸门模式：有新版本或仓库内漂移 → 退出 1
  --repo <dir>     仓库根目录（默认 = 本脚本上一级）
  --registry <url> npm registry（默认 ${DEFAULT_REGISTRY}；亦可用 DSH_NPM_REGISTRY）
`

/**
 * CLI 入口。
 * @param argv - 参数（不含 node 与脚本路径）。
 * @param opts - `{ repoRoot, fetchImpl, stdout, stderr }`（测试注入用）。
 * @returns 退出码。
 */
export async function main(argv, opts = {}) {
  const args = [...argv]
  if (args.includes('--help') || args.includes('-h')) {
    ;(opts.stdout ?? process.stdout).write(USAGE)
    return EXIT.ok
  }
  const out = opts.stdout ?? process.stdout
  const err = opts.stderr ?? process.stderr
  const check = args.includes('--check')
  const take = (flag) => {
    const i = args.indexOf(flag)
    if (i === -1) return undefined
    const v = args[i + 1]
    if (v === undefined || v.startsWith('--')) throw new Error(`${flag} 缺少取值`)
    return v
  }
  let repoRoot = opts.repoRoot
  let registry
  try {
    repoRoot = take('--repo') ?? repoRoot ?? resolve(dirname(fileURLToPath(import.meta.url)), '..')
    registry = take('--registry') ?? process.env.DSH_NPM_REGISTRY ?? DEFAULT_REGISTRY
  } catch (e) {
    err.write(`${e instanceof Error ? e.message : String(e)}\n${USAGE}`)
    return EXIT.failed
  }

  let report
  try {
    const pinned = await readPinned(repoRoot)
    const published = await fetchPublished(KERNEL_PACKAGE, { registry, fetchImpl: opts.fetchImpl })
    report = buildReport(pinned, published)
  } catch (e) {
    err.write(`✗ 检测失败：${e instanceof Error ? e.message : String(e)}\n`)
    err.write(`  （registry ${registry}；检测失败不等于"没有新版本"）\n`)
    return EXIT.failed
  }

  out.write(`${formatReport(report)}\n`)
  const drifted = report.drift.kernel.length > 0 || report.drift.bundle.length > 0
  if (check && (report.latest !== null || drifted)) {
    err.write(`✗ 闸门未通过：${report.latest === null ? '' : `有新版本 ${report.latest}`}${report.latest !== null && drifted ? '；' : ''}${drifted ? '仓库内版本漂移' : ''}\n`)
    return EXIT.outdated
  }
  return EXIT.ok
}

// 直接执行（被 import 时不跑）。
if (process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  process.exitCode = await main(process.argv.slice(2))
}
