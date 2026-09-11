/**
 * Trilha de auditoria (`audit_logs`).
 *
 * A tabela existe desde a migration 0006, com o comentario "preparado para auditoria futura
 * (... so no login)", mas nunca recebeu uma unica escrita -- nem a de login. Este modulo e o
 * primeiro produtor de verdade dela.
 *
 * Regras que valem para todo evento registrado aqui:
 * - **Nunca gravar segredo.** Senha, hash e cookie de sessao nao entram em `metadata` em
 *   hipotese nenhuma; o objetivo da trilha e reconstruir QUEM fez O QUE e QUANDO.
 * - **Nunca derrubar a operacao auditada.** Se a gravacao falhar, o login/alteracao continua;
 *   a falha vai para o log/Sentry. Auditoria que quebra a funcionalidade vira incentivo para
 *   alguem desligar a auditoria.
 */
import { isDatabaseConfigured, query } from "../db/client";
import { logger } from "../observability/logger";

export type AuditAction =
  | "LOGIN_SUCCESS"
  | "LOGIN_FAILED"
  | "LOGIN_BLOCKED"
  | "LOGIN_INACTIVE_USER"
  | "PASSWORD_CHANGED"
  | "USER_CREATED"
  | "USER_UPDATED"
  | "USER_ACTIVATED"
  | "USER_DEACTIVATED"
  | "BENCHMARK_MANUAL_OBSERVATION_CREATED";

export interface AuditEvent {
  action: AuditAction;
  /** Quem executou a acao. Null em login malsucedido, onde nao ha identidade comprovada. */
  actorUserId?: string | null;
  /** Sobre quem a acao recai (ex.: usuario criado/desativado pelo admin). */
  targetUserId?: string | null;
  metadata?: Record<string, unknown>;
}

/**
 * Grava um evento. Deliberadamente nao lanca: chame sem `await` quando a operacao auditada nao
 * puder esperar pela escrita (ex.: resposta do login).
 */
export async function recordAuditEvent(event: AuditEvent): Promise<void> {
  if (!isDatabaseConfigured) return;
  try {
    await query(
      "audit_logs.insert",
      `insert into audit_logs (actor_user_id, target_user_id, action, metadata)
       values ($1, $2, $3, $4)`,
      [event.actorUserId ?? null, event.targetUserId ?? null, event.action, event.metadata ? JSON.stringify(event.metadata) : null],
    );
  } catch (err) {
    logger.error("Falha ao gravar evento de auditoria", {
      action: event.action,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export interface AuditLogRow {
  id: string;
  actor_user_id: string | null;
  target_user_id: string | null;
  action: AuditAction;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export async function listRecentAuditEvents(limit = 100): Promise<AuditLogRow[]> {
  return query<AuditLogRow>(
    "audit_logs.list_recent",
    `select id, actor_user_id, target_user_id, action, metadata, created_at
     from audit_logs
     order by created_at desc
     limit $1`,
    [limit],
  );
}
