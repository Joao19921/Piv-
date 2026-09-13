/**
 * Junta o catalogo estatico de perfis (`catalogs.ts`) com o salario OBSERVADO no CAGED
 * (`salary_observations`, alimentado por server/scripts/ingestCaged.ts).
 *
 * O catalogo continua sendo a lista de cargos que o produto conhece -- titulo, senioridade,
 * Fator K, regime. O que muda e a origem do NUMERO: onde ha observacao real do CAGED para o CBO
 * do perfil, a remuneracao passa a ser a mediana efetivamente registrada, com dispersao e
 * tamanho de amostra; onde nao ha, o valor parametrizado do catalogo permanece, marcado como
 * estimativa.
 *
 * ## Duas regras que nao sao negociaveis aqui
 *
 * 1. **So perfil CLT recebe dado do CAGED.** O CAGED e o cadastro de emprego formal: por
 *    definicao, vinculo celetista. Aplicar a mediana dele num perfil PJ misturaria duas coisas
 *    que o mercado precifica de formas diferentes. O lado PJ virá do PNCP (valor efetivamente
 *    contratado por posto/hora no setor publico), nunca daqui.
 *
 * 2. **Perfil sem CBO nao recebe nada.** A CBO 2002 nao tem ocupacao para Cientista de Dados,
 *    Engenheiro de IA, UX/UI nem Scrum Master. Esses perfis ficam com `cbo: null` no catalogo e
 *    seguem exibindo a estimativa, rotulada como tal -- inventar um CBO "proximo" produziria um
 *    numero plausivel e infundado, que e pior do que a ausencia de numero num produto cujo
 *    proposito e sustentar estimativa auditavel.
 */
import { isDatabaseConfigured } from "../../infrastructure/db/client";
import { logger } from "../../infrastructure/observability/logger";
import { findCurrentByCbo, findCurrentByRoleSlug, type SalaryObservationRow } from "../../infrastructure/repositories/salaryObservationsRepository";
import { laborProfiles, type LaborProfile } from "./catalogs";

/** Um recorte observado. Serve amostra (CAGED/RAIS) e tabela publicada (SISP). */
export interface ObservedSalary {
  source: "CAGED" | "SISP" | "RAIS";
  sourceUrl: string;
  /** Mes de referencia dos microdados (YYYY-MM-DD). */
  competencia: string;
  /** null = agregado nacional. */
  uf: string | null;
  /** null em fonte publicada, que divulga o valor sem expor a amostra. */
  nAmostra: number | null;
  /** Qual ponto da distribuicao sustentou o valor, dado a senioridade. `null` quando a fonte
   * publica um valor unico, sem dispersao para recortar. */
  percentilAplicado: "p25" | "mediana" | "p75" | null;
  /** null quando a fonte nao publica dispersao. */
  p25: number | null;
  mediana: number;
  p75: number | null;
}

export interface EnrichedLaborProfile extends Omit<LaborProfile, "sourceStatus"> {
  sourceStatus: "OPERATIONAL" | "FALLBACK_STALE";
  /** Fonte que sustentou `monthlyCompensation`. Ausente quando so ha a estimativa do catalogo. */
  observed?: ObservedSalary;
  /**
   * Referencia oficial do SISP para o mesmo perfil, quando existir. Vem SEPARADA de `observed`
   * de proposito: nao substitui o valor de mercado, aparece ao lado dele. Numa contratacao
   * publica, ver as duas -- o que o mercado paga e o que a Portaria estabelece -- vale mais do
   * que qualquer uma isolada, e a divergencia entre elas costuma ser o proprio argumento.
   */
  referenciaOficial?: ObservedSalary;
  /**
   * Estoque de vinculos ativos em 31/12 (RAIS), no mesmo CBO/UF do CAGED, no mesmo percentil
   * escolhido para a senioridade do perfil -- amostra ordens de magnitude maior, mas com
   * defasagem de ~12 meses. Fica SEPARADA de `observed` de proposito, pelo mesmo motivo de
   * `referenciaOficial`: nunca substitui o valor de mercado do CAGED, so aparece ao lado dele.
   */
  referenciaRais?: ObservedSalary;
}

