import express, { type Router } from "express";
import { getCloudCatalog, getCloudSku, getLatestKnownPrice, type CloudPricePoint } from "../domain/services/cloudCatalog";
import { getLaborProfile, laborProfiles, licenseCatalog } from "../domain/services/catalogs";
import { computeCloudEstimate } from "../domain/services/cloudPricing";
import { computeLaborRate } from "../domain/services/laborPricing";
import { getMarketBenchmarkHistory, searchMarketBenchmark } from "../domain/services/marketBenchmark";
import { getAzureUnitPrice } from "../infrastructure/collectors/azureCollector";
import { getPtax } from "../infrastructure/collectors/bacenCollector";
import { AWS_REGION_AVG_USD_PER_HOUR, DEFAULT_REGION_KEY, GCP_REGION_AVG_USD_PER_HOUR, getPendingSources } from "../infrastructure/collectors/staticFallbacks";
import { isDatabaseConfigured } from "../infrastructure/db/client";
import { insertPrice } from "../infrastructure/repositories/cloudPricingRepository";
import { getLatestIngestionRuns, type IngestionRun } from "../infrastructure/repositories/ingestionRunsRepository";
import { logger } from "../infrastructure/observability/logger";
import { getQueryStats } from "../infrastructure/observability/queryStats";
import type { ResilienceResult } from "../infrastructure/resilience/resilienceManager";

function toSourceView(name: string, result: ResilienceResult<unknown>) {
  return {
    name,
    status: result.status,
    source: result.source,
    timestamp: result.timestamp,
    warning: result.warning,
    data: result.data,
  };
}

/** Deriva um ApiSourceResult a partir da ultima execucao registrada em ingestion_runs (fontes sem checagem ao vivo por requisicao). */
function fromIngestionRun(name: string, run: IngestionRun | undefined) {
  if (!run) {
    return {
      name,
      status: "FALLBACK_STALE" as const,
      source: "STATIC_SNAPSHOT",
      timestamp: new Date().toISOString(),
      warning: "Ingestao periodica ainda nao rodou para esta fonte; usando snapshot estatico do catalogo.",
      data: null,
    };
  }
  return {
    name,
    status: run.status,
    source: "SCHEDULED_INGESTION",
    timestamp: run.finishedAt,
    warning: run.errorMessage ?? `Ultima ingestao: ${run.recordsUpserted} preco(s) atualizados em ${run.durationMs}ms.`,
    data: null,
  };
}

