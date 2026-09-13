/**
 * runtime 池 + 注册表（console 内置实现）测试。
 *
 * 覆盖 R7 的验收判据：版本池不可变、被引用禁止删除、实例靠软链引用池、
 * 升级 = 切软链（可切回）、注册表与 scripts/dsh-registry.mjs 双向兼容。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readlinkSync, lstatSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { execFileSync } from 'node:child_process'

import {
  importRuntime,
  listRuntimes,
  removeRuntime,
  linkRuntimeInto,
  currentRuntimeVersion,
  runtimeDir,
} from '../src/runtimes.js'
import { loadRegistry, saveRegistry, upsertInstance, findInstance } from '../src/registry.js'

const ROOT = join(__dirname, '..', '..', '..')
const REGISTRY_CLI = join(ROOT, 'scripts', 'dsh-registry.mjs')

let tmp: string
let pool: string
let registryFile: string

/** 造一份"官方 CLI 安装"：官方包 + 一个非官方包（不应被链接）。 */
function fakeCli(dir: string, version = '0.1.2-rc.1', extraOfficial: string[] = ['dsh-base', 'dsh-web-app']): string {
  const nm = join(dir, 'node_modules')
  const write = (name: string, pkgVersion: string) => {
    mkdirSync(join(nm, ...name.split('/')), { recursive: true })
    writeFileSync(join(nm, ...name.split('/'), 'package.json'), JSON.stringify({ name, version: pkgVersion }))
  }
  write('@deepseek-ai/dsh', version)
  for (const e of extraOfficial) write(`@deepseek-ai/${e}`, version)
  write('dsh-console', '0.0.0') // 自研包：池里不该有，也不该被链接
  return dir
}

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'dsh-rt-'))
  pool = join(tmp, 'runtimes')
  registryFile = join(tmp, 'registry.json')
  process.env.DSH_RUNTIMES = pool
  process.env.DSH_REGISTRY = registryFile
  process.env.DSH_HOST_ID = 'master'
})

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true })
  delete process.env.DSH_RUNTIMES
  delete process.env.DSH_REGISTRY
  delete process.env.DSH_HOST_ID
})

describe('runtime 池', () => {
  it('导入版本：目录结构 + 来源版本校验', () => {
    const cli = fakeCli(join(tmp, 'cli'))
    const r = importRuntime({ version: '0.1.2-rc.1', source: cli })
    expect(r.ok).toBe(true)
    expect(existsSync(join(runtimeDir('0.1.2-rc.1'), 'node_modules', '@deepseek-ai', 'dsh'))).toBe(true)
    const marker = JSON.parse(readFileSync(join(runtimeDir('0.1.2-rc.1'), '.dsh-runtime.json'), 'utf8'))
    expect(marker.version).toBe('0.1.2-rc.1')
    expect(marker.source).toBe(cli)
  })

  it('池不可变：同版本重复导入被拒绝，且不改动池内文件', () => {
    const cli = fakeCli(join(tmp, 'cli'))
    importRuntime({ version: '0.1.2-rc.1', source: cli })
    const before = readFileSync(join(runtimeDir('0.1.2-rc.1'), '.dsh-runtime.json'), 'utf8')
    const again = importRuntime({ version: '0.1.2-rc.1', source: cli })
    expect(again.ok).toBe(false)
    expect(again.error).toMatch(/已存在|不可变/)
    expect(readFileSync(join(runtimeDir('0.1.2-rc.1'), '.dsh-runtime.json'), 'utf8')).toBe(before)
  })

  it('来源版本与目标版本不符时拒绝导入', () => {
    const cli = fakeCli(join(tmp, 'cli'), '0.1.1-rc.2')
    const r = importRuntime({ version: '0.1.2-rc.1', source: cli })
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/版本不符|0\.1\.1-rc\.2/)
  })

  it('listRuntimes 按池目录列出（排序）', () => {
    importRuntime({ version: '0.1.2-rc.1', source: fakeCli(join(tmp, 'cli-a')) })
    importRuntime({ version: '0.1.1-rc.2', source: fakeCli(join(tmp, 'cli-b'), '0.1.1-rc.2') })
    expect(listRuntimes()).toEqual(['0.1.1-rc.2', '0.1.2-rc.1'])
  })

  it('被实例引用的版本拒绝删除；无引用可删', () => {
    importRuntime({ version: '0.1.2-rc.1', source: fakeCli(join(tmp, 'cli')) })
    importRuntime({ version: '0.1.1-rc.2', source: fakeCli(join(tmp, 'cli-b'), '0.1.1-rc.2') })
    const reg = loadRegistry()
    upsertInstance(reg, { id: 'instance-a', host: 'master', home: join(tmp, 'home'), profileDir: 'dev', layout: 'home', version: '0.1.2-rc.1' })
    saveRegistry(reg)
    const denied = removeRuntime('0.1.2-rc.1')
    expect(denied.ok).toBe(false)
    expect(denied.error).toMatch(/被实例引用|instance-a/)
    expect(listRuntimes()).toContain('0.1.2-rc.1')
    expect(removeRuntime('0.1.1-rc.2').ok).toBe(true)
    expect(listRuntimes()).not.toContain('0.1.1-rc.2')
  })
})

