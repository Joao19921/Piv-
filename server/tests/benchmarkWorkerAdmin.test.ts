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
  const createdJobIds: number[] = [];

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
    if (createdJobIds.length > 0) {
      await query("test_cleanup.delete_benchmark_jobs", `delete from benchmark_jobs where id = any($1::bigint[])`, [createdJobIds]);
    }
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

  it("lista o catalogo de fontes abertas (so Robert Half aprovada)", async () => {
    const res = await request(app).get("/api/v1/admin/benchmark-worker/open-sources").set("Cookie", adminCookie);
    expect(res.status).toBe(200);
    expect(res.body.openSources).toHaveLength(1);
    expect(res.body.openSources[0]).toMatchObject({ name: "robert_half", url: "https://www.roberthalf.com/br/pt/insights/guia-salarial/tecnologia" });
  });

  it("rejeita registro manual sem cargo", async () => {
    const res = await request(app)
      .post("/api/v1/admin/benchmark-worker/manual-entry")
      .set("Cookie", adminCookie)
      .send({ roleTitle: "", regime: "clt", salaryMin: 10000, salaryMax: 15000, currency: "brl", periodicity: "monthly", observedAt: "2026-09-11", openSource: "robert_half" });
    expect(res.status).toBe(400);
  });

  it("rejeita registro manual com fonte desconhecida", async () => {
    const res = await request(app)
      .post("/api/v1/admin/benchmark-worker/manual-entry")
      .set("Cookie", adminCookie)
      .send({ roleTitle: "Analista de BI", regime: "clt", salaryMin: 10000, salaryMax: 15000, currency: "brl", periodicity: "monthly", observedAt: "2026-09-11", openSource: "salary_com" });
    expect(res.status).toBe(400);
  });

  it("rejeita quando o minimo e maior que o maximo", async () => {
    const res = await request(app)
      .post("/api/v1/admin/benchmark-worker/manual-entry")
      .set("Cookie", adminCookie)
      .send({ roleTitle: "Analista de BI", regime: "clt", salaryMin: 20000, salaryMax: 10000, currency: "brl", periodicity: "monthly", observedAt: "2020-01-05", openSource: "robert_half" });
    expect(res.status).toBe(400);
  });

  it("registra uma observacao manual, resolve a URL da fonte no servidor e ela aparece no historico de execucoes", async () => {
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
        observedAt: "2020-01-15",
        openSource: "robert_half",
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

    const rows = await query<{ source_reference: string; open_source: string }>(
      "test.check_resolved_source",
      "select source_reference, open_source from benchmark_results where source = 'manual' and role_title = 'Analista de BI' and observed_at = '2020-01-15'",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].open_source).toBe("robert_half");
    expect(rows[0].source_reference).toBe("https://www.roberthalf.com/br/pt/insights/guia-salarial/tecnologia");
  });

  it("reenviar o mesmo cargo/data atualiza a observacao em vez de duplicar (idempotencia)", async () => {
    const payload = {
      roleTitle: "Analista de BI",
      regime: "clt" as const,
      salaryMin: 10000,
      salaryMax: 15000,
      currency: "brl" as const,
      periodicity: "monthly" as const,
      observedAt: "2020-02-20",
      openSource: "robert_half",
    };
    const first = await request(app).post("/api/v1/admin/benchmark-worker/manual-entry").set("Cookie", adminCookie).send(payload);
    const second = await request(app).post("/api/v1/admin/benchmark-worker/manual-entry").set("Cookie", adminCookie).send({ ...payload, salaryMin: 11000 });
    // Cada chamada cria sua propria linha em benchmark_runs (so benchmark_results e upsert) --
    // as duas precisam ser limpas no afterAll.
    createdRunIds.push(first.body.runId, second.body.runId);

    const rows = await query<{ salary_min: string }>(
      "test.count_results_by_reference",
      "select salary_min from benchmark_results where source = 'manual' and role_title = $1 and observed_at = $2",
      [payload.roleTitle, payload.observedAt],
    );
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].salary_min)).toBe(11000);
  });

  it("consulta um cargo e traz a visao da base publica do governo e da base aberta, com media dos pontos reais", async () => {
    const res = await request(app)
      .get("/api/v1/admin/benchmark-worker/role-lookup")
      .query({ role: "Analista de BI" })
      .set("Cookie", adminCookie);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.government)).toBe(true);
    const openMatch = res.body.openResults.find((r: { observed_at: string }) => r.observed_at === "2020-02-20");
    expect(openMatch).toBeTruthy();
    expect(openMatch.open_source_label).toContain("Robert Half");
    // A observacao registrada acima (midpoint 12500) precisa entrar nos pontos usados na media.
    expect(res.body.points.some((p: { value: number }) => p.value === 12500)).toBe(true);
  });

  it("rejeita consulta de cargo sem informar o cargo", async () => {
    const res = await request(app).get("/api/v1/admin/benchmark-worker/role-lookup").set("Cookie", adminCookie);
    expect(res.status).toBe(400);
  });

  it("lista gatilhos pendentes de reavaliacao e fecha o gatilho quando uma nova observacao e registrada", async () => {
    const [profile] = await query<{ id: number }>(
      "test.find_seeded_profile",
      "select id from benchmark_profiles where role_title = 'Analista de BI' and seniority = 'Sênior' and state is null",
    );
    expect(profile).toBeTruthy();

    const [job] = await query<{ id: number }>(
      "test.insert_pending_job",
      "insert into benchmark_jobs (profile_id, source, status) values ($1, 'manual', 'pending') returning id",
      [profile.id],
    );
    createdJobIds.push(job.id);

    const listRes = await request(app).get("/api/v1/admin/benchmark-worker/open-source-triggers").set("Cookie", adminCookie);
    expect(listRes.status).toBe(200);
    expect(listRes.body.triggers.some((t: { job_id: number }) => t.job_id === job.id)).toBe(true);

    const createRes = await request(app)
      .post("/api/v1/admin/benchmark-worker/manual-entry")
      .set("Cookie", adminCookie)
      .send({
        roleTitle: "Analista de BI",
        seniority: "Sênior",
        state: null,
        regime: "clt",
        salaryMin: 10000,
        salaryMax: 15000,
        currency: "brl",
        periodicity: "monthly",
        observedAt: "2020-03-25",
        openSource: "robert_half",
      });
    expect(createRes.status).toBe(201);
    createdRunIds.push(createRes.body.runId);

    const afterRes = await request(app).get("/api/v1/admin/benchmark-worker/open-source-triggers").set("Cookie", adminCookie);
    expect(afterRes.body.triggers.some((t: { job_id: number }) => t.job_id === job.id)).toBe(false);
  });
});
