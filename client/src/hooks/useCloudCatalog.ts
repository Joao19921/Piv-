import { useQuery } from "@tanstack/react-query";
import { fetchCloudCatalog } from "@/lib/api";

export function useCloudCatalog() {
  return useQuery({
    queryKey: ["cloud-catalog"],
    queryFn: fetchCloudCatalog,
    staleTime: 60_000,
  });
}
