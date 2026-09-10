import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { computeLaborRate } from "../src/domain/services/laborPricing";
import { hashPassword } from "../src/infrastructure/auth/password";
import { closePool, query } from "../src/infrastructure/db/client";
import { insertUser, updateUserPassword } from "../src/infrastructure/repositories/userRepository";
import { buildTestApp } from "./testApp";

describe("computeLaborRate", () => {
  it("aplica custos, encargos e margem como percentuais adicionais", () => {
    const result = computeLaborRate({ monthlySalary: 15500, costsAndChargesPct: 42, marginPct: 22 });
    expect(result.monthlyCost).toBeCloseTo(22010, 2);
    expect(result.billableHours).toBe(168);
    expect(result.hourlyCost).toBeCloseTo(22010 / 168, 6);
    expect(result.suggestedRate).toBeCloseTo(result.hourlyCost * 1.22, 6);
    expect(result.suggestedRate).toBeCloseTo(159.83, 1);
  });

  it("com custos e margem zerados, divide a remuneracao mensal por 168", () => {
    const result = computeLaborRate({ monthlySalary: 10000, costsAndChargesPct: 0, marginPct: 0 });
    expect(result.monthlyCost).toBe(10000);
    expect(result.hourlyCost).toBeCloseTo(10000 / 168, 6);
    expect(result.suggestedRate).toBeCloseTo(10000 / 168, 6);
  });

  it("nunca deixa a taxa sugerida menor que o custo-hora (percentuais negativos sao tratados como 0)", () => {
    const result = computeLaborRate({ monthlySalary: 10000, costsAndChargesPct: -50, marginPct: -10 });
    expect(result.suggestedRate).toBeCloseTo(result.hourlyCost, 6);
  });

  it("aceita percentuais acima de 100% sem distorcer a base de calculo", () => {
    const result = computeLaborRate({ monthlySalary: 10000, costsAndChargesPct: 100, marginPct: 100 });
    expect(result.monthlyCost).toBe(20000);
    expect(result.suggestedRate).toBeCloseTo((20000 / 168) * 2, 6);
  });

  it("salario negativo e tratado como 0, sem gerar custo negativo", () => {
    const result = computeLaborRate({ monthlySalary: -5000, costsAndChargesPct: 42, marginPct: 20 });
    expect(result.monthlyCost).toBe(0);
    expect(result.hourlyCost).toBe(0);
    expect(result.suggestedRate).toBe(0);
  });

  it("custos e encargos incidem sobre a remuneracao mensal", () => {
    const base = computeLaborRate({ monthlySalary: 8000, costsAndChargesPct: 0, marginPct: 0 });
    const withCosts = computeLaborRate({ monthlySalary: 8000, costsAndChargesPct: 50, marginPct: 0 });
    expect(withCosts.monthlyCost).toBeCloseTo(base.monthlyCost * 1.5, 6);
    expect(withCosts.suggestedRate).toBeCloseTo(base.suggestedRate * 1.5, 6);
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
      .send({ monthlySalary: 15500, costsAndChargesPct: 42, marginPct: 22 });

    expect(res.status).toBe(200);
    const expected = computeLaborRate({ monthlySalary: 15500, costsAndChargesPct: 42, marginPct: 22 });
    expect(res.body.monthlyCost).toBeCloseTo(expected.monthlyCost, 6);
    expect(res.body.hourlyCost).toBeCloseTo(expected.hourlyCost, 6);
    expect(res.body.suggestedRate).toBeCloseTo(expected.suggestedRate, 6);
    expect(res.body.billableHours).toBe(168);
  });

  it("rejeita com 400 quando os campos nao sao numericos (ex.: string mal formatada chegando do cliente)", async () => {
    const res = await request(app)
      .post("/api/v1/labor/estimate")
      .set("Cookie", laborCookie)
      .send({ monthlySalary: "15.500", costsAndChargesPct: 42, marginPct: 22 });

    expect(res.status).toBe(400);
  });
});
