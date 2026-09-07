import crypto from "crypto";
import { logger } from "../observability/logger";

/** Sessao assinada por HMAC, carrega o id do usuario autenticado + expiracao. */
export const SESSION_COOKIE_NAME = "pivo_session";
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
export const SESSION_TTL_REMEMBER_MS = 30 * 24 * 60 * 60 * 1000;

let ephemeralSecret: string | null = null;

/**
 * SESSION_SECRET deveria vir de env var (mesmo valor entre deploys, senão toda sessao
 * expira a cada restart). Sem ela, gera um segredo em memoria no boot: funciona, so nao
 * sobrevive a um redeploy/restart do processo (aviso no log pra nao passar despercebido).
 */
function getSessionSecret(): string {
  const fromEnv = process.env.SESSION_SECRET;
  if (fromEnv) return fromEnv;
  if (!ephemeralSecret) {
    ephemeralSecret = crypto.randomBytes(32).toString("hex");
    logger.error("SESSION_SECRET nao configurada; usando segredo efemero gerado no boot (sessoes nao sobrevivem a um restart/redeploy).");
  }
  return ephemeralSecret;
}

function sign(value: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(value).digest("base64url");
}

/** userId como string (o driver pg devolve bigint como string p/ nao perder precisao). */
export function createSessionCookieValue(userId: string, ttlMs: number = SESSION_TTL_MS): string {
  const expiresAt = String(Date.now() + ttlMs);
  const payload = `${userId}.${expiresAt}`;
  return `${payload}.${sign(payload, getSessionSecret())}`;
}

/** Retorna o userId da sessao valida, ou null se ausente/invalida/expirada. */
export function readSessionUserId(cookieValue: string | undefined): string | null {
  if (!cookieValue) return null;
  const parts = cookieValue.split(".");
  if (parts.length !== 3) return null;
  const [userId, expiresAt, signature] = parts;
  const payload = `${userId}.${expiresAt}`;
  if (sign(payload, getSessionSecret()) !== signature) return null;
  const expiresAtMs = Number(expiresAt);
  if (!Number.isFinite(expiresAtMs) || Date.now() >= expiresAtMs) return null;
  return userId || null;
}

export function parseCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  const match = header
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : undefined;
}
