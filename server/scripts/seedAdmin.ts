/**
 * Cria o primeiro usuario ADMIN (pnpm run seed:admin). Le e-mail/senha de env vars --
 * nunca inventa uma senha (nao havia usuario real antes do RBAC, so uma credencial
 * unica compartilhada em texto puro via TEST_ACCESS_USER/PASSWORD). Idempotente: recusa
 * rodar se o e-mail ja existir. O ADMIN criado passa pelo mesmo fluxo de "trocar senha
 * no primeiro login" que qualquer usuario novo (must_change_password = true).
 */
import "dotenv/config";
import { hashPassword } from "../src/infrastructure/auth/password";
import { closePool, isDatabaseConfigured } from "../src/infrastructure/db/client";
import { emailExists, insertUser } from "../src/infrastructure/repositories/userRepository";
import { logger } from "../src/infrastructure/observability/logger";

async function main(): Promise<void> {
  if (!isDatabaseConfigured) {
    throw new Error("DATABASE_URL nao configurado -- necessario pra criar o usuario no Postgres.");
  }

  const name = process.env.ADMIN_NAME?.trim();
  const email = process.env.ADMIN_EMAIL?.trim();
  const password = process.env.ADMIN_INITIAL_PASSWORD;

  if (!name || !email || !password) {
    throw new Error("Defina ADMIN_NAME, ADMIN_EMAIL e ADMIN_INITIAL_PASSWORD (env vars) antes de rodar este script.");
  }
  if (password.length < 8) {
    throw new Error("ADMIN_INITIAL_PASSWORD precisa ter pelo menos 8 caracteres.");
  }
  if (await emailExists(email)) {
    throw new Error(`Ja existe um usuario com o e-mail '${email}'. Nada foi alterado.`);
  }

  const id = await insertUser({
    name,
    email,
    passwordHash: hashPassword(password),
    role: "ADMIN",
    status: "ACTIVE",
    permissions: [],
  });

  console.log(`Usuario ADMIN criado (id ${id}): ${email}`);
  console.log("Ele sera obrigado a trocar a senha no primeiro login.");
}

main()
  .catch((err) => {
    logger.error("seedAdmin falhou", { error: err instanceof Error ? err.message : String(err) });
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => closePool());
