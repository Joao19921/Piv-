export interface QueryStat {
  count: number;
  errorCount: number;
  totalMs: number;
  maxMs: number;
  lastRanAt: string;
  lastError?: string;
}

const stats = new Map<string, QueryStat>();

/** Observabilidade leve de consultas ao banco: contadores em memoria por nome de query, desde o start do processo. */
export function recordQuery(name: string, durationMs: number, error?: unknown): void {
  const current = stats.get(name) ?? { count: 0, errorCount: 0, totalMs: 0, maxMs: 0, lastRanAt: "" };
  current.count += 1;
  current.totalMs += durationMs;
  current.maxMs = Math.max(current.maxMs, durationMs);
  current.lastRanAt = new Date().toISOString();
  if (error) {
    current.errorCount += 1;
    current.lastError = error instanceof Error ? error.message : String(error);
  }
  stats.set(name, current);
}

export interface QueryStatsSummary extends QueryStat {
  name: string;
  avgMs: number;
}

export function getQueryStats(): QueryStatsSummary[] {
  return Array.from(stats.entries())
    .map(([name, stat]) => ({ ...stat, name, avgMs: stat.count ? Math.round(stat.totalMs / stat.count) : 0 }))
    .sort((a, b) => b.count - a.count);
}
