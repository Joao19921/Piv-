import { query, withTransaction, type TransactionQuery } from "../db/client";
import type { PermissionCode, Role, UserStatus } from "../../domain/services/authorization";

export interface UserRow {
  id: string;
  name: string;
  email: string;
  password_hash: string;
  role: Role;
  status: UserStatus;
  must_change_password: boolean;
  created_at: string;
  updated_at: string;
  last_login_at: string | null;
  /** Migration 0008 — contador duravel de falhas de login. */
  failed_login_attempts: number;
  locked_until: string | null;
}

export interface UserWithPermissions extends UserRow {
  permissions: PermissionCode[];
}

export interface CreateUserInput {
  name: string;
  email: string;
  passwordHash: string;
  role: Role;
  status: UserStatus;
  permissions: PermissionCode[];
}

export interface UpdateUserInput {
  name: string;
  email: string;
  role: Role;
  status: UserStatus;
  permissions: PermissionCode[];
}

async function replacePermissions(txQuery: TransactionQuery, userId: string, permissions: PermissionCode[]): Promise<void> {
  await txQuery("user_permissions.delete_by_user", `delete from user_permissions where user_id = $1`, [userId]);
  // ADMIN nunca ganha linhas aqui (acesso total vem do role); so grava permissoes p/ USER.
  for (const code of permissions) {
    await txQuery(
      "user_permissions.insert",
      `insert into user_permissions (user_id, permission_id)
       select $1, id from permissions where code = $2
       on conflict do nothing`,
      [userId, code],
    );
  }
}

function attachPermissions<T extends UserRow>(rows: T[], permissionRows: { user_id: string; code: PermissionCode }[]): (T & { permissions: PermissionCode[] })[] {
  const byUser = new Map<string, PermissionCode[]>();
  for (const p of permissionRows) {
    const list = byUser.get(p.user_id) ?? [];
    list.push(p.code);
    byUser.set(p.user_id, list);
  }
  return rows.map((row) => ({ ...row, permissions: row.role === "ADMIN" ? [] : (byUser.get(row.id) ?? []) }));
}

export async function findUserByEmail(email: string): Promise<UserWithPermissions | undefined> {
  const [row] = await query<UserRow>("users.find_by_email", `select * from users where lower(email) = lower($1)`, [email]);
  if (!row) return undefined;
  const [withPermissions] = await attachPermissionsForRows([row]);
  return withPermissions;
}

export async function findUserById(id: string): Promise<UserWithPermissions | undefined> {
  const [row] = await query<UserRow>("users.find_by_id", `select * from users where id = $1`, [id]);
  if (!row) return undefined;
  const [withPermissions] = await attachPermissionsForRows([row]);
  return withPermissions;
}

async function attachPermissionsForRows(rows: UserRow[]): Promise<UserWithPermissions[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const permissionRows = await query<{ user_id: string; code: PermissionCode }>(
    "user_permissions.list_by_users",
    `select up.user_id, p.code
     from user_permissions up
     join permissions p on p.id = up.permission_id
     where up.user_id = any($1::bigint[])`,
    [ids],
  );
  return attachPermissions(rows, permissionRows);
}

export async function listUsers(): Promise<UserWithPermissions[]> {
  const rows = await query<UserRow>("users.list", `select * from users order by created_at asc`);
  return attachPermissionsForRows(rows);
}

export async function emailExists(email: string, excludingUserId?: string): Promise<boolean> {
  const rows = excludingUserId
    ? await query<{ id: string }>("users.email_exists_excluding", `select id from users where lower(email) = lower($1) and id != $2`, [email, excludingUserId])
    : await query<{ id: string }>("users.email_exists", `select id from users where lower(email) = lower($1)`, [email]);
  return rows.length > 0;
}

export async function insertUser(input: CreateUserInput): Promise<string> {
  return withTransaction(async (txQuery) => {
    const [row] = await txQuery<{ id: string }>(
      "users.insert",
      `insert into users (name, email, password_hash, role, status, must_change_password)
       values ($1, $2, $3, $4, $5, true)
       returning id`,
      [input.name, input.email, input.passwordHash, input.role, input.status],
    );
    if (input.role === "USER") {
      await replacePermissions(txQuery, row.id, input.permissions);
    }
    return row.id;
  });
}

export async function updateUser(id: string, input: UpdateUserInput): Promise<void> {
  await withTransaction(async (txQuery) => {
    await txQuery(
      "users.update",
      `update users set name = $2, email = $3, role = $4, status = $5, updated_at = now() where id = $1`,
      [id, input.name, input.email, input.role, input.status],
    );
    await replacePermissions(txQuery, id, input.role === "USER" ? input.permissions : []);
  });
}

export async function setUserStatus(id: string, status: UserStatus): Promise<void> {
  await query("users.set_status", `update users set status = $2, updated_at = now() where id = $1`, [id, status]);
}

export async function updateUserPassword(id: string, passwordHash: string, mustChangePassword: boolean): Promise<void> {
  await query(
    "users.update_password",
    `update users set password_hash = $2, must_change_password = $3, updated_at = now() where id = $1`,
    [id, passwordHash, mustChangePassword],
  );
}

export async function touchLastLogin(id: string): Promise<void> {
  await query("users.touch_last_login", `update users set last_login_at = now() where id = $1`, [id]);
}

/**
 * Contador duravel de falhas de login (migration 0008). O bloqueio em si e decidido pelo
 * `loginThrottle` (em memoria, uniforme para conta existente ou nao, para nao virar oraculo de
 * enumeracao); estas colunas existem para o bloqueio SOBREVIVER a um restart do processo --
 * o Render Free reinicia sozinho, e sem isso bastaria esperar um restart para zerar o contador.
 */
export async function registerFailedLogin(id: string, lockUntil: Date | null): Promise<void> {
  await query(
    "users.register_failed_login",
    `update users
        set failed_login_attempts = failed_login_attempts + 1,
            locked_until = coalesce($2, locked_until)
      where id = $1`,
    [id, lockUntil],
  );
}

export async function clearFailedLogins(id: string): Promise<void> {
  await query(
    "users.clear_failed_logins",
    `update users set failed_login_attempts = 0, locked_until = null where id = $1`,
    [id],
  );
}
