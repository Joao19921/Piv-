import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { computeLaborRate } from "../src/domain/services/laborPricing";
import { hashPassword } from "../src/infrastructure/auth/password";
import { closePool, query } from "../src/infrastructure/db/client";
import { insertUser, updateUserPassword } from "../src/infrastructure/repositories/userRepository";
import { buildTestApp } from "./testApp";

describe("computeLaborRate", () => {
  it("calcula custo mensal, custo-hora e taxa sugerida (caso padrao da tela)", () => {
    const result = computeLaborRate({ monthlySalary: 15500, factorK: 1.42, marginPct: 22 });
    expect(result.monthlyCost).toBeCloseTo(22010, 2);
    expect(result.billableHours).toBe(168);
    expect(result.hourlyCost).toBeCloseTo(22010 / 168, 6);
    // taxa sugerida = custo-hora / (1 - margem) -- confere a formula de "preco pra cobrir a margem alvo"
    expect(result.suggestedRate).toBeCloseTo(result.hourlyCost / 0.78, 6);
    expect(result.suggestedRate).toBeCloseTo(167.96, 1);
  });

  it("sem margem, a taxa sugerida e igual ao custo-hora", () => {
    const result = computeLaborRate({ monthlySalary: 10000, factorK: 1.5, marginPct: 0 });
    expect(result.hourlyCost).toBeCloseTo(result.suggestedRate, 6);
  });

  it("nunca deixa a taxa sugerida menor que o custo-hora (margem negativa e tratada como 0)", () => {
    const result = computeLaborRate({ monthlySalary: 10000, factorK: 1.5, marginPct: -10 });
    expect(result.suggestedRate).toBeCloseTo(result.hourlyCost, 6);
  });

  it("limita a margem em 95% mesmo se o valor informado for maior", () => {
    const a = computeLaborRate({ monthlySalary: 10000, factorK: 1.5, marginPct: 95 });
    const b = computeLaborRate({ monthlySalary: 10000, factorK: 1.5, marginPct: 999 });
    expect(a.suggestedRate).toBeCloseTo(b.suggestedRate, 6);
  });

  it("salario ou fator K negativos sao tratados como 0, nao geram custo negativo", () => {
    const result = computeLaborRate({ monthlySalary: -5000, factorK: 1.4, marginPct: 20 });
    expect(result.monthlyCost).toBe(0);
    expect(result.hourlyCost).toBe(0);
    expect(result.suggestedRate).toBe(0);
  });

  it("dobrar o Fator K dobra o custo mensal e a taxa sugerida (proporcionalidade)", () => {
    const base = computeLaborRate({ monthlySalary: 8000, factorK: 1.5, marginPct: 20 });
    const doubled = computeLaborRate({ monthlySalary: 8000, factorK: 3, marginPct: 20 });
    expect(doubled.monthlyCost).toBeCloseTo(base.monthlyCost * 2, 6);
    expect(doubled.suggestedRate).toBeCloseTo(base.suggestedRate * 2, 6);
  });
});

describe("POST /labor/estimate", () => {
  const app = buildTestApp();
  const EMAIL_DOMAIN = "@test.pivo.internal";
  const PASSWORD = "Test1234!";
  let laborCookie: string;

  beforeAll(async () => {
    const id = await insertUser({ name: "Labor Estimate", email: `labor-estimate${EMAIL_DOMAIN}`, passwordHash: hashPassword(PASSWORD), role: "USER", status: "ACTIVE", permissions: ["LABOR"] });
    await updateUserPassword(id, hashPassword(PASSWORD), false);
    const res = await request(app).post("/api/v1/auth/login").send({ email: `labor-estimate${EMAIL_DOMAIN}`, password: PASSWORD });
    const cookie = res.headers["set-cookie"];
    laborCookie = Array.isArray(cookie) ? cookie[0] : cookie;
  });

  afterAll(async () => {
    await query("test_cleanup.delete_users", `delete from users where email like $1`, [`labor-estimate%${EMAIL_DOMAIN}`]);
    await closePool();
  });

  it("responde com os mesmos valores calculados por computeLaborRate direto (nao ha divergencia entre rota e funcao pura)", async () => {
    const res = await request(app)
      .post("/api/v1/labor/estimate")
      .set("Cookie", laborCookie)
      .send({ monthlySalary: 15500, factorK: 1.42, marginPct: 22 });

    expect(res.status).toBe(200);
    const expected = computeLaborRate({ monthlySalary: 15500, factorK: 1.42, marginPct: 22 });
    expect(res.body.monthlyCost).toBeCloseTo(expected.monthlyCost, 6);
    expect(res.body.hourlyCost).toBeCloseTo(expected.hourlyCost, 6);
    expect(res.body.suggestedRate).toBeCloseTo(expected.suggestedRate, 6);
    expect(res.body.billableHours).toBe(168);
  });

  it("rejeita com 400 quando os campos nao sao numericos (ex.: string mal formatada chegando do cliente)", async () => {
    const res = await request(app)
      .post("/api/v1/labor/estimate")
      .set("Cookie", laborCookie)
      .send({ monthlySalary: "15.500", factorK: 1.42, marginPct: 22 });

    expect(res.status).toBe(400);
  });
});
