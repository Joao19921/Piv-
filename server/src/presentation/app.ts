import express, { type Router } from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getCloudCatalog } from "../domain/services/cloudCatalog";
import { getLaborProfile, laborProfiles, licenseCatalog } from "../domain/services/catalogs";
import { searchCloudServiceDefinitions, type CloudProvider } from "../domain/services/cloudServiceCatalog";
import { computeLaborRate } from "../domain/services/laborPricing";
import { getMarketBenchmarkHistory, searchMarketBenchmark } from "../domain/services/marketBenchmark";
import { calculateServicePrice } from "../domain/services/pricingEngine";
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
import { createAdminUsersRouter } from "./adminUsersRoutes";
import { createAuthRouter } from "./authRoutes";
import { requireAuth, requirePermission } from "./authMiddleware";

/** Versão do package.json, lida uma vez no boot; usada só para exibir "v{versão}" no rodapé do app. */
const appVersion = (() => {
  try {
    const dirname = path.dirname(fileURLToPath(import.meta.url));
    const pkg = JSON.parse(fs.readFileSync(path.resolve(dirname, "..", "package.json"), "utf-8")) as { version?: string };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
})();

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

/** Deriva um ApiSourceResult a partir da última execucao registrada em ingestion_runs (fontes sem checagem ao vivo por requisicao). */
function fromIngestionRun(name: string, run: IngestionRun | undefined) {
  if (!run) {
    return {
      name,
      status: "FALLBACK_STALE" as const,
      source: "STATIC_SNAPSHOT",
      timestamp: new Date().toISOString(),
      warning: "Ingestão periódica ainda não rodou para esta fonte; usando snapshot estático do catálogo.",
      data: null,
    };
  }
  return {
    name,
    status: run.status,
    source: "SCHEDULED_INGESTION",
    timestamp: run.finishedAt,
    // Não repassa run.errorMessage cru pro usuário final: esse campo guarda detalhe técnico
    // (ex.: nome de variável de ambiente faltando) que serve pro backend/observabilidade, não
    // pra tela. O detalhe completo continua em ingestion_runs (Postgres) e nos logs/Sentry.
    warning: run.status === "OPERATIONAL"
      ? `Última ingestão: ${run.recordsUpserted} preço(s) atualizados em ${run.durationMs}ms.`
      : "Ingestão automática indisponível no momento; usando dados de referência internos.",
    data: null,
  };
}

export function createApiRouter(): Router {
  const router = express.Router();
  router.use(express.json());

  // Health check leve para orquestradores (Render, etc.): não toca fontes externas nem exige login.
  router.get("/healthz", (_req, res) => {
    res.json({ status: "ok" });
  });

  // Login por e-mail/senha (RBAC): rotas de sessão, sempre acessíveis sem estar autenticado.
  router.use(createAuthRouter());

  // Dali pra baixo, toda rota exige sessão válida (usuário ativo) — Visão Geral é a base
  // liberada pra qualquer autenticado; módulos abaixo somam a permissão específica.
  router.use(requireAuth);

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
      toSourceView("PNCP - Consulta Pública", pncp),
      fromIngestionRun("AWS Pricing API", ingestionRuns.AWS_PRICING_INGESTION),
      fromIngestionRun("GCP Cloud Billing Catalog", ingestionRuns.GCP_PRICING_INGESTION),
      {
        name: "Benchmark salarial",
        status: process.env.MARKET_BENCHMARK_CONNECTOR_URL ? "DEGRADED" : "FALLBACK_STALE",
        source: process.env.MARKET_BENCHMARK_CONNECTOR_URL ? "LIVE_CONNECTOR_READY" : "STATIC_SNAPSHOT",
        timestamp: new Date().toISOString(),
        warning: process.env.MARKET_BENCHMARK_CONNECTOR_URL
          ? "Conector externo configurado; usando dados de referência internos quando a fonte externa falha."
          : "Usando dados de referência internos (catálogo de perfis CLT e/ou PJ).",
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
      meta: {
        version: appVersion,
        // RENDER_GIT_COMMIT é injetada automaticamente pelo Render em runtime; local/outros hosts caem em "dev".
        commit: (process.env.RENDER_GIT_COMMIT ?? "dev").slice(0, 7),
        environment: process.env.APP_ENV ?? "Homologação",
      },
    });
  });

  router.get("/fx/ptax", async (_req, res) => {
    res.json(await getPtax());
  });

  router.use("/cloud", requirePermission("INFRA"));

  // Catálogo pesquisável de serviços (Compute, Storage, Database, Networking, Containers,
  // Serverless, CDN) por AWS/Azure/GCP. Compute tem as opções de SKU preenchidas ao vivo
  // (mesmo catálogo/preço do /system-health); os demais são catálogo estático com fonte explícita.
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
      res.status(400).json({ error: "region é obrigatório." });
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
      res.status(404).json({ error: err instanceof Error ? err.message : "Serviço não encontrado." });
    }
  });

  /** Valida e recalcula os serviços de uma arquitetura (usado por create e update). */
  async function buildArchitectureInput(body: Record<string, unknown>): Promise<{ error: string } | { input: ArchitectureInput }> {
    const { name, currency, services } = body;

    if (typeof name !== "string" || !name.trim()) return { error: "name é obrigatório." };
    if (currency !== "BRL" && currency !== "USD") return { error: "currency deve ser BRL ou USD." };
    if (!Array.isArray(services) || services.length === 0) return { error: "services deve ser uma lista com pelo menos 1 serviço." };

    const resolvedServices: ArchitectureServiceInput[] = [];
    for (const raw of services as Record<string, unknown>[]) {
      const { serviceId, region, config } = raw ?? {};
      if (typeof serviceId !== "string" || !serviceId.trim()) return { error: "Cada serviço precisa de 'serviceId'." };
      if (typeof region !== "string" || !region.trim()) return { error: "Cada serviço precisa de 'region'." };

      let pricing;
      try {
        pricing = await calculateServicePrice(serviceId, region, (config as Record<string, unknown>) ?? {});
      } catch (err) {
        return { error: err instanceof Error ? err.message : `Serviço '${serviceId}' inválido.` };
      }

      const definition = searchCloudServiceDefinitions({}).find((d) => d.id === serviceId);
      if (!definition) return { error: `Serviço '${serviceId}' não encontrado no catálogo.` };

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

  // Única coisa que o produto persiste: uma arquitetura de infra cloud (composição de N
  // serviços) salva com nome pelo usuário. Preço de cada serviço é recalculado no momento do
  // save/edição (não reaproveita um valor que o cliente possa ter enviado desatualizado).
  router.post("/cloud/architectures", async (req, res) => {
    if (!isDatabaseConfigured) {
      res.status(503).json({ error: "Banco não configurado; não é possível salvar arquiteturas agora." });
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
      res.status(404).json({ error: "Banco não configurado." });
      return;
    }
    const detail = await getArchitecture(req.params.id);
    if (!detail) {
      res.status(404).json({ error: "Arquitetura não encontrada." });
      return;
    }
    res.json({ architecture: toArchitectureDetailView(detail.architecture, detail.services) });
  });

  router.put("/cloud/architectures/:id", async (req, res) => {
    if (!isDatabaseConfigured) {
      res.status(503).json({ error: "Banco não configurado; não é possível editar arquiteturas agora." });
      return;
    }
    const existing = await getArchitecture(req.params.id);
    if (!existing) {
      res.status(404).json({ error: "Arquitetura não encontrada." });
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
      res.status(503).json({ error: "Banco não configurado." });
      return;
    }
    const existing = await getArchitecture(req.params.id);
    if (!existing) {
      res.status(404).json({ error: "Arquitetura não encontrada." });
      return;
    }
    await deleteArchitecture(req.params.id);
    res.status(204).send();
  });

  // Duplica com o snapshot já salvo (não recalcula preço): "duplicar" preserva exatamente o
  // que foi salvo, sem depender de preços ao vivo ainda estarem disponíveis no momento da cópia.
  router.post("/cloud/architectures/:id/duplicate", async (req, res) => {
    if (!isDatabaseConfigured) {
      res.status(503).json({ error: "Banco não configurado." });
      return;
    }
    const existing = await getArchitecture(req.params.id);
    if (!existing) {
      res.status(404).json({ error: "Arquitetura não encontrada." });
      return;
    }
    const { name } = (req.body ?? {}) as Record<string, unknown>;
    const newName = typeof name === "string" && name.trim() ? name.trim().slice(0, 120) : `${existing.architecture.name} (cópia)`;

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

  router.use("/labor", requirePermission("LABOR"));
  router.use("/market-benchmark", requirePermission("LABOR"));

  router.get("/labor/profiles", (_req, res) => {
    res.json({
      profiles: laborProfiles,
      source: {
        name: "CAGED / MTE",
        status: "FALLBACK_STALE",
        source: "STATIC_SNAPSHOT",
        timestamp: laborProfiles[0]?.updatedAt ?? new Date().toISOString(),
        warning: "Ingestão real do CAGED ainda pendente; perfis usam snapshot parametrizado de CBOs de tecnologia.",
        data: null,
      },
    });
  });

  router.post("/labor/estimate", (req, res) => {
    const { monthlySalary, factorK, marginPct, profileId } = (req.body ?? {}) as Record<string, unknown>;
    if (typeof monthlySalary !== "number" || typeof factorK !== "number" || typeof marginPct !== "number") {
      res.status(400).json({ error: "monthlySalary, factorK e marginPct são obrigatórios e devem ser numéricos." });
      return;
    }

    const profile = typeof profileId === "string" ? getLaborProfile(profileId) : undefined;
    res.json(computeLaborRate({ monthlySalary, factorK, marginPct, profile }));
  });

  router.post("/market-benchmark/search", async (req, res) => {
    const { role, state, city, notes } = (req.body ?? {}) as Record<string, unknown>;
    if (typeof role !== "string" || !role.trim()) {
      res.status(400).json({ error: "role é obrigatório." });
      return;
    }

    // toSourceView adiciona "name": sem isso, o parse() do schema no cliente falha sempre (campo
    // obrigatorio ausente) e a busca aparece como erro genérico mesmo quando o resultado (com
    // fallback estático) foi computado e salvo no histórico com sucesso.
    const result = await searchMarketBenchmark({
      role,
      state: typeof state === "string" ? state : undefined,
      city: typeof city === "string" ? city : undefined,
      notes: typeof notes === "string" ? notes : undefined,
    });
    res.json(toSourceView("Benchmark salarial", result));
  });

  router.get("/market-benchmark/history", async (_req, res) => {
    res.json({ entries: await getMarketBenchmarkHistory() });
  });

  router.use("/licenses", requirePermission("LICENSES"));

  router.get("/licenses/catalog", (_req, res) => {
    res.json({
      items: licenseCatalog,
      source: {
        name: "Catálogo de licenças",
        status: "FALLBACK_STALE",
        source: "STATIC_TABLE",
        timestamp: licenseCatalog[0]?.updatedAt ?? new Date().toISOString(),
        warning: "Catálogo baseado em páginas oficiais de preços; conectores comerciais por fornecedor ainda não foram configurados.",
        data: null,
      },
    });
  });

  // Área administrativa (CRUD de usuários) — só ADMIN (checado dentro do próprio router).
  router.use(createAdminUsersRouter());

  return router;
}
