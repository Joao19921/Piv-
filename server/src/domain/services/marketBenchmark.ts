import { readCache, writeCache } from "../../infrastructure/cache/fileCache";
import { isDatabaseConfigured } from "../../infrastructure/db/client";
import { logger } from "../../infrastructure/observability/logger";
import { insertBenchmarkSearch, listRecentBenchmarkSearches } from "../../infrastructure/repositories/marketBenchmarkRepository";
import { executeWithFallback, type ResilienceResult } from "../../infrastructure/resilience/resilienceManager";
import { laborProfiles, type LaborProfile } from "./catalogs";

export interface MarketBenchmarkInput {
  role: string;
  state?: string;
  city?: string;
  notes?: string;
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

export interface MarketBenchmarkHistoryEntry extends MarketBenchmarkResult {
  id: string;
}

const HISTORY_CACHE_KEY = "market-benchmark-history";
const BENCHMARK_CACHE_VERSION = "v4";
const REQUEST_TIMEOUT_MS = 8_000;

/**
 * Ordem importa: matchProfilesForRole usa a primeira categoria cuja regex casar, entao os
 * padroes mais especificos (ex.: "gerente de suporte") ficam antes dos genericos (ex.: "suporte").
 * Os perfis "sgd-*" vem das tabelas oficiais de referencia salarial SISP/MGI (Portarias
 * SGD/MGI no 6.055/2025 e no 4.777/2026); os demais sao o catalogo interno pre-existente.
 */
const roleCategories: Array<{ pattern: RegExp; profileIds: string[] }> = [
  { pattern: /gerente.*suporte|suporte.*gerente/i, profileIds: ["sgd-gersup"] },
  { pattern: /gerente.*infraestrutura/i, profileIds: ["sgd-gerinf"] },
  { pattern: /gerente.*seguranca|ciso\b/i, profileIds: ["sgd-gerseg"] },
  { pattern: /gerente.*projetos?|project manager|\bpmo\b/i, profileIds: ["sgd-gerpro"] },
  { pattern: /manutencao.*equipamentos|tecnico.*hardware/i, profileIds: ["sgd-tecman-01", "sgd-tecman-02", "sgd-tecman-03"] },
  { pattern: /tecnico.*rede|rede.*telecom|telecomunicacoes/i, profileIds: ["sgd-tecred-01", "sgd-tecred-02", "sgd-tecred-03"] },
  { pattern: /helpdesk|help desk|tecnico.*suporte|suporte.*usuario/i, profileIds: ["sgd-tecsup-01", "sgd-tecsup-02", "sgd-tecsup-03"] },
  { pattern: /suporte computacional/i, profileIds: ["sgd-asupcomp-01", "sgd-asupcomp-02", "sgd-asupcomp-03"] },
  { pattern: /administrador.*banco de dados|\bdba\b/i, profileIds: ["sgd-abd-01", "sgd-abd-02", "sgd-abd-03"] },
  { pattern: /administrador.*sistemas operacionais|sysadmin/i, profileIds: ["sgd-aso-01", "sgd-aso-02", "sgd-aso-03"] },
  { pattern: /analista.*rede|comunicacao de dados/i, profileIds: ["sgd-ared-01", "sgd-ared-02", "sgd-ared-03"] },
  { pattern: /especialista.*cloud|cloud engineer|cloud architect/i, profileIds: ["sgd-cloud-01", "sgd-cloud-02"] },
  { pattern: /arquiteto.*software|software architect/i, profileIds: ["sgd-arqsof-01", "sgd-arqsof-02"] },
  { pattern: /arquiteto.*dados|data architect/i, profileIds: ["sgd-arqdados-01", "sgd-arqdados-02", "sgd-arqdados-03"] },
  { pattern: /cientista.*dados|data scientist/i, profileIds: ["sgd-cdados-01", "sgd-cdados-02", "sgd-cdados-03"] },
  { pattern: /engenheiro.*ia\b|machine learning|inteligencia artificial|\bml engineer\b/i, profileIds: ["sgd-ia-eng-01", "sgd-ia-eng-02", "sgd-ia-eng-03"] },
  { pattern: /administrador.*dados/i, profileIds: ["sgd-adados-02", "sgd-adados-03"] },
  { pattern: /analista.*bi\b|business intelligence/i, profileIds: ["sgd-abi-01", "sgd-abi-02", "sgd-abi-03"] },
  { pattern: /analista.*metricas|metrics analyst/i, profileIds: ["sgd-metrica-01", "sgd-metrica-02", "sgd-metrica-03"] },
  { pattern: /teste|qualidade|\bqa\b|quality assurance/i, profileIds: ["sgd-atq-01", "sgd-atq-02", "sgd-atq-03"] },
  { pattern: /negocios|requisitos|business analyst/i, profileIds: ["sgd-anr-01", "sgd-anr-02", "sgd-anr-03"] },
  { pattern: /seguranca.*informacao|security analyst|infosec|cyber/i, profileIds: ["sgd-aseg-01", "sgd-aseg-02", "sgd-aseg-03"] },
  { pattern: /lider.*desenvolvimento|tech lead/i, profileIds: ["sgd-ldesenv"] },
  { pattern: /scrum/i, profileIds: ["sgd-scrum"] },
  { pattern: /ux\/?ui|user experience|product designer/i, profileIds: ["sgd-auxui-01", "sgd-auxui-02"] },
  {
    pattern: /backend|api|java|node|full stack|frontend|desenvolvedor|developer|dev\b/i,
    profileIds: ["dev-pleno-clt", "dev-senior-pj", "sgd-desenv-01", "sgd-desenv-02", "sgd-desenv-03", "sgd-destec-01", "sgd-destec-02", "sgd-destec-03"],
  },
  { pattern: /dados|data|bi\b|analytics/i, profileIds: ["dados-especialista-pj"] },
  { pattern: /arquiteto|solution|solucao|solucoes/i, profileIds: ["arquiteto-senior-pj"] },
  { pattern: /analista|sistemas|business analyst|requisitos/i, profileIds: ["analista-pleno-clt"] },
];

const FALLBACK_PROFILE_IDS = ["analista-pleno-clt", "sgd-asupcomp-02"];

function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function slugify(text: string): string {
  return normalize(text).replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "benchmark";
}

function formatBRL(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0,
  }).format(value);
}

