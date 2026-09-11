import { describe, expect, it } from "vitest";
import { createModule3App } from "../../module3/src/app";
import { buildPncpSearchUrl } from "../../module3/src/sources";
import { parseTenderText } from "../../module3/src/parser";
import request from "supertest";

describe("Módulo 3 isolado", () => {
  it("expõe health sem exigir o banco do core", async () => {
    const response = await request(createModule3App({ port: 3013, requestTimeoutMs: 100, databaseUrl: undefined })).get("/healthz");
    expect(response.status).toBe(200);
    expect(response.body.service).toBe("module3-public-data");
  });

  it("valida termo antes de consultar fontes públicas", async () => {
    const response = await request(createModule3App({ port: 3013, requestTimeoutMs: 100, databaseUrl: undefined })).get("/v1/mod3/public-tenders").query({ term: "x" });
    expect(response.status).toBe(400);
  });

  it("monta a consulta oficial do PNCP com termo e janela", () => {
    const url = buildPncpSearchUrl("Desenvolvedor React", new Date("2026-09-11T12:00:00Z"));
    expect(url.hostname).toBe("pncp.gov.br");
    expect(url.searchParams.get("criterioBusca")).toBe("Desenvolvedor React");
    expect(url.searchParams.get("dataInicial")).toBe("20260812");
  });

  it("extrai valores iniciais de perfis e equipamentos de texto de TR", () => {
    const parsed = parseTenderText("Desenvolvedor Senior: R$ 185,50 por hora\nNotebook i7: R$ 4.200,00");
    expect(parsed.profiles[0].hourlyRate).toBe(185.5);
    expect(parsed.equipment[0].unitPrice).toBe(4200);
  });
});