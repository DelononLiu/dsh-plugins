#!/usr/bin/env node
/**
 * 实例注册表（instances registry）——实例清单的**唯一权威**。
 *
 * 为什么需要它：实例清单曾有三个来源（daemon 落盘 instances.json、dsh-profile.sh 按名字推导
 * 目录、channel 发现），而 console 角色没有持久档案；布局双轨（老实例 ~/.dsh-<名> 自带安装 /
 * 新实例 ~/.dsh-home/instance-<名> 引用 runtime 池）之后，"名字 → 目录"的推导不再成立。
 * 因此：注册表文件是唯一入口，**运行时不做目录扫描**；老实例由一次显式的 `import` 动作登记。
 *
 * 文件：`$DSH_REGISTRY` 或 `~/.dsh-home/registry.json`；主键 `<host>/<instanceId>`
 * （单机 host = `$DSH_HOST_ID` 或 `os.hostname()`；跨主机同名不冲突）。
 *
 * 用法：
 *   dsh-registry.mjs path                          # 打印注册表路径
 *   dsh-registry.mjs list [--json] [--include-deleted]
 *   dsh-registry.mjs get <id> [--format tsv]       # tsv: home profileDir host layout role version port status
 *   dsh-registry.mjs import [--dry-run]            # 显式登记现有 per-instance 布局实例（幂等）
 *   dsh-registry.mjs remove <id>                   # 墓碑（条目保留，状态置 deleted）
 */

import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { homedir, hostname } from 'node:os'
import { join, basename, dirname } from 'node:path'

export const SCHEMA_VERSION = 1

/** 注册表路径：DSH_REGISTRY 覆盖，缺省 ~/.dsh-home/registry.json。 */
export function registryPath(env = process.env) {
  if (env.DSH_REGISTRY) return env.DSH_REGISTRY
  return join(env.HOME || homedir(), '.dsh-home', 'registry.json')
}

/** 本机 host id（多机主键的前半段）。 */
export function hostId(env = process.env) {
  return env.DSH_HOST_ID || hostname()
}

/** 读注册表；文件不存在 = 空表（不是错误）。 */
export function loadRegistry(file = registryPath()) {
  if (!existsSync(file)) return { schemaVersion: SCHEMA_VERSION, instances: {} }
  const raw = JSON.parse(readFileSync(file, 'utf8'))
  if (raw.schemaVersion !== SCHEMA_VERSION) {
    throw new Error(`注册表 schemaVersion 不支持：${raw.schemaVersion}（期望 ${SCHEMA_VERSION}）`)
  }
  if (typeof raw.instances !== 'object' || raw.instances === null) {
    throw new Error('注册表格式错误：instances 必须是对象')
  }
  return raw
}

/** 原子写注册表：临时文件 + rename（崩在中间不会留下半截 JSON）。 */
export function saveRegistry(reg, file = registryPath()) {
  mkdirSync(dirname(file), { recursive: true })
  const tmp = `${file}.tmp-${process.pid}`
  writeFileSync(tmp, `${JSON.stringify(reg, null, 2)}\n`)
  renameSync(tmp, file)
}

/** 读实例 patch 的实测事实：webserver 端口 + console 角色。 */
export function readPatchFacts(home, profileDir) {
  const patch = join(home, 'profiles', profileDir, 'cordis.patch.yml')
  if (!existsSync(patch)) return { port: null, role: 'console' }
  const lines = readFileSync(patch, 'utf8').split('\n')
  let port = null
  let inWebserver = false
  let role = null
  for (const line of lines) {
    if (/^- id: webserver\s*$/.test(line)) { inWebserver = true; continue }
    if (/^- id: /.test(line)) { inWebserver = false; continue }
    if (inWebserver) {
      const m = /^\s*port:\s*(\d+)\s*$/.exec(line)
      if (m && port === null) port = Number(m[1])
    }
    const r = /^\s*role:\s*(console|daemon|instance)\s*$/.exec(line)
    // 只认 console 插件段下的 role——同文件其它段（如用户 roles 列表）不匹配单数 role 行
    if (r && role === null && /^\s{4,}role:/.test(line)) role = r[1]
  }
  // 无 role 行 = console 插件默认角色（console 角色默认不注册 instance 执行器）
  return { port, role: role ?? 'console' }
}

/** 造一条实例档案（导入与创建共用同一形态）。 */
export function makeEntry({ id, host, home, profileDir, layout, template = null, version = null, addr = null }) {
  const facts = readPatchFacts(home, profileDir)
  return {
    id,
    name: id,
    host,
    home,
    profileDir,
    template,
    templateFingerprint: null,
    version,
    port: facts.port,
    role: facts.role,
    layout,
    addr: addr ?? (facts.port ? `http://127.0.0.1:${facts.port}` : null),
    status: 'active',
    createdAt: new Date().toISOString(),
    deletedAt: null,
  }
}

/**
 * 显式导入现有实例：扫描 per-instance 布局（`~/.dsh-<名>/profiles/<名>`）与正式实例
 * （`~/.dsh/profiles/web`）。**这是唯一允许扫描的地方**——运行时发现一律读注册表。
 * 幂等：已存在的条目（含墓碑）不动；legacy 条目只刷新 home/profileDir 与实测字段。
 */
