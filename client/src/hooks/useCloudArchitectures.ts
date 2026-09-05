import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchCloudArchitectures, saveCloudArchitecture } from "@/lib/api";

export function useCloudArchitectures() {
  return useQuery({
    queryKey: ["cloud-architectures"],
    queryFn: fetchCloudArchitectures,
    staleTime: 15_000,
  });
}

export function useSaveCloudArchitecture() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: saveCloudArchitecture,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cloud-architectures"] });
    },
  });
}
