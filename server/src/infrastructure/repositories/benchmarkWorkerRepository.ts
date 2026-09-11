/**
 * Acesso somente-leitura + registro manual sobre o schema aditivo do benchmark worker
 * (migration 0011: benchmark_sources/profiles/jobs/runs/results). O worker Python
 * (benchmark-worker/) continua sendo quem roda a coleta agendada -- esta tela do admin
 * so lê o estado dela e permite registrar uma observação manual (docs/
 * BENCHMARK-WORKER-MANUAL.md, seção 3.2), equivalente ao `manual_entry.py` do worker,
 * mas acionável pela UI sem precisar de Python local.
 */
import { query, withTransaction } from "../db/client";

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

export interface ManualObservationInput {
  roleTitle: string;
  seniority: string | null;
  state: string | null;
  regime: "clt" | "pj" | "unknown";
  salaryMin: number;
  salaryMax: number;
  currency: "brl" | "usd";
  periodicity: "monthly" | "annual";
  observedAt: string;
  sourceReference: string;
}

/**
 * Grava uma observação manual: uma linha em `benchmark_runs` (status=success,
 * triggered_by=manual) e uma em `benchmark_results` (source=manual), na mesma transação
 * -- mesmo desenho do `PostgresRepository.save_run_summary` do worker Python, para que
 * `benchmark_runs` nunca tenha uma execução sem os resultados que a originaram.
 *
 * Confidence fixa em 1.0: diferente do CLI do worker (que tenta interpretar texto livre
 * e reduz a confiança no que não reconhece), aqui os campos já chegam estruturados —
 * quem preenche o formulário já escolheu explicitamente cada valor.
 */
export async function insertManualObservation(input: ManualObservationInput): Promise<{ runId: number }> {
  const now = new Date().toISOString();
  const sourceSummary = JSON.stringify([{ source: "manual", status: "success", observations: 1, error_summary: null }]);

  return withTransaction(async (txQuery) => {
    const [runRow] = await txQuery<{ id: number }>(
      "benchmark_worker.insert_manual_run",
      `insert into benchmark_runs (status, triggered_by, source_summary, started_at, finished_at)
       values ('success', 'manual', $1, $2, $2)
       returning id`,
      [sourceSummary, now],
    );

    await txQuery(
      "benchmark_worker.insert_manual_result",
      `insert into benchmark_results
         (run_id, source, source_reference, role_title, seniority, state, regime,
          salary_min, salary_max, currency, periodicity, observed_at, confidence, collected_at)
       values ($1, 'manual', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 1.0, $12)
       on conflict (source, source_reference, observed_at) do update set
         role_title = excluded.role_title,
         seniority = excluded.seniority,
         state = excluded.state,
         regime = excluded.regime,
         salary_min = excluded.salary_min,
         salary_max = excluded.salary_max,
         currency = excluded.currency,
         periodicity = excluded.periodicity,
         confidence = excluded.confidence,
         collected_at = excluded.collected_at`,
      [
        runRow.id,
        input.sourceReference,
        input.roleTitle,
        input.seniority,
        input.state,
        input.regime,
        input.salaryMin,
        input.salaryMax,
        input.currency,
        input.periodicity,
        input.observedAt,
        now,
      ],
    );

    return { runId: runRow.id };
  });
}