function matchProfilesForRole(role: string): LaborProfile[] {
  const normalized = normalize(role);
  const category = roleCategories.find((entry) => entry.pattern.test(normalized));
  const ids = category?.profileIds ?? FALLBACK_PROFILE_IDS;
  return ids
    .map((id) => laborProfiles.find((profile) => profile.id === id))
    .filter((profile): profile is LaborProfile => Boolean(profile));
}

function buildStaticBenchmark(input: MarketBenchmarkInput): MarketBenchmarkResult {
  const city = input.city?.trim() || "Brasil";
  const state = input.state?.trim().toUpperCase() || "BR";
  const matchedProfiles = matchProfilesForRole(input.role);

  const sources: MarketBenchmarkSalarySource[] = matchedProfiles.map((profile) => ({
    employmentModel: profile.employmentModel,
    profileId: profile.id,
    profileTitle: profile.title,
    seniority: profile.seniority,
    monthlyCompensation: profile.monthlyCompensation,
    factorK: profile.factorK,
    observation: `Valor bruto do catalogo interno (${profile.benchmarkSource}), sem margem, imposto ou ajuste regional aplicado nesta V1.`,
  }));

  const suggestedMonthlyCompensation = sources.length
    ? Math.round(sources.reduce((total, source) => total + source.monthlyCompensation, 0) / sources.length)
    : 0;

  const summarySources = sources.length
    ? sources.map((source) => `${source.employmentModel} ${formatBRL(source.monthlyCompensation)}`).join(" e ")
    : "nenhum perfil do catalogo correspondente";

  return {
    roleSearched: input.role.trim(),
    state,
    city,
    notes: input.notes?.trim() || undefined,
    sources,
    suggestedMonthlyCompensation,
    sourceMode: "STATIC_SNAPSHOT",
    summary: `Referencia para ${input.role.trim()} em ${city}/${state}: ${summarySources}. Valores brutos do catalogo interno de perfis (salario CLT e/ou PJ), sem margem, imposto ou ajuste regional aplicado nesta V1.`,
    generatedAt: new Date().toISOString(),
  };
}

