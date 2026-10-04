/**
 * 实例自报内核版本解析（`src/kernel-version.ts`）：三条进程内路径各自命中，
 * 全失败留空（不编造）。
 */

import { describe, expect, it } from 'vitest'
import { npmPrefixFromPath, resolveKernelVersion } from '../src/kernel-version.ts'

const PKG = JSON.stringify({ name: '@deepseek-ai/dsh', version: '0.1.7-rc.2' })

describe('resolveKernelVersion（进程内自报）', () => {
  it('路径 1：模块解析 @deepseek-ai/dsh/package.json 命中', () => {
    const resolved = '/any/node_modules/@deepseek-ai/dsh/package.json'
    const version = resolveKernelVersion({
      resolveModule: (id) => (id === '@deepseek-ai/dsh/package.json' ? resolved : undefined),
      readText: (path) => (path === resolved ? PKG : undefined),
      argv: [],
      execPath: '',
    })
    expect(version).toBe('0.1.7-rc.2')
  })

  it('路径 2：argv[1] 入口（<prefix>/bin/dsh）推 npm 前缀命中', () => {
    const prefix = '/opt/node-v24'
    const pkg = `${prefix}/lib/node_modules/@deepseek-ai/dsh/package.json`
    const version = resolveKernelVersion({
      resolveModule: () => undefined,
      argv: ['node', `${prefix}/bin/dsh`],
      execPath: '',
      exists: (path) => path === pkg,
      readText: (path) => (path === pkg ? PKG : undefined),
    })
    expect(version).toBe('0.1.7-rc.2')
  })

  it('路径 2：argv[1] 是 pnpm .bin 软链 → 解析软链后推前缀命中', () => {
    const prefix = '/opt/cli'
    const pkg = `${prefix}/node_modules/@deepseek-ai/dsh/package.json`
    const link = `${prefix}/node_modules/.bin/dsh`
    const real = `${prefix}/node_modules/@deepseek-ai/dsh/lib/bin.js`
    const version = resolveKernelVersion({
      resolveModule: () => undefined,
      argv: ['node', link],
      execPath: '',
      realpath: (path) => (path === link ? real : undefined),
      exists: (path) => path === pkg,
      readText: (path) => (path === pkg ? PKG : undefined),
    })
    expect(version).toBe('0.1.7-rc.2')
  })

  it('路径 3：execPath（<prefix>/bin/node）推 npm 前缀命中', () => {
    const prefix = '/opt/node-v24'
    const pkg = `${prefix}/lib/node_modules/@deepseek-ai/dsh/package.json`
    const version = resolveKernelVersion({
      resolveModule: () => undefined,
      argv: [],
      execPath: `${prefix}/bin/node`,
      exists: (path) => path === pkg,
      readText: (path) => (path === pkg ? PKG : undefined),
    })
    expect(version).toBe('0.1.7-rc.2')
  })

  it('三条路径全失败 → 留空（不编造）', () => {
    const version = resolveKernelVersion({
      resolveModule: () => undefined,
      argv: [],
      execPath: '',
      exists: () => false,
      readText: () => undefined,
    })
    expect(version).toBeUndefined()
  })

  it('模块解析命中但 package.json 无 version → 继续回落前缀（不静默返回空串）', () => {
    const prefix = '/opt/node-v24'
    const pkg = `${prefix}/lib/node_modules/@deepseek-ai/dsh/package.json`
    const version = resolveKernelVersion({
      resolveModule: () => '/somewhere/package.json',
      argv: ['node', `${prefix}/bin/dsh`],
      execPath: '',
      exists: (path) => path === pkg,
      readText: (path) => (path === pkg ? PKG : '{}'),
    })
    expect(version).toBe('0.1.7-rc.2')
  })
})

describe('npmPrefixFromPath（前缀推导）', () => {
  it('<prefix>/bin/dsh → prefix', () => {
    expect(npmPrefixFromPath('/opt/node/bin/dsh')).toBe('/opt/node')
  })

  it('解析后的包内路径 → prefix；pnpm .bin 软链不认', () => {
    expect(npmPrefixFromPath('/opt/node/lib/node_modules/@deepseek-ai/dsh/lib/bin.js')).toBe('/opt/node')
    expect(npmPrefixFromPath('/repo/node_modules/@deepseek-ai/dsh/lib/bin.js')).toBe('/repo')
    expect(npmPrefixFromPath('/repo/node_modules/.bin/dsh')).toBeUndefined()
  })

  it('空/无关路径 → undefined（不猜）', () => {
    expect(npmPrefixFromPath('')).toBeUndefined()
    expect(npmPrefixFromPath(undefined)).toBeUndefined()
    expect(npmPrefixFromPath('/usr/local/lib/foo.js')).toBeUndefined()
  })
})
