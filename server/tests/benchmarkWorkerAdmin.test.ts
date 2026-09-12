import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hashPassword } from "../src/infrastructure/auth/password";
import { closePool, query } from "../src/infrastructure/db/client";
import { insertUser, updateUserPassword } from "../src/infrastructure/repositories/userRepository";
import { buildTestApp } from "./testApp";

describe("Administração do Benchmark Worker", () => {
  const app = buildTestApp();
  const EMAIL_DOMAIN = "@test.pivo.internal";
  const PASSWORD = "Test1234!";
  let adminCookie: string;
  let userCookie: string;

  beforeAll(async () => {
    const adminId = await insertUser({ name: "Benchmark Admin", email: `bmworker-admin${EMAIL_DOMAIN}`, passwordHash: hashPassword(PASSWORD), role: "ADMIN", status: "ACTIVE", permissions: [] });
    await updateUserPassword(adminId, hashPassword(PASSWORD), false);
    const adminRes = await request(app).post("/api/v1/auth/login").send({ email: `bmworker-admin${EMAIL_DOMAIN}`, password: PASSWORD });
    const adminSetCookie = adminRes.headers["set-cookie"];
    adminCookie = Array.isArray(adminSetCookie) ? adminSetCookie[0] : adminSetCookie;

    const userId = await insertUser({ name: "Benchmark User", email: `bmworker-user${EMAIL_DOMAIN}`, passwordHash: hashPassword(PASSWORD), role: "USER", status: "ACTIVE", permissions: ["LABOR"] });
    await updateUserPassword(userId, hashPassword(PASSWORD), false);
    const userRes = await request(app).post("/api/v1/auth/login").send({ email: `bmworker-user${EMAIL_DOMAIN}`, password: PASSWORD });
    const userSetCookie = userRes.headers["set-cookie"];
    userCookie = Array.isArray(userSetCookie) ? userSetCookie[0] : userSetCookie;
  });

  afterAll(async () => {
    await query("test_cleanup.delete_users", `delete from users where email like $1`, [`bmworker-%${EMAIL_DOMAIN}`]);
    await closePool();
  });

  it("bloqueia quem nao tem a permissao BENCHMARK_WORKER", async () => {
    const res = await request(app).get("/api/v1/admin/benchmark-worker/sources").set("Cookie", userCookie);
    expect(res.status).toBe(403);
  });

  it("lista as fontes cadastradas (indeed/glassdoor/infojobs desabilitadas, manual habilitada)", async () => {
    const res = await request(app).get("/api/v1/admin/benchmark-worker/sources").set("Cookie", adminCookie);
    expect(res.status).toBe(200);
    const byName = Object.fromEntries(res.body.sources.map((s: { name: string; status: string }) => [s.name, s.status]));
    expect(byName).toEqual({ indeed: "disabled", glassdoor: "disabled", infojobs: "disabled", manual: "enabled" });
  });

  it("lista o historico de execucoes (formato, sem exigir conteudo especifico)", async () => {
    const res = await request(app).get("/api/v1/admin/benchmark-worker/runs").set("Cookie", adminCookie);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.runs)).toBe(true);
  });

  it("rejeita consulta de cargo sem informar o cargo", async () => {
    const res = await request(app).get("/api/v1/admin/benchmark-worker/role-lookup").set("Cookie", adminCookie);
    expect(res.status).toBe(400);
  });

  it("consulta um cargo e traz os perfis da base publica do governo (CAGED/SISP)", async () => {
    const res = await request(app)
      .get("/api/v1/admin/benchmark-worker/role-lookup")
      .query({ role: "Analista de BI" })
      .set("Cookie", adminCookie);
    expect(res.status).toBe(200);
    expect(res.body.role).toBe("Analista de BI");
    expect(Array.isArray(res.body.government)).toBe(true);
    expect(res.body.government.every((p: { title: string }) => p.title.toLowerCase().includes("analista de bi"))).toBe(true);
  });

  it("devolve lista vazia para um cargo sem correspondencia no catalogo", async () => {
    const res = await request(app)
      .get("/api/v1/admin/benchmark-worker/role-lookup")
      .query({ role: "cargo-inexistente-xyz" })
      .set("Cookie", adminCookie);
    expect(res.status).toBe(200);
    expect(res.body.government).toEqual([]);
  });
});
