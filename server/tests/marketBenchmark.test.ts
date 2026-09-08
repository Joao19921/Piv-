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

beforeAll(async () => {
  const laborId = await insertUser({ name: "Benchmark Labor", email: `benchmark-labor${EMAIL_DOMAIN}`, passwordHash: hashPassword(PASSWORD), role: "USER", status: "ACTIVE", permissions: ["LABOR"] });
  await updateUserPassword(laborId, hashPassword(PASSWORD), false);
  const noPermId = await insertUser({ name: "Benchmark Sem Permissao", email: `benchmark-noperm${EMAIL_DOMAIN}`, passwordHash: hashPassword(PASSWORD), role: "USER", status: "ACTIVE", permissions: [] });
  await updateUserPassword(noPermId, hashPassword(PASSWORD), false);

  laborCookie = await loginCookie(`benchmark-labor${EMAIL_DOMAIN}`);
  noPermCookie = await loginCookie(`benchmark-noperm${EMAIL_DOMAIN}`);
});

afterAll(async () => {
  await query("test_cleanup.delete_benchmark_searches", `delete from market_benchmark_searches where role_searched = $1`, ["Teste automatizado de benchmark"]);
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
});
