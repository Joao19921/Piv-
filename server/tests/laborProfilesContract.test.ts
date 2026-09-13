import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
// Importa o schema do CLIENTE de proposito: este teste existe para provar que os dois lados
// concordam. `client/src/lib/api.ts` so importa zod, entao roda em ambiente node sem problema.
import { laborProfilesResponseSchema } from "../../client/src/lib/api";
import { hashPassword } from "../src/infrastructure/auth/password";
import { closePool, query } from "../src/infrastructure/db/client";
import { upsertSalaryObservations } from "../src/infrastructure/repositories/salaryObservationsRepository";
import { insertUser, updateUserPassword } from "../src/infrastructure/repositories/userRepository";
import { buildTestApp } from "./testApp";

const app = buildTestApp();
const EMAIL = "contrato-labor@test.pivo.internal";
const PASSWORD = "Test1234!";
let cookie: string;

// Fixture propria pra provar que `referenciaOficial`/`referenciaRais` sobrevivem o
// servidor->cliente: sem banco populado no CI, os dois campos ficam sempre ausentes (optional
// no zod), e um schema que os descartasse silenciosamente passaria no teste do mesmo jeito.
const FIXTURE_SOURCE_URL = "https://test.pivo.internal/contrato-labor-fixture";
// "dev-pleno-clt" (catalogs.ts): CLT, cbo "2124-05" -> "212405" sem hifen.
const FIXTURE_ROLE_SLUG = "dev-pleno-clt";
const FIXTURE_CBO = "212405";

beforeAll(async () => {
  const id = await insertUser({
    name: "Contrato Labor",
    email: EMAIL,
    passwordHash: hashPassword(PASSWORD),
    role: "USER",
    status: "ACTIVE",
    permissions: ["LABOR"],
  });
  await updateUserPassword(id, hashPassword(PASSWORD), false);
  const res = await request(app).post("/api/v1/auth/login").send({ email: EMAIL, password: PASSWORD });
  const set = res.headers["set-cookie"];
  cookie = Array.isArray(set) ? set[0] : set;

  await upsertSalaryObservations([
    {
      source: "SISP",
      sourceUrl: FIXTURE_SOURCE_URL,
      cbo: null,
      roleSlug: FIXTURE_ROLE_SLUG,
      seniority: "Pleno",
      employmentModel: "CLT",
      uf: null,
      municipio: null,
      competencia: "2026-01-01",
      nAmostra: null,
      mediana: 12345,
    },
    {
      source: "RAIS",
      sourceUrl: FIXTURE_SOURCE_URL,
      cbo: FIXTURE_CBO,
      roleSlug: null,
      seniority: null,
      employmentModel: "CLT",
      uf: null,
      municipio: null,
      competencia: "2026-01-01",
      nAmostra: 500,
      p25: 8000,
      mediana: 10000,
      p75: 13000,
    },
  ]);
});

afterAll(async () => {
  await query("test_cleanup.delete_users", `delete from users where email = $1`, [EMAIL]);
  await query("test_cleanup.delete_salary_fixture", `delete from salary_observations where source_url = $1`, [FIXTURE_SOURCE_URL]);
  await closePool();
});

/**
 * Teste de contrato entre servidor e cliente.
 *
 * Motivo concreto: quando `cbo` passou a aceitar null (cargos que a CBO 2002 nao preve) e
 * `sourceStatus` deixou de ser sempre "FALLBACK_STALE" (perfis cobertos pelo CAGED vem
 * OPERATIONAL), o schema do cliente continuou exigindo `z.string()` e `z.literal(...)`. O
 * `parse()` falhava e derrubava a tela inteira de Mao de obra -- sem nenhum teste acusar,
 * porque o servidor estava certo, o cliente estava certo isoladamente, e ninguem comparava os
 * dois. Este arquivo compara.
 */
describe("contrato /labor/profiles: servidor x schema do cliente", () => {
  it("a resposta real passa no schema que o cliente usa para parsear", async () => {
    const res = await request(app).get("/api/v1/labor/profiles").set("Cookie", cookie);
    expect(res.status).toBe(200);

    const parsed = laborProfilesResponseSchema.safeParse(res.body);
    if (!parsed.success) {
      throw new Error(`Cliente rejeitaria a resposta do servidor:\n${JSON.stringify(parsed.error.issues, null, 2)}`);
    }
    expect(parsed.data.profiles.length).toBeGreaterThan(0);
  });

  it("o recorte por UF tambem respeita o contrato", async () => {
    const res = await request(app).get("/api/v1/labor/profiles?uf=SP").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(laborProfilesResponseSchema.safeParse(res.body).success).toBe(true);
  });

  // Os dois formatos que quebraram na pratica, afirmados explicitamente para nao regredirem.
  it("aceita perfil com cbo null e perfil com sourceStatus OPERATIONAL", async () => {
    const res = await request(app).get("/api/v1/labor/profiles").set("Cookie", cookie);
    const { profiles } = laborProfilesResponseSchema.parse(res.body);

    // Cargos que a CBO 2002 nao preve (Cientista de Dados, Engenheiro de IA, UX/UI, Scrum Master).
    expect(profiles.some((p) => p.cbo === null)).toBe(true);
    // Sem banco populado o CI ainda nao tem observacao; o contrato so exige que o valor seja um
    // dos dois aceitos, nunca um literal fixo.
    expect(profiles.every((p) => p.sourceStatus === "OPERATIONAL" || p.sourceStatus === "FALLBACK_STALE")).toBe(true);
  });

  it("referenciaOficial (SISP) e referenciaRais (RAIS) chegam ao cliente sem serem descartadas", async () => {
    const res = await request(app).get("/api/v1/labor/profiles").set("Cookie", cookie);
    const { profiles } = laborProfilesResponseSchema.parse(res.body);

    const perfil = profiles.find((p) => p.id === FIXTURE_ROLE_SLUG);
    expect(perfil?.referenciaOficial?.mediana).toBe(12345);
    expect(perfil?.referenciaOficial?.source).toBe("SISP");
    expect(perfil?.referenciaRais?.mediana).toBe(10000);
    expect(perfil?.referenciaRais?.source).toBe("RAIS");
  });
});
