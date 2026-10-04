/**
 * 实例进程内解析**自己正在跑的内核版本**。
 *
 * 版本是**运行时属性**，不是磁盘布局属性：实例可能引用 runtime 池（软链
 * `~/.dsh-runtimes/<版本>/`），也可能是全局/自带安装（`<prefix>/lib/node_modules/
 * @deepseek-ai/dsh`）。只按磁盘布局猜会漏掉后一种（真机实测：全局安装的实例
 * `node_modules/@deepseek-ai/dsh` 根本不存在 → 版本恒空）。故由实例**自报**，
 * 这里给出稳健的进程内解析：三种来源依序尝试，都拿不到就留空（不编造）。
 *
 * 1. 模块解析 `@deepseek-ai/dsh/package.json`（`createRequire(import.meta.url)`）；
 * 2. `process.argv[1]`（`.../bin/dsh`；软链先 `realpath`）推出的 npm 前缀；
 * 3. `process.execPath`（`.../bin/node`；软链先 `realpath`）推出的 npm 前缀。
 *
 * 磁盘池软链（`src/runtimes.ts` 的 `currentRuntimeVersion`）只作**离线兜底**，
 * 与自报是两个来源，不在此处混用。
 */

import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

/** `resolveKernelVersion` 的依赖注入点（缺省读真实进程与文件系统；测试注入桩）。 */
export interface KernelVersionInput {
  /** 模块解析器（缺省 `createRequire(import.meta.url).resolve`）；抛错/返回 undefined 视为未命中。 */
  resolveModule?: (id: string) => string | undefined
  /** 进程参数（缺省 `process.argv`）；`argv[1]` = 入口脚本路径。 */
  argv?: readonly string[]
  /** 进程可执行文件路径（缺省 `process.execPath`）。 */
  execPath?: string
  /** 读文本（缺省 `fs.readFileSync`；不可读返回 undefined）。 */
  readText?: (path: string) => string | undefined
  /** 存在判定（缺省 `fs.existsSync`）。 */
  exists?: (path: string) => boolean
  /** 软链解析（缺省 `fs.realpathSync`；不可解析返回 undefined）——`.bin/dsh` 这类软链要解析到包内。 */
  realpath?: (path: string) => string | undefined
}

/** 官方内核包名（自报对象）。 */
const KERNEL_PACKAGE = '@deepseek-ai/dsh'

/** 缺省读文件：不可读（不存在/无权限）返回 undefined，不抛。 */
function defaultReadText(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return undefined
  }
}

/** `createRequire(import.meta.url)` 的模块解析（未安装/未导出 package.json → undefined）。 */
function defaultResolveModule(id: string): string | undefined {
  try {
    return createRequire(import.meta.url).resolve(id)
  } catch {
    return undefined
  }
}

/** 缺省软链解析：不可解析返回 undefined（不抛）。 */
function defaultRealpath(path: string): string | undefined {
  try {
    return realpathSync(path)
  } catch {
    return undefined
  }
}

/** 从 package.json 文本取 `version`（非法 JSON / 非字符串 / 空串 → undefined）。 */
function versionOf(text: string | undefined): string | undefined {
  if (text === undefined) return undefined
  try {
    const version = (JSON.parse(text) as { version?: unknown }).version
    return typeof version === 'string' && version !== '' ? version : undefined
  } catch {
    return undefined
  }
}

/**
 * 从路径推 npm 前缀（三种真实布局）：
 * - `<prefix>/bin/dsh`（bin 里的可执行入口；`node_modules/.bin/dsh` 这类软链需先 realpath 再判）；
 * - `<prefix>/lib/node_modules/@deepseek-ai/dsh/...`（解析后的包内文件 / npm 全局布局）；
 * - `<prefix>/node_modules/@deepseek-ai/dsh/...`（本地/仓库内安装）。
 * @param path - 入口脚本或可执行文件路径。
 * @returns npm 前缀；推不出返回 undefined（不猜）。
 */
export function npmPrefixFromPath(path: string | undefined): string | undefined {
  if (path === undefined || path === '') return undefined
  const norm = path.replace(/\\/g, '/')
  const underLib = /^(.*)\/lib\/node_modules\/@deepseek-ai\/dsh(?:\/|$)/.exec(norm)
  if (underLib !== null) return underLib[1]
  const underModules = /^(.*)\/node_modules\/@deepseek-ai\/dsh(?:\/|$)/.exec(norm)
  if (underModules !== null) return underModules[1]
  // `<prefix>/bin/<name>`：父目录名为 bin 才认（`.bin/dsh` 的父目录是 `.bin`，不匹配）。
  const parent = dirname(norm)
  if (parent !== '.' && norm.startsWith(`${parent}/`) && parent.slice(parent.lastIndexOf('/') + 1) === 'bin') {
    return dirname(parent)
  }
  return undefined
}

/**
 * 解析本进程正在跑的内核版本。
 * @param input - 依赖注入（缺省读真实进程/文件系统）。
 * @returns 内核版本；三路径全失败返回 undefined（**不编造**）。
 */
export function resolveKernelVersion(input: KernelVersionInput = {}): string | undefined {
  const readText = input.readText ?? defaultReadText
  const exists = input.exists ?? existsSync

  // 1. 模块解析（最准：解析到真实加载的包）。
  const resolved = (input.resolveModule ?? defaultResolveModule)(`${KERNEL_PACKAGE}/package.json`)
  if (resolved !== undefined) {
    const version = versionOf(readText(resolved))
    if (version !== undefined) return version
  }

  // 2/3. npm 前缀：argv[1]（实际入口；软链解析后）优先，execPath（node 本体）其次。
  const argv = input.argv ?? process.argv
  const execPath = input.execPath ?? process.execPath
  const realpath = input.realpath ?? defaultRealpath
  const entry = argv[1]
  const paths = [
    entry,
    entry === undefined ? undefined : realpath(entry),
    execPath,
    realpath(execPath),
  ]
  const seen = new Set<string>()
  for (const path of paths) {
    const prefix = npmPrefixFromPath(path)
    if (prefix === undefined || seen.has(prefix)) continue
    seen.add(prefix)
    // lib/node_modules 是 npm 全局布局；node_modules 是本地布局。
    for (const segment of ['lib/node_modules', 'node_modules']) {
      const pkg = join(prefix, segment, KERNEL_PACKAGE, 'package.json')
      if (!exists(pkg)) continue
      const version = versionOf(readText(pkg))
      if (version !== undefined) return version
    }
  }
  return undefined
}
