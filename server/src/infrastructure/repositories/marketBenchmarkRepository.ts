import { query } from "../db/client";
import type { MarketBenchmarkHistoryEntry, MarketBenchmarkResult, MarketBenchmarkSalarySource } from "../../domain/services/marketBenchmark";

interface SearchRow {
  id: string;
  role_searched: string;
  state: string;
  city: string;
  notes: string | null;
  suggested_monthly_compensation: string;
  source_mode: "LIVE_CONNECTOR" | "STATIC_SNAPSHOT";
  summary: string;
  generated_at: string;
}

interface SourceRow {
  search_id: string;
  employment_model: "CLT" | "PJ";
  profile_id: string;
  profile_title: string;
  seniority: MarketBenchmarkSalarySource["seniority"];
  monthly_compensation: string;
  factor_k: string;
  observation: string;
}

export async function insertBenchmarkSearch(result: MarketBenchmarkResult): Promise<string> {
  const [row] = await query<{ id: string }>(
    "market_benchmark_searches.insert",
    `insert into market_benchmark_searches (role_searched, state, city, notes, suggested_monthly_compensation, source_mode, summary, generated_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8)
     returning id`,
    [result.roleSearched, result.state, result.city, result.notes ?? null, result.suggestedMonthlyCompensation, result.sourceMode, result.summary, result.generatedAt],
  );

  for (const source of result.sources) {
    await query(
      "market_benchmark_sources.insert",
      `insert into market_benchmark_sources (search_id, employment_model, profile_id, profile_title, seniority, monthly_compensation, factor_k, observation)
       values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [row.id, source.employmentModel, source.profileId, source.profileTitle, source.seniority, source.monthlyCompensation, source.factorK, source.observation],
    );
  }

  return row.id;
}

export async function listRecentBenchmarkSearches(limit = 50): Promise<MarketBenchmarkHistoryEntry[]> {
  const searches = await query<SearchRow>(
    "market_benchmark_searches.list_recent",
    `select id, role_searched, state, city, notes, suggested_monthly_compensation, source_mode, summary, generated_at
     from market_benchmark_searches
     order by generated_at desc
     limit $1`,
    [limit],
  );
  if (!searches.length) return [];

  const ids = searches.map((s) => s.id);
  const sources = await query<SourceRow>(
    "market_benchmark_sources.list_by_search_ids",
    `select search_id, employment_model, profile_id, profile_title, seniority, monthly_compensation, factor_k, observation
     from market_benchmark_sources
     where search_id = any($1::bigint[])`,
    [ids],
  );

  const sourcesBySearch = new Map<string, MarketBenchmarkSalarySource[]>();
  for (const source of sources) {
    const list = sourcesBySearch.get(source.search_id) ?? [];
    list.push({
      employmentModel: source.employment_model,
      profileId: source.profile_id,
      profileTitle: source.profile_title,
      seniority: source.seniority,
      monthlyCompensation: Number(source.monthly_compensation),
      factorK: Number(source.factor_k),
      observation: source.observation,
    });
    sourcesBySearch.set(source.search_id, list);
  }

  return searches.map((row) => ({
    id: row.id,
    roleSearched: row.role_searched,
    state: row.state,
    city: row.city,
    notes: row.notes ?? undefined,
    suggestedMonthlyCompensation: Number(row.suggested_monthly_compensation),
    sourceMode: row.source_mode,
    summary: row.summary,
    generatedAt: row.generated_at,
    sources: sourcesBySearch.get(row.id) ?? [],
  }));
}
