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
    const r = aplicarObservacao(perfil({ seniority: "Pleno" }), observacao());

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

describe("senioridade lida como faixa da distribuicao", () => {
  // O CAGED agrega por CBO, e CBO nao distingue senioridade: sem isso, Junior, Pleno e Senior do
  // mesmo codigo exibiriam o MESMO numero -- pior que a estimativa anterior, que ao menos variava.
  // A saida usa a dispersao que a propria amostra fornece, em vez de inventar multiplicador.
  it("cada senioridade recebe um ponto diferente da distribuicao", () => {
    const obs = observacao({ p25: "4500", mediana: "8000", p75: "12000" });

    expect(aplicarObservacao(perfil({ seniority: "Júnior" }), obs).monthlyCompensation).toBe(4500);
    expect(aplicarObservacao(perfil({ seniority: "Pleno" }), obs).monthlyCompensation).toBe(8000);
    expect(aplicarObservacao(perfil({ seniority: "Sênior" }), obs).monthlyCompensation).toBe(12000);
  });

  it("o rotulo diz qual percentil sustentou o valor", () => {
    const jr = aplicarObservacao(perfil({ seniority: "Júnior" }), observacao());
    expect(jr.benchmarkSource).toContain("P25");
    expect(jr.observed?.percentilAplicado).toBe("p25");

    const sr = aplicarObservacao(perfil({ seniority: "Sênior" }), observacao());
    expect(sr.benchmarkSource).toContain("P75");
  });

  // Limitacao conhecida e deliberada: a amostra nao oferece ponto acima do P75. Fica explicito
  // no rotulo em vez de disfarcado com um numero inventado.
  it("Especialista cai no P75, junto com Senior, por falta de ponto acima", () => {
    const esp = aplicarObservacao(perfil({ seniority: "Especialista" }), observacao());
    expect(esp.observed?.percentilAplicado).toBe("p75");
    expect(esp.monthlyCompensation).toBe(12000);
  });

  // Toda observacao carrega a distribuicao inteira, independentemente de qual ponto foi aplicado:
  // e o que permite a tela mostrar a faixa, nao so o numero.
  it("expoe a distribuicao completa qualquer que seja a senioridade", () => {
    const r = aplicarObservacao(perfil({ seniority: "Júnior" }), observacao());
    expect(r.observed).toMatchObject({ p25: 4500, mediana: 8000, p75: 12000 });
  });
});

describe("referência oficial do SISP ao lado do mercado", () => {
  function sisp(overrides: Partial<SalaryObservationRow> = {}): SalaryObservationRow {
    return observacao({
      source: "SISP",
      source_url: "https://www.gov.br/governodigital/pt-br/contratacoes-de-tic/legislacao/...",
      cbo: null,
      role_slug: "sgd-asupcomp-02",
      uf: null,
      competencia: "2026-06-17",
      // Fonte publicada: valor de referencia, sem amostra nem dispersao (migration 0010).
      n_amostra: null,
      p25: null,
      mediana: "5076",
      p75: null,
      ...overrides,
    });
  }

  // O ponto central: a referencia NAO substitui o valor de mercado, aparece ao lado dele. Numa
  // contratacao publica, a divergencia entre o que o mercado paga e o que a Portaria estabelece
  // costuma ser o proprio argumento.
  it("expoe as duas fontes sem uma sobrescrever a outra", () => {
    const r = aplicarObservacao(perfil({ seniority: "Pleno" }), observacao(), sisp());

    expect(r.monthlyCompensation).toBe(8000); // mercado (CAGED) segue sendo o valor aplicado
    expect(r.observed?.source).toBe("CAGED");
    expect(r.referenciaOficial?.source).toBe("SISP");
    expect(r.referenciaOficial?.mediana).toBe(5076);
  });

  // Sem isto, 35 perfis que a CBO 2002 nao cobre ficariam sem nenhuma fonte citavel, mesmo
  // existindo Portaria oficial para eles.
  it("aparece mesmo quando nao ha dado de mercado para o perfil", () => {
    const r = aplicarObservacao(perfil({ cbo: null }), undefined, sisp());

    expect(r.observed).toBeUndefined();
    expect(r.sourceStatus).toBe("FALLBACK_STALE");
    expect(r.referenciaOficial?.mediana).toBe(5076);
    expect(r.referenciaOficial?.sourceUrl).toContain("gov.br");
  });

  // Tabela publicada divulga um valor por cargo+senioridade, nao uma distribuicao. Recortar
  // percentil ali seria inventar dispersao que a fonte nao tem.
  it("nao inventa dispersao nem percentil para fonte publicada", () => {
    const r = aplicarObservacao(perfil({ seniority: "Sênior" }), undefined, sisp());

    expect(r.referenciaOficial?.p25).toBeNull();
    expect(r.referenciaOficial?.p75).toBeNull();
    expect(r.referenciaOficial?.percentilAplicado).toBeNull();
    expect(r.referenciaOficial?.nAmostra).toBeNull();
  });

  it("fica ausente quando o perfil nao tem Portaria correspondente", () => {
    const r = aplicarObservacao(perfil(), observacao(), undefined);
    expect(r.referenciaOficial).toBeUndefined();
  });
});

