/**
 * 内核新版本检测测试（只读检测 + TTL 缓存 + 失败语义）。
 *
 * 重点不是"能查到最新版本"，而是三条不变量：检测失败 ≠ 已是最新、池变则缓存失效、
 * `refresh` 才强制打网络。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { compareVersions, detectKernelUpdate, localVersions, readCache, KERNEL_PACKAGE } from '../src/kernel-update.js'

let pool: string
let env: NodeJS.ProcessEnv

/** 造池内版本目录（`listRuntimes` 只认带标记的目录）。 */
function putRuntime(version: string): void {
  const dir = join(pool, version)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, '.dsh-runtime.json'), JSON.stringify({ version }))
}

/** 假 registry 响应（只用到 dist-tags）。 */
function tagsFetch(distTags: Record<string, string>, count = { n: 0 }): typeof fetch {
  return (async () => {
    count.n += 1
    return { ok: true, status: 200, json: async () => ({ 'dist-tags': distTags }) }
  }) as unknown as typeof fetch
}

beforeEach(() => {
  pool = mkdtempSync(join(tmpdir(), 'dsh-kernel-upd-'))
  env = { ...process.env, DSH_RUNTIMES: pool }
})

afterEach(() => {
  rmSync(pool, { recursive: true, force: true })
})

describe('compareVersions', () => {
  it('预发布 < 正式；rc.2 < rc.10；alpha < rc', () => {
    expect(compareVersions('0.1.7-rc.2', '0.1.7-rc.10')).toBe(-1)
    expect(compareVersions('0.1.7-alpha.2', '0.1.7-rc.1')).toBe(-1)
    expect(compareVersions('0.2.0-rc.1', '0.1.7-rc.2')).toBe(1)
    expect(compareVersions('0.1.7', '0.1.7-rc.2')).toBe(1)
    expect(compareVersions('0.1.7-rc.2', '0.1.7-rc.2')).toBe(0)
  })

  it('无法解析的版本不抛异常（回落字符串比较）', () => {
    expect(compareVersions('weird', 'weird')).toBe(0)
  })
})

describe('localVersions', () => {
  it('池内版本降序；池为空/不存在 → []', () => {
    expect(localVersions({ ...env, DSH_RUNTIMES: join(pool, 'missing') })).toEqual([])
    putRuntime('0.1.7-rc.2')
    putRuntime('0.1.5-rc.3')
    expect(localVersions(env)).toEqual(['0.1.7-rc.2', '0.1.5-rc.3'])
  })
})

