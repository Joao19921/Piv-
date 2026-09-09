import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hashPassword } from "../src/infrastructure/auth/password";
import { closePool, query } from "../src/infrastructure/db/client";
import { insertUser, updateUserPassword } from "../src/infrastructure/repositories/userRepository";
import { buildTestApp } from "./testApp";

const app = buildTestApp();
const EMAIL_DOMAIN = "@test.pivo.internal";
const PASSWORD = "Test1234!";

async function loginCookie(email: string): Promise<string> {
  const res = await request(app).post("/api/v1/auth/login").send({ email, password: PASSWORD });
  const cookie = res.headers["set-cookie"];
  if (!cookie) throw new Error(`Login falhou pra ${email}: ${JSON.stringify(res.body)}`);
  return Array.isArray(cookie) ? cookie[0] : cookie;
}

let laborCookie: string;
let noPermCookie: string;
let outroLaborCookie: string;

beforeAll(async () => {
  const laborId = await insertUser({ name: "Benchmark Labor", email: `benchmark-labor${EMAIL_DOMAIN}`, passwordHash: hashPassword(PASSWORD), role: "USER", status: "ACTIVE", permissions: ["LABOR"] });
  await updateUserPassword(laborId, hashPassword(PASSWORD), false);
  const noPermId = await insertUser({ name: "Benchmark Sem Permissao", email: `benchmark-noperm${EMAIL_DOMAIN}`, passwordHash: hashPassword(PASSWORD), role: "USER", status: "ACTIVE", permissions: [] });
  await updateUserPassword(noPermId, hashPassword(PASSWORD), false);
  // Segundo usuario com LABOR: existe so para provar que um nao ve o historico do outro.
  const outroLaborId = await insertUser({ name: "Benchmark Outro Labor", email: `benchmark-outro${EMAIL_DOMAIN}`, passwordHash: hashPassword(PASSWORD), role: "USER", status: "ACTIVE", permissions: ["LABOR"] });
  await updateUserPassword(outroLaborId, hashPassword(PASSWORD), false);

  laborCookie = await loginCookie(`benchmark-labor${EMAIL_DOMAIN}`);
  noPermCookie = await loginCookie(`benchmark-noperm${EMAIL_DOMAIN}`);
  outroLaborCookie = await loginCookie(`benchmark-outro${EMAIL_DOMAIN}`);
});

afterAll(async () => {
  // O historico e salvo em fire-and-forget (nao bloqueia a resposta da busca -- ver
  // marketBenchmark.ts) -- sem essa pausa, a limpeza corre risco de apagar a linha pai
  // (market_benchmark_searches) antes do INSERT filho (market_benchmark_sources) em segundo
  // plano terminar, violando a FK. So acontece nesse teardown agressivo do teste; em produção
  // nada apaga uma busca recem-feita nesse intervalo.
  await new Promise((resolve) => setTimeout(resolve, 500));
  await query("test_cleanup.delete_benchmark_searches", `delete from market_benchmark_searches where role_searched = any($1)`, [
    ["Teste automatizado de benchmark", "Consultor SAP FI/CO senior automatizado", "Desenvolvedor Backend automatizado", "Cargo privado do usuario A"],
  ]);
  // Prefixo proprio (nao o dominio inteiro): outro arquivo de teste roda em paralelo (mesmo
  // worker pool do vitest) e tambem usa @test.pivo.internal -- um DELETE por dominio inteiro
  // apagaria as fixtures do outro arquivo no meio da execucao dele.
  await query("test_cleanup.delete_users", `delete from users where email like $1`, [`benchmark-%${EMAIL_DOMAIN}`]);
  await closePool();
});