async function fetchLiveBenchmark(input: MarketBenchmarkInput): Promise<MarketBenchmarkResult> {
  const endpoint = process.env.MARKET_BENCHMARK_CONNECTOR_URL;
  if (!endpoint) {
    throw new Error("MARKET_BENCHMARK_CONNECTOR_URL nao configurado");
  }

  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!res.ok) {
    throw new Error(`Conector de benchmark respondeu HTTP ${res.status}`);
  }

  const data = (await res.json()) as MarketBenchmarkResult;
  return { ...data, sourceMode: "LIVE_CONNECTOR", generatedAt: data.generatedAt ?? new Date().toISOString() };
}

async function readHistory(): Promise<MarketBenchmarkHistoryEntry[]> {
  if (isDatabaseConfigured) {
    try {
      return await listRecentBenchmarkSearches();
    } catch (err) {
      logger.error("Falha ao ler historico de benchmark do Postgres; usando cache em arquivo", { error: err instanceof Error ? err.message : String(err) });
    }
  }
  return readCache<MarketBenchmarkHistoryEntry[]>(HISTORY_CACHE_KEY)?.data ?? [];
}

/** Persiste a busca (Postgres quando configurado; cache em arquivo como fallback) e devolve a entrada com id. */
async function saveHistoryEntry(result: MarketBenchmarkResult): Promise<MarketBenchmarkHistoryEntry> {
  if (isDatabaseConfigured) {
    try {
      const id = await insertBenchmarkSearch(result);
      return { ...result, id };
    } catch (err) {
      logger.error("Falha ao gravar historico de benchmark no Postgres; usando cache em arquivo", { error: err instanceof Error ? err.message : String(err) });
    }
  }
  const entry: MarketBenchmarkHistoryEntry = { ...result, id: `${Date.now()}-${slugify(result.roleSearched)}` };
  const existing = readCache<MarketBenchmarkHistoryEntry[]>(HISTORY_CACHE_KEY)?.data ?? [];
  writeCache(
    HISTORY_CACHE_KEY,
    [entry, ...existing.filter((item) => item.roleSearched !== entry.roleSearched || item.city !== entry.city || item.state !== entry.state)].slice(0, 50),
  );
  return entry;
}

export async function searchMarketBenchmark(input: MarketBenchmarkInput): Promise<ResilienceResult<MarketBenchmarkResult>> {
  const role = input.role.trim();
  if (!role) {
    return {
      status: "OFFLINE",
      source: "NONE",
      timestamp: new Date().toISOString(),
      warning: "Cargo/perfil e obrigatorio para buscar benchmark.",
      data: null,
    };
  }

  const cacheKey = `market-benchmark-${BENCHMARK_CACHE_VERSION}-${slugify(`${role}-${input.state ?? "BR"}-${input.city ?? "brasil"}-${input.notes ?? ""}`)}`;
  const result = await executeWithFallback<MarketBenchmarkResult>({
    serviceName: "MARKET_BENCHMARK",
    primary: async () => {
      const liveResult = await fetchLiveBenchmark({ role, state: input.state, city: input.city, notes: input.notes });
      writeCache(cacheKey, liveResult);
      return liveResult;
    },
    fallback: async () => {
      const cached = readCache<MarketBenchmarkResult>(cacheKey);
      if (cached) return cached;
      const staticResult = buildStaticBenchmark({ role, state: input.state, city: input.city, notes: input.notes });
      writeCache(cacheKey, staticResult);
      return { data: staticResult, updatedAt: staticResult.generatedAt };
    },
  });

  if (result.data) {
    await saveHistoryEntry(result.data);
  }

  return result;
}

export async function getMarketBenchmarkHistory(): Promise<MarketBenchmarkHistoryEntry[]> {
  return readHistory();
}