describe('detectKernelUpdate', () => {
  it('本机落后于官方 latest → updateAvailable，latest 取 dist-tags.latest', async () => {
    putRuntime('0.1.7-rc.2')
    const info = await detectKernelUpdate({ env, fetchImpl: tagsFetch({ latest: '0.2.0-rc.2', next: '0.2.0-rc.2', alpha: '0.1.7-alpha.2' }) })
    expect(info.local).toBe('0.1.7-rc.2')
    expect(info.latest).toBe('0.2.0-rc.2')
    expect(info.updateAvailable).toBe(true)
    expect(info.cached).toBe(false)
    expect(info.error).toBeUndefined()
  })

  it('latest 缺省时回落 next', async () => {
    putRuntime('0.1.7-rc.2')
    const info = await detectKernelUpdate({ env, fetchImpl: tagsFetch({ next: '0.2.0-rc.2' }) })
    expect(info.latest).toBe('0.2.0-rc.2')
  })

  it('本机已是官方最新 → updateAvailable=false（不谎报有更新）', async () => {
    putRuntime('0.2.0-rc.2')
    const info = await detectKernelUpdate({ env, fetchImpl: tagsFetch({ latest: '0.2.0-rc.2' }) })
    expect(info.updateAvailable).toBe(false)
  })

  it('池为空 → local=null、updateAvailable=false（说不出"落后多少"）', async () => {
    const info = await detectKernelUpdate({ env, fetchImpl: tagsFetch({ latest: '0.2.0-rc.2' }) })
    expect(info.local).toBeNull()
    expect(info.latest).toBe('0.2.0-rc.2')
    expect(info.updateAvailable).toBe(false)
  })

  it('TTL 内二次调用走缓存，不再打网络', async () => {
    putRuntime('0.1.7-rc.2')
    const count = { n: 0 }
    const fetchImpl = tagsFetch({ latest: '0.2.0-rc.2' }, count)
    await detectKernelUpdate({ env, fetchImpl })
    const second = await detectKernelUpdate({ env, fetchImpl })
    expect(count.n).toBe(1)
    expect(second.cached).toBe(true)
    expect(second.updateAvailable).toBe(true)
  })

  it('池在 TTL 内新增版本 → 缓存失效并重查（本机版本不能是陈的）', async () => {
    putRuntime('0.1.7-rc.2')
    const count = { n: 0 }
    const fetchImpl = tagsFetch({ latest: '0.2.0-rc.2' }, count)
    await detectKernelUpdate({ env, fetchImpl })
    putRuntime('0.2.0-rc.2')
    const second = await detectKernelUpdate({ env, fetchImpl })
    expect(count.n).toBe(2)
    expect(second.local).toBe('0.2.0-rc.2')
    expect(second.updateAvailable).toBe(false)
  })

  it('refresh=true 绕过缓存强制重查', async () => {
    putRuntime('0.1.7-rc.2')
    const count = { n: 0 }
    const fetchImpl = tagsFetch({ latest: '0.2.0-rc.2' }, count)
    await detectKernelUpdate({ env, fetchImpl })
    await detectKernelUpdate({ env, fetchImpl, refresh: true })
    expect(count.n).toBe(2)
  })

  it('检测失败 → error 有值、latest=null、updateAvailable=false（**不得**当成已是最新）', async () => {
    putRuntime('0.1.7-rc.2')
    const boom = (async () => { throw new Error('connect ECONNREFUSED') }) as unknown as typeof fetch
    const info = await detectKernelUpdate({ env, fetchImpl: boom })
    expect(info.error).toMatch(/ECONNREFUSED/)
    expect(info.latest).toBeNull()
    expect(info.updateAvailable).toBe(false)
    expect(info.local).toBe('0.1.7-rc.2') // 本机事实仍然给出
  })

  it('失败也进缓存（短 TTL）——TTL 内重试不再打网络，但仍报 error', async () => {
    const count = { n: 0 }
    const boom = (async () => { count.n += 1; throw new Error('boom') }) as unknown as typeof fetch
    await detectKernelUpdate({ env, fetchImpl: boom })
    const second = await detectKernelUpdate({ env, fetchImpl: boom })
    expect(count.n).toBe(1)
    expect(second.error).toMatch(/boom/)
    expect(second.cached).toBe(true)
  })

  it('registry 返回 5xx → 报错而非"没有新版本"', async () => {
    putRuntime('0.1.7-rc.2')
    const bad = (async () => ({ ok: false, status: 502, json: async () => ({}) })) as unknown as typeof fetch
    const info = await detectKernelUpdate({ env, fetchImpl: bad })
    expect(info.error).toMatch(/HTTP 502/)
    expect(info.latest).toBeNull()
  })

  it('registry 可达但没有 dist-tags → 报错（响应残缺不当成结论）', async () => {
    const empty = (async () => ({ ok: true, status: 200, json: async () => ({}) })) as unknown as typeof fetch
    const info = await detectKernelUpdate({ env, fetchImpl: empty })
    expect(info.error).toMatch(/dist-tags/)
  })

  it('缓存文件落在池旁且写入的是本次结果（可审计）', async () => {
    putRuntime('0.1.7-rc.2')
    await detectKernelUpdate({ env, fetchImpl: tagsFetch({ latest: '0.2.0-rc.2' }) })
    const file = join(pool, '.kernel-update-check.json')
    expect(existsSync(file)).toBe(true)
    const cached = JSON.parse(readFileSync(file, 'utf8')) as { latest: string; updateAvailable: boolean }
    expect(cached.latest).toBe('0.2.0-rc.2')
    expect(cached.updateAvailable).toBe(true)
    expect(readCache(env)?.latest).toBe('0.2.0-rc.2')
  })

  it('检测是只读动作：池目录不存在时不创建池、不落缓存', async () => {
    const absent = join(pool, 'no-pool-here')
    const info = await detectKernelUpdate({ env: { ...env, DSH_RUNTIMES: absent }, fetchImpl: tagsFetch({ latest: '0.2.0-rc.2' }) })
    expect(info.latest).toBe('0.2.0-rc.2') // 结论照给
    expect(existsSync(absent)).toBe(false) // 但不凭空造池
  })

  it('检测的包名是官方内核包（版本轴唯一）', () => {
    expect(KERNEL_PACKAGE).toBe('@deepseek-ai/dsh')
  })
})
