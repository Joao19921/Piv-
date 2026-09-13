import { describe, expect, it } from "vitest";
import { createModule3App } from "../../module3/src/app";
import { CATSER_CATALOG, findCatserCategory } from "../../module3/src/catserCatalog";
import { buildPesquisaPrecoUrl, buildPncpSearchUrl } from "../../module3/src/sources";
import { parseTenderText } from "../../module3/src/parser";
import request from "supertest";

describe("Módulo 3 isolado", () => {
  it("expõe health sem exigir o banco do core", async () => {
    const response = await request(createModule3App({ port: 3013, requestTimeoutMs: 100, maxRetries: 0, databaseUrl: undefined })).get("/healthz");
    expect(response.status).toBe(200);
    expect(response.body.service).toBe("module3-public-data");
  });

  it("valida termo antes de consultar fontes públicas", async () => {
    const response = await request(createModule3App({ port: 3013, requestTimeoutMs: 100, maxRetries: 0, databaseUrl: undefined })).get("/v1/mod3/public-tenders").query({ term: "x" });
    expect(response.status).toBe(400);
  });

  it("monta a consulta oficial do PNCP com termo e janela", () => {
    const url = buildPncpSearchUrl("Desenvolvedor React", new Date("2026-09-11T12:00:00Z"));
    expect(url.hostname).toBe("pncp.gov.br");
    expect(url.searchParams.get("criterioBusca")).toBe("Desenvolvedor React");
    expect(url.searchParams.get("dataInicial")).toBe("20260812");
    expect(url.searchParams.get("codigoModalidadeContratacao")).toBe("6");
    expect(url.searchParams.get("tamanhoPagina")).toBe("10");
    expect(buildPncpSearchUrl("software", new Date("2026-09-11T12:00:00Z"), { startDate: "2026-08-01", endDate: "2026-08-31" }).searchParams.get("dataInicial")).toBe("20260801");
    expect(buildPncpSearchUrl("software", new Date("2026-09-11T12:00:00Z"), { uf: "sp", pageSize: 10 }).search).toContain("uf=SP");
  });

  it("extrai valores iniciais de perfis e equipamentos de texto de TR", () => {
    const parsed = parseTenderText("Desenvolvedor Senior: R$ 185,50 por hora\nNotebook i7: R$ 4.200,00");
    expect(parsed.profiles[0].hourlyRate).toBe(185.5);
    expect(parsed.equipment[0].unitPrice).toBe(4200);
  });

  it("monta a consulta do modulo Pesquisa de Preco com o codigoItemCatalogo certo", () => {
    const url = buildPesquisaPrecoUrl(25887);
    expect(url.hostname).toBe("dadosabertos.compras.gov.br");
    expect(url.pathname).toBe("/modulo-pesquisa-preco/3_consultarServico");
    expect(url.searchParams.get("codigoItemCatalogo")).toBe("25887");
    expect(url.searchParams.get("tamanhoPagina")).toBe("100");
    expect(buildPesquisaPrecoUrl(25887, { pageSize: 10 }).searchParams.get("tamanhoPagina")).toBe("10");
  });

  it("catalogo CATSER so tem codigos numericos e chaves unicas", () => {
    expect(CATSER_CATALOG.length).toBeGreaterThan(0);
    expect(new Set(CATSER_CATALOG.map((c) => c.key)).size).toBe(CATSER_CATALOG.length);
    expect(CATSER_CATALOG.every((c) => Number.isInteger(c.codigoItemCatalogo) && c.codigoItemCatalogo > 0)).toBe(true);
  });

  it("service-price-categories expõe o catalogo sem exigir o banco do modulo", async () => {
    const response = await request(createModule3App({ port: 3013, requestTimeoutMs: 100, maxRetries: 0, databaseUrl: undefined })).get("/v1/mod3/service-price-categories");
    expect(response.status).toBe(200);
    expect(response.body.data).toEqual(CATSER_CATALOG.map(({ key, label }) => ({ key, label })));
  });

  it("service-prices rejeita categoria desconhecida", async () => {
    const response = await request(createModule3App({ port: 3013, requestTimeoutMs: 100, maxRetries: 0, databaseUrl: undefined })).get("/v1/mod3/service-prices").query({ categoria: "categoria-inexistente" });
    expect(response.status).toBe(400);
    expect(findCatserCategory("categoria-inexistente")).toBeUndefined();
  });
});