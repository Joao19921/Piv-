import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  activateUserRequest,
  createUser,
  deactivateUserRequest,
  fetchUsers,
  updateUserRequest,
  type ManagedUser,
  type SaveUserParams,
} from "@/lib/api";

const LIST_KEY = ["admin-users"];

export function useUsers() {
  return useQuery({
    queryKey: LIST_KEY,
    queryFn: fetchUsers,
    staleTime: 5_000,
  });
}

export function useCreateUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createUser,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: LIST_KEY }),
  });
}

export function useUpdateUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...params }: SaveUserParams & { id: string }) => updateUserRequest(id, params),
    onSuccess: (updatedUser) => {
      queryClient.setQueryData<ManagedUser[]>(LIST_KEY, (users) => users?.map((user) => user.id === updatedUser.id ? updatedUser : user));
      return queryClient.invalidateQueries({ queryKey: LIST_KEY });
    },
  });
}

export function useActivateUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: activateUserRequest,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: LIST_KEY }),
  });
}

export function useDeactivateUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deactivateUserRequest,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: LIST_KEY }),
  });
}
