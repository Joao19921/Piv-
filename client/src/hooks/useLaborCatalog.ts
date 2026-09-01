import { useQuery } from "@tanstack/react-query";
import { fetchLaborProfiles } from "@/lib/api";

export function useLaborCatalog() {
  return useQuery({
    queryKey: ["labor-profiles"],
    queryFn: fetchLaborProfiles,
    staleTime: 60_000,
  });
}
