/**
 * Ingestao anual da RAIS para `salary_observations` (fonte 'RAIS', migration 0018).
 *
 * Uso:
 *   pnpm run ingest:rais                 # ultimo ano publicado no FTP
 *   pnpm run ingest:rais -- 2025         # ano especifico
 *   pnpm run ingest:rais -- --dry-run    # calcula e imprime, sem gravar no banco
 *
 * Roda como job agendado (.github/workflows/ingest-rais.yml), nao na Lambda de precos: precisa
 * de `7z` e `curl`, RAM folgada e minutos de execucao -- mesmos pre-requisitos do
 * ingest:caged, ver o cabecalho de server/src/infrastructure/collectors/raisCollector.ts.
 *
 * A RAIS fica sempre AO LADO do CAGED, nunca no lugar: grava com o mesmo `cbo`/`uf` do CAGED,
 * so muda o `source` -- getEnrichedLaborProfiles (laborBenchmark.ts) consulta as duas
 * separadamente e nunca decide uma no lugar da outra.
 */
import "dotenv/config";
import { anoParaData, descobrirUltimoAno, ingestRaisAno, MIN_AMOSTRA } from "../src/infrastructure/collectors/raisCollector";
import { CBOS_TI } from "../src/infrastructure/collectors/cagedCollector";
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
  const anoArg = args.find((a) => /^\d{4}$/.test(a));

  const startedAt = new Date();
  const ano = anoArg ?? (await descobrirUltimoAno());
  console.log(`\nAno-base alvo: ${ano}${anoArg ? "" : " (mais recente no FTP)"}\n`);

  const resultado = await ingestRaisAno(ano);

  console.log(`linhas lidas (7 regioes) : ${resultado.linhasLidas.toLocaleString("pt-BR")}`);
  console.log(`vinculos de TI ativos em 31/12 na amostra: ${resultado.linhasConsideradas.toLocaleString("pt-BR")}`);
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
    console.log("\n--dry-run: nada gravado.");
    return;
  }

  if (!isDatabaseConfigured) {
    throw new Error("DATABASE_URL nao configurado -- nao ha onde gravar. Use --dry-run para so inspecionar.");
  }

  const observacoes: SalaryObservationInput[] = resultado.agregados.map((a) => ({
    source: "RAIS",
    sourceUrl: resultado.sourceUrl,
    cbo: a.cbo,
    // Mesma regra do CAGED: RAIS_VINC_PUB e o cadastro de vinculo FORMAL (CLT). O lado PJ nao
    // vem daqui.
    employmentModel: "CLT",
    uf: a.uf,
    municipio: null,
    competencia: anoParaData(ano),
    nAmostra: a.nAmostra,
    p25: a.p25,
    mediana: a.mediana,
    p75: a.p75,
    media: a.media,
  }));

  const gravadas = await upsertSalaryObservations(observacoes);
  console.log(`\n${gravadas} observacao(oes) gravada(s) em salary_observations (source=RAIS).`);

  await recordIngestionRun({
    serviceName: "RAIS",
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
    logger.error("Ingestao da RAIS falhou", { error: reason });
    process.exitCode = 1;
  })
  .finally(async () => {
    if (isDatabaseConfigured) await closePool();
  });
