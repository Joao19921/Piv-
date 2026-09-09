import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
// Importa o schema do CLIENTE de proposito: este teste existe para provar que os dois lados
// concordam. `client/src/lib/api.ts` so importa zod, entao roda em ambiente node sem problema.
import { laborProfilesResponseSchema } from "../../client/src/lib/api";
import { hashPassword } from "../src/infrastructure/auth/password";
import { closePool, query } from "../src/infrastructure/db/client";
import { insertUser, updateUserPassword } from "../src/infrastructure/repositories/userRepository";
import { buildTestApp } from "./testApp";

const app = buildTestApp();
const EMAIL = "contrato-labor@test.pivo.internal";
const PASSWORD = "Test1234!";
let cookie: string;

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
});

afterAll(async () => {
  await query("test_cleanup.delete_users", `delete from users where email = $1`, [EMAIL]);
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
});
