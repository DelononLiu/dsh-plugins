/**
 * 内核新版本检测（**只读**）：本机 runtime 池最高版本 vs 官方 npm dist-tags。
 *
 * 与升级引擎的分工：这里只**报告**（发现新版本），升级仍由人经
 * `upgradeInstances` 显式发起——检测绝不写实例状态、不改 profile、不预填升级目标。
 *
 * 三条不变量（都是踩过的那类坑）：
 * - **检测失败 ≠ 没有新版本**：网络/解析错误只回 `error` 字段，`latest` 保持 null，
 *   调用方不得把 null 当"已是最新"。
 * - **不拿 dist-tag 冒充可升级**：`updateAvailable` 要 `local` 与 `latest` 都有值才可能为
 *   true；池为空时说不出"本机落后多少"。
 * - **不每次刷新都打网络**：结果落盘缓存（成功 6h / 失败 5min），`refresh` 才强制重查。
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { listRuntimes, poolRoot } from './runtimes.js'
import type { KernelUpdateInfo } from './types.js'

/** 内核包名（与 scripts/check-kernel-version.mjs 同一版本轴）。 */
export const KERNEL_PACKAGE = '@deepseek-ai/dsh'

const DEFAULT_REGISTRY = 'https://registry.npmjs.org'
const TIMEOUT_MS = 8000
/** 成功结果缓存 TTL（6h：官方 rc 以天为节奏，秒级新鲜度没有价值）。 */
const OK_TTL_MS = 6 * 60 * 60 * 1000
/** 失败结果缓存 TTL（5min：够挡住连点，又不让一次抖动挡住半天）。 */
const FAIL_TTL_MS = 5 * 60 * 1000
const CACHE_FILE = '.kernel-update-check.json'

/** 缓存文件路径（runtime 池旁；池不可用时退化为不缓存）。 */
function cacheFile(env: NodeJS.ProcessEnv): string {
  return join(poolRoot(env), CACHE_FILE)
}

/**
 * 版本序比较（预发布 < 正式；预发布逐段比较，数字段按数值、数字段 < 字母段）。
 * 只服务于"哪个更新"这一个判断，不引入 semver 依赖。
 * @returns a<b → -1，a=b → 0，a>b → 1；无法解析时按字符串比较兜底。
 */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string): { nums: number[]; pre: string[] } | null => {
    const m = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(v.trim())
    if (m === null) return null
    return { nums: [+m[1], +m[2], +m[3]], pre: m[4] === undefined ? [] : m[4].split('.') }
  }
  const pa = parse(a)
  const pb = parse(b)
  if (pa === null || pb === null) return a === b ? 0 : (a < b ? -1 : 1)
  for (let i = 0; i < 3; i += 1) {
    if (pa.nums[i] !== pb.nums[i]) return pa.nums[i] < pb.nums[i] ? -1 : 1
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

/** 本机 runtime 池版本（降序）；池不存在/为空 → `[]`。 */
export function localVersions(env: NodeJS.ProcessEnv = process.env): string[] {
  try {
    return listRuntimes(env).slice().sort((a, b) => compareVersions(b, a))
  } catch {
    return [] // 池目录不可读 = 本机版本未知，不是"没有版本"
  }
}

/** 读缓存（TTL 内有效；超期/损坏/格式不符 → null）。 */
export function readCache(env: NodeJS.ProcessEnv = process.env, now = Date.now()): KernelUpdateInfo | null {
  const file = cacheFile(env)
  if (!existsSync(file)) return null
  try {
    const cached = JSON.parse(readFileSync(file, 'utf8')) as Partial<KernelUpdateInfo>
    if (typeof cached.checkedAt !== 'string' || !Array.isArray(cached.pooled) || typeof cached.distTags !== 'object' || cached.distTags === null) return null
    const age = now - Date.parse(cached.checkedAt)
    if (!Number.isFinite(age) || age < 0) return null
    return age <= (cached.error === undefined ? OK_TTL_MS : FAIL_TTL_MS) ? (cached as KernelUpdateInfo) : null
  } catch {
    return null
  }
}

/** 写缓存（尽力而为；**池目录不存在时不创建**——检测是只读动作，不该凭空造出 runtime 池）。 */
function writeCache(env: NodeJS.ProcessEnv, info: KernelUpdateInfo): void {
  try {
    if (!existsSync(poolRoot(env))) return
    writeFileSync(cacheFile(env), `${JSON.stringify(info, null, 2)}\n`)
  } catch {
    /* 缓存失败不改变结论 */
  }
}

/** 拉官方 dist-tags（仅取 `dist-tags`，不下载整份版本清单）。 */
async function fetchDistTags(opts: {
  registry?: string
  fetchImpl?: typeof fetch
  timeoutMs?: number
}): Promise<Record<string, string>> {
  const registry = String(opts.registry ?? process.env.DSH_NPM_REGISTRY ?? DEFAULT_REGISTRY).replace(/\/+$/, '')
  const doFetch = opts.fetchImpl ?? fetch
  const res = await doFetch(`${registry}/${KERNEL_PACKAGE}`, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(opts.timeoutMs ?? TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`registry HTTP ${res.status}`)
  const body = (await res.json()) as { 'dist-tags'?: Record<string, string> }
  const tags = body['dist-tags'] ?? {}
  if (Object.keys(tags).length === 0) throw new Error('registry 响应无 dist-tags')
  return tags
}

/**
 * 检测内核新版本（只读；结果带缓存）。
 * @param opts - `refresh` 绕过缓存强制重查；`env`/`fetchImpl`/`now`/`registry` 为测试缝。
 * @returns 本机池版本 + 官方 dist-tags + 是否有更新；检测失败时带 `error`。
 */
export async function detectKernelUpdate(opts: {
  refresh?: boolean
  env?: NodeJS.ProcessEnv
  fetchImpl?: typeof fetch
  now?: number
  registry?: string
} = {}): Promise<KernelUpdateInfo> {
  const env = opts.env ?? process.env
  const now = opts.now ?? Date.now()
  const pooled = localVersions(env)
  const local = pooled[0] ?? null

  if (opts.refresh !== true) {
    const cached = readCache(env, now)
    // 缓存也要与本机池现状对齐：池在 TTL 内新增了版本，缓存里的"本机版本"就过期了。
    if (cached !== null && (cached.pooled ?? []).join(',') === pooled.join(',')) return { ...cached, pooled, local, cached: true }
  }

  const base: KernelUpdateInfo = {
    local,
    pooled,
    distTags: {},
    latest: null,
    updateAvailable: false,
    checkedAt: new Date(now).toISOString(),
    cached: false,
  }
  try {
    const distTags = await fetchDistTags({ registry: opts.registry, fetchImpl: opts.fetchImpl })
    const latest = distTags.latest ?? distTags.next ?? null
    const info: KernelUpdateInfo = {
      ...base,
      distTags,
      latest,
      updateAvailable: local !== null && latest !== null && compareVersions(latest, local) > 0,
    }
    writeCache(env, info)
    return info
  } catch (e) {
    const info: KernelUpdateInfo = { ...base, error: e instanceof Error ? e.message : String(e) }
    writeCache(env, info)
    return info
  }
}
