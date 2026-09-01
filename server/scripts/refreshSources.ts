/**
 * Ingestao periodica de precos e cotacoes (rodada pelo cron do GitHub Actions a cada 5 dias,
 * ou manualmente com `pnpm run refresh-sources`).
 *
 * Para cada SKU/regiao do catalogo (Postgres), consulta a fonte real (Azure Retail Prices,
 * AWS Pricing API, GCP Cloud Billing Catalog) e grava o preco em `cloud_prices`. Tambem
 * atualiza a cotacao PTAX em `fx_rates`. Cada fonte grava uma linha resumo em `ingestion_runs`
 * (status, quantidade de registros, duracao, erro) para o painel de observabilidade em /system-health.
 */
import "dotenv/config";
import { getAwsUnitPrice } from "../src/infrastructure/collectors/awsCollector";
import { getAzureUnitPrice } from "../src/infrastructure/collectors/azureCollector";
import { getPtax } from "../src/infrastructure/collectors/bacenCollector";
import { getGcpUnitPrice } from "../src/infrastructure/collectors/gcpCollector";
import { closePool, isDatabaseConfigured } from "../src/infrastructure/db/client";
import { logger } from "../src/infrastructure/observability/logger";
import { insertPrice, listRegions, listSkus, type CloudRegionRow, type CloudSkuRow } from "../src/infrastructure/repositories/cloudPricingRepository";
import { insertFxRate } from "../src/infrastructure/repositories/fxRepository";
import { recordIngestionRun, type IngestionStatus } from "../src/infrastructure/repositories/ingestionRunsRepository";
import type { ResilienceResult } from "../src/infrastructure/resilience/resilienceManager";

interface ProviderRunSummary {
  serviceName: string;
  status: IngestionStatus;
  recordsUpserted: number;
  errorMessages: string[];
}

function worstStatus(a: IngestionStatus, b: IngestionStatus): IngestionStatus {
  const rank: Record<IngestionStatus, number> = { OPERATIONAL: 0, DEGRADED: 1, FALLBACK_STALE: 2, OFFLINE: 3 };
  return rank[b] > rank[a] ? b : a;
}

async function ingestSkuPrice(
  sku: CloudSkuRow,
  region: CloudRegionRow,
  summary: ProviderRunSummary,
): Promise<void> {
  let result: ResilienceResult<{ pricePerHourUsd: number }>;

  if (sku.provider === "Azure") {
    result = await getAzureUnitPrice(region.region_key, sku.azure_arm_sku_name ?? sku.sku_name);
  } else if (sku.provider === "AWS") {
    result = await getAwsUnitPrice(region.provider_region, sku.sku_name);
  } else {
    result = await getGcpUnitPrice(region.provider_region, sku.sku_name, sku.vcpu, Number(sku.memory_gib));
  }

  summary.status = worstStatus(summary.status, result.status);
  if (result.warning) summary.errorMessages.push(`${sku.id}/${region.region_key}: ${result.warning}`);

  if (result.data) {
    await insertPrice({ skuId: sku.id, regionKey: region.region_key, pricePerHourUsd: result.data.pricePerHourUsd, sourceStatus: result.status });
    summary.recordsUpserted += 1;
  }
}

async function runProviderIngestion(provider: "AWS" | "Azure" | "GCP", skus: CloudSkuRow[], regions: CloudRegionRow[]): Promise<void> {
  const serviceName = `${provider.toUpperCase()}_PRICING_INGESTION`;
  const startedAt = new Date();
  const summary: ProviderRunSummary = { serviceName, status: "OPERATIONAL", recordsUpserted: 0, errorMessages: [] };

  const providerSkus = skus.filter((sku) => sku.provider === provider);
  const providerRegions = regions.filter((region) => region.provider === provider);

  for (const sku of providerSkus) {
    for (const region of providerRegions) {
      try {
        await ingestSkuPrice(sku, region, summary);
      } catch (err) {
        summary.status = "OFFLINE";
        summary.errorMessages.push(`${sku.id}/${region.region_key}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  const durationMs = Date.now() - startedAt.getTime();
  await recordIngestionRun({
    serviceName,
    status: summary.status,
    recordsUpserted: summary.recordsUpserted,
    durationMs,
    errorMessage: summary.errorMessages.length ? summary.errorMessages.slice(0, 5).join(" | ") : undefined,
    startedAt,
  });
  logger.info(`Ingestao ${provider} concluida`, { ...summary, durationMs });
}

async function runFxIngestion(): Promise<void> {
  const startedAt = new Date();
  const result = await getPtax();
  const durationMs = Date.now() - startedAt.getTime();

  if (result.data) {
    await insertFxRate({ rate: result.data.rate, quotedAt: result.data.quotedAt, sourceStatus: result.status });
  }

  await recordIngestionRun({
    serviceName: "BACEN_PTAX_INGESTION",
    status: result.status,
    recordsUpserted: result.data ? 1 : 0,
    durationMs,
    errorMessage: result.warning,
    startedAt,
  });
  logger.info("Ingestao PTAX concluida", { status: result.status, durationMs });
}

async function main(): Promise<void> {
  if (!isDatabaseConfigured) {
    logger.error("DATABASE_URL nao configurado; abortando ingestao. Configure a connection string do Postgres antes de rodar este script.");
    process.exitCode = 1;
    return;
  }

  const [skus, regions] = await Promise.all([listSkus(), listRegions()]);
  if (!skus.length || !regions.length) {
    logger.error("Catalogo de SKUs/regioes vazio no Postgres; rode as migrations/seed antes da ingestao.");
    process.exitCode = 1;
    return;
  }

  await Promise.all([
    runProviderIngestion("AWS", skus, regions),
    runProviderIngestion("Azure", skus, regions),
    runProviderIngestion("GCP", skus, regions),
    runFxIngestion(),
  ]);
}

main()
  .catch((err) => {
    logger.error("Ingestao periodica falhou de forma inesperada", { error: err instanceof Error ? err.message : String(err) });
    process.exitCode = 1;
  })
  .finally(() => closePool());
