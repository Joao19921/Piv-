import crypto from "crypto";

/** Sessao simples assinada por HMAC para o ambiente de teste (credencial unica compartilhada). */
export const SESSION_COOKIE_NAME = "pivo_session";
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
export const SESSION_TTL_REMEMBER_MS = 30 * 24 * 60 * 60 * 1000;

function sign(value: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(value).digest("base64url");
}

export function createSessionCookieValue(secret: string, ttlMs: number = SESSION_TTL_MS): string {
  const expiresAt = String(Date.now() + ttlMs);
  return `${expiresAt}.${sign(expiresAt, secret)}`;
}

export function isSessionCookieValid(cookieValue: string | undefined, secret: string): boolean {
  if (!cookieValue) return false;
  const [expiresAt, signature] = cookieValue.split(".");
  if (!expiresAt || !signature) return false;
  if (sign(expiresAt, secret) !== signature) return false;
  const expiresAtMs = Number(expiresAt);
  return Number.isFinite(expiresAtMs) && Date.now() < expiresAtMs;
}

export function parseCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  const match = header
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : undefined;
}