describe('实例引用池（软链 = 切引用）', () => {
  function instanceProfile(version = '0.1.2-rc.1'): string {
    const profile = join(tmp, 'instance-a', 'profiles', 'dev')
    mkdirSync(join(profile, 'node_modules', '@deepseek-ai'), { recursive: true })
    // 实例自带安装的现状：官方包是真目录（升级前）
    for (const name of ['dsh', 'dsh-base']) {
      mkdirSync(join(profile, 'node_modules', '@deepseek-ai', name), { recursive: true })
      writeFileSync(join(profile, 'node_modules', '@deepseek-ai', name, 'package.json'), JSON.stringify({ name: `@deepseek-ai/${name}`, version }))
    }
    // 自研包必须保持在实例里（不参与池引用）
    mkdirSync(join(profile, 'node_modules', 'dsh-console'), { recursive: true })
    writeFileSync(join(profile, 'node_modules', 'dsh-console', 'package.json'), JSON.stringify({ name: 'dsh-console', version: '0.0.0' }))
    return profile
  }

  it('把官方包软链到池；自研包原样不动；可重复执行', () => {
    importRuntime({ version: '0.1.2-rc.1', source: fakeCli(join(tmp, 'cli')) })
    const profile = instanceProfile()
    const r = linkRuntimeInto(profile, '0.1.2-rc.1')
    expect(r.ok).toBe(true)
    const linked = join(profile, 'node_modules', '@deepseek-ai', 'dsh')
    expect(lstatSync(linked).isSymbolicLink()).toBe(true)
    expect(readlinkSync(linked)).toBe(join(runtimeDir('0.1.2-rc.1'), 'node_modules', '@deepseek-ai', 'dsh'))
    expect(lstatSync(join(profile, 'node_modules', 'dsh-console')).isDirectory()).toBe(true)
    expect(currentRuntimeVersion(profile)).toBe('0.1.2-rc.1')
    expect(linkRuntimeInto(profile, '0.1.2-rc.1').ok).toBe(true) // 幂等
  })

  it('切引用：换版本只改软链目标，回滚 = 切回旧引用', () => {
    importRuntime({ version: '0.1.2-rc.1', source: fakeCli(join(tmp, 'cli-a')) })
    importRuntime({ version: '0.1.1-rc.2', source: fakeCli(join(tmp, 'cli-b'), '0.1.1-rc.2') })
    const profile = instanceProfile()
    linkRuntimeInto(profile, '0.1.2-rc.1')
    linkRuntimeInto(profile, '0.1.1-rc.2')
    expect(currentRuntimeVersion(profile)).toBe('0.1.1-rc.2')
    linkRuntimeInto(profile, '0.1.2-rc.1')
    expect(currentRuntimeVersion(profile)).toBe('0.1.2-rc.1')
  })

  it('目标版本不在池里 → 拒绝（不改动任何东西）', () => {
    const profile = instanceProfile()
    const r = linkRuntimeInto(profile, '9.9.9')
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/未在池|9\.9\.9/)
    expect(lstatSync(join(profile, 'node_modules', '@deepseek-ai', 'dsh')).isSymbolicLink()).toBe(false)
  })
})

describe('注册表：console 内置实现与 scripts/dsh-registry.mjs 双向兼容', () => {
  const env = () => ({ ...process.env, DSH_REGISTRY: registryFile, DSH_HOST_ID: 'master' })

  it('console 写 → 脚本读（tsv 字段一致）', () => {
    const reg = loadRegistry()
    upsertInstance(reg, { id: 'instance-a', host: 'master', home: join(tmp, 'home-a'), profileDir: 'dev', layout: 'home', version: '0.1.2-rc.1' })
    saveRegistry(reg)
    const out = execFileSync('node', [REGISTRY_CLI, 'get', 'instance-a', '--format', 'tsv'], { env: env(), encoding: 'utf8' })
    const [home, profileDir, host, layout, , version, , status] = out.trim().split('\t')
    expect(home).toBe(join(tmp, 'home-a'))
    expect(profileDir).toBe('dev')
    expect(host).toBe('master')
    expect(layout).toBe('home')
    expect(version).toBe('0.1.2-rc.1')
    expect(status).toBe('active')
  })

  it('脚本写 → console 读；墓碑状态一致', () => {
    const home = join(tmp, 'legacy-home')
    mkdirSync(join(home, '.dsh-web9', 'profiles', 'web9'), { recursive: true })
    execFileSync('node', [REGISTRY_CLI, 'import'], { env: { ...env(), HOME: home }, encoding: 'utf8' })
    const reg = loadRegistry()
    const entry = findInstance(reg, 'web9')
    expect(entry?.home).toBe(join(home, '.dsh-web9'))
    expect(entry?.layout).toBe('legacy')
    execFileSync('node', [REGISTRY_CLI, 'remove', 'web9'], { env: { ...env(), HOME: home }, encoding: 'utf8' })
    expect(findInstance(loadRegistry(), 'web9')?.status).toBe('deleted')
  })
})