export function importInstances({ env = process.env, reg = loadRegistry(registryPath(env)) } = {}) {
  const HOME = env.HOME || homedir()
  const host = hostId(env)
  const found = []
  let entries
  try {
    entries = readdirSync(HOME)
  } catch {
    entries = []
  }
  for (const name of entries) {
    if (!name.startsWith('.dsh-')) continue
    // 新布局根 `~/.dsh-home` 本身也匹配通配符——它不是实例
    if (name === '.dsh-home') continue
    const id = name.slice('.dsh-'.length)
    const home = join(HOME, name)
    if (!id || id === 'dsh') continue
    if (!existsSync(join(home, 'profiles', id))) continue
    found.push({ id, home, profileDir: id, layout: 'legacy' })
  }
  // 正式实例（3080）：DSH_HOME=~/.dsh，profile=web
  const officialHome = join(HOME, '.dsh')
  if (existsSync(join(officialHome, 'profiles', 'web'))) {
    found.push({ id: 'web', home: officialHome, profileDir: 'web', layout: 'legacy' })
  }

  const added = []
  const refreshed = []
  for (const f of found) {
    const key = `${host}/${f.id}`
    const prev = reg.instances[key]
    if (prev) {
      if (prev.status === 'deleted') continue // 墓碑不被导入复活
      if (prev.layout === 'legacy') {
        Object.assign(prev, makeEntry({ ...f, host }), { createdAt: prev.createdAt, id: prev.id, name: prev.name })
        refreshed.push(key)
      }
      continue
    }
    reg.instances[key] = makeEntry({ ...f, host })
    added.push(key)
  }
  return { reg, added, refreshed, scanned: found.length }
}

/** 按 id 查条目；多 host 同名时报错列出候选键。 */
export function findByInstanceId(reg, id) {
  const hits = Object.entries(reg.instances).filter(([, v]) => v.id === id)
  if (hits.length === 0) throw new Error(`未知实例：${id} 未在注册表（${registryPath()}）`)
  if (hits.length > 1) {
    throw new Error(`实例 id 歧义：${id} 出现在多个主机（${hits.map(([k]) => k).join(', ')}）——请用 <host>/<id> 指定`)
  }
  return hits[0]
}

const TSV_FIELDS = ['home', 'profileDir', 'host', 'layout', 'role', 'version', 'port', 'status']

function main(argv) {
  const [cmd, ...rest] = argv
  const flags = new Set(rest.filter((a) => a.startsWith('--')))
  const positional = rest.filter((a) => !a.startsWith('--'))
  const fmtArg = rest.indexOf('--format')
  const format = fmtArg >= 0 ? rest[fmtArg + 1] : null

  switch (cmd) {
    case 'path':
      process.stdout.write(`${registryPath()}\n`)
      return 0
    case 'list': {
      const reg = loadRegistry()
      const all = Object.values(reg.instances)
        .filter((i) => flags.has('--include-deleted') || i.status !== 'deleted')
        .sort((a, b) => a.id.localeCompare(b.id))
      if (flags.has('--json')) process.stdout.write(`${JSON.stringify(all, null, 2)}\n`)
      else for (const i of all) process.stdout.write(`${i.id}\t${i.layout}\t${i.status}\t${i.home}\n`)
      return 0
    }
    case 'get': {
      const id = positional[0]
      if (!id) throw new Error('用法: dsh-registry.mjs get <id> [--format tsv]')
      const reg = loadRegistry()
      const entry = findByInstanceId(reg, id)[1]
      if (format === 'tsv') {
        process.stdout.write(`${TSV_FIELDS.map((f) => (entry[f] ?? '')).join('\t')}\n`)
      } else {
        process.stdout.write(`${JSON.stringify(entry, null, 2)}\n`)
      }
      return 0
    }
    case 'import': {
      const { reg, added, refreshed, scanned } = importInstances()
      if (flags.has('--dry-run')) {
        process.stdout.write(`将新增 ${added.length} 条：${added.join(', ') || '（无）'}\n（dry-run，未写入）\n`)
        return 0
      }
      saveRegistry(reg)
      process.stdout.write(
        `扫描 ${scanned} 个 per-instance 布局实例 → 新增 ${added.length} 条、刷新 ${refreshed.length} 条（注册表：${registryPath()}）\n`,
      )
      return 0
    }
    case 'remove': {
      const id = positional[0]
      if (!id) throw new Error('用法: dsh-registry.mjs remove <id>')
      const reg = loadRegistry()
      const [, entry] = findByInstanceId(reg, id)
      entry.status = 'deleted'
      entry.deletedAt = new Date().toISOString()
      saveRegistry(reg)
      process.stdout.write(`已转墓碑：${entry.host}/${entry.id}（档案保留，目录归档由删除流程负责）\n`)
      return 0
    }
    default:
      process.stderr.write(
        '用法: dsh-registry.mjs {path|list|get <id>|import|remove <id>} [--json|--format tsv|--include-deleted|--dry-run]\n',
      )
      return 2
  }
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  try {
    process.exitCode = main(process.argv.slice(2))
  } catch (e) {
    process.stderr.write(`${e.message}\n`)
    process.exitCode = 1
  }
}
