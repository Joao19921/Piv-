/**
 * Cria gatilhos de reavaliação (`benchmark_jobs`, source='manual') para a base aberta a cada
 * ~10 dias -- NUNCA acessa Robert Half nem nenhuma fonte de terceiro. Só compara datas dentro
 * do próprio Postgres: se um `benchmark_profiles` ativo não tem uma observação manual recente
 * (ou nunca teve nenhuma), fica pendente um lembrete pro admin reabrir a página da fonte e
 * decidir se atualiza o valor.
 *
 * Por que não automatizar a coleta em si: o ToS da Robert Half
 * (roberthalf.com/br/pt/termos-de-uso, cláusula 5g) proíbe explicitamente "robôs ou sistemas
 * de varredura" para acessar dados do site -- ver docs/BENCHMARK-WORKER-MANUAL.md, seção
 * 3.1/3.2. Continua sendo um humano quem lê a página e registra o número; este script só avisa
 * QUANDO isso precisa acontecer de novo.
 *
 * Idempotente: não cria um segundo gatilho pendente para o mesmo perfil (checa
 * `benchmark_jobs` existente antes de inserir).
 *
 * Uso:
 *   pnpm run benchmark:refresh-open-source-triggers               grava
 *   pnpm run benchmark:refresh-open-source-triggers -- --dry-run  só lista
 */
import "dotenv/config";
import { closePool, isDatabaseConfigured, query } from "../src/infrastructure/db/client";
import { logger } from "../src/infrastructure/observability/logger";

const STALE_AFTER_DAYS = 10;

interface ActiveProfileRow {
  id: number;
  role_title: string;
  seniority: string | null;
  state: string | null;
}

interface StaleCheckRow {
  id: number;
  needs_trigger: boolean;
}

async function main(): Promise<void> {
  const dryRun = process.argv.slice(2).includes("--dry-run");
  if (!isDatabaseConfigured) {
    throw new Error("DATABASE_URL não configurado. Defina a variável antes de rodar (não há modo --dry-run sem banco: precisamos ler benchmark_profiles/benchmark_jobs).");
  }

  const profiles = await query<ActiveProfileRow>(
    "benchmark_worker.refresh_triggers.active_profiles",
    "select id, role_title, seniority, state from benchmark_profiles where active",
  );

  // Um perfil precisa de gatilho quando (a) não há benchmark_results 'manual' recente pra ele
  // (nenhum, ou o mais recente já passou de STALE_AFTER_DAYS dias) e (b) ainda não existe um
  // benchmark_jobs pendente pra esse perfil+fonte -- não duplica lembrete a cada execução.
  const staleRows = await query<StaleCheckRow>(
    "benchmark_worker.refresh_triggers.stale_profiles",
    `select p.id,
            (
              not exists (
                select 1 from benchmark_results br
                 where br.source = 'manual'
                   and br.role_title = p.role_title
                   and br.seniority is not distinct from p.seniority
                   and br.state is not distinct from p.state
                   and br.collected_at > now() - make_interval(days => $1)
              )
              and not exists (
                select 1 from benchmark_jobs j
                 where j.profile_id = p.id and j.source = 'manual' and j.status = 'pending'
              )
            ) as needs_trigger
       from benchmark_profiles p
      where p.active`,
    [STALE_AFTER_DAYS],
  );

  const idsThatNeedTrigger = new Set(staleRows.filter((row) => row.needs_trigger).map((row) => row.id));
  const targets = profiles.filter((profile) => idsThatNeedTrigger.has(profile.id));

  console.log(`\nPerfis ativos: ${profiles.length}`);
  console.log(`Gatilhos novos a criar: ${targets.length}`);
  targets.slice(0, 10).forEach((profile) => console.log(`  ${profile.role_title} / ${profile.seniority ?? "-"} / ${profile.state ?? "BR"}`));
  if (targets.length > 10) console.log(`  ... e mais ${targets.length - 10}`);

  if (dryRun) {
    console.log("\n--dry-run: nada gravado.");
    return;
  }

  if (targets.length) {
    await query(
      "benchmark_worker.refresh_triggers.insert_jobs",
      `insert into benchmark_jobs (profile_id, source, status)
       select id, 'manual', 'pending' from benchmark_profiles where id = any($1::bigint[])`,
      [targets.map((profile) => profile.id)],
    );
  }

  console.log(`\n${targets.length} gatilho(s) de reavaliação criado(s).`);
}

main()
  .catch((err) => {
    logger.error("Criação de gatilhos da base aberta falhou", { error: err instanceof Error ? err.message : String(err) });
    process.exitCode = 1;
  })
  .finally(async () => {
    if (isDatabaseConfigured) await closePool();
  });