export function createApiRouter(): Router {
  const router = express.Router();
  router.use(express.json());

  // Health check leve para orquestradores (Render, etc.): nao toca fontes externas nem exige Basic Auth.
  router.get("/healthz", (_req, res) => {
    res.json({ status: "ok" });
  });

  router.get("/system-health", async (_req, res) => {
    const [ptax, azure, ingestionRuns] = await Promise.all([
      getPtax(),
      getAzureUnitPrice("us-east-1"),
      isDatabaseConfigured ? getLatestIngestionRuns().catch(() => ({}) as Record<string, IngestionRun>) : Promise.resolve({} as Record<string, IngestionRun>),
    ]);

    const sources = [
      toSourceView("BACEN - PTAX", ptax),
      toSourceView("Azure Retail API", azure),
      fromIngestionRun("AWS Pricing API", ingestionRuns.AWS_PRICING_INGESTION),
      fromIngestionRun("GCP Cloud Billing Catalog", ingestionRuns.GCP_PRICING_INGESTION),
      {
        name: "Benchmark salarial",
        status: process.env.MARKET_BENCHMARK_CONNECTOR_URL ? "DEGRADED" : "FALLBACK_STALE",
        source: process.env.MARKET_BENCHMARK_CONNECTOR_URL ? "LIVE_CONNECTOR_READY" : "STATIC_SNAPSHOT",
        timestamp: new Date().toISOString(),
        warning: process.env.MARKET_BENCHMARK_CONNECTOR_URL
          ? "Conector externo configurado; consultas usam cache/fallback quando a fonte falha."
          : "Conector externo de benchmark nao configurado; usando catalogo interno de perfis (salario CLT e/ou PJ) como snapshot local.",
        data: null,
      },
      ...getPendingSources(),
    ];

    res.json({
      sources,
      ingestion: Object.values(ingestionRuns),
      database: {
        configured: isDatabaseConfigured,
        queries: getQueryStats(),
      },
    });
  });

  router.get("/fx/ptax", async (_req, res) => {
    res.json(await getPtax());
  });

  router.get("/cloud/catalog", async (_req, res) => {
    const catalog = await getCloudCatalog();
    res.json({
      regions: catalog.regions,
      skus: catalog.skus,
      source: {
        name: "Catalogo cloud",
        status: catalog.origin === "DATABASE" ? "OPERATIONAL" : "FALLBACK_STALE",
        source: catalog.origin === "DATABASE" ? "POSTGRES" : "STATIC_SNAPSHOT",
        timestamp: new Date().toISOString(),
        warning:
          catalog.origin === "DATABASE"
            ? "Catalogo carregado do Postgres. Azure tambem consulta preco ao vivo por requisicao; AWS/GCP sao atualizados pela ingestao periodica (a cada 5 dias)."
            : "Postgres indisponivel ou ainda nao configurado (DATABASE_URL); usando snapshot estatico embutido no codigo.",
      },
    });
  });

  /**
   * AWS e GCP nao sao consultados ao vivo a partir do app web: a Lambda de ingestao periodica
   * (IAM Role, sem access key fixa) e quem fala com essas APIs a cada ~5 dias e grava em
   * cloud_prices. Aqui so lemos o ultimo preco conhecido (Postgres, ou o snapshot estatico
   * quando o Postgres esta indisponivel/ainda sem dado para esse SKU/regiao).
   */
  function resolveIngestedUnitPrice(provider: "AWS" | "GCP", knownPrice: CloudPricePoint | undefined, region: string): ResilienceResult<{ pricePerHourUsd: number }> {
    if (knownPrice) {
      return {
        status: knownPrice.sourceStatus,
        source: "SCHEDULED_INGESTION",
        timestamp: new Date().toISOString(),
        warning: knownPrice.sourceStatus === "OPERATIONAL" ? undefined : "Preco vem da ultima ingestao periodica bem-sucedida; pode nao refletir o valor mais recente.",
        data: { pricePerHourUsd: knownPrice.pricePerHourUsd },
      };
    }
    const table = provider === "AWS" ? AWS_REGION_AVG_USD_PER_HOUR : GCP_REGION_AVG_USD_PER_HOUR;
    return {
      status: "OFFLINE",
      source: "NONE",
      timestamp: new Date().toISOString(),
      warning: "Ingestao periodica ainda nao rodou para este SKU/regiao; usando media generica de custo por regiao.",
      data: { pricePerHourUsd: table[region] ?? table[DEFAULT_REGION_KEY] },
    };
  }

  router.get("/cloud/estimate", async (req, res) => {
    const provider = String(req.query.provider ?? "AWS") as "AWS" | "Azure" | "GCP";
    const region = String(req.query.region ?? "us-east-1");
    const skuId = String(req.query.skuId ?? "");
    const instances = Number(req.query.instances);
    const hours = Number(req.query.hours);

    if (!Number.isFinite(instances) || !Number.isFinite(hours) || instances < 0 || hours < 0) {
      res.status(400).json({ error: "Parametros 'instances' e 'hours' sao obrigatorios e devem ser numericos." });
      return;
    }

    const sku = await getCloudSku(skuId, provider);
    const knownPrice = await getLatestKnownPrice(sku.id, region);

    const [unitPriceResult, fxResult] = await Promise.all([
      provider === "Azure"
        ? getAzureUnitPrice(region, sku.azureArmSkuName ?? sku.skuName, knownPrice?.pricePerHourUsd)
        : Promise.resolve(resolveIngestedUnitPrice(provider, knownPrice, region)),
      getPtax(),
    ]);

    const unitPriceUsd = (unitPriceResult.data as { pricePerHourUsd: number } | null)?.pricePerHourUsd ?? 0.08;
    const fxRate = (fxResult.data as { rate: number } | null)?.rate ?? 5.4;
    const estimate = computeCloudEstimate({ unitPriceUsd, fxRate, instances, hours });

    // Azure e ao vivo por requisicao: aproveita para manter o Postgres fresco entre as janelas da Lambda.
    if (isDatabaseConfigured && provider === "Azure" && unitPriceResult.status === "OPERATIONAL") {
      insertPrice({ skuId: sku.id, regionKey: region, pricePerHourUsd: unitPriceUsd, sourceStatus: "OPERATIONAL" }).catch((err) =>
        logger.error("Falha ao gravar preco ao vivo no Postgres", { error: err instanceof Error ? err.message : String(err) }),
      );
    }

    res.json({
      estimate,
      sku,
      unitPrice: toSourceView(provider === "Azure" ? "Azure Retail API" : `${provider} Pricing (ingestao periodica)`, unitPriceResult),
      fx: toSourceView("BACEN - PTAX", fxResult),
    });
  });

  router.get("/labor/profiles", (_req, res) => {
    res.json({
      profiles: laborProfiles,
      source: {
        name: "CAGED / MTE",
        status: "FALLBACK_STALE",
        source: "STATIC_SNAPSHOT",
        timestamp: laborProfiles[0]?.updatedAt ?? new Date().toISOString(),
        warning: "Ingestao real do CAGED ainda pendente; perfis usam snapshot parametrizado de CBOs de tecnologia.",
      },
    });
  });

  router.post("/labor/estimate", (req, res) => {
    const { monthlySalary, factorK, marginPct, profileId } = (req.body ?? {}) as Record<string, unknown>;
    if (typeof monthlySalary !== "number" || typeof factorK !== "number" || typeof marginPct !== "number") {
      res.status(400).json({ error: "monthlySalary, factorK e marginPct sao obrigatorios e devem ser numericos." });
      return;
    }

    const profile = typeof profileId === "string" ? getLaborProfile(profileId) : undefined;
    res.json(computeLaborRate({ monthlySalary, factorK, marginPct, profile }));
  });

  router.post("/market-benchmark/search", async (req, res) => {
    const { role, state, city, notes } = (req.body ?? {}) as Record<string, unknown>;
    if (typeof role !== "string" || !role.trim()) {
      res.status(400).json({ error: "role e obrigatorio." });
      return;
    }

    res.json(await searchMarketBenchmark({
      role,
      state: typeof state === "string" ? state : undefined,
      city: typeof city === "string" ? city : undefined,
      notes: typeof notes === "string" ? notes : undefined,
    }));
  });

  router.get("/market-benchmark/history", async (_req, res) => {
    res.json({ entries: await getMarketBenchmarkHistory() });
  });

  router.get("/licenses/catalog", (_req, res) => {
    res.json({
      items: licenseCatalog,
      source: {
        name: "Catalogo de licencas",
        status: "FALLBACK_STALE",
        source: "STATIC_TABLE",
        timestamp: licenseCatalog[0]?.updatedAt ?? new Date().toISOString(),
        warning: "Catalogo baseado em paginas oficiais de precos; conectores comerciais por fornecedor ainda nao foram configurados.",
      },
    });
  });

  return router;
}
