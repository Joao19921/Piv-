import express, { type Router } from "express";
import { PERMISSION_CODES, type PermissionCode, type Role, type UserStatus } from "../domain/services/authorization";
import { validatePassword } from "../domain/services/passwordPolicy";
import { hashPassword } from "../infrastructure/auth/password";
import { recordAuditEvent } from "../infrastructure/repositories/auditRepository";
import { emailExists, insertUser, listUsers, setUserStatus, updateUser, type UserWithPermissions } from "../infrastructure/repositories/userRepository";
import { requireRole } from "./authMiddleware";

function toUserView(user: UserWithPermissions) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    status: user.status,
    mustChangePassword: user.must_change_password,
    permissions: user.role === "ADMIN" ? [] : user.permissions,
    createdAt: user.created_at,
    updatedAt: user.updated_at,
    lastLoginAt: user.last_login_at,
  };
}

function parsePermissions(value: unknown): PermissionCode[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const codes = value.filter((v): v is PermissionCode => typeof v === "string" && (PERMISSION_CODES as string[]).includes(v));
  return codes.length === value.length ? codes : undefined;
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function createAdminUsersRouter(): Router {
  const router = express.Router();
  router.use(requireRole("ADMIN"));

  router.get("/admin/users", async (_req, res) => {
    const users = await listUsers();
    res.json({ users: users.map(toUserView) });
  });

  router.post("/admin/users", async (req, res) => {
    const { name, email, password, confirmPassword, role, status, permissions } = (req.body ?? {}) as Record<string, unknown>;

    if (typeof name !== "string" || !name.trim()) {
      res.status(400).json({ error: "Nome completo é obrigatório." });
      return;
    }
    if (typeof email !== "string" || !EMAIL_REGEX.test(email.trim())) {
      res.status(400).json({ error: "Informe um e-mail válido." });
      return;
    }
    if (typeof password !== "string") {
      res.status(400).json({ error: "A senha inicial é obrigatória." });
      return;
    }
    // Mesma politica da troca de senha (passwordPolicy): antes eram duas regras `length >= 8`
    // separadas, com textos diferentes -- a senha inicial definida pelo admin ficava livre para
    // ser "12345678", justo a que o usuario mais tende a manter.
    const policy = validatePassword(password, { name: typeof name === "string" ? name : undefined, email: typeof email === "string" ? email : undefined });
    if (!policy.ok) {
      res.status(400).json({ error: `Senha inicial: ${policy.error}` });
      return;
    }
    if (password !== confirmPassword) {
      res.status(400).json({ error: "A confirmação de senha não é igual à senha inicial." });
      return;
    }
    if (role !== "ADMIN" && role !== "USER") {
      res.status(400).json({ error: "Perfil deve ser ADMIN ou USER." });
      return;
    }
    const resolvedStatus: UserStatus = status === "INACTIVE" ? "INACTIVE" : "ACTIVE";
    const resolvedPermissions = parsePermissions(permissions ?? []);
    if (!resolvedPermissions) {
      res.status(400).json({ error: "Permissões inválidas." });
      return;
    }

    const normalizedEmail = email.trim();
    if (await emailExists(normalizedEmail)) {
      res.status(409).json({ error: "Já existe um usuário com este e-mail." });
      return;
    }

    const id = await insertUser({
      name: name.trim(),
      email: normalizedEmail,
      passwordHash: hashPassword(password),
      role: role as Role,
      status: resolvedStatus,
      permissions: resolvedPermissions,
    });

    void recordAuditEvent({
      action: "USER_CREATED",
      actorUserId: req.user!.id,
      targetUserId: id,
      // Sem a senha, obviamente: a trilha registra quem criou quem, com qual acesso.
      metadata: { email: normalizedEmail, role, status: resolvedStatus, permissions: resolvedPermissions },
    });

    // Senha inicial em texto puro so aparece nesta resposta -- nunca mais recuperavel depois.
    res.status(201).json({ email: normalizedEmail, initialPassword: password, userId: id });
  });

  router.put("/admin/users/:id", async (req, res) => {
    const { name, email, role, status, permissions } = (req.body ?? {}) as Record<string, unknown>;

    if (typeof name !== "string" || !name.trim()) {
      res.status(400).json({ error: "Nome completo é obrigatório." });
      return;
    }
    if (typeof email !== "string" || !EMAIL_REGEX.test(email.trim())) {
      res.status(400).json({ error: "Informe um e-mail válido." });
      return;
    }
    if (role !== "ADMIN" && role !== "USER") {
      res.status(400).json({ error: "Perfil deve ser ADMIN ou USER." });
      return;
    }
    const resolvedStatus: UserStatus = status === "INACTIVE" ? "INACTIVE" : "ACTIVE";
    const resolvedPermissions = parsePermissions(permissions ?? []);
    if (!resolvedPermissions) {
      res.status(400).json({ error: "Permissões inválidas." });
      return;
    }

    const normalizedEmail = email.trim();
    if (await emailExists(normalizedEmail, req.params.id)) {
      res.status(409).json({ error: "Já existe um usuário com este e-mail." });
      return;
    }

    let updated: UserWithPermissions;
    try {
      updated = await updateUser(req.params.id, {
        name: name.trim(),
        email: normalizedEmail,
        role: role as Role,
        status: resolvedStatus,
        permissions: resolvedPermissions,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("Permissões não cadastradas")) {
        res.status(409).json({ error: "O catálogo de permissões do banco está desatualizado. A migration de acesso precisa ser aplicada antes de salvar." });
        return;
      }
      if (message.includes("Usuário não encontrado")) {
        res.status(404).json({ error: "Este usuário não existe mais. Atualize a lista e tente novamente." });
        return;
      }
      throw error;
    }
    void recordAuditEvent({
      action: "USER_UPDATED",
      actorUserId: req.user!.id,
      targetUserId: req.params.id,
      metadata: { email: normalizedEmail, role, status: resolvedStatus, permissions: resolvedPermissions },
    });
    res.json({ ok: true, user: toUserView(updated) });
  });

  router.post("/admin/users/:id/activate", async (req, res) => {
    await setUserStatus(req.params.id, "ACTIVE");
    void recordAuditEvent({ action: "USER_ACTIVATED", actorUserId: req.user!.id, targetUserId: req.params.id });
    res.json({ ok: true });
  });

  router.post("/admin/users/:id/deactivate", async (req, res) => {
    if (req.user!.id === req.params.id) {
      res.status(400).json({ error: "Você não pode desativar a própria conta." });
      return;
    }
    await setUserStatus(req.params.id, "INACTIVE");
    void recordAuditEvent({ action: "USER_DEACTIVATED", actorUserId: req.user!.id, targetUserId: req.params.id });
    res.json({ ok: true });
  });

  return router;
}
