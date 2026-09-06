/**
 * dsh-console logs 查看器纯逻辑（src/client/logView.ts）单元测试。
 * 纯函数、无 React/DOM，node 环境直接跑。
 */

import { describe, expect, it } from 'vitest'
import {
  filterRecords,
  formatRowTime,
  levelToSeverity,
  matchesQuery,
  passesLevelFilter,
  recordsToText,
  rowCaption,
  splitByQuery,
} from '../src/client/logView.ts'
import type { LogRecord } from 'dsh-console/types'

describe('logView pure module', () => {
  const baseRecord: LogRecord = {
    ts: '2024-01-01T12:34:56.789Z',
    role: 'daemon',
    level: 'info',
    scope: 'test',
    msg: 'hello world',
  }

  describe('levelToSeverity', () => {
    it('maps debug/info/warn/error to 0..3', () => {
      expect(levelToSeverity('debug')).toBe(0)
      expect(levelToSeverity('info')).toBe(1)
      expect(levelToSeverity('warn')).toBe(2)
      expect(levelToSeverity('error')).toBe(3)
    })
    it('maps null (legacy) to info severity 1', () => {
      expect(levelToSeverity(null)).toBe(1)
    })
  })

  describe('passesLevelFilter', () => {
    const mk = (level: LogRecord['level']): LogRecord => ({ ...baseRecord, level })
    const debugR = mk('debug')
    const infoR = mk('info')
    const warnR = mk('warn')
    const errorR = mk('error')
    const nullR = mk(null)

    it('minLevel all passes all levels', () => {
      for (const r of [debugR, infoR, warnR, errorR, nullR]) expect(passesLevelFilter(r, 'all')).toBe(true)
    })
    it('minLevel debug passes debug and above', () => {
      for (const r of [debugR, infoR, warnR, errorR, nullR]) expect(passesLevelFilter(r, 'debug')).toBe(true)
    })
    it('minLevel info passes info and above (hides debug)', () => {
      expect(passesLevelFilter(debugR, 'info')).toBe(false)
      for (const r of [infoR, warnR, errorR, nullR]) expect(passesLevelFilter(r, 'info')).toBe(true)
    })
    it('minLevel warn passes warn and above (hides debug/info/legacy)', () => {
      for (const r of [debugR, infoR, nullR]) expect(passesLevelFilter(r, 'warn')).toBe(false)
      for (const r of [warnR, errorR]) expect(passesLevelFilter(r, 'warn')).toBe(true)
    })
    it('minLevel error passes only error', () => {
      for (const r of [debugR, infoR, warnR, nullR]) expect(passesLevelFilter(r, 'error')).toBe(false)
      expect(passesLevelFilter(errorR, 'error')).toBe(true)
    })
    it('minLevel null behaves as info threshold (legacy 同 info 展示)', () => {
      expect(passesLevelFilter(debugR, null)).toBe(false)
      for (const r of [infoR, warnR, errorR, nullR]) expect(passesLevelFilter(r, null)).toBe(true)
    })
  })

  describe('matchesQuery', () => {
    it('empty / whitespace query matches everything', () => {
      expect(matchesQuery('anything', '')).toBe(true)
      expect(matchesQuery('anything', '   ')).toBe(true)
    })
    it('case-insensitive substring', () => {
      expect(matchesQuery('Hello World', 'hello')).toBe(true)
      expect(matchesQuery('Hello World', 'WORLD')).toBe(true)
      expect(matchesQuery('Hello World', 'ell')).toBe(true)
      expect(matchesQuery('Hello World', 'xyz')).toBe(false)
    })
  })

  describe('splitByQuery', () => {
    it('empty / whitespace query returns single non-match segment', () => {
      expect(splitByQuery('hello', '')).toEqual([{ text: 'hello', match: false }])
      expect(splitByQuery('hello', '  ')).toEqual([{ text: 'hello', match: false }])
    })
    it('single match in the middle splits into non-match + match (无空尾)', () => {
      expect(splitByQuery('hello world', 'world')).toEqual([
        { text: 'hello ', match: false },
        { text: 'world', match: true },
      ])
    })
    it('match at start has no leading empty segment', () => {
      expect(splitByQuery('hello there', 'hello')).toEqual([
        { text: 'hello', match: true },
        { text: ' there', match: false },
      ])
    })
    it('match at end has no trailing empty segment', () => {
      expect(splitByQuery('there hello', 'hello')).toEqual([
        { text: 'there ', match: false },
        { text: 'hello', match: true },
      ])
    })
    it('adjacent overlapping-free repeated matches merge without empty fillers', () => {
      expect(splitByQuery('banana', 'na')).toEqual([
        { text: 'ba', match: false },
        { text: 'na', match: true },
        { text: 'na', match: true },
      ])
    })
    it('case-insensitive match preserves original casing', () => {
      expect(splitByQuery('Hello World', 'hello')).toEqual([
        { text: 'Hello', match: true },
        { text: ' World', match: false },
      ])
    })
  })

  describe('filterRecords', () => {
    const records: LogRecord[] = [
      { ...baseRecord, ts: '2024-01-01T12:00:00.000Z', level: 'debug', msg: 'debug msg', scope: 'test' },
      { ...baseRecord, ts: '2024-01-01T12:00:01.000Z', level: 'info', msg: 'info msg', scope: 'test' },
      { ...baseRecord, ts: '2024-01-01T12:00:02.000Z', level: 'warn', msg: 'warn msg', scope: 'test' },
      { ...baseRecord, ts: '2024-01-01T12:00:03.000Z', level: 'error', msg: 'error msg', scope: 'test' },
      { ...baseRecord, ts: '2024-01-01T12:00:04.000Z', level: null, msg: 'legacy msg', scope: 'test' },
      { ...baseRecord, ts: '2024-01-01T12:00:05.000Z', level: 'info', msg: 'another info', scope: 'other', instanceId: 'web3' },
    ]

    it('minLevel debug shows all 6', () => {
      const filtered = filterRecords(records, { minLevel: 'debug', query: '', errorsOnly: false })
      expect(filtered).toHaveLength(6)
    })
    it('minLevel info hides debug only (5)', () => {
      const filtered = filterRecords(records, { minLevel: 'info', query: '', errorsOnly: false })
      expect(filtered).toHaveLength(5)
      expect(filtered.map((r) => r.level)).not.toContain('debug')
    })
    it('minLevel warn shows warn+error (hides debug/info/legacy)', () => {
      const filtered = filterRecords(records, { minLevel: 'warn', query: '', errorsOnly: false })
      expect(filtered.map((r) => r.level)).toEqual(['warn', 'error'])
    })
    it('minLevel error shows only error', () => {
      const filtered = filterRecords(records, { minLevel: 'error', query: '', errorsOnly: false })
      expect(filtered).toHaveLength(1)
      expect(filtered[0].level).toBe('error')
    })
    it('errorsOnly overrides minLevel to error', () => {
      const filtered = filterRecords(records, { minLevel: 'info', query: '', errorsOnly: true })
      expect(filtered).toHaveLength(1)
      expect(filtered[0].level).toBe('error')
    })
    it('query matches msg', () => {
      const filtered = filterRecords(records, { minLevel: 'all', query: 'info', errorsOnly: false })
      expect(filtered.map((r) => r.msg)).toEqual(['info msg', 'another info'])
    })
    it('query matches instanceId', () => {
      const filtered = filterRecords(records, { minLevel: 'all', query: 'web3', errorsOnly: false })
      expect(filtered).toHaveLength(1)
      expect(filtered[0].msg).toBe('another info')
    })
    it('query matches scope', () => {
      const filtered = filterRecords(records, { minLevel: 'all', query: 'other', errorsOnly: false })
      expect(filtered).toHaveLength(1)
      expect(filtered[0].scope).toBe('other')
    })
    it('query is case-insensitive', () => {
      const filtered = filterRecords(records, { minLevel: 'all', query: 'INFO', errorsOnly: false })
      expect(filtered).toHaveLength(2)
    })
    it('combines level and query filters', () => {
      const filtered = filterRecords(records, { minLevel: 'warn', query: 'msg', errorsOnly: false })
      expect(filtered.map((r) => r.level)).toEqual(['warn', 'error'])
    })
    it('empty array returns empty', () => {
      expect(filterRecords([], { minLevel: 'all', query: '', errorsOnly: false })).toEqual([])
    })
  })

  describe('formatRowTime', () => {
    it('formats ISO (UTC) time to HH:MM:SS.mmm', () => {
      expect(formatRowTime('2024-01-01T12:34:56.789Z')).toBe('12:34:56.789')
      expect(formatRowTime('2024-01-01T00:00:00.000Z')).toBe('00:00:00.000')
      expect(formatRowTime('2024-01-01T23:59:59.999Z')).toBe('23:59:59.999')
    })
    it('falls back to original string on invalid input', () => {
      expect(formatRowTime('not-a-date')).toBe('not-a-date')
      expect(formatRowTime('')).toBe('')
    })
  })

  describe('rowCaption', () => {
    const rec = (partial: Partial<LogRecord>): LogRecord => ({ ...baseRecord, ...partial })
    it('daemon without instanceId', () => {
      expect(rowCaption(rec({ role: 'daemon', scope: 'network' }))).toBe('daemon · network')
    })
    it('instance with instanceId', () => {
      expect(rowCaption(rec({ role: 'instance', scope: 'api', instanceId: 'web3' }))).toBe('instance/web3 · api')
    })
    it('console without instanceId', () => {
      expect(rowCaption(rec({ role: 'console', scope: 'upgrade' }))).toBe('console · upgrade')
    })
  })

  describe('recordsToText', () => {
    it('one plain-text line per record', () => {
      const records: LogRecord[] = [
        { ts: '2024-01-01T12:00:00.000Z', role: 'daemon', level: 'info', scope: 'test', msg: 'hello' },
        { ts: '2024-01-01T12:00:01.000Z', role: 'instance', level: 'error', scope: 'api', msg: 'error occurred', instanceId: 'web3' },
      ]
      const text = recordsToText(records)
      expect(text).toContain('[12:00:00.000] [info] daemon · test hello')
      expect(text).toContain('[12:00:01.000] [error] instance/web3 · api error occurred')
      expect(text.split('\n')).toHaveLength(2)
    })
    it('empty array returns empty string', () => {
      expect(recordsToText([])).toBe('')
    })
  })
})
