import express, { type Router } from "express";
import { cloudRegions, cloudSkus, getCloudSku } from "../domain/services/cloudCatalog";
import { getLaborProfile, laborProfiles, licenseCatalog } from "../domain/services/catalogs";
import { computeCloudEstimate } from "../domain/services/cloudPricing";
import { computeLaborRate } from "../domain/services/laborPricing";
import { getMarketBenchmarkHistory, searchMarketBenchmark } from "../domain/services/marketBenchmark";
import { getAzureUnitPrice } from "../infrastructure/collectors/azureCollector";
import { getPtax } from "../infrastructure/collectors/bacenCollector";
import { getPendingSources, getStaticProviderPrice } from "../infrastructure/collectors/staticFallbacks";
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

export function createApiRouter(): Router {
  const router = express.Router();
  router.use(express.json());

  // Health check leve para orquestradores (Render, etc.): nao toca fontes externas nem exige Basic Auth.
  router.get("/healthz", (_req, res) => {
    res.json({ status: "ok" });
  });

  router.get("/system-health", async (_req, res) => {
    const [ptax, azure] = await Promise.all([getPtax(), getAzureUnitPrice("us-east-1")]);

    const sources = [
      toSourceView("BACEN - PTAX", ptax),
      toSourceView("Azure Retail API", azure),
      toSourceView("AWS Pricing", getStaticProviderPrice("AWS", "us-east-1")),
      {
        name: "Benchmark salarial",
        status: process.env.MARKET_BENCHMARK_CONNECTOR_URL ? "DEGRADED" : "FALLBACK_STALE",
        source: process.env.MARKET_BENCHMARK_CONNECTOR_URL ? "LIVE_CONNECTOR_READY" : "STATIC_SNAPSHOT",
        timestamp: new Date().toISOString(),
        warning: process.env.MARKET_BENCHMARK_CONNECTOR_URL
          ? "Conector externo configurado; consultas usam cache/fallback quando a fonte falha."
          : "Conector externo de benchmark nao configurado; usando snapshot parametrizado local com Robert Half, Michael Page, Glassdoor e Indeed.",
        data: null,
      },
      ...getPendingSources(),
    ];

    res.json({ sources });
  });

  router.get("/fx/ptax", async (_req, res) => {
    res.json(await getPtax());
  });

  router.get("/cloud/catalog", (_req, res) => {
    res.json({
      regions: cloudRegions,
      skus: cloudSkus,
      source: {
        name: "Catalogo cloud",
        status: "FALLBACK_STALE",
        source: "LIVE_AZURE_STATIC_AWS_GCP",
        timestamp: new Date().toISOString(),
        warning: "Azure usa Retail Prices API ao vivo. AWS e GCP usam snapshot oficial parametrizado ate os coletores dedicados serem ligados.",
      },
    });
  });

  router.get("/cloud/estimate", async (req, res) => {
    const provider = String(req.query.provider ?? "AWS");
    const region = String(req.query.region ?? "us-east-1");
    const skuId = String(req.query.skuId ?? "");
    const instances = Number(req.query.instances);
    const hours = Number(req.query.hours);

    if (!Number.isFinite(instances) || !Number.isFinite(hours) || instances < 0 || hours < 0) {
      res.status(400).json({ error: "Parametros 'instances' e 'hours' sao obrigatorios e devem ser numericos." });
      return;
    }

    const sku = getCloudSku(skuId, provider);
    const fallbackPrice = sku.regionalPricesUsd[region] ?? Object.values(sku.regionalPricesUsd)[0] ?? 0;
    const staticResult: ResilienceResult<{ pricePerHourUsd: number; skuName: string; sourceUrl: string }> = {
      status: "FALLBACK_STALE",
      source: "STATIC_SNAPSHOT",
      timestamp: new Date().toISOString(),
      warning: `${provider} usa snapshot oficial parametrizado nesta fase. Ligue o coletor dedicado para preco ao vivo.`,
      data: { pricePerHourUsd: fallbackPrice, skuName: sku.skuName, sourceUrl: sku.sourceUrl },
    };

    const [unitPriceResult, fxResult] = await Promise.all([
      provider === "Azure" ? getAzureUnitPrice(region, sku.azureArmSkuName ?? sku.skuName, fallbackPrice) : Promise.resolve(staticResult),
      getPtax(),
    ]);

    const unitPriceUsd = (unitPriceResult.data as { pricePerHourUsd: number } | null)?.pricePerHourUsd ?? 0.08;
    const fxRate = (fxResult.data as { rate: number } | null)?.rate ?? 5.4;
    const estimate = computeCloudEstimate({ unitPriceUsd, fxRate, instances, hours });

    res.json({
      estimate,
      sku,
      unitPrice: toSourceView(provider === "Azure" ? "Azure Retail API" : `${provider} (snapshot oficial)`, unitPriceResult),
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

  router.get("/market-benchmark/history", (_req, res) => {
    res.json({ entries: getMarketBenchmarkHistory() });
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
