import { useQuery } from "@tanstack/react-query";
import { fetchBenchmarkRuns, fetchBenchmarkSources, fetchRoleLookup } from "@/lib/api";

const SOURCES_KEY = ["benchmark-worker-sources"];
const RUNS_KEY = ["benchmark-worker-runs"];

export function useBenchmarkSources() {
  return useQuery({ queryKey: SOURCES_KEY, queryFn: fetchBenchmarkSources, staleTime: 15_000 });
}

export function useBenchmarkRuns() {
  return useQuery({ queryKey: RUNS_KEY, queryFn: fetchBenchmarkRuns, staleTime: 5_000 });
}

/** Habilitada só quando `role` não é vazio -- a busca por cargo é sob demanda, não roda sozinha. */
export function useRoleLookup(role: string, state: string | null) {
  const trimmed = role.trim();
  return useQuery({
    queryKey: ["benchmark-worker-role-lookup", trimmed, state],
    queryFn: () => fetchRoleLookup(trimmed, state),
    enabled: trimmed.length > 0,
    staleTime: 15_000,
  });
}
