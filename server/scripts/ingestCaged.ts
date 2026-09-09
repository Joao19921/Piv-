/**
 * Ingestao mensal do Novo CAGED para `salary_observations`.
 *
 * Uso:
 *   pnpm run ingest:caged                 # ultima competencia publicada no FTP
 *   pnpm run ingest:caged -- 202607       # competencia especifica
 *   pnpm run ingest:caged -- --dry-run    # calcula e imprime, sem gravar no banco
 *
 * Roda como job agendado no GitHub Actions (.github/workflows/ingest-caged.yml), nao na Lambda
 * de precos: precisa de `7z` e `curl`, de RAM folgada e de minutos de execucao -- ver o cabecalho
 * de server/src/infrastructure/collectors/cagedCollector.ts.
 *
 * Pre-requisitos no ambiente: `curl` e `7z` no PATH, e `DATABASE_URL` (exceto em --dry-run).
 */
import "dotenv/config";
import {
  CBOS_TI,
  competenciaParaData,
  descobrirUltimaCompetencia,
  ingestCagedCompetencia,
  MIN_AMOSTRA,
} from "../src/infrastructure/collectors/cagedCollector";
import { closePool, isDatabaseConfigured } from "../src/infrastructure/db/client";
import { logger } from "../src/infrastructure/observability/logger";
import { recordIngestionRun } from "../src/infrastructure/repositories/ingestionRunsRepository";
import { upsertSalaryObservations, type SalaryObservationInput } from "../src/infrastructure/repositories/salaryObservationsRepository";

function formatBRL(v: number): string {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const competenciaArg = args.find((a) => /^\d{6}$/.test(a));

  const startedAt = new Date();
  const competencia = competenciaArg ?? (await descobrirUltimaCompetencia());
  console.log(`\nCompetencia alvo: ${competencia}${competenciaArg ? "" : " (mais recente no FTP)"}\n`);

  const resultado = await ingestCagedCompetencia(competencia);

  console.log(`linhas lidas no arquivo : ${resultado.linhasLidas.toLocaleString("pt-BR")}`);
  console.log(`admissoes de TI na amostra: ${resultado.linhasConsideradas.toLocaleString("pt-BR")}`);
  console.log(`recortes com amostra >= ${MIN_AMOSTRA}: ${resultado.agregados.length}\n`);

  console.log("CBO     UF   n       P25          Mediana      P75          Ocupacao");
  console.log("-".repeat(100));
  for (const a of resultado.agregados.slice(0, 25)) {
    console.log(
      `${a.cbo}  ${(a.uf ?? "BR").padEnd(4)} ${String(a.nAmostra).padStart(6)}  ` +
        `${formatBRL(a.p25).padEnd(12)} ${formatBRL(a.mediana).padEnd(12)} ${formatBRL(a.p75).padEnd(12)} ` +
        `${CBOS_TI[a.cbo] ?? ""}`,
    );
  }
  if (resultado.agregados.length > 25) {
    console.log(`... e mais ${resultado.agregados.length - 25} recorte(s).`);
  }

  if (dryRun) {
    console.log("\n--dry-run: nada gravado no banco.");
    return;
  }

  if (!isDatabaseConfigured) {
    throw new Error("DATABASE_URL nao configurado -- nao ha onde gravar. Use --dry-run para so inspecionar.");
  }

  const observacoes: SalaryObservationInput[] = resultado.agregados.map((a) => ({
    source: "CAGED",
    sourceUrl: resultado.sourceUrl,
    cbo: a.cbo,
    // O CAGED e o cadastro de emprego FORMAL: por definicao, vinculo CLT. O lado PJ vira de
    // outra fonte (PNCP), nunca daqui.
    employmentModel: "CLT",
    uf: a.uf,
    municipio: null,
    competencia: competenciaParaData(resultado.competencia),
    nAmostra: a.nAmostra,
    p25: a.p25,
    mediana: a.mediana,
    p75: a.p75,
    media: a.media,
  }));

  const gravadas = await upsertSalaryObservations(observacoes);
  console.log(`\n${gravadas} observacao(oes) gravada(s) em salary_observations.`);

  // Mesma trilha de observabilidade das demais ingestoes -- aparece em /system-health.
  await recordIngestionRun({
    serviceName: "CAGED",
    status: gravadas > 0 ? "OPERATIONAL" : "DEGRADED",
    recordsUpserted: gravadas,
    durationMs: Date.now() - startedAt.getTime(),
    errorMessage: gravadas > 0 ? undefined : `Nenhum recorte atingiu a amostra minima de ${MIN_AMOSTRA}.`,
    startedAt,
  });
}

main()
  .catch((err) => {
    const reason = err instanceof Error ? err.message : String(err);
    logger.error("Ingestao do CAGED falhou", { error: reason });
    process.exitCode = 1;
  })
  .finally(async () => {
    if (isDatabaseConfigured) await closePool();
  });
