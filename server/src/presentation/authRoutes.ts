import express, { type Router } from "express";
import { hashPassword, verifyPassword } from "../infrastructure/auth/password";
import { createSessionCookieValue, parseCookie, readSessionUserId, SESSION_COOKIE_NAME, SESSION_TTL_MS, SESSION_TTL_REMEMBER_MS } from "../infrastructure/auth/session";
import { findUserByEmail, findUserById, touchLastLogin, updateUserPassword } from "../infrastructure/repositories/userRepository";
import { requireSession } from "./authMiddleware";

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

  router.post("/auth/login", async (req, res) => {
    const { email, password, remember } = (req.body ?? {}) as Record<string, unknown>;
    if (typeof email !== "string" || !email.trim() || typeof password !== "string" || !password) {
      res.status(400).json({ error: "E-mail e senha são obrigatórios." });
      return;
    }

    const user = await findUserByEmail(email.trim());
    if (!user || user.status !== "ACTIVE" || !verifyPassword(password, user.password_hash)) {
      res.status(401).json({ error: "E-mail ou senha inválidos." });
      return;
    }

    await touchLastLogin(user.id);
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
    if (newPassword.length < 8) {
      res.status(400).json({ error: "A nova senha precisa ter pelo menos 8 caracteres." });
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

    await updateUserPassword(user.id, hashPassword(newPassword), false);
    res.json({ ok: true });
  });

  return router;
}
