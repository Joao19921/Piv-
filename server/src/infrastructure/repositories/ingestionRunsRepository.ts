import { query } from "../db/client";

export type IngestionStatus = "OPERATIONAL" | "DEGRADED" | "FALLBACK_STALE" | "OFFLINE";

export interface IngestionRunInput {
  serviceName: string;
  status: IngestionStatus;
  recordsUpserted: number;
  durationMs: number;
  errorMessage?: string;
  startedAt: Date;
}

export interface IngestionRun {
  serviceName: string;
  status: IngestionStatus;
  recordsUpserted: number;
  durationMs: number;
  errorMessage: string | null;
  startedAt: string;
  finishedAt: string;
}

interface IngestionRunRow {
  service_name: string;
  status: IngestionStatus;
  records_upserted: number;
  duration_ms: number;
  error_message: string | null;
  started_at: string;
  finished_at: string;
}

function toIngestionRun(row: IngestionRunRow): IngestionRun {
  return {
    serviceName: row.service_name,
    status: row.status,
    recordsUpserted: row.records_upserted,
    durationMs: row.duration_ms,
    errorMessage: row.error_message,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  };
}

export async function recordIngestionRun(input: IngestionRunInput): Promise<void> {
  await query(
    "ingestion_runs.insert",
    `insert into ingestion_runs (service_name, status, records_upserted, duration_ms, error_message, started_at)
     values ($1, $2, $3, $4, $5, $6)`,
    [input.serviceName, input.status, input.recordsUpserted, input.durationMs, input.errorMessage ?? null, input.startedAt.toISOString()],
  );
}

/** Ultima execucao registrada por servico (uma linha por service_name), para o painel de observabilidade. */
export async function getLatestIngestionRuns(): Promise<Record<string, IngestionRun>> {
  const rows = await query<IngestionRunRow>(
    "ingestion_runs.latest_by_service",
    `select distinct on (service_name) service_name, status, records_upserted, duration_ms, error_message, started_at, finished_at
     from ingestion_runs
     order by service_name, finished_at desc`,
  );
  const result: Record<string, IngestionRun> = {};
  for (const row of rows) {
    result[row.service_name] = toIngestionRun(row);
  }
  return result;
}
