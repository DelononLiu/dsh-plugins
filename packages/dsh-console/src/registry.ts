/**
 * 实例注册表（读写的第二实现，schema 与 `scripts/dsh-registry.mjs` 一致）。
 *
 * 为什么会有两份实现：console 是**已发布包**，不能依赖仓内脚本（部署到别的机器就断），
 * 也不该为此多发布一个包；因此内置同 schema 实现，并用**双向兼容测试**
 * （`tests/runtimes.spec.ts`）把"同一格式"钉死，而不是靠自觉。
 *
 * 权威源仍是 `~/.dsh-home/registry.json`（`$DSH_REGISTRY` 可覆盖），运行时**不扫描目录**。
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { homedir, hostname } from 'node:os'
import { dirname, join } from 'node:path'

/** schema 版本（与 scripts/dsh-registry.mjs 的 SCHEMA_VERSION 必须一致）。 */
export const SCHEMA_VERSION = 1

/** 实例档案。 */
export interface InstanceEntry {
  id: string
  name: string
  host: string
  home: string
  profileDir: string
  template: string | null
  templateFingerprint: string | null
  version: string | null
  port: number | null
  role: string
  /**
   * 布局：`legacy` = per-instance home（`~/.dsh-<名>`，自带安装）；`home` = 引用
   * runtime 池的新布局（`~/.dsh-home/instance-<名>`）；`profile` = **既有 home 下的
   * 一个 profile**（如 `~/.dsh` 的 `daemon`——与 `web` 平级，不是独立实例 home）。
   * 纯描述字段（运行时判布局看 home/profileDir 实际存在性，不读它）。
   */
  layout: 'legacy' | 'home' | 'profile'
  addr: string | null
  status: 'active' | 'deleted'
  createdAt: string
  deletedAt: string | null
  /** 删除时目录归档到的路径（墓碑保留它，恢复/审计都靠它）。 */
  archivePath?: string
  /** 归档时间（删除时刻）。 */
  archivedAt?: string
}

/** 注册表文件内容。 */
export interface Registry {
  schemaVersion: number
  instances: Record<string, InstanceEntry>
}

/** 注册表路径：`$DSH_REGISTRY` 覆盖，缺省 `~/.dsh-home/registry.json`。 */
export function registryPath(env: NodeJS.ProcessEnv = process.env): string {
  if (env.DSH_REGISTRY) return env.DSH_REGISTRY
  return join(env.HOME || homedir(), '.dsh-home', 'registry.json')
}

/** 本机 host id（多机主键的前半段）。 */
export function hostId(env: NodeJS.ProcessEnv = process.env): string {
  return env.DSH_HOST_ID || hostname()
}

/** 读注册表：文件不存在 = 空表（不是错误）。 */
export function loadRegistry(file: string = registryPath()): Registry {
  if (!existsSync(file)) return { schemaVersion: SCHEMA_VERSION, instances: {} }
  const raw = JSON.parse(readFileSync(file, 'utf8')) as Registry
  if (raw.schemaVersion !== SCHEMA_VERSION) {
    throw new Error(`注册表 schemaVersion 不支持：${String(raw.schemaVersion)}（期望 ${SCHEMA_VERSION}）`)
  }
  if (typeof raw.instances !== 'object' || raw.instances === null) {
    throw new Error('注册表格式错误：instances 必须是对象')
  }
  return raw
}

/** 原子写注册表（临时文件 + rename；崩在中间不留半截 JSON）。 */
export function saveRegistry(reg: Registry, file: string = registryPath()): void {
  mkdirSync(dirname(file), { recursive: true })
  const tmp = `${file}.tmp-${process.pid}`
  writeFileSync(tmp, `${JSON.stringify(reg, null, 2)}\n`)
  renameSync(tmp, file)
}

/** 读实例 patch 的实测事实：webserver 端口 + console 角色（与脚本同一判读规则）。 */
function patchFacts(home: string, profileDir: string): { port: number | null; role: string } {
  const patch = join(home, 'profiles', profileDir, 'cordis.patch.yml')
  if (!existsSync(patch)) return { port: null, role: 'console' }
  let inWebserver = false
  let port: number | null = null
  let role: string | null = null
  for (const line of readFileSync(patch, 'utf8').split('\n')) {
    if (/^- id: webserver\s*$/.test(line)) {
      inWebserver = true
      continue
    }
    if (/^- id: /.test(line)) {
      inWebserver = false
      continue
    }
    if (inWebserver) {
      const m = /^\s*port:\s*(\d+)\s*$/.exec(line)
      if (m && port === null) port = Number(m[1])
    }
    const r = /^\s{4,}role:\s*(console|daemon|instance)\s*$/.exec(line)
    if (r && role === null) role = r[1]
  }
  return { port, role: role ?? 'console' }
}