/** "2124-05" -> "212405", que e como o CAGED grava. */
export function cboSemHifen(cbo: string): string {
  return cbo.replace(/-/g, "");
}

function toNumber(value: string | null): number | null {
  if (value === null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Escolhe a melhor observacao para um CBO. `findCurrentByCbo` ja devolve municipio antes de UF
 * antes de nacional; aqui so pegamos a primeira que sobreviveu ao filtro geografico.
 */
function melhorObservacao(rows: SalaryObservationRow[], cbo: string): SalaryObservationRow | undefined {
  return rows.find((r) => r.cbo === cbo);
}

/** Converte a linha do banco na visao de fonte, aceitando tabela publicada (sem dispersao). */
function toObserved(row: SalaryObservationRow, percentilAplicado: ObservedSalary["percentilAplicado"]): ObservedSalary | null {
  const mediana = toNumber(row.mediana);
  if (mediana === null) return null;
  return {
    source: row.source === "SISP" ? "SISP" : row.source === "RAIS" ? "RAIS" : "CAGED",
    sourceUrl: row.source_url,
    competencia: row.competencia,
    uf: row.uf,
    nAmostra: row.n_amostra,
    percentilAplicado,
    p25: toNumber(row.p25),
    mediana,
    p75: toNumber(row.p75),
  };
}

/**
 * Qual ponto da distribuicao representa cada senioridade.
 *
 * O CAGED agrega por CBO, e CBO **nao distingue senioridade** -- "Analista de suporte
 * computacional" e um codigo so, do junior ao senior. Aplicar a mediana em todos os niveis faria
 * Junior, Pleno e Senior exibirem o mesmo numero, o que e pior que a estimativa anterior: ela ao
 * menos variava por nivel.
 *
 * A saida nao e inventar variacao, e sim usar a dispersao que a propria amostra ja fornece. Ler
 * P25/mediana/P75 como faixa de senioridade e a leitura convencional de banda salarial, e cada
 * ponto continua sendo um valor observado -- nao um numero derivado de multiplicador arbitrario.
 *
 * "Especialista" cai no P75 junto com "Senior" porque a amostra nao oferece ponto acima disso;
 * o rotulo diz qual percentil sustentou o valor, entao a limitacao fica visivel em vez de
 * disfarcada.
 */
const PERCENTIL_POR_SENIORIDADE: Record<LaborProfile["seniority"], "p25" | "mediana" | "p75"> = {
  "Júnior": "p25",
  Pleno: "mediana",
  "Sênior": "p75",
  Especialista: "p75",
};

const NOME_DO_PERCENTIL = { p25: "P25", mediana: "mediana", p75: "P75" } as const;

/** Exportada para teste: e aqui que se decide se o perfil exibe dado observado ou estimativa. */
export function aplicarObservacao(
  profile: LaborProfile,
  row: SalaryObservationRow | undefined,
  referencia?: SalaryObservationRow,
  raisRow?: SalaryObservationRow,
): EnrichedLaborProfile {
  const mediana = row ? toNumber(row.mediana) : null;
  const p25 = row ? toNumber(row.p25) : null;
  const p75 = row ? toNumber(row.p75) : null;

  // Escolhido fora do "if" abaixo: a referencia da RAIS deve aparecer mesmo quando o CAGED nao
  // tem dado pro perfil (profile cai pra estimativa estatica) -- as duas fontes sao
  // independentes, nenhuma depende da outra estar presente.
  const escolhido = PERCENTIL_POR_SENIORIDADE[profile.seniority];
  const referenciaOficial = referencia ? (toObserved(referencia, null) ?? undefined) : undefined;
  const referenciaRais = raisRow ? (toObserved(raisRow, escolhido) ?? undefined) : undefined;

  if (!row || mediana === null || p25 === null || p75 === null) {
    return { ...profile, sourceStatus: "FALLBACK_STALE", referenciaOficial, referenciaRais };
  }

  const valor = { p25, mediana, p75 }[escolhido];

  return {
    ...profile,
    monthlyCompensation: valor,
    sourceStatus: "OPERATIONAL",
    benchmarkSource:
      `CAGED/MTE — ${NOME_DO_PERCENTIL[escolhido]} da competência ${row.competencia.slice(0, 7)} ` +
      `(${row.uf ?? "Brasil"}, n=${row.n_amostra})`,
    updatedAt: row.collected_at,
    observed: {
      source: "CAGED",
      sourceUrl: row.source_url,
      competencia: row.competencia,
      uf: row.uf,
      nAmostra: row.n_amostra,
      percentilAplicado: escolhido,
      p25,
      mediana,
      p75,
    },
    referenciaOficial,
    referenciaRais,
  };
}

/**
 * Perfis do catalogo com o salario observado aplicado onde existir.
 *
 * `uf` restringe o recorte geografico: com "SP", um perfil que tenha observacao paulista usa a
 * mediana de SP; sem observacao local, cai para a nacional. Nunca falha por causa do banco --
 * sem Postgres, ou com ele fora, devolve o catalogo estatico como sempre foi.
 */
export async function getEnrichedLaborProfiles(options: { uf?: string | null } = {}): Promise<EnrichedLaborProfile[]> {
  if (!isDatabaseConfigured) {
    return laborProfiles.map((p) => aplicarObservacao(p, undefined));
  }

  // So faz sentido consultar CBO de perfil CLT: ver a regra 1 no cabecalho.
  const cbos = [
    ...new Set(
      laborProfiles
        .filter((p) => p.employmentModel === "CLT" && p.cbo)
        .map((p) => cboSemHifen(p.cbo as string)),
    ),
  ];

  let rows: SalaryObservationRow[] = [];
  let raisRows: SalaryObservationRow[] = [];
  let referencias = new Map<string, SalaryObservationRow>();
  try {
    // As tres consultas sao independentes e rodam juntas: CAGED e RAIS respondem por CBO
    // (fontes diferentes, nunca misturadas -- ver o filtro `source` em findCurrentByCbo), o
    // SISP pelo perfil da propria Portaria.
    const [observadas, raisObservadas, oficiais] = await Promise.all([
      cbos.length ? findCurrentByCbo(cbos, { uf: options.uf ?? null, municipio: null, source: "CAGED" }) : Promise.resolve([]),
      cbos.length ? findCurrentByCbo(cbos, { uf: options.uf ?? null, municipio: null, source: "RAIS" }) : Promise.resolve([]),
      findCurrentByRoleSlug(laborProfiles.map((p) => p.id), "SISP"),
    ]);
    rows = observadas;
    raisRows = raisObservadas;
    referencias = new Map(oficiais.filter((r) => r.role_slug).map((r) => [r.role_slug as string, r]));
  } catch (err) {
    // Benchmark degradado e melhor que tela quebrada: cai para o catalogo estatico, do mesmo
    // jeito que o resto do app faz com fonte externa indisponivel.
    logger.error("Falha ao ler salary_observations; usando o catalogo estatico", {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return laborProfiles.map((profile) => {
    const referencia = referencias.get(profile.id);
    if (profile.employmentModel !== "CLT" || !profile.cbo) return aplicarObservacao(profile, undefined, referencia);
    const cboProfile = cboSemHifen(profile.cbo);
    return aplicarObservacao(profile, melhorObservacao(rows, cboProfile), referencia, melhorObservacao(raisRows, cboProfile));
  });
}

export async function getEnrichedLaborProfile(id: string, options: { uf?: string | null } = {}): Promise<EnrichedLaborProfile | undefined> {
  const todos = await getEnrichedLaborProfiles(options);
  return todos.find((p) => p.id === id);
}

/** Resumo para a UI dizer honestamente de onde vieram os numeros da lista. */
export function resumirCobertura(profiles: EnrichedLaborProfile[]): {
  total: number;
  comDadoReal: number;
  competencia: string | null;
} {
  const observados = profiles.filter((p) => p.observed);
  const competencias = [...new Set(observados.map((p) => p.observed!.competencia))].sort();
  return {
    total: profiles.length,
    comDadoReal: observados.length,
    competencia: competencias.at(-1)?.slice(0, 7) ?? null,
  };
}
