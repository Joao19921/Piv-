const API_BASE = "/api/v1";

export type SourceStatus = "OPERATIONAL" | "DEGRADED" | "FALLBACK_STALE" | "OFFLINE";

export interface ApiSourceResult<T = unknown> {
  name: string;
  status: SourceStatus;
  source: string;
  timestamp: string;
  warning?: string;
  data: T | null;
}

export interface IngestionRun {
  serviceName: string;
  status: SourceStatus;
  recordsUpserted: number;
  durationMs: number;
  errorMessage: string | null;
  startedAt: string;
  finishedAt: string;
}

export interface QueryStat {
  name: string;
  count: number;
  errorCount: number;
  avgMs: number;
  maxMs: number;
  lastRanAt: string;
  lastError?: string;
}

export interface SystemHealthResponse {
  sources: ApiSourceResult[];
  ingestion: IngestionRun[];
  database: { configured: boolean; queries: QueryStat[] };
}

export async function fetchSystemHealth(): Promise<SystemHealthResponse> {
  const res = await fetch(`${API_BASE}/system-health`);
  if (!res.ok) throw new Error("Falha ao consultar o estado das fontes.");
  return res.json();
}

export interface CloudEstimateParams {
  provider: string;
  region: string;
  skuId: string;
  instances: number;
  hours: number;
  storageGb?: number;
}

export interface CloudRegion {
  key: string;
  provider: "AWS" | "Azure" | "GCP";
  label: string;
  providerRegion: string;
}

export interface CloudSku {
  id: string;
  provider: "AWS" | "Azure" | "GCP";
  family: "Burstable" | "General purpose" | "Compute optimized" | "Memory optimized";
  skuName: string;
  displayName: string;
  vcpu: number;
  memoryGiB: number;
  os: "Linux";
  pricingModel: "OnDemand";
  sourceName: string;
  sourceUrl: string;
  notes: string;
}

export interface CloudCatalogResponse {
  regions: CloudRegion[];
  skus: CloudSku[];
  source: ApiSourceResult<null>;
}

export interface CloudEstimateResponse {
  estimate: { computeUsd: number; storageUsd: number; monthlyUsd: number; monthlyBrl: number };
  sku: CloudSku;
  unitPrice: ApiSourceResult<{ pricePerHourUsd: number; skuName?: string; armRegion?: string; sourceUrl?: string }>;
  fx: ApiSourceResult<{ rate: number; quotedAt: string }>;
  storage: { volumeType: string; pricePerGbMonthUsd: number; status: SourceStatus; warning?: string } | null;
}

export async function fetchCloudCatalog(): Promise<CloudCatalogResponse> {
  const res = await fetch(`${API_BASE}/cloud/catalog`);
  if (!res.ok) throw new Error("Falha ao carregar catalogo de cloud.");
  return res.json();
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
  return res.json();
}

export interface LaborProfile {
  id: string;
  title: string;
  seniority: "Junior" | "Pleno" | "Senior" | "Especialista";
  cbo: string;
  employmentModel: "CLT" | "PJ";
  monthlyCompensation: number;
  factorK: number;
  benchmarkSource: string;
  sourceStatus: "FALLBACK_STALE";
  updatedAt: string;
}

export interface LaborProfilesResponse {
  profiles: LaborProfile[];
  source: ApiSourceResult<null>;
}

export async function fetchLaborProfiles(): Promise<LaborProfilesResponse> {
  const res = await fetch(`${API_BASE}/labor/profiles`);
  if (!res.ok) throw new Error("Falha ao carregar perfis de mao de obra.");
  return res.json();
}

export interface LaborEstimateParams {
  profileId?: string;
  monthlySalary: number;
  factorK: number;
  marginPct: number;
}

export interface LaborEstimateResponse {
  monthlyCost: number;
  hourlyCost: number;
  suggestedRate: number;
  billableHours: number;
  profile?: LaborProfile;
}

export async function fetchLaborEstimate(params: LaborEstimateParams): Promise<LaborEstimateResponse> {
  const res = await fetch(`${API_BASE}/labor/estimate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  if (!res.ok) throw new Error("Falha ao calcular taxa de mao de obra.");
  return res.json();
}

export interface MarketBenchmarkSalarySource {
  employmentModel: "CLT" | "PJ";
  profileId: string;
  profileTitle: string;
  seniority: LaborProfile["seniority"];
  monthlyCompensation: number;
  factorK: number;
  observation: string;
}

export interface MarketBenchmarkResult {
  roleSearched: string;
  state: string;
  city: string;
  notes?: string;
  sources: MarketBenchmarkSalarySource[];
  suggestedMonthlyCompensation: number;
  sourceMode: "LIVE_CONNECTOR" | "STATIC_SNAPSHOT";
  summary: string;
  generatedAt: string;
}

export interface MarketBenchmarkResponse extends ApiSourceResult<MarketBenchmarkResult> {}

export interface MarketBenchmarkHistoryEntry extends MarketBenchmarkResult {
  id: string;
}

export interface MarketBenchmarkHistoryResponse {
  entries: MarketBenchmarkHistoryEntry[];
}

export async function searchMarketBenchmark(params: { role: string; state: string; city: string; notes?: string }): Promise<MarketBenchmarkResponse> {
  const res = await fetch(`${API_BASE}/market-benchmark/search`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  if (!res.ok) throw new Error("Falha ao buscar benchmark de mercado.");
  return res.json();
}

export async function fetchMarketBenchmarkHistory(): Promise<MarketBenchmarkHistoryResponse> {
  const res = await fetch(`${API_BASE}/market-benchmark/history`);
  if (!res.ok) throw new Error("Falha ao carregar historico de benchmark.");
  return res.json();
}

export interface LicenseCatalogItem {
  id: string;
  vendor: string;
  product: string;
  plan: string;
  billingMetric: string;
  unitPriceUsd: number;
  minimumSeats: number;
  category: "DevOps" | "Produtividade" | "Observabilidade" | "Seguranca" | "Dados" | "Colaboracao" | "ITSM";
  billingCycle?: "monthly" | "annual-paid-monthly";
  sourceUrl?: string;
  source: string;
  sourceStatus: "FALLBACK_STALE";
  notes?: string;
  updatedAt: string;
}

export interface LicenseCatalogResponse {
  items: LicenseCatalogItem[];
  source: ApiSourceResult<null>;
}

export async function fetchLicenseCatalog(): Promise<LicenseCatalogResponse> {
  const res = await fetch(`${API_BASE}/licenses/catalog`);
  if (!res.ok) throw new Error("Falha ao carregar catalogo de licencas.");
  return res.json();
}
