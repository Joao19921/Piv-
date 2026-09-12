/**
 * Acesso somente-leitura ao schema do benchmark worker (migration 0011:
 * benchmark_sources/profiles/jobs/runs/results). O worker Python (benchmark-worker/) continua
 * sendo quem roda a coleta agendada -- esta tela do admin so le o estado dela.
 *
 * Ate 2026-09-12 esta tela tambem permitia registrar uma observacao manual da base aberta
 * (guias publicos de terceiros, ex. Robert Half). Removido: o produto decidiu nao sustentar
 * esse fluxo manual na UI. As tabelas `benchmark_open_sources` e as colunas de
 * `benchmark_results` ligadas a isso continuam no banco (dado historico preservado), so nao
 * sao mais lidas/escritas por este repositorio.
 */
import { query } from "../db/client";

export interface BenchmarkSourceRow {
  name: string;
  status: "enabled" | "disabled";
  disabled_reason: string | null;
  updated_at: string;
}

export interface BenchmarkRunRow {
  id: number;
  status: "success" | "partial" | "failed";
  triggered_by: "manual" | "scheduled";
  source_summary: Array<{ source: string; status: string; observations: number; error_summary: string | null }>;
  started_at: string;
  finished_at: string;
}

export async function listBenchmarkSources(): Promise<BenchmarkSourceRow[]> {
  return query<BenchmarkSourceRow>(
    "benchmark_worker.list_sources",
    "select name, status, disabled_reason, updated_at from benchmark_sources order by name",
  );
}

export async function listRecentBenchmarkRuns(limit: number): Promise<BenchmarkRunRow[]> {
  return query<BenchmarkRunRow>(
    "benchmark_worker.list_runs",
    "select id, status, triggered_by, source_summary, started_at, finished_at from benchmark_runs order by finished_at desc limit $1",
    [limit],
  );
}
