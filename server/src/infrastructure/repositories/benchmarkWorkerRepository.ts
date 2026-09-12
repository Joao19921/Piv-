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

export interface BenchmarkOpenSourceRow {
  name: string;
  label: string;
  url: string;
  updated_at: string;
}

/** Catalogo das fontes abertas aprovadas (migration 0014) -- unica fonte de verdade para o
 * dropdown "Fonte" do registro manual. Nunca aceitar URL digitada livremente no lugar disso. */
export async function listOpenSources(): Promise<BenchmarkOpenSourceRow[]> {
  return query<BenchmarkOpenSourceRow>(
    "benchmark_worker.list_open_sources",
    "select name, label, url, updated_at from benchmark_open_sources order by label",
  );
}

export async function getOpenSourceByName(name: string): Promise<BenchmarkOpenSourceRow | undefined> {
  const [row] = await query<BenchmarkOpenSourceRow>(
    "benchmark_worker.get_open_source",
    "select name, label, url, updated_at from benchmark_open_sources where name = $1",
    [name],
  );
  return row;
}

export interface OpenBenchmarkResultRow {
  id: number;
  role_title: string;
  seniority: string | null;
  state: string | null;
  regime: "clt" | "pj" | "unknown";
  salary_min: string;
  salary_max: string;
  currency: "brl" | "usd" | "unknown";
  periodicity: "monthly" | "annual" | "unknown";
  observed_at: string;
  collected_at: string;
  open_source: string | null;
  open_source_label: string | null;
  open_source_url: string | null;
}

/** Observacoes da base aberta (source='manual') cujo cargo bate com `roleQuery` (substring,
 * sem diferenciar caixa/acento fica a cargo do chamador normalizar antes). */
export async function searchOpenBenchmarkResults(roleQuery: string, state: string | null): Promise<OpenBenchmarkResultRow[]> {
  return query<OpenBenchmarkResultRow>(
    "benchmark_worker.search_open_results",
    `select br.id, br.role_title, br.seniority, br.state, br.regime, br.salary_min, br.salary_max,
            br.currency, br.periodicity, br.observed_at::text, br.collected_at::text,
            br.open_source, os.label as open_source_label, os.url as open_source_url
       from benchmark_results br
       left join benchmark_open_sources os on os.name = br.open_source
      where br.source = 'manual'
        and br.role_title ilike $1
        and ($2::text is null or br.state is null or br.state = $2)
      order by br.observed_at desc`,
    [`%${roleQuery}%`, state],
  );
}

export interface OpenSourceTriggerRow {
  job_id: number;
  profile_id: number;
  role_title: string;
  seniority: string | null;
  state: string | null;
  requested_at: string;
}

/** Gatilhos pendentes de reavaliacao da base aberta (ver server/scripts/refreshOpenBenchmarkTriggers.ts
 * -- nunca criado por scraping, so por um cron que compara datas dentro do proprio Postgres). */
export async function listOpenSourceTriggers(): Promise<OpenSourceTriggerRow[]> {
  return query<OpenSourceTriggerRow>(
    "benchmark_worker.list_open_source_triggers",
    `select j.id as job_id, j.profile_id, p.role_title, p.seniority, p.state, j.requested_at::text
       from benchmark_jobs j
       join benchmark_profiles p on p.id = j.profile_id
      where j.source = 'manual' and j.status = 'pending'
      order by j.requested_at asc`,
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
  openSource: string;
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
         (run_id, source, source_reference, open_source, role_title, seniority, state, regime,
          salary_min, salary_max, currency, periodicity, observed_at, confidence, collected_at)
       values ($1, 'manual', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 1.0, $13)
       on conflict (source, source_reference, observed_at) do update set
         open_source = excluded.open_source,
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
        input.openSource,
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

    // Fecha o gatilho de reavaliacao (se houver) para o mesmo cargo+senioridade+UF: alguem
    // acabou de reavaliar de verdade, entao a pendencia deixa de fazer sentido. `is not
    // distinct from` trata null=null como igual (perfil nacional / sem senioridade informada).
    await txQuery(
      "benchmark_worker.close_open_source_trigger",
      `update benchmark_jobs set status = 'done', finished_at = $1
         where source = 'manual' and status = 'pending'
           and profile_id in (
             select id from benchmark_profiles
              where role_title = $2
                and seniority is not distinct from $3
                and state is not distinct from $4
           )`,
      [now, input.roleTitle, input.seniority, input.state],
    );

    return { runId: runRow.id };
  });
}
