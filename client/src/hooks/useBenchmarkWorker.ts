import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createManualObservation, fetchBenchmarkRuns, fetchBenchmarkSources } from "@/lib/api";

const SOURCES_KEY = ["benchmark-worker-sources"];
const RUNS_KEY = ["benchmark-worker-runs"];

export function useBenchmarkSources() {
  return useQuery({ queryKey: SOURCES_KEY, queryFn: fetchBenchmarkSources, staleTime: 15_000 });
}

export function useBenchmarkRuns() {
  return useQuery({ queryKey: RUNS_KEY, queryFn: fetchBenchmarkRuns, staleTime: 5_000 });
}

export function useCreateManualObservation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createManualObservation,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: RUNS_KEY }),
  });
}
