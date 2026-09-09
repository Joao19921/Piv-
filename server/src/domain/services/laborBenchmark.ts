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
import { findCurrentByCbo, type SalaryObservationRow } from "../../infrastructure/repositories/salaryObservationsRepository";
import { laborProfiles, type LaborProfile } from "./catalogs";

/** Recorte observado que sustentou o numero exibido. */
export interface ObservedSalary {
  source: "CAGED";
  sourceUrl: string;
  /** Mes de referencia dos microdados (YYYY-MM-DD). */
  competencia: string;
  /** null = agregado nacional. */
  uf: string | null;
  nAmostra: number;
  p25: number;
  mediana: number;
  p75: number;
}

export interface EnrichedLaborProfile extends Omit<LaborProfile, "sourceStatus"> {
  sourceStatus: "OPERATIONAL" | "FALLBACK_STALE";
  /** Presente apenas quando ha observacao real cobrindo este perfil. */
  observed?: ObservedSalary;
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

/** Exportada para teste: e aqui que se decide se o perfil exibe dado observado ou estimativa. */
export function aplicarObservacao(profile: LaborProfile, row: SalaryObservationRow | undefined): EnrichedLaborProfile {
  const mediana = row ? toNumber(row.mediana) : null;
  const p25 = row ? toNumber(row.p25) : null;
  const p75 = row ? toNumber(row.p75) : null;

  if (!row || mediana === null || p25 === null || p75 === null) {
    return { ...profile, sourceStatus: "FALLBACK_STALE" };
  }

  return {
    ...profile,
    monthlyCompensation: mediana,
    sourceStatus: "OPERATIONAL",
    benchmarkSource: `CAGED/MTE — competência ${row.competencia.slice(0, 7)} (${row.uf ?? "Brasil"}, n=${row.n_amostra})`,
    updatedAt: row.collected_at,
    observed: {
      source: "CAGED",
      sourceUrl: row.source_url,
      competencia: row.competencia,
      uf: row.uf,
      nAmostra: row.n_amostra,
      p25,
      mediana,
      p75,
    },
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
  if (cbos.length) {
    try {
      rows = await findCurrentByCbo(cbos, { uf: options.uf ?? null, municipio: null });
    } catch (err) {
      // Benchmark degradado e melhor que tela quebrada: cai para o catalogo estatico, do mesmo
      // jeito que o resto do app faz com fonte externa indisponivel.
      logger.error("Falha ao ler salary_observations; usando o catalogo estatico", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return laborProfiles.map((profile) => {
    if (profile.employmentModel !== "CLT" || !profile.cbo) return aplicarObservacao(profile, undefined);
    return aplicarObservacao(profile, melhorObservacao(rows, cboSemHifen(profile.cbo)));
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
