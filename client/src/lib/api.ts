import { z } from "zod";

const API_BASE = "/api/v1";

const sourceStatusSchema = z.enum(["OPERATIONAL", "DEGRADED", "FALLBACK_STALE", "OFFLINE"]);
export type SourceStatus = z.infer<typeof sourceStatusSchema>;

export interface ApiSourceResult<T = unknown> {
  name: string;
  status: SourceStatus;
  source: string;
  timestamp: string;
  warning?: string;
  data: T | null;
}

function apiSourceResultSchema<T extends z.ZodTypeAny>(dataSchema: T) {
  return z.object({
    name: z.string(),
    status: sourceStatusSchema,
    source: z.string(),
    timestamp: z.string(),
    warning: z.string().optional(),
    data: dataSchema.nullable(),
  });
}

const ingestionRunSchema = z.object({
  serviceName: z.string(),
  status: sourceStatusSchema,
  recordsUpserted: z.number(),
  durationMs: z.number(),
  errorMessage: z.string().nullable(),
  startedAt: z.string(),
  finishedAt: z.string(),
});
export type IngestionRun = z.infer<typeof ingestionRunSchema>;

const queryStatSchema = z.object({
  name: z.string(),
  count: z.number(),
  errorCount: z.number(),
  avgMs: z.number(),
  maxMs: z.number(),
  lastRanAt: z.string(),
  lastError: z.string().optional(),
});
export type QueryStat = z.infer<typeof queryStatSchema>;

const systemHealthResponseSchema = z.object({
  sources: z.array(apiSourceResultSchema(z.unknown())),
  ingestion: z.array(ingestionRunSchema),
  database: z.object({ configured: z.boolean(), queries: z.array(queryStatSchema) }),
});
export type SystemHealthResponse = z.infer<typeof systemHealthResponseSchema>;

export async function fetchSystemHealth(): Promise<SystemHealthResponse> {
  const res = await fetch(`${API_BASE}/system-health`);
  if (!res.ok) throw new Error("Falha ao consultar o estado das fontes.");
  return systemHealthResponseSchema.parse(await res.json());
}

export interface CloudEstimateParams {
  provider: string;
  region: string;
  skuId: string;
  instances: number;
  hours: number;
  storageGb?: number;
}

const cloudRegionSchema = z.object({
  key: z.string(),
  provider: z.enum(["AWS", "Azure", "GCP"]),
  label: z.string(),
  providerRegion: z.string(),
});
export type CloudRegion = z.infer<typeof cloudRegionSchema>;

const cloudSkuSchema = z.object({
  id: z.string(),
  provider: z.enum(["AWS", "Azure", "GCP"]),
  family: z.enum(["Burstable", "General purpose", "Compute optimized", "Memory optimized"]),
  skuName: z.string(),
  displayName: z.string(),
  vcpu: z.number(),
  memoryGiB: z.number(),
  os: z.literal("Linux"),
  pricingModel: z.literal("OnDemand"),
  azureArmSkuName: z.string().optional(),
  sourceName: z.string(),
  sourceUrl: z.string(),
  notes: z.string(),
});
export type CloudSku = z.infer<typeof cloudSkuSchema>;

const cloudCatalogResponseSchema = z.object({
  regions: z.array(cloudRegionSchema),
  skus: z.array(cloudSkuSchema),
  source: apiSourceResultSchema(z.null()),
});
export type CloudCatalogResponse = z.infer<typeof cloudCatalogResponseSchema>;

const cloudEstimateResponseSchema = z.object({
  estimate: z.object({ computeUsd: z.number(), storageUsd: z.number(), monthlyUsd: z.number(), monthlyBrl: z.number() }),
  sku: cloudSkuSchema,
  unitPrice: apiSourceResultSchema(
    z.object({ pricePerHourUsd: z.number(), skuName: z.string().optional(), armRegion: z.string().optional(), sourceUrl: z.string().optional() }),
  ),
  fx: apiSourceResultSchema(z.object({ rate: z.number(), quotedAt: z.string() })),
  storage: z
    .object({ volumeType: z.string(), pricePerGbMonthUsd: z.number(), status: sourceStatusSchema, warning: z.string().optional() })
    .nullable(),
});
export type CloudEstimateResponse = z.infer<typeof cloudEstimateResponseSchema>;

export async function fetchCloudCatalog(): Promise<CloudCatalogResponse> {
  const res = await fetch(`${API_BASE}/cloud/catalog`);
  if (!res.ok) throw new Error("Falha ao carregar catalogo de cloud.");
  return cloudCatalogResponseSchema.parse(await res.json());
}

export async function fetchCloudEstimate(params: CloudEstimateParams): Promise<CloudEstimateResponse> {
  const qs = new URLSearchParams({
    provider: params.provider,
    region: params.region,
    skuId: params.skuId,
    instances: String(params.instances),
    hours: String(params.hours),
    storageGb: String(params.storageGb ?? 0),
  });
  const res = await fetch(`${API_BASE}/cloud/estimate?${qs.toString()}`);
  if (!res.ok) throw new Error("Falha ao estimar o custo de infraestrutura.");
  return cloudEstimateResponseSchema.parse(await res.json());
}

