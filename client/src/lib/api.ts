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
    // .default(null): algumas rotas (snapshot estático sem payload de dado real, ex. labor/profiles,
    // licenses/catalog) nunca incluem a chave "data" no JSON. nullable() sozinho só aceita null
    // explícito, não chave ausente (undefined) — já causou parse() falhar em produção com esses
    // dois endpoints. default(null) trata ausente e null da mesma forma, sem afetar quem já envia null.
    data: dataSchema.nullable().default(null),
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
  meta: z.object({ version: z.string(), commit: z.string(), environment: z.string() }).optional(),
});
export type SystemHealthResponse = z.infer<typeof systemHealthResponseSchema>;

export async function fetchSystemHealth(): Promise<SystemHealthResponse> {
  const res = await fetch(`${API_BASE}/system-health`);
  if (!res.ok) throw new Error("Falha ao consultar o estado das fontes.");
  return systemHealthResponseSchema.parse(await res.json());
}

export const cloudProviderSchema = z.enum(["AWS", "Azure", "GCP"]);
export type CloudProvider = z.infer<typeof cloudProviderSchema>;

export const serviceCategorySchema = z.enum(["Compute", "Storage", "Database", "Networking", "Containers", "Serverless", "CDN"]);
export type ServiceCategory = z.infer<typeof serviceCategorySchema>;

const cloudRegionSchema = z.object({
  key: z.string(),
  provider: cloudProviderSchema,
  label: z.string(),
  providerRegion: z.string(),
});
export type CloudRegion = z.infer<typeof cloudRegionSchema>;

const configFieldOptionSchema = z.object({ value: z.string(), label: z.string() });
const configFieldSchema = z.object({
  key: z.string(),
  label: z.string(),
  type: z.enum(["select", "number", "toggle"]),
  unit: z.string().optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  step: z.number().optional(),
  default: z.union([z.string(), z.number(), z.boolean()]),
  options: z.array(configFieldOptionSchema).optional(),
});
export type CloudServiceConfigField = z.infer<typeof configFieldSchema>;

const pricingSourceInfoSchema = z.object({
  source: z.enum(["catalog", "live_api"]),
  estimated: z.boolean(),
  lastUpdated: z.string(),
  sourceUrl: z.string(),
  note: z.string().optional(),
});
export type PricingSourceInfo = z.infer<typeof pricingSourceInfoSchema>;

const cloudServiceSchema = z.object({
  id: z.string(),
  provider: cloudProviderSchema,
  category: serviceCategorySchema,
  name: z.string(),
  description: z.string(),
  pricingInfo: pricingSourceInfoSchema,
  configFields: z.array(configFieldSchema),
  regions: z.array(cloudRegionSchema),
});
export type CloudService = z.infer<typeof cloudServiceSchema>;

const cloudServicesResponseSchema = z.object({ services: z.array(cloudServiceSchema) });
export type CloudServicesResponse = z.infer<typeof cloudServicesResponseSchema>;

export async function fetchCloudServices(params: { q?: string; provider?: CloudProvider; category?: ServiceCategory } = {}): Promise<CloudServicesResponse> {
  const qs = new URLSearchParams();
  if (params.q) qs.set("q", params.q);
  if (params.provider) qs.set("provider", params.provider);
  if (params.category) qs.set("category", params.category);
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  const res = await fetch(`${API_BASE}/cloud/services${suffix}`);
  if (!res.ok) throw new Error("Falha ao carregar catálogo de serviços.");
  return cloudServicesResponseSchema.parse(await res.json());
}

const servicePricingSchema = z.object({
  monthlyUsd: z.number(),
  monthlyBrl: z.number(),
  fxRate: z.number(),
  source: z.enum(["catalog", "live_api", "scheduled_ingestion"]),
  estimated: z.boolean(),
  lastUpdated: z.string(),
  sourceUrl: z.string(),
  note: z.string().optional(),
  warning: z.string().optional(),
});
export type ServicePricing = z.infer<typeof servicePricingSchema>;

async function parseErrorOrThrow(res: Response, fallback: string): Promise<never> {
  const body = (await res.json().catch(() => null)) as { error?: string } | null;
  throw new Error(body?.error ?? fallback);
}