describe("POST /market-benchmark/search", () => {
  it("exige permissao LABOR (403 sem ela)", async () => {
    const res = await request(app)
      .post("/api/v1/market-benchmark/search")
      .set("Cookie", noPermCookie)
      .send({ role: "Teste automatizado de benchmark" });
    expect(res.status).toBe(403);
  });

  it("responde 400 sem cargo", async () => {
    const res = await request(app).post("/api/v1/market-benchmark/search").set("Cookie", laborCookie).send({ role: "" });
    expect(res.status).toBe(400);
  });

  // Regressao: a resposta precisa incluir "name" (como toda fonte em ApiSourceResult) -- sem
  // isso, o schema zod do cliente falha ao validar (campo obrigatorio ausente) e a busca aparece
  // como erro generico pro usuario mesmo quando o backend computou e salvou o resultado com sucesso.
  it("inclui 'name' e o resultado do fallback estatico na resposta", async () => {
    const res = await request(app)
      .post("/api/v1/market-benchmark/search")
      .set("Cookie", laborCookie)
      .send({ role: "Teste automatizado de benchmark", state: "SP", city: "São Paulo" });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe("Benchmark salarial");
    expect(res.body.status).toBeDefined();
    expect(res.body.data).not.toBeNull();
    expect(res.body.data.roleSearched).toBe("Teste automatizado de benchmark");
    expect(res.body.data.city).toBe("São Paulo");
    expect(Array.isArray(res.body.data.sources)).toBe(true);
    expect(res.body.data.sources.length).toBeGreaterThan(0);
  });

  // Regressao: um cargo sem categoria correspondente (ex.: consultoria funcional de ERP/SAP,
  // que o catalogo nao cobre) tem que vir marcado como hasDirectMatch:false e com mais de uma
  // fonte generica variada -- sem isso o cliente aplicava automaticamente um perfil generico
  // (ex.: "Analista de Sistemas") como se fosse o cargo buscado, e sempre devolvia so 2 fontes,
  // as duas por acaso CLT, confundindo o usuario ("CLT e CLT, nao entendi").
  it("marca hasDirectMatch:false e devolve varias fontes genericas (CLT e PJ) quando o cargo nao tem categoria no catalogo", async () => {
    const res = await request(app)
      .post("/api/v1/market-benchmark/search")
      .set("Cookie", laborCookie)
      .send({ role: "Consultor SAP FI/CO senior automatizado", state: "SP", city: "São Paulo" });

    expect(res.status).toBe(200);
    expect(res.body.data.hasDirectMatch).toBe(false);
    expect(res.body.data.sources.length).toBeGreaterThanOrEqual(4);
    const models = new Set(res.body.data.sources.map((s: { employmentModel: string }) => s.employmentModel));
    expect(models.has("CLT")).toBe(true);
    expect(models.has("PJ")).toBe(true);
    expect(res.body.data.summary).toContain("Não encontramos um perfil específico");
  });

  it("marca hasDirectMatch:true quando o cargo bate com uma categoria real do catalogo", async () => {
    const res = await request(app)
      .post("/api/v1/market-benchmark/search")
      .set("Cookie", laborCookie)
      .send({ role: "Desenvolvedor Backend automatizado", state: "SP", city: "São Paulo" });

    expect(res.status).toBe(200);
    expect(res.body.data.hasDirectMatch).toBe(true);
  });
});

describe("GET /market-benchmark/history", () => {
  // Regressao (vazamento horizontal): a rota fazia `order by generated_at desc limit 50` sem
  // filtro nenhum, e a tabela nem tinha coluna de dono -- entao qualquer usuario com LABOR via
  // as buscas de todos os outros, incluindo o campo `notes`, que e texto livre onde o analista
  // cola nome de cliente e contexto da negociacao. Ver migration 0007.
  it("nao expoe a busca de um usuario no historico de outro", async () => {
    const cargoPrivado = "Cargo privado do usuario A";

    const busca = await request(app)
      .post("/api/v1/market-benchmark/search")
      .set("Cookie", laborCookie)
      .send({ role: cargoPrivado, state: "SP", city: "São Paulo", notes: "Proposta confidencial do cliente X" });
    expect(busca.status).toBe(200);

    // O historico e gravado em fire-and-forget (nao bloqueia a resposta da busca), entao a
    // leitura logo abaixo precisa esperar a escrita em segundo plano terminar.
    await new Promise((resolve) => setTimeout(resolve, 500));

    const historicoDoDono = await request(app).get("/api/v1/market-benchmark/history").set("Cookie", laborCookie);
    expect(historicoDoDono.status).toBe(200);
    expect(historicoDoDono.body.entries.some((e: { roleSearched: string }) => e.roleSearched === cargoPrivado)).toBe(true);

    const historicoDoOutro = await request(app).get("/api/v1/market-benchmark/history").set("Cookie", outroLaborCookie);
    expect(historicoDoOutro.status).toBe(200);
    expect(historicoDoOutro.body.entries.some((e: { roleSearched: string }) => e.roleSearched === cargoPrivado)).toBe(false);
    // E nao basta nao vazar aquele cargo: o outro usuario nao deve ver NENHUMA busca alheia.
    const notasAlheias = historicoDoOutro.body.entries.map((e: { notes?: string }) => e.notes ?? "");
    expect(notasAlheias.some((n: string) => n.includes("Proposta confidencial"))).toBe(false);
  });
});
