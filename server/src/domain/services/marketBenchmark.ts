import { readCache, writeCache } from "../../infrastructure/cache/fileCache";
import { executeWithFallback, type ResilienceResult } from "../../infrastructure/resilience/resilienceManager";
import { laborProfiles, type LaborProfile } from "./catalogs";

export interface MarketBenchmarkInput {
  role: string;
  state?: string;
  city?: string;
  notes?: string;
}

export interface MarketBenchmarkSource {
  sourceName: string;
  sourceUrl: string | null;
  valueText: string;
  monthlyMin: number;
  monthlyMax: number;
  observation: string;
  confidence: "LOW" | "MEDIUM" | "HIGH";
}

export interface MarketBenchmarkResult {
  roleSearched: string;
  state: string;
  city: string;
  notes?: string;
  matchedProfile: LaborProfile;
  suggestedMonthlyCompensation: number;
  regionalMultiplier: number;
  sourceMode: "LIVE_CONNECTOR" | "STATIC_SNAPSHOT";
  results: MarketBenchmarkSource[];
  summary: string;
  generatedAt: string;
}

export interface MarketBenchmarkHistoryEntry extends MarketBenchmarkResult {
  id: string;
}

const HISTORY_CACHE_KEY = "market-benchmark-history";
const BENCHMARK_CACHE_VERSION = "v3";
const REQUEST_TIMEOUT_MS = 8_000;

const seniorityMultipliers: Array<{ pattern: RegExp; seniority: LaborProfile["seniority"]; multiplier: number }> = [
  { pattern: /junior|jr\b|júnior/i, seniority: "Junior", multiplier: 0.72 },
  { pattern: /pleno|mid/i, seniority: "Pleno", multiplier: 1 },
  { pattern: /senior|sr\b|sênior/i, seniority: "Senior", multiplier: 1.28 },
  { pattern: /especialista|lead|principal|arquiteto/i, seniority: "Especialista", multiplier: 1.45 },
];

const cityMultipliers: Record<string, number> = {
  "sao paulo": 1.08,
  "são paulo": 1.08,
  campinas: 1.04,
  "rio de janeiro": 1.03,
  brasilia: 1.02,
  "brasília": 1.02,
  curitiba: 0.98,
  recife: 0.92,
  "porto alegre": 0.97,
  remoto: 1,
};

const stateMultipliers: Record<string, number> = {
  AC: 0.86,
  AL: 0.88,
  AM: 0.91,
  AP: 0.87,
  BA: 0.92,
  CE: 0.91,
  DF: 1.04,
  ES: 0.95,
  GO: 0.94,
  MA: 0.86,
  MG: 0.98,
  MS: 0.92,
  MT: 0.93,
  PA: 0.9,
  PB: 0.88,
  PE: 0.93,
  PI: 0.86,
  PR: 0.99,
  RJ: 1.03,
  RN: 0.88,
  RO: 0.88,
  RR: 0.87,
  RS: 0.98,
  SC: 1,
  SE: 0.87,
  SP: 1.08,
  TO: 0.87,
};

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

function inferProfile(role: string): LaborProfile {
  const normalized = normalize(role);
  if (/dados|data|bi|analytics/.test(normalized)) return laborProfiles.find((profile) => profile.id === "dados-especialista-pj") ?? laborProfiles[0];
  if (/arquiteto|solution|solucao|solucoes/.test(normalized)) return laborProfiles.find((profile) => profile.id === "arquiteto-senior-pj") ?? laborProfiles[0];
  if (/analista|sistemas|business analyst|requisitos/.test(normalized)) return laborProfiles.find((profile) => profile.id === "analista-pleno-clt") ?? laborProfiles[0];
  if (/backend|api|java|node|full stack|frontend|desenvolvedor|developer|dev/.test(normalized)) return laborProfiles.find((profile) => profile.id === "dev-senior-pj") ?? laborProfiles[0];
  return laborProfiles.find((profile) => profile.id === "analista-pleno-clt") ?? laborProfiles[0];
}

function inferSeniority(role: string, profile: LaborProfile): { seniority: LaborProfile["seniority"]; multiplier: number } {
  const matched = seniorityMultipliers.find((entry) => entry.pattern.test(role));
  return matched ?? { seniority: profile.seniority, multiplier: 1 };
}

