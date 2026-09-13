/**
 * 实例生命周期（删除归档 / 恢复）测试——R1 的验收判据。
 *
 * 覆盖：删除 = 目录归档（可恢复）+ 墓碑；两条硬守卫（正式 web / 本机 daemon）拒绝；
 * 归档区只保留最近 N 个；恢复把目录移回且拒绝覆盖现有目录；不存在的归档显式报错。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { archiveInstance, archiveKeep, archiveRoot, listArchives, pruneArchives, restoreInstance } from '../src/lifecycle.js'
import { findInstance, loadRegistry, saveRegistry, upsertInstance, type InstanceEntry } from '../src/registry.js'

let tmp: string
let registryFile: string

function seed(id: string, over: Partial<InstanceEntry> = {}): InstanceEntry {
  const home = over.home ?? join(tmp, `instance-${id}`)
  mkdirSync(join(home, 'profiles', 'dev'), { recursive: true })
  writeFileSync(join(home, 'profiles', 'dev', 'package.json'), '{"x":1}\n')
  const reg = loadRegistry()
  const entry = upsertInstance(reg, { id, host: 'master', home, profileDir: 'dev', layout: 'home', version: '0.1.2-rc.1', ...over })
  saveRegistry(reg)
  return entry
}

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'dsh-life-'))
  registryFile = join(tmp, '.dsh-home', 'registry.json')
  process.env.DSH_REGISTRY = registryFile
  process.env.DSH_HOST_ID = 'master'
  mkdirSync(join(tmp, '.dsh-home'), { recursive: true })
})

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true })
  delete process.env.DSH_REGISTRY
  delete process.env.DSH_HOST_ID
  delete process.env.DSH_ARCHIVE_KEEP
})

describe('删除 = 归档（可恢复）+ 墓碑', () => {
  it('目录进归档区、档案转墓碑并记录归档路径', () => {
    const entry = seed('instance-a')
    const r = archiveInstance(entry, { ts: 1000 })
    expect(r.ok).toBe(true)
    expect(existsSync(entry.home)).toBe(false)
    expect(r.archivedAt).toBe(join(archiveRoot(), 'instance-a-1000'))
    expect(existsSync(join(r.archivedAt!, 'profiles', 'dev', 'package.json'))).toBe(true)
    const tomb = findInstance(loadRegistry(), 'instance-a')!
    expect(tomb.status).toBe('deleted')
    expect(tomb.deletedAt).toBeTruthy()
    expect(tomb.archivePath).toBe(join(archiveRoot(), 'instance-a-1000'))
  })

  it('恢复：归档移回原 home、档案转回 active、归档条目清除', () => {
    const entry = seed('instance-a')
    archiveInstance(entry, { ts: 2000 })
    const r = restoreInstance('instance-a')
    expect(r.ok).toBe(true)
    expect(r.home).toBe(entry.home)
    expect(existsSync(join(entry.home, 'profiles', 'dev', 'package.json'))).toBe(true)
    const back = findInstance(loadRegistry(), 'instance-a')!
    expect(back.status).toBe('active')
    expect(back.deletedAt).toBe(null)
    expect(listArchives('instance-a')).toEqual([])
  })

  it('恢复拒绝覆盖已存在的目录（那可能是另一个活实例）', () => {
    const entry = seed('instance-a')
    archiveInstance(entry, { ts: 3000 })
    mkdirSync(entry.home, { recursive: true }) // 有人重建了同名目录
    const r = restoreInstance('instance-a')
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/已存在/)
  })

  it('非删除态 / 无归档 / 未知实例：显式报错，不静默', () => {
    const entry = seed('instance-b')
    expect(restoreInstance('instance-b').ok).toBe(false) // 还活着，不是墓碑
    archiveInstance(entry, { ts: 4000 })
    rmSync(archiveRoot(), { recursive: true, force: true }) // 归档被人删了
    const r = restoreInstance('instance-b')
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/没有归档/)
    expect(restoreInstance('nope').error).toMatch(/未知实例/)
  })
})

describe('删除守卫：默认实例不许删', () => {
  it('正式 web（3080）拒绝删除', () => {
    const entry = seed('web', { home: join(process.env.HOME ?? '', '.dsh'), role: 'console' })
    const r = archiveInstance(entry, { ts: 5000 })
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/3080|禁止删除/)
    expect(findInstance(loadRegistry(), 'web')!.status).toBe('active')
  })

  it('本机 daemon（执行面自身）拒绝删除', () => {
    const entry = seed('daemon', { role: 'daemon' })
    const r = archiveInstance(entry, { ts: 6000 })
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/daemon.*禁止删除|执行面/)
    expect(findInstance(loadRegistry(), 'daemon')!.status).toBe('active')
  })
})

describe('归档区裁剪：只保留最近 N 个', () => {
  it('保留份数可配，超出部分被删（按时间戳取新）', () => {
    process.env.DSH_ARCHIVE_KEEP = '2'
    expect(archiveKeep()).toBe(2)
    for (const ts of [100, 200, 300, 400]) {
      const entry = seed(`instance-${ts}`)
      archiveInstance(entry, { ts })
    }
    const left = readdirSync(archiveRoot()).sort()
    expect(left).toEqual(['instance-300-300', 'instance-400-400'])
  })

  it('无法解析的时间戳不崩溃（按 0 处理）', () => {
    mkdirSync(join(archiveRoot(), 'garbage'), { recursive: true })
    expect(() => pruneArchives(5)).not.toThrow()
  })
})
