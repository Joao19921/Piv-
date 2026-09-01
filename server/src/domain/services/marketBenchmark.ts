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

const roleCategories: Array<{ pattern: RegExp; profileIds: string[] }> = [
  { pattern: /dados|data|bi\b|analytics/i, profileIds: ["dados-especialista-pj"] },
  { pattern: /arquiteto|solution|solucao|solucoes/i, profileIds: ["arquiteto-senior-pj"] },
  { pattern: /analista|sistemas|business analyst|requisitos/i, profileIds: ["analista-pleno-clt"] },
  { pattern: /backend|api|java|node|full stack|frontend|desenvolvedor|developer|dev\b/i, profileIds: ["dev-pleno-clt", "dev-senior-pj"] },
];

const FALLBACK_PROFILE_IDS = ["analista-pleno-clt"];

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
