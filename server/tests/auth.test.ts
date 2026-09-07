import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hashPassword } from "../src/infrastructure/auth/password";
import { closePool, query } from "../src/infrastructure/db/client";
import { insertUser, updateUserPassword, type CreateUserInput } from "../src/infrastructure/repositories/userRepository";
import { buildTestApp } from "./testApp";

const app = buildTestApp();
const EMAIL_DOMAIN = "@test.pivo.internal";
const PASSWORD = "Test1234!";

/** Cria um usuario de teste ja com mustChangePassword=false (simula onboarding concluido),
 * pra nao interferir nos testes de permissao -- o fluxo de primeiro acesso tem teste proprio. */
async function createReadyUser(input: Omit<CreateUserInput, "passwordHash"> & { password?: string }) {
  const id = await insertUser({ ...input, passwordHash: hashPassword(input.password ?? PASSWORD) });
  await updateUserPassword(id, hashPassword(input.password ?? PASSWORD), false);
  return id;
}

async function loginCookie(email: string, password = PASSWORD): Promise<string> {
  const res = await request(app).post("/api/v1/auth/login").send({ email, password });
  const cookie = res.headers["set-cookie"];
  if (!cookie) throw new Error(`Login falhou pra ${email}: ${JSON.stringify(res.body)}`);
  return Array.isArray(cookie) ? cookie[0] : cookie;
}

let adminCookie: string;
let noPermCookie: string;
let laborCookie: string;
let infraCookie: string;
let licensesCookie: string;
let inactiveEmail: string;
let deactivatableUserId: string;

beforeAll(async () => {
  await createReadyUser({ name: "Admin Teste", email: `rbac-admin${EMAIL_DOMAIN}`, role: "ADMIN", status: "ACTIVE", permissions: [] });
  await createReadyUser({ name: "Sem Permissao", email: `rbac-noperm${EMAIL_DOMAIN}`, role: "USER", status: "ACTIVE", permissions: [] });
  await createReadyUser({ name: "So Labor", email: `rbac-labor${EMAIL_DOMAIN}`, role: "USER", status: "ACTIVE", permissions: ["LABOR"] });
  await createReadyUser({ name: "So Infra", email: `rbac-infra${EMAIL_DOMAIN}`, role: "USER", status: "ACTIVE", permissions: ["INFRA"] });
  await createReadyUser({ name: "So Licenses", email: `rbac-licenses${EMAIL_DOMAIN}`, role: "USER", status: "ACTIVE", permissions: ["LICENSES"] });
  inactiveEmail = `rbac-inactive${EMAIL_DOMAIN}`;
  await createReadyUser({ name: "Inativo", email: inactiveEmail, role: "USER", status: "INACTIVE", permissions: ["LABOR"] });
  deactivatableUserId = await createReadyUser({ name: "Desativavel", email: `rbac-deactivatable${EMAIL_DOMAIN}`, role: "USER", status: "ACTIVE", permissions: ["LABOR"] });

  adminCookie = await loginCookie(`rbac-admin${EMAIL_DOMAIN}`);
  noPermCookie = await loginCookie(`rbac-noperm${EMAIL_DOMAIN}`);
  laborCookie = await loginCookie(`rbac-labor${EMAIL_DOMAIN}`);
  infraCookie = await loginCookie(`rbac-infra${EMAIL_DOMAIN}`);
  licensesCookie = await loginCookie(`rbac-licenses${EMAIL_DOMAIN}`);
});

afterAll(async () => {
  await query("test_cleanup.delete_users", `delete from users where email like $1`, [`%${EMAIL_DOMAIN}`]);
  await closePool();
});