function inferCityMultiplier(city: string): number {
  const normalizedCity = normalize(city);
  return Object.entries(cityMultipliers).find(([key]) => normalize(key) === normalizedCity)?.[1] ?? 1;
}

function inferStateMultiplier(state: string | undefined): number {
  if (!state) return 1;
  return stateMultipliers[state.trim().toUpperCase()] ?? 1;
}

function buildStaticBenchmark(input: MarketBenchmarkInput): MarketBenchmarkResult {
  const city = input.city?.trim() || "Brasil";
  const state = input.state?.trim().toUpperCase() || "BR";
  const matchedProfile = inferProfile(input.role);
  const seniority = inferSeniority(input.role, matchedProfile);
  const regionalMultiplier = inferStateMultiplier(state) * inferCityMultiplier(city);
  const base = Math.round(matchedProfile.monthlyCompensation * seniority.multiplier * regionalMultiplier);

  const sources: MarketBenchmarkSource[] = [
    {
      sourceName: "Robert Half Brasil",
      sourceUrl: null,
      valueText: `${formatBRL(base * 0.92)} a ${formatBRL(base * 1.35)}/mes`,
      monthlyMin: Math.round(base * 0.92),
      monthlyMax: Math.round(base * 1.35),
      observation: "Snapshot parametrizado localmente; guia salarial ao vivo ainda nao conectado.",
      confidence: "MEDIUM",
    },
    {
      sourceName: "Michael Page Brasil",
      sourceUrl: null,
      valueText: `${formatBRL(base * 0.9)} a ${formatBRL(base * 1.32)}/mes`,
      monthlyMin: Math.round(base * 0.9),
      monthlyMax: Math.round(base * 1.32),
      observation: "Snapshot parametrizado localmente; estudo salarial Michael Page ainda nao consultado ao vivo.",
      confidence: "MEDIUM",
    },
    {
      sourceName: "Glassdoor Brasil",
      sourceUrl: null,
      valueText: `${formatBRL(base * 0.82)} a ${formatBRL(base * 1.18)}/mes`,
      monthlyMin: Math.round(base * 0.82),
      monthlyMax: Math.round(base * 1.18),
      observation: "Estimativa derivada do perfil CTC mais proximo; amostra publica nao consultada nesta execucao.",
      confidence: "LOW",
    },
    {
      sourceName: "Indeed Brasil",
      sourceUrl: null,
      valueText: `${formatBRL(base * 0.78)} a ${formatBRL(base * 1.1)}/mes`,
      monthlyMin: Math.round(base * 0.78),
      monthlyMax: Math.round(base * 1.1),
      observation: "Faixa de contingencia para orientar triagem; requer validacao antes de proposta.",
      confidence: "LOW",
    },
  ];

  const suggestedMonthlyCompensation = Math.round(
    sources.reduce((total, source) => total + (source.monthlyMin + source.monthlyMax) / 2, 0) / sources.length,
  );

  return {
    roleSearched: input.role.trim(),
    state,
    city,
    notes: input.notes?.trim() || undefined,
    matchedProfile: { ...matchedProfile, seniority: seniority.seniority },
    suggestedMonthlyCompensation,
    regionalMultiplier,
    sourceMode: "STATIC_SNAPSHOT",
    results: sources,
    summary: `Benchmark aproximado para ${input.role.trim()} em ${city}/${state}: ${formatBRL(suggestedMonthlyCompensation)}/mes como remuneracao de referencia. Ajuste regional aplicado: ${regionalMultiplier.toFixed(2)}x. Use como insumo de composicao; preco de venda ainda depende de Fator K, margem e impostos.`,
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

function readHistory(): MarketBenchmarkHistoryEntry[] {
  return readCache<MarketBenchmarkHistoryEntry[]>(HISTORY_CACHE_KEY)?.data ?? [];
}

function writeHistory(history: MarketBenchmarkHistoryEntry[]): void {
  writeCache(HISTORY_CACHE_KEY, history.slice(0, 50));
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
    const entry: MarketBenchmarkHistoryEntry = {
      ...result.data,
      id: `${Date.now()}-${slugify(role)}`,
    };
    writeHistory([entry, ...readHistory().filter((item) => item.roleSearched !== role || item.city !== entry.city || item.state !== entry.state)]);
  }

  return result;
}

export function getMarketBenchmarkHistory(): MarketBenchmarkHistoryEntry[] {
  return readHistory();
}
