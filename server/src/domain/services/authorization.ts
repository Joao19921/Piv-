export type Role = "ADMIN" | "USER";
export type UserStatus = "ACTIVE" | "INACTIVE";
export type PermissionCode = "LABOR" | "INFRA" | "LICENSES";

export const PERMISSION_CODES: PermissionCode[] = ["LABOR", "INFRA", "LICENSES"];

export interface AuthenticatedUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  status: UserStatus;
  mustChangePassword: boolean;
  permissions: PermissionCode[];
}

/** ADMIN tem acesso total sempre; USER depende das permissoes cadastradas. Nunca duplicar
 * acesso de ADMIN como linhas de permissao — evita a inconsistencia "admin sem permissao". */
export function hasPermission(user: AuthenticatedUser, code: PermissionCode): boolean {
  if (user.role === "ADMIN") return true;
  return user.permissions.includes(code);
}

export function isAdmin(user: AuthenticatedUser): boolean {
  return user.role === "ADMIN";
}

export function isActive(user: Pick<AuthenticatedUser, "status">): boolean {
  return user.status === "ACTIVE";
}