describe("login", () => {
  it("recusa senha errada (401)", async () => {
    const res = await request(app).post("/api/v1/auth/login").send({ email: `rbac-admin${EMAIL_DOMAIN}`, password: "senha-errada" });
    expect(res.status).toBe(401);
  });

  it("recusa usuario inativo mesmo com senha certa (401)", async () => {
    const res = await request(app).post("/api/v1/auth/login").send({ email: inactiveEmail, password: PASSWORD });
    expect(res.status).toBe(401);
  });

  it("loga com e-mail e senha corretos (200)", async () => {
    const res = await request(app).post("/api/v1/auth/login").send({ email: `rbac-admin${EMAIL_DOMAIN}`, password: PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe("ADMIN");
  });
});

describe("visao geral (qualquer autenticado)", () => {
  it("401 sem sessao", async () => {
    const res = await request(app).get("/api/v1/system-health");
    expect(res.status).toBe(401);
  });

  it("200 com qualquer usuario ativo, mesmo sem nenhuma permissao", async () => {
    const res = await request(app).get("/api/v1/system-health").set("Cookie", noPermCookie);
    expect(res.status).toBe(200);
  });
});

describe("permissao LABOR", () => {
  it("403 sem LABOR", async () => {
    const res = await request(app).get("/api/v1/labor/profiles").set("Cookie", noPermCookie);
    expect(res.status).toBe(403);
  });
  it("200 com LABOR", async () => {
    const res = await request(app).get("/api/v1/labor/profiles").set("Cookie", laborCookie);
    expect(res.status).toBe(200);
  });
});

describe("permissao INFRA", () => {
  it("403 sem INFRA", async () => {
    const res = await request(app).get("/api/v1/cloud/services").set("Cookie", noPermCookie);
    expect(res.status).toBe(403);
  });
  it("200 com INFRA", async () => {
    const res = await request(app).get("/api/v1/cloud/services").set("Cookie", infraCookie);
    expect(res.status).toBe(200);
  });
});

describe("permissao LICENSES", () => {
  it("403 sem LICENSES", async () => {
    const res = await request(app).get("/api/v1/licenses/catalog").set("Cookie", noPermCookie);
    expect(res.status).toBe(403);
  });
  it("200 com LICENSES", async () => {
    const res = await request(app).get("/api/v1/licenses/catalog").set("Cookie", licensesCookie);
    expect(res.status).toBe(200);
  });
});

describe("ADMIN", () => {
  it("acessa LABOR, INFRA e LICENSES mesmo sem nenhuma linha de permissao cadastrada", async () => {
    const labor = await request(app).get("/api/v1/labor/profiles").set("Cookie", adminCookie);
    const infra = await request(app).get("/api/v1/cloud/services").set("Cookie", adminCookie);
    const licenses = await request(app).get("/api/v1/licenses/catalog").set("Cookie", adminCookie);
    expect(labor.status).toBe(200);
    expect(infra.status).toBe(200);
    expect(licenses.status).toBe(200);
  });
});

describe("administracao (CRUD de usuarios)", () => {
  it("403 pra USER, mesmo autenticado", async () => {
    const res = await request(app).get("/api/v1/admin/users").set("Cookie", noPermCookie);
    expect(res.status).toBe(403);
  });

  it("200 pra ADMIN", async () => {
    const res = await request(app).get("/api/v1/admin/users").set("Cookie", adminCookie);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.users)).toBe(true);
  });

  it("cria usuario e devolve a senha inicial em texto puro so nesta resposta", async () => {
    const res = await request(app)
      .post("/api/v1/admin/users")
      .set("Cookie", adminCookie)
      .send({
        name: "Criado No Teste",
        email: `rbac-created${EMAIL_DOMAIN}`,
        password: "SenhaInicial123",
        confirmPassword: "SenhaInicial123",
        role: "USER",
        status: "ACTIVE",
        permissions: ["LABOR"],
      });
    expect(res.status).toBe(201);
    expect(res.body.initialPassword).toBe("SenhaInicial123");
    expect(res.body.email).toBe(`rbac-created${EMAIL_DOMAIN}`);
  });

  it("409 ao repetir o mesmo e-mail", async () => {
    const res = await request(app)
      .post("/api/v1/admin/users")
      .set("Cookie", adminCookie)
      .send({
        name: "Duplicado",
        email: `rbac-created${EMAIL_DOMAIN}`,
        password: "OutraSenha123",
        confirmPassword: "OutraSenha123",
        role: "USER",
        status: "ACTIVE",
        permissions: [],
      });
    expect(res.status).toBe(409);
  });

  it("desativa um usuario e o login dele passa a ser recusado; reativar restaura o login", async () => {
    const deactivate = await request(app).post(`/api/v1/admin/users/${deactivatableUserId}/deactivate`).set("Cookie", adminCookie);
    expect(deactivate.status).toBe(200);

    const loginAfterDeactivate = await request(app).post("/api/v1/auth/login").send({ email: `rbac-deactivatable${EMAIL_DOMAIN}`, password: PASSWORD });
    expect(loginAfterDeactivate.status).toBe(401);

    const activate = await request(app).post(`/api/v1/admin/users/${deactivatableUserId}/activate`).set("Cookie", adminCookie);
    expect(activate.status).toBe(200);

    const loginAfterActivate = await request(app).post("/api/v1/auth/login").send({ email: `rbac-deactivatable${EMAIL_DOMAIN}`, password: PASSWORD });
    expect(loginAfterActivate.status).toBe(200);
  });
});

describe("primeiro acesso (troca obrigatoria de senha)", () => {
  it("bloqueia modulos ate trocar a senha, depois libera", async () => {
    const email = `rbac-firstlogin${EMAIL_DOMAIN}`;
    await insertUser({ name: "Primeiro Acesso", email, passwordHash: hashPassword(PASSWORD), role: "USER", status: "ACTIVE", permissions: ["LABOR"] });
    const cookie = await loginCookie(email);

    const session = await request(app).get("/api/v1/auth/session").set("Cookie", cookie);
    expect(session.body.user.mustChangePassword).toBe(true);

    const blocked = await request(app).get("/api/v1/system-health").set("Cookie", cookie);
    expect(blocked.status).toBe(403);
    expect(blocked.body.error).toBe("password_change_required");

    const changed = await request(app)
      .post("/api/v1/auth/change-password")
      .set("Cookie", cookie)
      .send({ currentPassword: PASSWORD, newPassword: "NovaSenha1234", confirmPassword: "NovaSenha1234" });
    expect(changed.status).toBe(200);

    const allowed = await request(app).get("/api/v1/system-health").set("Cookie", cookie);
    expect(allowed.status).toBe(200);
  });
});
