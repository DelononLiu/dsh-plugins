/**
 * Tests for session-status.ts pure functions.
 * Covers status resolution, pending kind normalization, and subagent counting.
 */

import { describe, expect, it } from 'vitest'

import {
  type PendingInteractionKind,
  normalizePendingKind,
  type SummaryRow,
  type RowStatusView,
  resolveRowStatus,
  indexRunningSubagents,
} from '../src/client/session-status'

describe('normalizePendingKind', () => {
  it('returns same value for valid kinds', () => {
    expect(normalizePendingKind('approval')).toBe('approval')
    expect(normalizePendingKind('plan-review')).toBe('plan-review')
    expect(normalizePendingKind('question')).toBe('question')
  })

  it('returns undefined for invalid kinds', () => {
    expect(normalizePendingKind(undefined)).toBeUndefined()
    expect(normalizePendingKind(null)).toBeUndefined()
    expect(normalizePendingKind('')).toBeUndefined()
    expect(normalizePendingKind('invalid')).toBeUndefined()
    expect(normalizePendingKind(123)).toBeUndefined()
  })
})

describe('resolveRowStatus', () => {
  const testCases: {
    name: string
    input: Parameters<typeof resolveRowStatus>[0]
    expected: RowStatusView
  }[] = [
    {
      name: 'pending approval',
      input: { pendingKind: 'approval', running: false, runningSubagentCount: 0, completed: false },
      expected: { dot: 'warning', label: '等待审批' },
    },
    {
      name: 'pending plan-review',
      input: { pendingKind: 'plan-review', running: false, runningSubagentCount: 0, completed: false },
      expected: { dot: 'warning', label: '等待 plan 评审' },
    },
    {
      name: 'pending question',
      input: { pendingKind: 'question', running: false, runningSubagentCount: 0, completed: false },
      expected: { dot: 'warning', label: '等待你回复' },
    },
    {
      name: 'running session',
      input: { pendingKind: undefined, running: true, runningSubagentCount: 0, completed: false },
      expected: { dot: 'ongoing', label: '运行中' },
    },
    {
      name: 'subagent running only (1)',
      input: { pendingKind: undefined, running: false, runningSubagentCount: 1, completed: false },
      expected: { dot: 'ongoing', label: '1 个子代理运行' },
    },
    {
      name: 'subagent running only (2)',
      input: { pendingKind: undefined, running: false, runningSubagentCount: 2, completed: false },
      expected: { dot: 'ongoing', label: '2 个子代理运行' },
    },
    {
      name: 'completed session',
      input: { pendingKind: undefined, running: false, runningSubagentCount: 0, completed: true },
      expected: { dot: 'done', label: '已完成' },
    },
    {
      name: 'idle session (default)',
      input: { pendingKind: undefined, running: false, runningSubagentCount: 0, completed: false },
      expected: { dot: undefined, label: '空闲' },
    },
    {
      name: 'pending overrides running',
      input: { pendingKind: 'approval', running: true, runningSubagentCount: 0, completed: false },
      expected: { dot: 'warning', label: '等待审批' },
    },
    {
      name: 'pending overrides completed',
      input: { pendingKind: 'question', running: false, runningSubagentCount: 0, completed: true },
      expected: { dot: 'warning', label: '等待你回复' },
    },
  ]

  for (const tc of testCases) {
    it(tc.name, () => {
      expect(resolveRowStatus(tc.input)).toEqual(tc.expected)
    })
  }
})

describe('indexRunningSubagents', () => {
  it('returns empty map for no subagents', () => {
    const rows: Array<{ id: string; parentId?: string; origin?: string; running?: boolean }> = [
      { id: 'a', origin: 'subagent', running: false },
      { id: 'b', origin: 'subagent', running: true },
    ]
    expect(indexRunningSubagents(rows)).toEqual(new Map())
  })

  it('counts running subagents per parent', () => {
    const rows: Array<{ id: string; parentId?: string; origin?: string; running?: boolean }> = [
      { id: 'sub1', parentId: 'parent1', origin: 'subagent', running: true },
      { id: 'sub2', parentId: 'parent1', origin: 'subagent', running: false },
      { id: 'sub3', parentId: 'parent2', origin: 'subagent', running: true },
      { id: 'parent1', origin: undefined, running: false },
      { id: 'parent2', origin: undefined, running: true },
    ]
    const result = indexRunningSubagents(rows)
    expect(result).toEqual(new Map([
      ['parent1', 1],
      ['parent2', 1],
    ]))
  })

  it('handles multiple generations', () => {
    const rows: Array<{ id: string; parentId?: string; origin?: string; running?: boolean }> = [
      { id: 'leaf1', parentId: 'child1', origin: 'subagent', running: true },
      { id: 'child1', parentId: 'parent', origin: 'subagent', running: true },
      { id: 'parent', parentId: undefined, origin: undefined, running: false },
    ]
    const result = indexRunningSubagents(rows)
    expect(result).toEqual(new Map([
      ['child1', 1],
      ['parent', 2],
    ]))
  })

  it('ignores non-subagent origins', () => {
    const rows: Array<{ id: string; parentId?: string; origin?: string; running?: boolean }> = [
      { id: 'a', parentId: 'parent', origin: 'something', running: true },
      { id: 'parent', origin: undefined, running: false },
    ]
    expect(indexRunningSubagents(rows)).toEqual(new Map())
  })

  it('handles missing parent in byId map', () => {
    const rows: Array<{ id: string; parentId?: string; origin?: string; running?: boolean }> = [
      { id: 'leaf', parentId: 'missing', origin: 'subagent', running: true },
    ]
    const result = indexRunningSubagents(rows)
    expect(result).toEqual(new Map([['missing', 1]]))
  })
})