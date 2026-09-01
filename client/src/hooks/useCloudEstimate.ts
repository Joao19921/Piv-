import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { fetchCloudEstimate, type CloudEstimateParams } from "@/lib/api";
import { useDebouncedValue } from "./useDebouncedValue";

export function useCloudEstimate(params: CloudEstimateParams) {
  const debounced = useDebouncedValue(params, 350);

  return useQuery({
    queryKey: ["cloud-estimate", debounced],
    queryFn: () => fetchCloudEstimate(debounced),
    placeholderData: keepPreviousData,
  });
}