export async function priceCloudService(serviceId: string, params: { region: string; config: Record<string, unknown> }): Promise<ServicePricing> {
  const res = await fetch(`${API_BASE}/cloud/services/${encodeURIComponent(serviceId)}/price`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  if (!res.ok) await parseErrorOrThrow(res, "Falha ao calcular o preço do serviço.");
  return z.object({ pricing: servicePricingSchema }).parse(await res.json()).pricing;
}

/** Uma fonte que sustentou o valor de um perfil: amostra (CAGED) ou tabela publicada (SISP). */
const observedSalarySchema = z.object({
  source: z.enum(["CAGED", "SISP"]),
  sourceUrl: z.string(),
  competencia: z.string(),
  uf: z.string().nullable(),
  /** null em fonte publicada, que divulga o valor sem expor a amostra. */
  nAmostra: z.number().nullable(),
  /** Qual ponto da distribuição sustentou o valor, dada a senioridade do perfil. */
  percentilAplicado: z.enum(["p25", "mediana", "p75"]).nullable(),
  p25: z.number().nullable(),
  mediana: z.number(),
  p75: z.number().nullable(),
});
export type ObservedSalary = z.infer<typeof observedSalarySchema>;

const laborProfileSchema = z.object({
  id: z.string(),
  title: z.string(),
  seniority: z.enum(["Júnior", "Pleno", "Sênior", "Especialista"]),
  // nullable: a CBO 2002 é de 2002 e não tem ocupação para Cientista de Dados, Engenheiro de IA,
  // UX/UI nem Scrum Master. Esses perfis vêm com null em vez de um código inventado.
  cbo: z.string().nullable(),
  employmentModel: z.enum(["CLT", "PJ"]),
  monthlyCompensation: z.number(),
  factorK: z.number(),
  benchmarkSource: z.string(),
  // Deixou de ser sempre FALLBACK_STALE: perfis cobertos pelo CAGED vêm OPERATIONAL. Manter o
  // literal aqui quebrava o parse e derrubava a tela inteira de Mão de obra.
  sourceStatus: z.enum(["OPERATIONAL", "FALLBACK_STALE"]),
  updatedAt: z.string(),
  /** Fonte de mercado (CAGED) que sustentou o valor, quando houver. */
  observed: observedSalarySchema.optional(),
  /** Referência oficial (Portaria SGD/MGI) para o mesmo perfil. Não substitui o valor de
   * mercado: aparece ao lado dele, e a divergência entre os dois costuma ser o argumento. */
  referenciaOficial: observedSalarySchema.optional(),
});
export type LaborProfile = z.infer<typeof laborProfileSchema>;

/** Exportado para o teste de contrato em server/tests/laborProfilesContract.test.ts, que valida
 * a resposta REAL do servidor contra este schema -- foi a divergencia silenciosa entre os dois
 * que derrubou a tela quando `cbo` virou nullable e `sourceStatus` deixou de ser literal. */
export const laborProfilesResponseSchema = z.object({
  profiles: z.array(laborProfileSchema),
  /** Quantos perfis têm dado observado, para a tela dizer a cobertura real em vez de um rótulo fixo. */
  coverage: z
    .object({
      total: z.number(),
      comDadoReal: z.number(),
      competencia: z.string().nullable(),
    })
    .optional(),
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
  costsAndChargesPct: number;
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
  hasDirectMatch: z.boolean().optional(),
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
  if (!res.ok) await parseErrorOrThrow(res, "Falha ao buscar benchmark de mercado.");
  return marketBenchmarkResponseSchema.parse(await res.json());
}

export async function fetchMarketBenchmarkHistory(): Promise<MarketBenchmarkHistoryResponse> {
  const res = await fetch(`${API_BASE}/market-benchmark/history`);
  if (!res.ok) throw new Error("Falha ao carregar histórico de benchmark.");
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
  category: z.enum(["DevOps", "Produtividade", "Observabilidade", "Segurança", "Dados", "Colaboração", "ITSM"]),
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
  if (!res.ok) throw new Error("Falha ao carregar catálogo de licenças.");
  return licenseCatalogResponseSchema.parse(await res.json());
}

const architectureServiceSchema = z.object({
  id: z.string(),
  serviceId: z.string(),
  provider: cloudProviderSchema,
  category: z.string(),
  name: z.string(),
  region: z.string(),
  configuration: z.record(z.string(), z.unknown()),
  monthlyUsd: z.number(),
  monthlyBrl: z.number(),
});
export type ArchitectureService = z.infer<typeof architectureServiceSchema>;

const architectureDetailSchema = z.object({
  id: z.string(),
  name: z.string(),
  provider: cloudProviderSchema,
  region: z.string(),
  currency: z.enum(["BRL", "USD"]),
  monthlyUsd: z.number(),
  monthlyBrl: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
  services: z.array(architectureServiceSchema),
});
export type ArchitectureDetail = z.infer<typeof architectureDetailSchema>;

const architectureSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  provider: cloudProviderSchema,
  region: z.string(),
  currency: z.enum(["BRL", "USD"]),
  monthlyUsd: z.number(),
  monthlyBrl: z.number(),
  serviceCount: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ArchitectureSummary = z.infer<typeof architectureSummarySchema>;

export interface DraftArchitectureService {
  serviceId: string;
  region: string;
  config: Record<string, unknown>;
}

export interface SaveArchitectureParams {
  name: string;
  currency: "BRL" | "USD";
  services: DraftArchitectureService[];
}

const architectureDetailResponseSchema = z.object({ architecture: architectureDetailSchema });
const architectureListResponseSchema = z.object({ architectures: z.array(architectureSummarySchema) });
export type ArchitectureListResponse = z.infer<typeof architectureListResponseSchema>;

export async function createArchitecture(params: SaveArchitectureParams): Promise<ArchitectureDetail> {
  const res = await fetch(`${API_BASE}/cloud/architectures`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  if (!res.ok) await parseErrorOrThrow(res, "Falha ao salvar a arquitetura.");
  return architectureDetailResponseSchema.parse(await res.json()).architecture;
}

export async function updateArchitecture(id: string, params: SaveArchitectureParams): Promise<ArchitectureDetail> {
  const res = await fetch(`${API_BASE}/cloud/architectures/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  if (!res.ok) await parseErrorOrThrow(res, "Falha ao atualizar a arquitetura.");
  return architectureDetailResponseSchema.parse(await res.json()).architecture;
}

export async function fetchArchitectures(): Promise<ArchitectureListResponse> {
  const res = await fetch(`${API_BASE}/cloud/architectures`);
  if (!res.ok) throw new Error("Falha ao carregar arquiteturas salvas.");
  return architectureListResponseSchema.parse(await res.json());
}

export async function fetchArchitecture(id: string): Promise<ArchitectureDetail> {
  const res = await fetch(`${API_BASE}/cloud/architectures/${encodeURIComponent(id)}`);
  if (!res.ok) throw new Error("Falha ao carregar a arquitetura.");
  return architectureDetailResponseSchema.parse(await res.json()).architecture;
}

export async function deleteArchitectureRequest(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/cloud/architectures/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!res.ok) await parseErrorOrThrow(res, "Falha ao excluir a arquitetura.");
}

export async function duplicateArchitectureRequest(id: string, name?: string): Promise<ArchitectureDetail> {
  const res = await fetch(`${API_BASE}/cloud/architectures/${encodeURIComponent(id)}/duplicate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) await parseErrorOrThrow(res, "Falha ao duplicar a arquitetura.");
  return architectureDetailResponseSchema.parse(await res.json()).architecture;
}

// --- Administração de usuários (RBAC) ---------------------------------------------------

const permissionCodeSchema = z.enum(["LABOR", "INFRA", "LICENSES"]);
export type PermissionCode = z.infer<typeof permissionCodeSchema>;

const userSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  role: z.enum(["ADMIN", "USER"]),
  status: z.enum(["ACTIVE", "INACTIVE"]),
  mustChangePassword: z.boolean(),
  permissions: z.array(permissionCodeSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
  lastLoginAt: z.string().nullable(),
});
export type ManagedUser = z.infer<typeof userSchema>;

const usersResponseSchema = z.object({ users: z.array(userSchema) });

const createUserResponseSchema = z.object({ email: z.string(), initialPassword: z.string(), userId: z.string() });
export type CreateUserResponse = z.infer<typeof createUserResponseSchema>;

export interface SaveUserParams {
  name: string;
  email: string;
  role: "ADMIN" | "USER";
  status: "ACTIVE" | "INACTIVE";
  permissions: PermissionCode[];
}

export async function fetchUsers(): Promise<ManagedUser[]> {
  const res = await fetch(`${API_BASE}/admin/users`);
  if (!res.ok) await parseErrorOrThrow(res, "Falha ao carregar usuários.");
  return usersResponseSchema.parse(await res.json()).users;
}

export async function createUser(params: SaveUserParams & { password: string; confirmPassword: string }): Promise<CreateUserResponse> {
  const res = await fetch(`${API_BASE}/admin/users`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  if (!res.ok) await parseErrorOrThrow(res, "Falha ao criar usuário.");
  return createUserResponseSchema.parse(await res.json());
}

export async function updateUserRequest(id: string, params: SaveUserParams): Promise<void> {
  const res = await fetch(`${API_BASE}/admin/users/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  if (!res.ok) await parseErrorOrThrow(res, "Falha ao atualizar usuário.");
}

export async function activateUserRequest(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/admin/users/${encodeURIComponent(id)}/activate`, { method: "POST" });
  if (!res.ok) await parseErrorOrThrow(res, "Falha ao ativar usuário.");
}

export async function deactivateUserRequest(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/admin/users/${encodeURIComponent(id)}/deactivate`, { method: "POST" });
  if (!res.ok) await parseErrorOrThrow(res, "Falha ao desativar usuário.");
}
