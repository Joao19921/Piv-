import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createManualObservation,
  fetchBenchmarkRuns,
  fetchBenchmarkSources,
  fetchOpenSources,
  fetchOpenSourceTriggers,
  fetchRoleLookup,
} from "@/lib/api";

const SOURCES_KEY = ["benchmark-worker-sources"];
const RUNS_KEY = ["benchmark-worker-runs"];
const OPEN_SOURCES_KEY = ["benchmark-worker-open-sources"];
const OPEN_SOURCE_TRIGGERS_KEY = ["benchmark-worker-open-source-triggers"];

export function useBenchmarkSources() {
  return useQuery({ queryKey: SOURCES_KEY, queryFn: fetchBenchmarkSources, staleTime: 15_000 });
}

export function useBenchmarkRuns() {
  return useQuery({ queryKey: RUNS_KEY, queryFn: fetchBenchmarkRuns, staleTime: 5_000 });
}

export function useOpenSources() {
  return useQuery({ queryKey: OPEN_SOURCES_KEY, queryFn: fetchOpenSources, staleTime: 60_000 });
}

export function useOpenSourceTriggers() {
  return useQuery({ queryKey: OPEN_SOURCE_TRIGGERS_KEY, queryFn: fetchOpenSourceTriggers, staleTime: 15_000 });
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

export function useCreateManualObservation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createManualObservation,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: RUNS_KEY });
      queryClient.invalidateQueries({ queryKey: OPEN_SOURCE_TRIGGERS_KEY });
      queryClient.invalidateQueries({ queryKey: ["benchmark-worker-role-lookup"] });
    },
  });
}
