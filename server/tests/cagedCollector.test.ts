import { describe, expect, it } from "vitest";
import { agregarLinhas, MIN_AMOSTRA } from "../src/infrastructure/collectors/cagedCollector";

/**
 * Cabecalho real do Novo CAGED (com acentos e capitalizacao originais). O parser mapeia coluna
 * por NOME, nunca por posicao -- estes testes existem para provar isso, porque um indice fixo
 * quebraria em silencio, lendo idade no lugar de salario.
 */
const CABECALHO =
  "competência;região;uf;município;seção;subclasse;saldomovimentação;cbo2002ocupação;categoria;" +
  "graudeinstrução;idade;horascontratuais;raçacor;sexo;tipoempregador;tipoestabelecimento;" +
  "tipomovimentação;tipodedeficiência;indtrabintermitente;indtrabparcial;salário;tamestabjan;" +
  "indicadoraprendiz;fração;competênciadec;indicadordeforadoprazo;unidadesaláriocódigo;valorsaláriofixo";

interface LinhaOpts {
  uf?: string;
  cbo?: string;
  saldo?: string;
  horas?: string;
  salario?: string;
}

function linha({ uf = "35", cbo = "212420", saldo = "1", horas = "44", salario = "5000,00" }: LinhaOpts = {}): string {
  const c = new Array(28).fill("0");
  c[2] = uf;
  c[6] = saldo;
  c[7] = cbo;
  c[11] = horas;
  c[20] = salario;
  return c.join(";");
}

/** Gera `n` linhas com salários distintos, para os percentis terem o que ordenar. */
function amostra(n: number, opts: LinhaOpts = {}, salarioBase = 1000): string[] {
  return Array.from({ length: n }, (_, i) => linha({ ...opts, salario: `${salarioBase + i * 100},00` }));
}

describe("agregarLinhas (CAGED)", () => {
  it("agrega por UF e tambem no nacional", async () => {
    const r = await agregarLinhas([CABECALHO, ...amostra(MIN_AMOSTRA, { uf: "35" }), ...amostra(MIN_AMOSTRA, { uf: "33" })]);

    const sp = r.agregados.find((a) => a.uf === "SP");
    const rj = r.agregados.find((a) => a.uf === "RJ");
    const br = r.agregados.find((a) => a.uf === null);

    expect(sp?.nAmostra).toBe(MIN_AMOSTRA);
    expect(rj?.nAmostra).toBe(MIN_AMOSTRA);
    // O recorte nacional soma os dois estados -- e o fallback quando nao ha amostra local.
    expect(br?.nAmostra).toBe(MIN_AMOSTRA * 2);
  });

  // Desligamento carrega o salario de SAIDA: sinal diferente de "quanto o mercado paga para
  // contratar hoje". Misturar os dois enviesaria a mediana para baixo.
  it("considera apenas admissoes (saldo = 1), ignorando desligamentos", async () => {
    const r = await agregarLinhas([
      CABECALHO,
      ...amostra(MIN_AMOSTRA, { saldo: "1" }),
      ...amostra(50, { saldo: "-1" }, 90_000),
    ]);
    expect(r.linhasConsideradas).toBe(MIN_AMOSTRA);
    expect(r.agregados.find((a) => a.uf === "SP")?.nAmostra).toBe(MIN_AMOSTRA);
  });

  it("ignora CBO que nao e de TI", async () => {
    const r = await agregarLinhas([CABECALHO, ...amostra(MIN_AMOSTRA, { cbo: "999999" })]);
    expect(r.linhasConsideradas).toBe(0);
    expect(r.agregados).toHaveLength(0);
  });

  it("descarta jornada parcial, que distorceria a mediana mensal", async () => {
    const r = await agregarLinhas([CABECALHO, ...amostra(MIN_AMOSTRA, { horas: "20" })]);
    expect(r.linhasConsideradas).toBe(0);
  });

  it("descarta salario fora da faixa de sanidade", async () => {
    const r = await agregarLinhas([
      CABECALHO,
      ...Array.from({ length: MIN_AMOSTRA }, () => linha({ salario: "1,00" })),
      ...Array.from({ length: MIN_AMOSTRA }, () => linha({ salario: "999999,00" })),
    ]);
    expect(r.linhasConsideradas).toBe(0);
  });

  // Sigilo e utilidade: mediana de meia duzia de admissoes nao e benchmark, e num recorte
  // geografico pequeno ainda levanta risco de reidentificacao.
  it("nao publica recorte abaixo da amostra minima", async () => {
    const r = await agregarLinhas([CABECALHO, ...amostra(MIN_AMOSTRA - 1)]);
    expect(r.agregados).toHaveLength(0);
  });

  it("le a virgula decimal do CAGED e calcula os percentis na ordem certa", async () => {
    // 30 salarios de 1000 a 3900, de 100 em 100.
    const r = await agregarLinhas([CABECALHO, ...amostra(30, { uf: "35" }, 1000)]);
    const sp = r.agregados.find((a) => a.uf === "SP")!;
    expect(sp.p25).toBeLessThan(sp.mediana);
    expect(sp.mediana).toBeLessThan(sp.p75);
    expect(sp.mediana).toBe(2450); // media dos dois centrais: (2400 + 2500) / 2
    expect(sp.media).toBe(2450);
  });

  // Se o MTE reordenar as colunas, o parser tem que continuar certo -- e o motivo de mapear
  // por nome. Este teste inverte a ordem do cabecalho e espera o MESMO resultado.
  it("acompanha mudanca de ordem das colunas no cabecalho", async () => {
    const nomes = CABECALHO.split(";");
    const ordemInvertida = [...nomes].reverse();
    const posOriginal = (nome: string) => nomes.indexOf(nome);

    const linhasInvertidas = amostra(MIN_AMOSTRA, { uf: "35" }).map((l) => {
      const campos = l.split(";");
      return ordemInvertida.map((nome) => campos[posOriginal(nome)]).join(";");
    });

    const r = await agregarLinhas([ordemInvertida.join(";"), ...linhasInvertidas]);
    expect(r.agregados.find((a) => a.uf === "SP")?.nAmostra).toBe(MIN_AMOSTRA);
  });

  it("falha alto quando uma coluna essencial some do layout", async () => {
    const semSalario = CABECALHO.split(";").filter((c) => c !== "salário").join(";");
    await expect(agregarLinhas([semSalario, linha()])).rejects.toThrow(/Layout do CAGED mudou/);
  });
});
