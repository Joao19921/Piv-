import type { NextFunction, Request, Response } from "express";
import { hasPermission, isAdmin, type AuthenticatedUser, type PermissionCode } from "../domain/services/authorization";
import { parseCookie, readSessionUserId, SESSION_COOKIE_NAME } from "../infrastructure/auth/session";
import { logger } from "../infrastructure/observability/logger";
import { findUserById } from "../infrastructure/repositories/userRepository";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

function toAuthenticatedUser(row: Awaited<ReturnType<typeof findUserById>>): AuthenticatedUser | undefined {
  if (!row) return undefined;
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    status: row.status,
    mustChangePassword: row.must_change_password,
    permissions: row.permissions,
  };
}

/**
 * Carrega o usuario da sessao (se houver) em req.user. Nao bloqueia sozinho -- rotas
 * publicas (login, healthz) passam por aqui sem exigir sessao; requireAuth/requirePermission
 * e quem bloqueia. Usuario INACTIVE e tratado como nao autenticado mesmo com cookie valido
 * (cobre o caso de desativacao no meio de uma sessao ja aberta).
 */
export async function attachUser(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const cookie = parseCookie(req.headers.cookie, SESSION_COOKIE_NAME);
  const userId = readSessionUserId(cookie);
  if (!userId) {
    next();
    return;
  }
  try {
    const row = await findUserById(userId);
    const user = toAuthenticatedUser(row);
    if (user && user.status === "ACTIVE") {
      req.user = user;
    }
  } catch (err) {
    // Falha ao consultar o Postgres nao deve derrubar a rota inteira -- trata como nao
    // autenticado (requireAuth/requirePermission bloqueiam do jeito certo, com 401).
    logger.error("Falha ao carregar usuario da sessao", { error: err instanceof Error ? err.message : String(err) });
  }
  next();
}

/** So exige sessao valida (usada pelas proprias rotas de auth -- ex.: change-password
 * precisa ser alcancavel mesmo com mustChangePassword pendente, senao vira um cadeado sem chave). */
export function requireSession(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  next();
}

/** Sessao valida E sem troca de senha pendente -- usada como gate geral dos modulos.
 * "usuario nao deve conseguir acessar os modulos normalmente enquanto a troca obrigatoria
 * de senha estiver pendente" precisa ser garantido aqui, nao so escondendo o menu no front. */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  if (req.user.mustChangePassword) {
    res.status(403).json({ error: "password_change_required" });
    return;
  }
  next();
}

export function requirePermission(code: PermissionCode) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    if (!hasPermission(req.user, code)) {
      res.status(403).json({ error: "forbidden" });
      return;
    }
    next();
  };
}

export function requireRole(role: "ADMIN") {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    if (role === "ADMIN" && !isAdmin(req.user)) {
      res.status(403).json({ error: "forbidden" });
      return;
    }
    next();
  };
}
