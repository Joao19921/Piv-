import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchMarketBenchmarkHistory, searchMarketBenchmark } from "@/lib/api";

export function useMarketBenchmarkHistory() {
  return useQuery({
    queryKey: ["market-benchmark-history"],
    queryFn: fetchMarketBenchmarkHistory,
    staleTime: 15_000,
  });
}

export function useMarketBenchmarkSearch() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: searchMarketBenchmark,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["market-benchmark-history"] });
    },
  });
}