const laborProfileSchema = z.object({
  id: z.string(),
  title: z.string(),
  seniority: z.enum(["Junior", "Pleno", "Senior", "Especialista"]),
  cbo: z.string(),
  employmentModel: z.enum(["CLT", "PJ"]),
  monthlyCompensation: z.number(),
  factorK: z.number(),
  benchmarkSource: z.string(),
  sourceStatus: z.literal("FALLBACK_STALE"),
  updatedAt: z.string(),
});
export type LaborProfile = z.infer<typeof laborProfileSchema>;

const laborProfilesResponseSchema = z.object({
  profiles: z.array(laborProfileSchema),
  source: apiSourceResultSchema(z.null()),
});
export type LaborProfilesResponse = z.infer<typeof laborProfilesResponseSchema>;

export async function fetchLaborProfiles(): Promise<LaborProfilesResponse> {
  const res = await fetch(`${API_BASE}/labor/profiles`);
  if (!res.ok) throw new Error("Falha ao carregar perfis de mao de obra.");
  return laborProfilesResponseSchema.parse(await res.json());
}

export interface LaborEstimateParams {
  profileId?: string;
  monthlySalary: number;
  factorK: number;
  marginPct: number;
}

const laborEstimateResponseSchema = z.object({
  monthlyCost: z.number(),
  hourlyCost: z.number(),
  suggestedRate: z.number(),
  billableHours: z.number(),
  profile: laborProfileSchema.optional(),
});
export type LaborEstimateResponse = z.infer<typeof laborEstimateResponseSchema>;

export async function fetchLaborEstimate(params: LaborEstimateParams): Promise<LaborEstimateResponse> {
  const res = await fetch(`${API_BASE}/labor/estimate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  if (!res.ok) throw new Error("Falha ao calcular taxa de mao de obra.");
  return laborEstimateResponseSchema.parse(await res.json());
}

const marketBenchmarkSalarySourceSchema = z.object({
  employmentModel: z.enum(["CLT", "PJ"]),
  profileId: z.string(),
  profileTitle: z.string(),
  seniority: laborProfileSchema.shape.seniority,
  monthlyCompensation: z.number(),
  factorK: z.number(),
  observation: z.string(),
});
export type MarketBenchmarkSalarySource = z.infer<typeof marketBenchmarkSalarySourceSchema>;

const marketBenchmarkResultSchema = z.object({
  roleSearched: z.string(),
  state: z.string(),
  city: z.string(),
  notes: z.string().optional(),
  sources: z.array(marketBenchmarkSalarySourceSchema),
  suggestedMonthlyCompensation: z.number(),
  sourceMode: z.enum(["LIVE_CONNECTOR", "STATIC_SNAPSHOT"]),
  summary: z.string(),
  generatedAt: z.string(),
});
export type MarketBenchmarkResult = z.infer<typeof marketBenchmarkResultSchema>;

const marketBenchmarkResponseSchema = apiSourceResultSchema(marketBenchmarkResultSchema);
export type MarketBenchmarkResponse = z.infer<typeof marketBenchmarkResponseSchema>;

const marketBenchmarkHistoryEntrySchema = marketBenchmarkResultSchema.extend({ id: z.string() });
export type MarketBenchmarkHistoryEntry = z.infer<typeof marketBenchmarkHistoryEntrySchema>;

const marketBenchmarkHistoryResponseSchema = z.object({ entries: z.array(marketBenchmarkHistoryEntrySchema) });
export type MarketBenchmarkHistoryResponse = z.infer<typeof marketBenchmarkHistoryResponseSchema>;

export async function searchMarketBenchmark(params: { role: string; state: string; city: string; notes?: string }): Promise<MarketBenchmarkResponse> {
  const res = await fetch(`${API_BASE}/market-benchmark/search`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  if (!res.ok) throw new Error("Falha ao buscar benchmark de mercado.");
  return marketBenchmarkResponseSchema.parse(await res.json());
}

export async function fetchMarketBenchmarkHistory(): Promise<MarketBenchmarkHistoryResponse> {
  const res = await fetch(`${API_BASE}/market-benchmark/history`);
  if (!res.ok) throw new Error("Falha ao carregar historico de benchmark.");
  return marketBenchmarkHistoryResponseSchema.parse(await res.json());
}

const licenseCatalogItemSchema = z.object({
  id: z.string(),
  vendor: z.string(),
  product: z.string(),
  plan: z.string(),
  billingMetric: z.string(),
  unitPriceUsd: z.number(),
  minimumSeats: z.number(),
  category: z.enum(["DevOps", "Produtividade", "Observabilidade", "Seguranca", "Dados", "Colaboracao", "ITSM"]),
  billingCycle: z.enum(["monthly", "annual-paid-monthly"]).optional(),
  sourceUrl: z.string().optional(),
  source: z.string(),
  sourceStatus: z.literal("FALLBACK_STALE"),
  notes: z.string().optional(),
  updatedAt: z.string(),
});
export type LicenseCatalogItem = z.infer<typeof licenseCatalogItemSchema>;

const licenseCatalogResponseSchema = z.object({
  items: z.array(licenseCatalogItemSchema),
  source: apiSourceResultSchema(z.null()),
});
export type LicenseCatalogResponse = z.infer<typeof licenseCatalogResponseSchema>;

export async function fetchLicenseCatalog(): Promise<LicenseCatalogResponse> {
  const res = await fetch(`${API_BASE}/licenses/catalog`);
  if (!res.ok) throw new Error("Falha ao carregar catalogo de licencas.");
  return licenseCatalogResponseSchema.parse(await res.json());
}
