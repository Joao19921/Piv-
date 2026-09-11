import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { closePool, getTlsVerification } from "../src/infrastructure/db/client";
import { buildTestApp } from "./testApp";

const app = buildTestApp();

afterAll(async () => {
  await closePool();
});

/**
 * Regressao de um incidente real: a aplicacao em producao perdeu acesso ao Postgres, toda rota
 * que consultava passou a responder 500 -- login inclusive -- e o /healthz seguiu devolvendo 200,
 * porque nao tocava o banco. O deploy passou verde com o app inutilizavel e ninguem soube ate um
 * usuario relatar. O smoke test do CI le exatamente o campo `db.status` afirmado aqui.
 */
describe("GET /healthz", () => {
  it("responde 200 sem exigir sessao", async () => {
    const res = await request(app).get("/api/v1/healthz");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
  });

  it("reporta o estado do banco num campo proprio", async () => {
    const res = await request(app).get("/api/v1/healthz");
    expect(res.body.db).toBeDefined();
    expect(["ok", "unreachable", "not_configured"]).toContain(res.body.db.status);
  });

  it("com banco configurado e acessivel, reporta ok com latencia", async () => {
    const res = await request(app).get("/api/v1/healthz");
    // A suite roda com Postgres de verdade (service container no CI).
    expect(res.body.db.status).toBe("ok");
    expect(typeof res.body.db.latencyMs).toBe("number");
  });

  // O Render usa este endpoint como health check: devolver erro quando o banco cai colocaria o
  // servico em loop de restart justamente quando o problema esta fora dele. Liveness e readiness
  // sao perguntas diferentes -- a segunda e um campo, nao um status HTTP.
  it("nao derruba o status HTTP por causa do banco", async () => {
    const res = await request(app).get("/api/v1/healthz");
    expect(res.status).toBe(200);
  });

  it("expoe o commit publicado, que o smoke test compara com o do push", async () => {
    const res = await request(app).get("/api/v1/healthz");
    expect(typeof res.body.commit).toBe("string");
  });
});

describe("modo de TLS da conexao com o banco", () => {
  // Regressao da queda de 10/09/2026: DATABASE_CA_CERT foi preenchida com o CA da conexao direta
  // da Supabase, que nao valida a cadeia do pooler. Com rejectUnauthorized ligado, o handshake
  // falhava e TODA consulta morria -- o app no ar, mas login e qualquer tela com dados em 500,
  // e so quem tem acesso ao painel do provedor conseguia corrigir.
  //
  // O modo agora e resolvido uma vez na subida (`ensureDatabaseTls`) e um CA que nao serve faz a
  // conexao cair para o modo sem verificacao, com aviso alto, em vez de derrubar a aplicacao.
  it("expoe em qual modo a conexao ficou", async () => {
    const res = await request(app).get("/api/v1/healthz");
    expect(["verified", "encrypted_only", "fallback_after_failure", "disabled"]).toContain(res.body.db.tlsVerification);
  });

  it("o estado exposto bate com o do modulo de banco", async () => {
    const res = await request(app).get("/api/v1/healthz");
    expect(res.body.db.tlsVerification).toBe(getTlsVerification());
  });
});
