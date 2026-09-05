import { useQuery } from "@tanstack/react-query";
import { fetchCloudServices, type CloudProvider, type ServiceCategory } from "@/lib/api";

export function useCloudServices(params: { q?: string; provider?: CloudProvider; category?: ServiceCategory } = {}) {
  return useQuery({
    queryKey: ["cloud-services", params],
    queryFn: () => fetchCloudServices(params),
    staleTime: 60_000,
  });
}
