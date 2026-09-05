import express, { type Router } from "express";
import { getCloudCatalog } from "../domain/services/cloudCatalog";
import { getLaborProfile, laborProfiles, licenseCatalog } from "../domain/services/catalogs";
import { searchCloudServiceDefinitions, type CloudProvider } from "../domain/services/cloudServiceCatalog";
import { computeLaborRate } from "../domain/services/laborPricing";
import { getMarketBenchmarkHistory, searchMarketBenchmark } from "../domain/services/marketBenchmark";
import { calculateServicePrice } from "../domain/services/pricingEngine";
import { createSessionCookieValue, isSessionCookieValid, parseCookie, SESSION_COOKIE_NAME, SESSION_TTL_MS, SESSION_TTL_REMEMBER_MS } from "../infrastructure/auth/session";
import { getAzureUnitPrice } from "../infrastructure/collectors/azureCollector";
import { getPtax } from "../infrastructure/collectors/bacenCollector";
import { getPncpStatus } from "../infrastructure/collectors/pncpCollector";
import { getPendingSources } from "../infrastructure/collectors/staticFallbacks";
import { isDatabaseConfigured } from "../infrastructure/db/client";
import {
  deleteArchitecture,
  getArchitecture,
  insertArchitecture,
  listArchitectureSummaries,
  updateArchitecture,
  type ArchitectureInput,
  type ArchitectureRow,
  type ArchitectureServiceInput,
  type ArchitectureServiceRow,
  type ArchitectureSummaryRow,
} from "../infrastructure/repositories/cloudArchitectureRepository";
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

