import { useQuery } from "@tanstack/react-query";
import { fetchSystemHealth } from "@/lib/api";

export function useSystemHealth() {
  return useQuery({
    queryKey: ["system-health"],
    queryFn: fetchSystemHealth,
    refetchInterval: 30_000,
    staleTime: 15_000,
  });
}
