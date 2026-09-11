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
  const createdRunIds: number[] = [];

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
    // benchmark_results tem "on delete cascade" a partir de benchmark_runs, nao o inverso --
    // apagar so os resultados deixaria a linha de benchmark_runs orfa para sempre no banco
    // compartilhado (o mesmo que a tela "Execucoes recentes" exibe). Apagar os runs por id
    // resolve os dois de uma vez.
    if (createdRunIds.length > 0) {
      await query("test_cleanup.delete_benchmark_runs", `delete from benchmark_runs where id = any($1::bigint[])`, [createdRunIds]);
    }
    await closePool();
  });

  it("bloqueia quem nao e ADMIN", async () => {
    const res = await request(app).get("/api/v1/admin/benchmark-worker/sources").set("Cookie", userCookie);
    expect(res.status).toBe(403);
  });

  it("lista as fontes cadastradas (indeed/glassdoor/infojobs desabilitadas, manual habilitada)", async () => {
    const res = await request(app).get("/api/v1/admin/benchmark-worker/sources").set("Cookie", adminCookie);
    expect(res.status).toBe(200);
    const byName = Object.fromEntries(res.body.sources.map((s: { name: string; status: string }) => [s.name, s.status]));
    expect(byName).toEqual({ indeed: "disabled", glassdoor: "disabled", infojobs: "disabled", manual: "enabled" });
  });

  it("rejeita registro manual sem referencia da fonte", async () => {
    const res = await request(app)
      .post("/api/v1/admin/benchmark-worker/manual-entry")
      .set("Cookie", adminCookie)
      .send({ roleTitle: "Analista de BI", regime: "clt", salaryMin: 10000, salaryMax: 15000, currency: "brl", periodicity: "monthly", observedAt: "2026-09-11", sourceReference: "" });
    expect(res.status).toBe(400);
  });

  it("rejeita quando o minimo e maior que o maximo", async () => {
    const res = await request(app)
      .post("/api/v1/admin/benchmark-worker/manual-entry")
      .set("Cookie", adminCookie)
      .send({ roleTitle: "Analista de BI", regime: "clt", salaryMin: 20000, salaryMax: 10000, currency: "brl", periodicity: "monthly", observedAt: "2026-09-11", sourceReference: "vitest://caso-invalido" });
    expect(res.status).toBe(400);
  });

  it("rejeita urls arbitrarias e lead-gen fora da lista autorizada", async () => {
    const res1 = await request(app)
      .post("/api/v1/admin/benchmark-worker/manual-entry")
      .set("Cookie", adminCookie)
      .send({ roleTitle: "Analista de BI", regime: "clt", salaryMin: 10000, salaryMax: 15000, currency: "brl", periodicity: "monthly", observedAt: "2026-09-11", sourceReference: "https://example.com/guia-salarial" });
    expect(res1.status).toBe(400);
    expect(res1.body.error).toMatch(/fonte pública autorizada|autorizada/i);

    const res2 = await request(app)
      .post("/api/v1/admin/benchmark-worker/manual-entry")
      .set("Cookie", adminCookie)
      .send({ roleTitle: "Analista de BI", regime: "clt", salaryMin: 10000, salaryMax: 15000, currency: "brl", periodicity: "monthly", observedAt: "2026-09-11", sourceReference: "https://www.michaelpage.com.br/pt/job/analista-de-bi" });
    expect(res2.status).toBe(400);
  });

  it("aceita apenas referencias publicas autorizadas do allowlist", async () => {
    const res1 = await request(app)
      .post("/api/v1/admin/benchmark-worker/manual-entry")
      .set("Cookie", adminCookie)
      .send({ roleTitle: "Analista de BI", regime: "clt", salaryMin: 10000, salaryMax: 15000, currency: "brl", periodicity: "monthly", observedAt: "2026-09-11", sourceReference: "https://www.roberthalf.com/br/pt/insights/guia-salarial/tecnologia" });
    expect(res1.status).toBe(201);
    createdRunIds.push(res1.body.runId);

    const res2 = await request(app)
      .post("/api/v1/admin/benchmark-worker/manual-entry")
      .set("Cookie", adminCookie)
      .send({ roleTitle: "Analista de BI", regime: "clt", salaryMin: 11000, salaryMax: 16000, currency: "brl", periodicity: "monthly", observedAt: "2026-09-11", sourceReference: "https://www.salary.com/research/salary?job=senior+data+analyst" });
    expect(res2.status).toBe(201);
    createdRunIds.push(res2.body.runId);
  });

  it("registra uma observacao manual e ela aparece no historico de execucoes", async () => {
    const reference = `vitest://guia-teste-${Date.now()}`;
    const createRes = await request(app)
      .post("/api/v1/admin/benchmark-worker/manual-entry")
      .set("Cookie", adminCookie)
      .send({
        roleTitle: "Analista de BI",
        seniority: "Sênior",
        state: "SP",
        regime: "clt",
        salaryMin: 10000,
        salaryMax: 15000,
        currency: "brl",
        periodicity: "monthly",
        observedAt: "2026-09-11",
        sourceReference: reference,
      });
    expect(createRes.status).toBe(201);
    expect(createRes.body.ok).toBe(true);
    createdRunIds.push(createRes.body.runId);

    const runsRes = await request(app).get("/api/v1/admin/benchmark-worker/runs").set("Cookie", adminCookie);
    expect(runsRes.status).toBe(200);
    const created = runsRes.body.runs.find((r: { id: number }) => r.id === createRes.body.runId);
    expect(created).toBeTruthy();
    expect(created.status).toBe("success");
    expect(created.triggered_by).toBe("manual");
    expect(created.source_summary).toEqual([{ source: "manual", status: "success", observations: 1, error_summary: null }]);
  });

  it("reenviar a mesma referencia/data atualiza a observacao em vez de duplicar (idempotencia)", async () => {
    const reference = `vitest://idempotencia-${Date.now()}`;
    const payload = {
      roleTitle: "Analista de BI",
      regime: "clt",
      salaryMin: 10000,
      salaryMax: 15000,
      currency: "brl",
      periodicity: "monthly",
      observedAt: "2026-09-11",
      sourceReference: reference,
    };
    const first = await request(app).post("/api/v1/admin/benchmark-worker/manual-entry").set("Cookie", adminCookie).send(payload);
    const second = await request(app).post("/api/v1/admin/benchmark-worker/manual-entry").set("Cookie", adminCookie).send({ ...payload, salaryMin: 11000 });
    // Cada chamada cria sua propria linha em benchmark_runs (so benchmark_results e upsert) --
    // as duas precisam ser limpas no afterAll.
    createdRunIds.push(first.body.runId, second.body.runId);

    const rows = await query<{ salary_min: string }>(
      "test.count_results_by_reference",
      "select salary_min from benchmark_results where source_reference = $1",
      [reference],
    );
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].salary_min)).toBe(11000);
  });
});