function toArchitectureSummaryView(row: ArchitectureSummaryRow) {
  return {
    id: row.id,
    name: row.name,
    provider: row.provider,
    region: row.region_key,
    currency: row.currency,
    monthlyUsd: Number(row.monthly_usd),
    monthlyBrl: Number(row.monthly_brl),
    serviceCount: Number(row.service_count),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toArchitectureServiceView(row: ArchitectureServiceRow) {
  return {
    id: row.id,
    serviceId: row.service_id,
    provider: row.provider,
    category: row.category,
    name: row.name,
    region: row.region_key,
    configuration: row.configuration,
    monthlyUsd: Number(row.monthly_usd),
    monthlyBrl: Number(row.monthly_brl),
  };
}

function toArchitectureDetailView(architecture: ArchitectureRow, services: ArchitectureServiceRow[]) {
  return {
    id: architecture.id,
    name: architecture.name,
    provider: architecture.provider,
    region: architecture.region_key,
    currency: architecture.currency,
    monthlyUsd: Number(architecture.monthly_usd),
    monthlyBrl: Number(architecture.monthly_brl),
    createdAt: architecture.created_at,
    updatedAt: architecture.updated_at,
    services: services.map(toArchitectureServiceView),
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

  // Health check leve para orquestradores (Render, etc.): nao toca fontes externas nem exige login.
  router.get("/healthz", (_req, res) => {
    res.json({ status: "ok" });
  });

  // Login do ambiente de teste (substitui o popup nativo de Basic Auth por uma tela do produto).
  // Credencial unica compartilhada (TEST_ACCESS_USER/TEST_ACCESS_PASSWORD) — sem sistema de usuarios.
  router.get("/auth/session", (req, res) => {
    const testAccessUser = process.env.TEST_ACCESS_USER;
    const testAccessPassword = process.env.TEST_ACCESS_PASSWORD;
    const authRequired = process.env.NODE_ENV === "production" && Boolean(testAccessUser && testAccessPassword);
    if (!authRequired) {
      res.json({ authenticated: true, required: false, username: null });
      return;
    }
    const token = parseCookie(req.headers.cookie, SESSION_COOKIE_NAME);
    const authenticated = isSessionCookieValid(token, testAccessPassword!);
    res.json({ authenticated, required: true, username: authenticated ? testAccessUser : null });
  });

  router.post("/auth/login", (req, res) => {
    const testAccessUser = process.env.TEST_ACCESS_USER;
    const testAccessPassword = process.env.TEST_ACCESS_PASSWORD;
    if (!testAccessUser || !testAccessPassword) {
      res.status(503).json({ error: "Autenticacao nao configurada neste ambiente." });
      return;
    }

    const { username, password, remember } = (req.body ?? {}) as Record<string, unknown>;
    if (username !== testAccessUser || password !== testAccessPassword) {
      res.status(401).json({ error: "Usuario ou senha invalidos." });
      return;
    }

    const ttlMs = remember === true ? SESSION_TTL_REMEMBER_MS : SESSION_TTL_MS;
    res.cookie(SESSION_COOKIE_NAME, createSessionCookieValue(testAccessPassword, ttlMs), {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      maxAge: ttlMs,
    });
    res.json({ ok: true });
  });

  router.post("/auth/logout", (_req, res) => {
    res.clearCookie(SESSION_COOKIE_NAME);
    res.json({ ok: true });
  });

  router.get("/system-health", async (_req, res) => {
    const [ptax, azure, pncp, ingestionRuns] = await Promise.all([
      getPtax(),
      getAzureUnitPrice("us-east-1"),
      getPncpStatus(),
      isDatabaseConfigured
        ? getLatestIngestionRuns().catch((err) => {
            logger.error("Falha ao ler ingestion_runs do Postgres", { error: err instanceof Error ? err.message : String(err) });
            return {} as Record<string, IngestionRun>;
          })
        : Promise.resolve({} as Record<string, IngestionRun>),
    ]);

    const sources = [
      toSourceView("BACEN - PTAX", ptax),
      toSourceView("Azure Retail API", azure),
      toSourceView("PNCP - Consulta Publica", pncp),
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

  // Catalogo pesquisavel de servicos (Compute, Storage, Database, Networking, Containers,
  // Serverless, CDN) por AWS/Azure/GCP. Compute tem as opcoes de SKU preenchidas ao vivo
  // (mesmo catalogo/preco do /system-health); os demais sao catalogo estatico com fonte explicita.
  router.get("/cloud/services", async (req, res) => {
    const q = typeof req.query.q === "string" ? req.query.q : undefined;
    const provider = typeof req.query.provider === "string" ? (req.query.provider as CloudProvider) : undefined;
    const category = typeof req.query.category === "string" ? req.query.category : undefined;

    const definitions = searchCloudServiceDefinitions({ q, provider, category: category as never });
    const catalog = await getCloudCatalog();

    const services = definitions.map((definition) => ({
      id: definition.id,
      provider: definition.provider,
      category: definition.category,
      name: definition.name,
      description: definition.description,
      pricingInfo: definition.pricingInfo,
      configFields: definition.configFields.map((field) => {
        if (field.dynamicOptions !== "compute-sku") return field;
        const options = catalog.skus
          .filter((sku) => sku.provider === definition.provider)
          .map((sku) => ({ value: sku.id, label: sku.displayName }));
        return { ...field, options };
      }),
      regions: catalog.regions.filter((region) => region.provider === definition.provider),
    }));

    res.json({ services });
  });

  router.post("/cloud/services/:serviceId/price", async (req, res) => {
    const { serviceId } = req.params;
    const { region, config } = (req.body ?? {}) as Record<string, unknown>;
    if (typeof region !== "string" || !region.trim()) {
      res.status(400).json({ error: "region e obrigatorio." });
      return;
    }
    if (config !== undefined && (typeof config !== "object" || config === null || Array.isArray(config))) {
      res.status(400).json({ error: "config, quando informado, deve ser um objeto." });
      return;
    }

    try {
      const pricing = await calculateServicePrice(serviceId, region, (config as Record<string, unknown>) ?? {});
      res.json({ pricing });
    } catch (err) {
      res.status(404).json({ error: err instanceof Error ? err.message : "Servico nao encontrado." });
    }
  });

  /** Valida e recalcula os servicos de uma arquitetura (usado por create e update). */
  async function buildArchitectureInput(body: Record<string, unknown>): Promise<{ error: string } | { input: ArchitectureInput }> {
    const { name, currency, services } = body;

    if (typeof name !== "string" || !name.trim()) return { error: "name e obrigatorio." };
    if (currency !== "BRL" && currency !== "USD") return { error: "currency deve ser BRL ou USD." };
    if (!Array.isArray(services) || services.length === 0) return { error: "services deve ser uma lista com pelo menos 1 servico." };

    const resolvedServices: ArchitectureServiceInput[] = [];
    for (const raw of services as Record<string, unknown>[]) {
      const { serviceId, region, config } = raw ?? {};
      if (typeof serviceId !== "string" || !serviceId.trim()) return { error: "Cada servico precisa de 'serviceId'." };
      if (typeof region !== "string" || !region.trim()) return { error: "Cada servico precisa de 'region'." };

      let pricing;
      try {
        pricing = await calculateServicePrice(serviceId, region, (config as Record<string, unknown>) ?? {});
      } catch (err) {
        return { error: err instanceof Error ? err.message : `Servico '${serviceId}' invalido.` };
      }

      const definition = searchCloudServiceDefinitions({}).find((d) => d.id === serviceId);
      if (!definition) return { error: `Servico '${serviceId}' nao encontrado no catalogo.` };

      resolvedServices.push({
        serviceId,
        provider: definition.provider,
        category: definition.category,
        name: definition.name,
        regionKey: region,
        configuration: (config as Record<string, unknown>) ?? {},
        monthlyUsd: pricing.monthlyUsd,
        monthlyBrl: pricing.monthlyBrl,
      });
    }

    return {
      input: {
        name: name.trim().slice(0, 120),
        provider: resolvedServices[0].provider,
        regionKey: resolvedServices[0].regionKey,
        currency,
        services: resolvedServices,
      },
    };
  }

  // Unica coisa que o produto persiste: uma arquitetura de infra cloud (composicao de N
  // servicos) salva com nome pelo usuario. Preco de cada servico e recalculado no momento do
  // save/edicao (nao reaproveita um valor que o cliente possa ter enviado desatualizado).
  router.post("/cloud/architectures", async (req, res) => {
    if (!isDatabaseConfigured) {
      res.status(503).json({ error: "Banco nao configurado; nao e possivel salvar arquiteturas agora." });
      return;
    }
    const result = await buildArchitectureInput((req.body ?? {}) as Record<string, unknown>);
    if ("error" in result) {
      res.status(400).json({ error: result.error });
      return;
    }
    const id = await insertArchitecture(result.input);
    const detail = await getArchitecture(id);
    res.status(201).json({ architecture: toArchitectureDetailView(detail!.architecture, detail!.services) });
  });

  router.get("/cloud/architectures", async (_req, res) => {
    if (!isDatabaseConfigured) {
      res.json({ architectures: [] });
      return;
    }
    const rows = await listArchitectureSummaries();
    res.json({ architectures: rows.map(toArchitectureSummaryView) });
  });

  router.get("/cloud/architectures/:id", async (req, res) => {
    if (!isDatabaseConfigured) {
      res.status(404).json({ error: "Banco nao configurado." });
      return;
    }
    const detail = await getArchitecture(req.params.id);
    if (!detail) {
      res.status(404).json({ error: "Arquitetura nao encontrada." });
      return;
    }
    res.json({ architecture: toArchitectureDetailView(detail.architecture, detail.services) });
  });

  router.put("/cloud/architectures/:id", async (req, res) => {
    if (!isDatabaseConfigured) {
      res.status(503).json({ error: "Banco nao configurado; nao e possivel editar arquiteturas agora." });
      return;
    }
    const existing = await getArchitecture(req.params.id);
    if (!existing) {
      res.status(404).json({ error: "Arquitetura nao encontrada." });
      return;
    }
    const result = await buildArchitectureInput((req.body ?? {}) as Record<string, unknown>);
    if ("error" in result) {
      res.status(400).json({ error: result.error });
      return;
    }
    await updateArchitecture(req.params.id, result.input);
    const detail = await getArchitecture(req.params.id);
    res.json({ architecture: toArchitectureDetailView(detail!.architecture, detail!.services) });
  });

  router.delete("/cloud/architectures/:id", async (req, res) => {
    if (!isDatabaseConfigured) {
      res.status(503).json({ error: "Banco nao configurado." });
      return;
    }
    const existing = await getArchitecture(req.params.id);
    if (!existing) {
      res.status(404).json({ error: "Arquitetura nao encontrada." });
      return;
    }
    await deleteArchitecture(req.params.id);
    res.status(204).send();
  });

  // Duplica com o snapshot ja salvo (nao recalcula preco): "duplicar" preserva exatamente o
  // que foi salvo, sem depender de precos ao vivo ainda estarem disponiveis no momento da copia.
  router.post("/cloud/architectures/:id/duplicate", async (req, res) => {
    if (!isDatabaseConfigured) {
      res.status(503).json({ error: "Banco nao configurado." });
      return;
    }
    const existing = await getArchitecture(req.params.id);
    if (!existing) {
      res.status(404).json({ error: "Arquitetura nao encontrada." });
      return;
    }
    const { name } = (req.body ?? {}) as Record<string, unknown>;
    const newName = typeof name === "string" && name.trim() ? name.trim().slice(0, 120) : `${existing.architecture.name} (copia)`;

    const id = await insertArchitecture({
      name: newName,
      provider: existing.architecture.provider,
      regionKey: existing.architecture.region_key,
      currency: existing.architecture.currency,
      services: existing.services.map((service) => ({
        serviceId: service.service_id,
        provider: service.provider,
        category: service.category,
        name: service.name,
        regionKey: service.region_key,
        configuration: service.configuration,
        monthlyUsd: Number(service.monthly_usd),
        monthlyBrl: Number(service.monthly_brl),
      })),
    });
    const detail = await getArchitecture(id);
    res.status(201).json({ architecture: toArchitectureDetailView(detail!.architecture, detail!.services) });
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
