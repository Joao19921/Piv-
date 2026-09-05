/**
 * Orquestra a ingestao periodica de precos/cotacoes (Azure, AWS, GCP, PTAX -> Postgres).
 * Compartilhado entre o script de linha de comando (`server/scripts/refreshSources.ts`,
 * `pnpm run refresh-sources`) e o handler da Lambda (`server/lambda/refreshSourcesHandler.ts`),
 * para nao duplicar a logica entre os dois pontos de entrada.
 */
import { getAwsEbsPrice, getAwsUnitPrice } from "../../infrastructure/collectors/awsCollector";
import { getAzureUnitPrice } from "../../infrastructure/collectors/azureCollector";
import { getPtax } from "../../infrastructure/collectors/bacenCollector";
import { getGcpUnitPrice } from "../../infrastructure/collectors/gcpCollector";
import { isDatabaseConfigured } from "../../infrastructure/db/client";
import { logger } from "../../infrastructure/observability/logger";
import { insertPrice, listRegions, listSkus, type CloudRegionRow, type CloudSkuRow } from "../../infrastructure/repositories/cloudPricingRepository";
import { insertFxRate } from "../../infrastructure/repositories/fxRepository";
import { recordIngestionRun, type IngestionStatus } from "../../infrastructure/repositories/ingestionRunsRepository";
import { insertStoragePrice } from "../../infrastructure/repositories/storagePricingRepository";
import type { ResilienceResult } from "../../infrastructure/resilience/resilienceManager";

export interface IngestionSummary {
  ok: boolean;
  reason?: string;
}

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

const INGESTION_CONCURRENCY = 4;

/** Processa `items` com no maximo `limit` chamadas de `fn` em voo simultaneamente (evita martelar as APIs externas de preco). */
async function mapWithConcurrency<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < items.length) {
      const item = items[cursor];
      cursor += 1;
      await fn(item);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

async function ingestSkuPrice(sku: CloudSkuRow, region: CloudRegionRow, summary: ProviderRunSummary): Promise<void> {
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
  const pairs = providerSkus.flatMap((sku) => providerRegions.map((region) => ({ sku, region })));

  await mapWithConcurrency(pairs, INGESTION_CONCURRENCY, async ({ sku, region }) => {
    try {
      await ingestSkuPrice(sku, region, summary);
    } catch (err) {
      summary.status = "OFFLINE";
      summary.errorMessages.push(`${sku.id}/${region.region_key}: ${err instanceof Error ? err.message : String(err)}`);
    }
  });

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

async function runAwsStorageIngestion(regions: CloudRegionRow[]): Promise<void> {
  const serviceName = "AWS_STORAGE_INGESTION";
  const startedAt = new Date();
  const summary: ProviderRunSummary = { serviceName, status: "OPERATIONAL", recordsUpserted: 0, errorMessages: [] };

  const awsRegions = regions.filter((region) => region.provider === "AWS");
  await mapWithConcurrency(awsRegions, INGESTION_CONCURRENCY, async (region) => {
    try {
      const result = await getAwsEbsPrice(region.provider_region);
      summary.status = worstStatus(summary.status, result.status);
      if (result.warning) summary.errorMessages.push(`ebs-gp3/${region.region_key}: ${result.warning}`);
      if (result.data) {
        await insertStoragePrice({
          provider: "AWS",
          regionKey: region.region_key,
          storageType: "gp3",
          pricePerGbMonthUsd: result.data.pricePerGbMonthUsd,
          sourceStatus: result.status,
        });
        summary.recordsUpserted += 1;
      }
    } catch (err) {
      summary.status = "OFFLINE";
      summary.errorMessages.push(`ebs-gp3/${region.region_key}: ${err instanceof Error ? err.message : String(err)}`);
    }
  });

  const durationMs = Date.now() - startedAt.getTime();
  await recordIngestionRun({
    serviceName,
    status: summary.status,
    recordsUpserted: summary.recordsUpserted,
    durationMs,
    errorMessage: summary.errorMessages.length ? summary.errorMessages.slice(0, 5).join(" | ") : undefined,
    startedAt,
  });
  logger.info("Ingestao AWS EBS concluida", { ...summary, durationMs });
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

export async function runIngestion(): Promise<IngestionSummary> {
  if (!isDatabaseConfigured) {
    const reason = "DATABASE_URL nao configurado; abortando ingestao.";
    logger.error(reason);
    return { ok: false, reason };
  }

  const [skus, regions] = await Promise.all([listSkus(), listRegions()]);
  if (!skus.length || !regions.length) {
    const reason = "Catalogo de SKUs/regioes vazio no Postgres; rode as migrations/seed antes da ingestao.";
    logger.error(reason);
    return { ok: false, reason };
  }

  await Promise.all([
    runProviderIngestion("AWS", skus, regions),
    runProviderIngestion("Azure", skus, regions),
    runProviderIngestion("GCP", skus, regions),
    runAwsStorageIngestion(regions),
    runFxIngestion(),
  ]);

  return { ok: true };
}