/** 新增/更新一条实例档案（保留 createdAt 与既有 id/name）。 */
export function upsertInstance(reg: Registry, input: Partial<InstanceEntry> & { id: string; host: string }): InstanceEntry {
  const key = `${input.host}/${input.id}`
  const prev = reg.instances[key]
  const facts = input.home && input.profileDir ? patchFacts(input.home, input.profileDir) : { port: null, role: 'console' }
  const entry: InstanceEntry = {
    id: input.id,
    name: input.name ?? prev?.name ?? input.id,
    host: input.host,
    home: input.home ?? prev?.home ?? '',
    profileDir: input.profileDir ?? prev?.profileDir ?? input.id,
    template: input.template ?? prev?.template ?? null,
    templateFingerprint: input.templateFingerprint ?? prev?.templateFingerprint ?? null,
    version: input.version ?? prev?.version ?? null,
    port: input.port ?? facts.port ?? prev?.port ?? null,
    role: input.role ?? prev?.role ?? facts.role,
    layout: input.layout ?? prev?.layout ?? 'home',
    addr: input.addr ?? prev?.addr ?? (facts.port ? `http://127.0.0.1:${facts.port}` : null),
    status: input.status ?? prev?.status ?? 'active',
    createdAt: prev?.createdAt ?? new Date().toISOString(),
    deletedAt: input.deletedAt ?? prev?.deletedAt ?? null,
  }
  reg.instances[key] = entry
  return entry
}

/** 按 id 查条目（含墓碑）；同 id 多 host 时返回第一个并优先 active。 */
export function findInstance(reg: Registry, id: string): InstanceEntry | undefined {
  const hits = Object.values(reg.instances).filter((i) => i.id === id)
  return hits.find((i) => i.status === 'active') ?? hits[0]
}

/** 列出实例（默认不含墓碑）。 */
export function listInstances(reg: Registry, opts: { includeDeleted?: boolean } = {}): InstanceEntry[] {
  return Object.values(reg.instances)
    .filter((i) => opts.includeDeleted === true || i.status !== 'deleted')
    .sort((a, b) => a.id.localeCompare(b.id))
}

/** 转墓碑（档案保留，目录归档由删除流程负责）。 */
export function removeInstance(reg: Registry, id: string): InstanceEntry {
  const entry = findInstance(reg, id)
  if (!entry) throw new Error(`未知实例：${id} 未在注册表（${registryPath()}）`)
  entry.status = 'deleted'
  entry.deletedAt = new Date().toISOString()
  return entry
}

/** 列出注册表里引用某 runtime 版本的实例 id（删除版本前的引用检查用）。 */
export function instancesUsingVersion(reg: Registry, version: string): string[] {
  return Object.values(reg.instances)
    .filter((i) => i.status !== 'deleted' && i.version === version)
    .map((i) => i.id)
}

/** 目录是否真实存在（注册表有档案但目录不在 = 不可用，不是"不存在"）。 */
export function instanceDirExists(entry: InstanceEntry): boolean {
  try {
    return statSync(join(entry.home, 'profiles', entry.profileDir)).isDirectory()
  } catch {
    return false
  }
}

/** 扫描 per-instance 布局（仅供**显式导入/创建**使用；运行时一律读注册表）。 */
export function scanLegacyHomes(homeDir: string): Array<{ id: string; home: string; profileDir: string }> {
  const found: Array<{ id: string; home: string; profileDir: string }> = []
  let names: string[] = []
  try {
    names = readdirSync(homeDir)
  } catch {
    names = []
  }
  for (const name of names) {
    if (!name.startsWith('.dsh-') || name === '.dsh-home') continue
    const id = name.slice('.dsh-'.length)
    if (!id || id === 'dsh') continue
    const home = join(homeDir, name)
    if (!existsSync(join(home, 'profiles', id))) continue
    found.push({ id, home, profileDir: id })
  }
  return found
}
