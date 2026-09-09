import express, { type Router } from "express";
import rateLimit from "express-rate-limit";
import { validatePassword } from "../domain/services/passwordPolicy";
import { hashPassword, verifyPassword } from "../infrastructure/auth/password";
import { LOCK_DURATION_MS, recordFailure, recordSuccess, remainingLockMs } from "../infrastructure/auth/loginThrottle";
import { createSessionCookieValue, parseCookie, readSessionUserId, SESSION_COOKIE_NAME, SESSION_TTL_MS, SESSION_TTL_REMEMBER_MS } from "../infrastructure/auth/session";
import { recordAuditEvent } from "../infrastructure/repositories/auditRepository";
import { clearFailedLogins, findUserByEmail, findUserById, registerFailedLogin, touchLastLogin, updateUserPassword } from "../infrastructure/repositories/userRepository";
import { requireSession } from "./authMiddleware";

/**
 * Resposta unica para credencial invalida, conta inexistente e conta inativa. Diferenciar as
 * tres seria mais amigavel, mas entregaria ao atacante um oraculo de quais e-mails existem e
 * quais estao ativos.
 */
const GENERIC_LOGIN_ERROR = "E-mail ou senha inválidos.";

/**
 * Rate limit por IP: segura a rajada vinda de um endereco so. Nao e o controle principal contra
 * brute force -- esse e o bloqueio por conta (`loginThrottle`, 5 tentativas), que tambem cobre
 * o ataque distribuido, onde cada IP tenta poucas vezes.
 *
 * O limite e alto de proposito. O Pivo e ferramenta corporativa: e provavel que o time inteiro
 * saia pelo mesmo IP publico (NAT do escritorio), entao um teto baixo aqui trancaria todo mundo
 * junto com o atacante -- transformando a protecao em negacao de servico contra o proprio time.
 * Quem segura o ataque de verdade e o bloqueio por conta; este limite existe so para conter
 * rajada automatizada absurda.
 *
 * ATENCAO: depende de `app.set("trust proxy", 1)`. Sem isso, atras do proxy do Render toda
 * requisicao chega com o IP do proxy e este limite passa a valer para o trafego inteiro.
 */
const loginIpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 100,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Muitas tentativas de login a partir deste endereço. Tente novamente em alguns minutos." },
});

function minutesFromMs(ms: number): number {
  return Math.max(1, Math.ceil(ms / 60_000));
}

function toSessionUserView(user: NonNullable<Awaited<ReturnType<typeof findUserById>>>) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    status: user.status,
    mustChangePassword: user.must_change_password,
    permissions: user.role === "ADMIN" ? [] : user.permissions,
  };
}

export function createAuthRouter(): Router {
  const router = express.Router();

  router.get("/auth/session", async (req, res) => {
    const cookie = parseCookie(req.headers.cookie, SESSION_COOKIE_NAME);
    const userId = readSessionUserId(cookie);
    if (!userId) {
      res.json({ authenticated: false, user: null });
      return;
    }
    const user = await findUserById(userId);
    if (!user || user.status !== "ACTIVE") {
      res.json({ authenticated: false, user: null });
      return;
    }
    res.json({ authenticated: true, user: toSessionUserView(user) });
  });

  router.post("/auth/login", loginIpLimiter, async (req, res) => {
    const { email, password, remember } = (req.body ?? {}) as Record<string, unknown>;
    if (typeof email !== "string" || !email.trim() || typeof password !== "string" || !password) {
      res.status(400).json({ error: "E-mail e senha são obrigatórios." });
      return;
    }

    const submittedEmail = email.trim();

    // Bloqueio por conta, checado ANTES de tocar o banco ou verificar a senha: e uniforme para
    // e-mail existente ou nao, entao nao revela quais contas existem.
    const lockedMs = remainingLockMs(submittedEmail);
    if (lockedMs > 0) {
      void recordAuditEvent({ action: "LOGIN_BLOCKED", metadata: { email: submittedEmail, remainingMinutes: minutesFromMs(lockedMs) } });
      res.status(429).json({
        error: `Muitas tentativas malsucedidas. Tente novamente em ${minutesFromMs(lockedMs)} minuto(s).`,
      });
      return;
    }

    const user = await findUserByEmail(submittedEmail);
    const passwordOk = Boolean(user) && verifyPassword(password, user!.password_hash);
    const isActive = user?.status === "ACTIVE";

    if (!user || !isActive || !passwordOk) {
      const justLocked = recordFailure(submittedEmail);

      // Conta que existe tambem acumula no contador duravel (migration 0008), para o bloqueio
      // sobreviver a um restart do processo.
      if (user) {
        void registerFailedLogin(user.id, justLocked ? new Date(Date.now() + LOCK_DURATION_MS) : null).catch(() => undefined);
      }

      void recordAuditEvent({
        action: user && !isActive ? "LOGIN_INACTIVE_USER" : "LOGIN_FAILED",
        targetUserId: user?.id ?? null,
        metadata: { email: submittedEmail, accountLocked: justLocked },
      });

      if (justLocked) {
        res.status(429).json({ error: `Muitas tentativas malsucedidas. Tente novamente em ${minutesFromMs(LOCK_DURATION_MS)} minuto(s).` });
        return;
      }
      res.status(401).json({ error: GENERIC_LOGIN_ERROR });
      return;
    }

    recordSuccess(submittedEmail);
    await touchLastLogin(user.id);
    void clearFailedLogins(user.id).catch(() => undefined);
    void recordAuditEvent({ action: "LOGIN_SUCCESS", actorUserId: user.id, targetUserId: user.id });

    const ttlMs = remember === true ? SESSION_TTL_REMEMBER_MS : SESSION_TTL_MS;
    res.cookie(SESSION_COOKIE_NAME, createSessionCookieValue(user.id, ttlMs), {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      maxAge: ttlMs,
    });
    res.json({ user: toSessionUserView(user) });
  });

  router.post("/auth/logout", (_req, res) => {
    res.clearCookie(SESSION_COOKIE_NAME);
    res.json({ ok: true });
  });

  router.post("/auth/change-password", requireSession, async (req, res) => {
    const { currentPassword, newPassword, confirmPassword } = (req.body ?? {}) as Record<string, unknown>;
    if (typeof currentPassword !== "string" || typeof newPassword !== "string" || typeof confirmPassword !== "string") {
      res.status(400).json({ error: "Preencha a senha atual, a nova senha e a confirmação." });
      return;
    }
    if (newPassword !== confirmPassword) {
      res.status(400).json({ error: "A confirmação não é igual à nova senha." });
      return;
    }

    const user = await findUserById(req.user!.id);
    if (!user || !verifyPassword(currentPassword, user.password_hash)) {
      res.status(401).json({ error: "Senha atual incorreta." });
      return;
    }

    // Politica aplicada depois de confirmar a senha atual: assim a mensagem de erro detalhada
    // ("precisa ter N caracteres") so chega a quem ja provou ser o dono da conta.
    const policy = validatePassword(newPassword, { name: user.name, email: user.email });
    if (!policy.ok) {
      res.status(400).json({ error: policy.error });
      return;
    }
    if (verifyPassword(newPassword, user.password_hash)) {
      res.status(400).json({ error: "A nova senha precisa ser diferente da atual." });
      return;
    }

    await updateUserPassword(user.id, hashPassword(newPassword), false);
    void recordAuditEvent({ action: "PASSWORD_CHANGED", actorUserId: user.id, targetUserId: user.id });
    res.json({ ok: true });
  });

  return router;
}
