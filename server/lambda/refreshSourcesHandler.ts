/**
 * Handler da Lambda "pivo-refresh-sources", disparada pelo EventBridge Scheduled Rule a
 * cada ~5 dias. Roda a mesma ingestao do script de linha de comando
 * (`server/scripts/refreshSources.ts`), mas usa a IAM Role de execucao da Lambda para
 * autenticar na AWS Pricing API (sem access key fixa). `DATABASE_URL` e
 * `GOOGLE_CLOUD_BILLING_API_KEY` continuam vindo de variaveis de ambiente da funcao.
 */
import { closePool } from "../src/infrastructure/db/client";
import { logger } from "../src/infrastructure/observability/logger";
import { runIngestion } from "../src/domain/services/ingestionOrchestrator";

export const handler = async (): Promise<{ ok: boolean; reason?: string }> => {
  try {
    const summary = await runIngestion();
    return summary;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    logger.error("Ingestao periodica (Lambda) falhou de forma inesperada", { error: reason });
    return { ok: false, reason };
  } finally {
    await closePool();
  }
};