describe("referência RAIS ao lado do CAGED", () => {
  function rais(overrides: Partial<SalaryObservationRow> = {}): SalaryObservationRow {
    return observacao({
      source: "RAIS",
      source_url: "ftp://ftp.mtps.gov.br/pdet/microdados/RAIS/2025/",
      competencia: "2025-12-31",
      // Estoque de fim de ano tem amostra bem maior que uma unica competencia do CAGED.
      n_amostra: 48_200,
      p25: "4700",
      mediana: "8300",
      p75: "12500",
      ...overrides,
    });
  }

  // O ponto central, igual ao da SISP: RAIS NAO substitui o valor de mercado (CAGED), aparece
  // ao lado dele -- mesmo quando as duas fontes tem dado real pro mesmo perfil.
  it("expoe as duas fontes sem uma sobrescrever a outra", () => {
    const r = aplicarObservacao(perfil({ seniority: "Pleno" }), observacao(), undefined, rais());

    expect(r.monthlyCompensation).toBe(8000); // mercado (CAGED) segue sendo o valor aplicado
    expect(r.observed?.source).toBe("CAGED");
    expect(r.referenciaRais?.source).toBe("RAIS");
    expect(r.referenciaRais?.mediana).toBe(8300);
  });

  // Diferente da SISP (tabela publicada, um valor so): a RAIS tem dispersao real, entao usa o
  // MESMO percentil escolhido para a senioridade do perfil -- comparacao justa com o CAGED.
  it("usa o mesmo percentil da senioridade, nao sempre a mediana", () => {
    const dados = rais({ p25: "4700", mediana: "8300", p75: "12500" });

    const jr = aplicarObservacao(perfil({ seniority: "Júnior" }), observacao(), undefined, dados);
    expect(jr.referenciaRais?.percentilAplicado).toBe("p25");

    const sr = aplicarObservacao(perfil({ seniority: "Sênior" }), observacao(), undefined, dados);
    expect(sr.referenciaRais?.percentilAplicado).toBe("p75");
  });

  // Perfis sem CAGED (35 que a CBO nao cobre bem, ou so sem observacao na competencia) ainda
  // podem ter RAIS -- as duas fontes sao independentes, nenhuma depende da outra existir.
  it("aparece mesmo quando nao ha dado do CAGED para o perfil", () => {
    const r = aplicarObservacao(perfil(), undefined, undefined, rais());

    expect(r.observed).toBeUndefined();
    expect(r.sourceStatus).toBe("FALLBACK_STALE");
    expect(r.referenciaRais?.mediana).toBe(8300);
  });

  it("fica ausente quando nao ha observacao da RAIS para o CBO/UF", () => {
    const r = aplicarObservacao(perfil(), observacao(), undefined, undefined);
    expect(r.referenciaRais).toBeUndefined();
  });
});
