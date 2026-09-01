import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { fetchLaborEstimate, type LaborEstimateParams } from "@/lib/api";
import { useDebouncedValue } from "./useDebouncedValue";

export function useLaborEstimate(params: LaborEstimateParams) {
  const debounced = useDebouncedValue(params, 250);

  return useQuery({
    queryKey: ["labor-estimate", debounced],
    queryFn: () => fetchLaborEstimate(debounced),
    placeholderData: keepPreviousData,
  });
}
