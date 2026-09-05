import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createArchitecture,
  deleteArchitectureRequest,
  duplicateArchitectureRequest,
  fetchArchitecture,
  fetchArchitectures,
  updateArchitecture,
} from "@/lib/api";

const LIST_KEY = ["cloud-architectures"];

export function useCloudArchitectures() {
  return useQuery({
    queryKey: LIST_KEY,
    queryFn: fetchArchitectures,
    staleTime: 5_000,
  });
}

export function useCloudArchitecture(id: string | undefined) {
  return useQuery({
    queryKey: ["cloud-architecture", id],
    queryFn: () => fetchArchitecture(id as string),
    enabled: Boolean(id),
  });
}

export function useCreateArchitecture() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createArchitecture,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: LIST_KEY }),
  });
}

export function useUpdateArchitecture() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...params }: Parameters<typeof updateArchitecture>[1] & { id: string }) => updateArchitecture(id, params),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: LIST_KEY });
      queryClient.invalidateQueries({ queryKey: ["cloud-architecture", variables.id] });
    },
  });
}

export function useDeleteArchitecture() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteArchitectureRequest,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: LIST_KEY }),
  });
}

export function useDuplicateArchitecture() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, name }: { id: string; name?: string }) => duplicateArchitectureRequest(id, name),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: LIST_KEY }),
  });
}
