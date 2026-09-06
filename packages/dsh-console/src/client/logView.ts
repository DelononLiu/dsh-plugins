/**
 * Pure log-view logic for dsh-console logs tab.
 * All functions are pure, deterministic, and testable without React/DOM.
 */

import type { LogRecord, LogLevel } from 'dsh-console/types';

/**
 * Numeric severity levels for comparison.
 * higher number = higher severity
 */
const LEVEL_SEVERITY: Record<string, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  null: 1, // legacy records treated as info for display threshold
};

/**
 * Convert a level string to its numeric severity.
 * @param level - LogLevel | null
 * @returns numeric severity (0-3)
 */
export function levelToSeverity(level: LogLevel | null): number {
  if (level === null) return LEVEL_SEVERITY.null;
  return LEVEL_SEVERITY[level];
}

/**
 * Check if a record passes the minimum severity threshold.
 * @param record - LogRecord to check
 * @param minLevel - minimum severity level to show ('debug'|'info'|'warn'|'error'|'all'|null)
 * @returns true if record should be shown
 */
export function passesLevelFilter(
  record: LogRecord,
  minLevel: LogLevel | 'all' | null
): boolean {
  if (minLevel === 'all') return true;
  if (minLevel === null) return levelToSeverity(record.level) >= LEVEL_SEVERITY.null;
  return levelToSeverity(record.level) >= LEVEL_SEVERITY[minLevel];
}

/**
 * Filter log records by level, search query, and errors-only flag.
 * @param records - array of LogRecord
 * @param opts - filtering options:
 *   - minLevel: minimum severity threshold ('all'|LogLevel|null)
 *   - query: case-insensitive substring to match against msg+instanceId+scope
 *   - errorsOnly: boolean shortcut for minLevel='error' (overrides minLevel if true)
 * @returns filtered array of LogRecord
 */
export function filterRecords(
  records: LogRecord[],
  opts: {
    minLevel: LogLevel | 'all' | null;
    query: string;
    errorsOnly: boolean;
  }
): LogRecord[] {
  const { minLevel, query, errorsOnly } = opts;
  const effectiveMinLevel = errorsOnly ? 'error' : minLevel;
  const trimmedQuery = query.trim();

  return records.filter((record) => {
    // Level filter
    if (!passesLevelFilter(record, effectiveMinLevel)) return false;

    // Query filter (case-insensitive)
    if (trimmedQuery === '') return true;

    const lowerQuery = trimmedQuery.toLowerCase();
    const { msg, instanceId, scope } = record;
    const searchable = `${msg} ${instanceId ?? ''} ${scope}`.toLowerCase();
    return searchable.includes(lowerQuery);
  });
}

/**
 * Check if a text matches a query (case-insensitive substring).
 * @param text - text to search in
 * @param query - search query (trimmed, case-insensitive)
 * @returns true if text contains query
 */
export function matchesQuery(text: string, query: string): boolean {
  const trimmed = query.trim();
  if (trimmed === '') return true;
  const lowerQuery = trimmed.toLowerCase();
  return text.toLowerCase().includes(lowerQuery);
}

/**
 * Split text by query matches for highlighting.
 * Returns array of segments: { text: string; match: boolean }
 * @param text - text to split
 * @param query - search query (case-insensitive)
 * @returns array of segments
 */
export function splitByQuery(text: string, query: string): Array<{ text: string; match: boolean }> {
  const trimmed = query.trim();
  if (trimmed === '' || text === '') return [{ text, match: false }];

  const lowerText = text.toLowerCase();
  const lowerQuery = trimmed.toLowerCase();
  const segments: Array<{ text: string; match: boolean }> = [];
  let start = 0;

  while (true) {
    const matchPos = lowerText.indexOf(lowerQuery, start);
    if (matchPos === -1) {
      // 末尾剩余（非空才保留；避免尾部空片段）。
      const rest = text.slice(start)
      if (rest.length > 0) segments.push({ text: rest, match: false })
      break
    }
    // 命中前文本（非空才保留）。
    if (matchPos > start) segments.push({ text: text.slice(start, matchPos), match: false })
    // 命中片段保留原文大小写（search 用 lowerText 定位，展示用原 text 切片）。
    segments.push({ text: text.slice(matchPos, matchPos + trimmed.length), match: true })
    start = matchPos + trimmed.length
  }

  return segments;
}

/**
 * Format ISO timestamp to compact HH:MM:SS.mmm format.
 * @param ts - ISO timestamp string (e.g., "2024-01-01T12:34:56.789Z")
 * @returns formatted time string (e.g., "12:34:56.789")
 */
export function formatRowTime(ts: string): string {
  try {
    const date = new Date(ts);
    if (isNaN(date.getTime())) return ts; // fallback to original if invalid
    // 用 UTC 取时（记录 ts 为 ISO Z 时间；本地时区会让测试/展示不确定）。
    const hh = String(date.getUTCHours()).padStart(2, '0');
    const mm = String(date.getUTCMinutes()).padStart(2, '0');
    const ss = String(date.getUTCSeconds()).padStart(2, '0');
    const mmm = String(date.getUTCMilliseconds()).padStart(3, '0');
    return `${hh}:${mm}:${ss}.${mmm}`;
  } catch {
    return ts; // fallback
  }
}

/**
 * Generate caption for a log record: role/instance + scope.
 * @param record - LogRecord
 * @returns caption string (e.g., "daemon/console" or "instance/web3 · api")
 */
export function rowCaption(record: LogRecord): string {
  const rolePart = record.role;
  const instancePart = record.instanceId ? `/${record.instanceId}` : '';
  const roleInstance = `${rolePart}${instancePart}`;
  return `${roleInstance} · ${record.scope}`;
}

/**
 * Convert filtered records to plain text for copying (one record per line).
 * Format: [time] [level] [caption] msg
 * @param records - array of LogRecord (already filtered)
 * @returns plain text string
 */
export function recordsToText(records: LogRecord[]): string {
  return records
    .map((record) => {
      const time = formatRowTime(record.ts);
      const level = record.level ?? 'null';
      const caption = rowCaption(record);
      return `[${time}] [${level}] ${caption} ${record.msg}`;
    })
    .join('\n');
}