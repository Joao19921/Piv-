/**
 * Registra os valores do Mapa de Pesquisa Salarial do SISP em `salary_observations`.
 *
 * Uso:
 *   pnpm run ingest:sisp              grava
 *   pnpm run ingest:sisp -- --dry-run so lista
 *
 * ## Por que isto existe
 *
 * 68 dos 73 perfis do catalogo ja vinham das Portarias SGD/MGI -- e sao **pesquisa salarial
 * oficial publicada pelo governo**, com cargo, senioridade e valor mensal. Mas estavam marcados
 * `sourceStatus: "FALLBACK_STALE"`, ou seja, o app tratava fonte oficial como se fosse chute, e
 * nao havia proveniencia navegavel: o texto citava a Portaria, sem link nem data separavel.
 *
 * Passando por `salary_observations`, o valor do SISP ganha o mesmo tratamento do CAGED --
 * `source`, `source_url`, `competencia` -- e a tela pode mostrar as duas fontes lado a lado:
 * o que o mercado paga (CAGED) e a referencia oficial (SISP). Para defender uma estimativa numa
 * contratacao publica, as duas juntas valem mais que qualquer uma isolada.
 *
 * ## Direcao da verdade
 *
 * O VALOR continua vindo de `catalogs.ts`, que e o que se edita quando sai Portaria nova. Este
 * script apenas materializa esses valores na tabela, com proveniencia. Nao e uma segunda fonte
 * de verdade -- e uma projecao da primeira, e por isso e idempotente (upsert por competencia).
 */
import "dotenv/config";
import { laborProfiles } from "../src/domain/services/catalogs";
import { closePool, isDatabaseConfigured } from "../src/infrastructure/db/client";
import { logger } from "../src/infrastructure/observability/logger";
import { recordIngestionRun } from "../src/infrastructure/repositories/ingestionRunsRepository";
import { upsertSalaryObservations, type SalaryObservationInput } from "../src/infrastructure/repositories/salaryObservationsRepository";

/**
 * Pagina oficial de cada Portaria. Aponta para o "documentos relacionados ao modelo" do
 * gov.br/governodigital, e nao para o PDF direto, porque o PDF muda de nome a cada republicacao
 * enquanto a pagina do modelo permanece -- e e nela que o proximo anexo vai aparecer.
 */
const FONTE_POR_PORTARIA: Array<{ padrao: RegExp; url: string }> = [
  {
    // Desenvolvimento, manutencao e sustentacao de software (altera a Portaria 750/2023).
    padrao: /4\.?777\/2026/,
    url: "https://www.gov.br/governodigital/pt-br/contratacoes-de-tic/legislacao/modelo-de-contratacao-de-servicos-de-desenvolvimento-manutencao-e-sustentacao-de-software/documentos-relacionados-ao-modelo",
  },
  {
    // Operacao de infraestrutura e atendimento a usuarios (altera a Portaria 1.070/2023).
    padrao: /6\.?055\/2025/,
    url: "https://www.gov.br/governodigital/pt-br/contratacoes-de-tic/legislacao/modelo-de-contracao-de-servicos-de-operacao-de-infraestrutura-e-de-atendimento-a-usuarios-de-tic",
  },
];

function urlDaFonte(benchmarkSource: string): string | null {
  return FONTE_POR_PORTARIA.find((f) => f.padrao.test(benchmarkSource))?.url ?? null;
}

/** A competencia do SISP e a data da Portaria, nao um mes de microdado. */
function competenciaDoPerfil(updatedAt: string): string {
  return updatedAt.slice(0, 10);
}

async function main(): Promise<void> {
  const dryRun = process.argv.slice(2).includes("--dry-run");
  const startedAt = new Date();

  const perfisSisp = laborProfiles.filter((p) => /Portaria SGD\/MGI/i.test(p.benchmarkSource));
  const semUrl = perfisSisp.filter((p) => !urlDaFonte(p.benchmarkSource));

  if (semUrl.length) {
    // Falha alta em vez de gravar com proveniencia inventada: `source_url` existe para o usuario
    // poder auditar a estimativa, e um link errado e pior que a ausencia do dado.
    throw new Error(
      `Sem URL oficial mapeada para ${semUrl.length} perfil(is). Portaria nova? ` +
        `Acrescente em FONTE_POR_PORTARIA. Exemplos: ${semUrl.slice(0, 3).map((p) => p.id).join(", ")}`,
    );
  }

  const observacoes: SalaryObservationInput[] = perfisSisp.map((p) => ({
    source: "SISP",
    sourceUrl: urlDaFonte(p.benchmarkSource) as string,
    // SISP nao usa CBO: identifica o cargo pelo perfil profissional da propria Portaria.
    cbo: null,
    roleSlug: p.id,
    seniority: p.seniority,
    employmentModel: p.employmentModel,
    // Referencia nacional: a Portaria nao faz recorte regional.
    uf: null,
    municipio: null,
    competencia: competenciaDoPerfil(p.updatedAt),
    // Fonte publicada: divulga o valor de referencia, nao a amostra que o gerou (migration 0010).
    nAmostra: null,
    p25: null,
    mediana: p.monthlyCompensation,
    p75: null,
    media: null,
  }));

  const porCompetencia = new Map<string, number>();
  for (const o of observacoes) porCompetencia.set(o.competencia, (porCompetencia.get(o.competencia) ?? 0) + 1);

  console.log(`\nPerfis SISP no catálogo: ${observacoes.length}`);
  for (const [comp, n] of [...porCompetencia].sort()) {
    console.log(`  competência ${comp}: ${n} perfil(is)`);
  }
  console.log("\nAmostra:");
  observacoes.slice(0, 8).forEach((o) =>
    console.log(`  ${String(o.roleSlug).padEnd(20)} ${String(o.seniority).padEnd(13)} R$ ${String(o.mediana).padStart(10)}`),
  );

  if (dryRun) {
    console.log("\n--dry-run: nada gravado.");
    return;
  }
  if (!isDatabaseConfigured) {
    throw new Error("DATABASE_URL nao configurado. Use --dry-run para so inspecionar.");
  }

  const gravadas = await upsertSalaryObservations(observacoes);
  console.log(`\n${gravadas} observação(ões) SISP gravada(s).`);

  await recordIngestionRun({
    serviceName: "SISP",
    status: gravadas > 0 ? "OPERATIONAL" : "DEGRADED",
    recordsUpserted: gravadas,
    durationMs: Date.now() - startedAt.getTime(),
    startedAt,
  });
}

main()
  .catch((err) => {
    logger.error("Ingestao do SISP falhou", { error: err instanceof Error ? err.message : String(err) });
    process.exitCode = 1;
  })
  .finally(async () => {
    if (isDatabaseConfigured) await closePool();
  });
