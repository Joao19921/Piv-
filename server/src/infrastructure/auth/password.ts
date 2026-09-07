import crypto from "crypto";

const SCRYPT_KEYLEN = 64;
const SALT_BYTES = 16;

/** Hash de senha com scrypt (RFC 7914) + salt aleatorio. Formato armazenado: "salt:hash" (ambos hex). */
export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(SALT_BYTES).toString("hex");
  const hash = crypto.scryptSync(password, salt, SCRYPT_KEYLEN).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const expected = Buffer.from(hash, "hex");
  const candidate = crypto.scryptSync(password, salt, SCRYPT_KEYLEN);
  return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
}
