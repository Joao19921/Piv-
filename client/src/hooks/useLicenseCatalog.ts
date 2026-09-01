import { useQuery } from "@tanstack/react-query";
import { fetchLicenseCatalog } from "@/lib/api";

export function useLicenseCatalog() {
  return useQuery({
    queryKey: ["license-catalog"],
    queryFn: fetchLicenseCatalog,
    staleTime: 60_000,
  });
}
