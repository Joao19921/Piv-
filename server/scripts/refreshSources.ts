/**
 * Ingestao periodica de precos e cotacoes, para rodar manualmente ou localmente
 * (`pnpm run refresh-sources`). Em producao, a mesma logica roda em
 * `server/lambda/refreshSourcesHandler.ts`, agendada via EventBridge a cada 5 dias.
 */
import "dotenv/config";
import { closePool } from "../src/infrastructure/db/client";
import { logger } from "../src/infrastructure/observability/logger";
import { runIngestion } from "../src/domain/services/ingestionOrchestrator";

runIngestion()
  .then((summary) => {
    if (!summary.ok) process.exitCode = 1;
  })
  .catch((err) => {
    logger.error("Ingestao periodica falhou de forma inesperada", { error: err instanceof Error ? err.message : String(err) });
    process.exitCode = 1;
  })
  .finally(() => closePool());
