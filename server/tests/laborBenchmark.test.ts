import { describe, expect, it } from "vitest";
import { laborProfiles, type LaborProfile } from "../src/domain/services/catalogs";
import { aplicarObservacao, cboSemHifen, resumirCobertura } from "../src/domain/services/laborBenchmark";
import type { SalaryObservationRow } from "../src/infrastructure/repositories/salaryObservationsRepository";

function perfil(overrides: Partial<LaborProfile> = {}): LaborProfile {
  return {
    id: "teste",
    title: "Analista de Sistemas",
    seniority: "Pleno",
    cbo: "2124-05",
    employmentModel: "CLT",
    monthlyCompensation: 10_000,
    factorK: 1.8,
    benchmarkSource: "catálogo interno",
    sourceStatus: "FALLBACK_STALE",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

function observacao(overrides: Partial<SalaryObservationRow> = {}): SalaryObservationRow {
  return {
    source: "CAGED",
    source_url: "ftp://ftp.mtps.gov.br/pdet/microdados/NOVO%20CAGED/2026/202607/CAGEDMOV202607.7z",
    cbo: "212405",
    role_slug: null,
    seniority: null,
    employment_model: "CLT",
    uf: "SP",
    municipio: null,
    competencia: "2026-07-01",
    n_amostra: 3234,
    // O driver pg devolve `numeric` como string; o codigo tem que converter.
    p25: "4500",
    mediana: "8000",
    p75: "12000",
    media: "8500",
    collected_at: "2026-09-09T13:00:00.000Z",
    ...overrides,
  };
}

describe("aplicarObservacao", () => {
  it("troca a estimativa pela mediana observada e marca a fonte como real", () => {
    const r = aplicarObservacao(perfil(), observacao());

    expect(r.monthlyCompensation).toBe(8000);
    expect(r.sourceStatus).toBe("OPERATIONAL");
    expect(r.benchmarkSource).toContain("CAGED/MTE");
    expect(r.benchmarkSource).toContain("2026-07");
    // n amostral no rotulo nao e enfeite: sem ele nao da para saber se a mediana veio de 3 ou
    // de 3 mil contratacoes.
    expect(r.benchmarkSource).toContain("3234");
    expect(r.observed?.p25).toBe(4500);
    expect(r.observed?.p75).toBe(12000);
    expect(r.observed?.sourceUrl).toContain("CAGEDMOV202607");
  });

  it("preserva a estimativa do catalogo quando nao ha observacao", () => {
    const original = perfil({ monthlyCompensation: 11_800 });
    const r = aplicarObservacao(original, undefined);

    expect(r.monthlyCompensation).toBe(11_800);
    expect(r.sourceStatus).toBe("FALLBACK_STALE");
    expect(r.observed).toBeUndefined();
  });

  // `numeric` do Postgres chega como string pelo driver pg. Se a conversao falhasse em silencio,
  // a tela mostraria NaN ou o valor errado sem nenhum erro.
  it("converte os numeric do Postgres, que chegam como string", () => {
    const r = aplicarObservacao(perfil(), observacao({ mediana: "7333.5", p25: "4208", p75: "11000" }));
    expect(r.observed?.mediana).toBe(7333.5);
    expect(typeof r.observed?.p25).toBe("number");
  });

  it("cai para a estimativa se a observacao vier com percentil nulo", () => {
    const r = aplicarObservacao(perfil(), observacao({ p25: null }));
    expect(r.sourceStatus).toBe("FALLBACK_STALE");
    expect(r.monthlyCompensation).toBe(10_000);
  });
});

describe("cboSemHifen", () => {
  it("converte o formato do catalogo para o do CAGED", () => {
    expect(cboSemHifen("2124-05")).toBe("212405");
    expect(cboSemHifen("1425-30")).toBe("142530");
  });
});

describe("resumirCobertura", () => {
  it("conta quantos perfis tem dado real e devolve a competencia mais recente", () => {
    const r = resumirCobertura([
      aplicarObservacao(perfil({ id: "a" }), observacao({ competencia: "2026-06-01" })),
      aplicarObservacao(perfil({ id: "b" }), observacao({ competencia: "2026-07-01" })),
      aplicarObservacao(perfil({ id: "c" }), undefined),
    ]);
    expect(r.total).toBe(3);
    expect(r.comDadoReal).toBe(2);
    expect(r.competencia).toBe("2026-07");
  });
});

describe("integridade do catalogo apos a correcao de CBO", () => {
  // O campo `cbo` virou chave de juncao com o CAGED. Antes da correcao ele era um agrupamento
  // grosseiro -- 2124-05 carregava dez cargos distintos, de BI a UX/UI --, e usa-lo como chave
  // atribuiria o salario de desenvolvedor ao designer.
  it("todo CBO preenchido tem o formato oficial NNNN-NN", () => {
    const invalidos = laborProfiles.filter((p) => p.cbo !== null && !/^\d{4}-\d{2}$/.test(p.cbo));
    expect(invalidos.map((p) => `${p.id}:${p.cbo}`)).toEqual([]);
  });

  it("cargos que a CBO 2002 nao preve ficam com cbo null, sem codigo inventado", () => {
    // A classificacao e de 2002: nao existe ocupacao para ciencia de dados, IA, UX nem agile.
    const semCbo = ["sgd-cdados-01", "sgd-ia-eng-01", "sgd-auxui-01", "sgd-scrum", "dados-especialista-pj"];
    for (const id of semCbo) {
      const p = laborProfiles.find((x) => x.id === id);
      expect(p, `perfil ${id} sumiu do catalogo`).toBeDefined();
      expect(p!.cbo, `${id} deveria estar sem CBO`).toBeNull();
    }
  });

  it("os quatro gerentes deixaram de compartilhar o mesmo codigo", () => {
    const gerentes = ["sgd-gerinf", "sgd-gerpro", "sgd-gerseg", "sgd-gersup"]
      .map((id) => laborProfiles.find((p) => p.id === id)?.cbo);
    expect(gerentes).toEqual(["1425-05", "1425-20", "1425-25", "1425-30"]);
    expect(new Set(gerentes).size).toBe(4);
  });

  it("Administrador de banco de dados usa a familia 2123, nao a 2124", () => {
    // Erro original do catalogo: DBA estava em 2124-15, que e "Analista de sistemas de automacao".
    const dba = laborProfiles.find((p) => p.id === "sgd-abd-02");
    expect(dba?.cbo).toBe("2123-05");
  });
});
