/**
 * Acesso a `salary_observations` (migration 0009) -- as observacoes salariais com fonte,
 * competencia e dispersao que substituem o snapshot hardcoded de `catalogs.ts`.
 */
import { query } from "../db/client";

export type SalarySource = "CAGED" | "SISP" | "PNCP" | "IBGE" | "RAIS";
export type EmploymentModel = "CLT" | "PJ";

export interface SalaryObservationInput {
  source: SalarySource;
  sourceUrl: string;
  /** CBO 2002 com 6 digitos, sem hifen. */
  cbo?: string | null;
  roleSlug?: string | null;
  seniority?: string | null;
  employmentModel: EmploymentModel;
  /** null = agregado nacional. */
  uf?: string | null;
  /** null = agregado da UF inteira. */
  municipio?: string | null;
  /** Primeiro dia do mes de referencia (YYYY-MM-DD). */
  competencia: string;
  /** null para fonte publicada, que divulga o valor sem expor a amostra (migration 0010). */
  nAmostra: number | null;
  p25?: number | null;
  mediana: number;
  p75?: number | null;
  media?: number | null;
}

export interface SalaryObservationRow {
  source: SalarySource;
  source_url: string;
  cbo: string | null;
  role_slug: string | null;
  seniority: string | null;
  employment_model: EmploymentModel;
  uf: string | null;
  municipio: string | null;
  competencia: string;
  n_amostra: number | null;
  p25: string | null;
  /** Valor central: mediana da amostra (CAGED) ou valor de referencia publicado (SISP). */
  mediana: string;
  p75: string | null;
  media: string | null;
  collected_at: string;
}

const COLUMNS_PER_ROW = 15;

/**
 * Grava um lote de observacoes.
 *
 * `on conflict do update` e nao um insert cego: reprocessar a mesma competencia (porque a
 * ingestao caiu no meio, ou porque o MTE republicou o arquivo com correcao) deve corrigir a
 * linha daquele mes, nao criar uma segunda. A serie historica e preservada por haver uma linha
 * por COMPETENCIA -- nao por acumular reprocessamentos do mesmo mes.
 */
export async function upsertSalaryObservations(rows: SalaryObservationInput[]): Promise<number> {
  if (!rows.length) return 0;

  const placeholders: string[] = [];
  const params: unknown[] = [];

  rows.forEach((row, i) => {
    const base = i * COLUMNS_PER_ROW;
    placeholders.push(`(${Array.from({ length: COLUMNS_PER_ROW }, (_, k) => `$${base + k + 1}`).join(", ")})`);
    params.push(
      row.source,
      row.sourceUrl,
      row.cbo ?? null,
      row.roleSlug ?? null,
      row.seniority ?? null,
      row.employmentModel,
      row.uf ?? null,
      row.municipio ?? null,
      row.competencia,
      row.nAmostra,
      row.p25 ?? null,
      row.mediana,
      row.p75 ?? null,
      row.media ?? null,
      new Date().toISOString(),
    );
  });

  await query(
    "salary_observations.upsert_batch",
    `insert into salary_observations
       (source, source_url, cbo, role_slug, seniority, employment_model, uf, municipio,
        competencia, n_amostra, p25, mediana, p75, media, collected_at)
     values ${placeholders.join(", ")}
     on conflict (source, cbo, role_slug, uf, municipio, competencia, employment_model)
     do update set
       source_url  = excluded.source_url,
       seniority   = excluded.seniority,
       n_amostra   = excluded.n_amostra,
       p25         = excluded.p25,
       mediana     = excluded.mediana,
       p75         = excluded.p75,
       media       = excluded.media,
       collected_at = excluded.collected_at`,
    params,
  );

  return rows.length;
}

/**
 * Valor corrente por CBO, com degrade geografico: tenta municipio, cai para UF, cai para o
 * agregado nacional. Devolve o que existir, mais especifico primeiro -- quem chama decide se a
 * amostra local e grande o bastante para usar no lugar da nacional.
 *
 * `source` filtra a fonte (ex.: 'CAGED' ou 'RAIS') -- sem isso, um CBO com observacao em mais
 * de uma fonte devolveria as duas misturadas na mesma lista, e quem consome (`melhorObservacao`
 * em laborBenchmark.ts) so pega a primeira, silenciosamente. RAIS e CAGED nunca devem se
 * confundir: cada chamada pede uma fonte especifica.
 */
export async function findCurrentByCbo(
  cbos: string[],
  options: { uf?: string | null; municipio?: string | null; source?: SalarySource } = {},
): Promise<SalaryObservationRow[]> {
  if (!cbos.length) return [];
  return query<SalaryObservationRow>(
    "salary_benchmark_current.find_by_cbo",
    // `competencia::text` e `collected_at::text` nao sao enfeite: o driver pg devolve `date` e
    // `timestamptz` como objeto Date do JavaScript, nao string. Sem o cast, o tipo declarado
    // acima mentiria sobre o runtime -- e o codigo que chama faz `competencia.slice(0, 7)`,
    // que estoura com Date. O teste nao pegou porque a fixture usava string; so a consulta
    // real ao Postgres revelou.
    `select source, source_url, cbo, role_slug, seniority, employment_model, uf, municipio,
            competencia::text, n_amostra, p25, mediana, p75, media, collected_at::text
       from salary_benchmark_current
      where cbo = any($1::text[])
        and (uf is null or uf = $2)
        and (municipio is null or municipio = $3)
        and ($4::text is null or source = $4)
      order by
        (municipio is not null) desc,
        (uf is not null) desc,
        n_amostra desc`,
    [cbos, options.uf ?? null, options.municipio ?? null, options.source ?? null],
  );
}

/** Competencia mais recente ja ingerida de uma fonte; null quando a fonte nunca rodou. */
export async function latestCompetencia(source: SalarySource): Promise<string | null> {
  const [row] = await query<{ competencia: string | null }>(
    "salary_observations.latest_competencia",
    `select max(competencia)::text as competencia from salary_observations where source = $1`,
    [source],
  );
  return row?.competencia ?? null;
}

/**
 * Valor corrente por perfil do catalogo, para fontes que identificam o cargo pelo proprio perfil
 * em vez de CBO -- caso do SISP, cujas Portarias publicam por "perfil profissional".
 */
export async function findCurrentByRoleSlug(roleSlugs: string[], source: SalarySource): Promise<SalaryObservationRow[]> {
  if (!roleSlugs.length) return [];
  return query<SalaryObservationRow>(
    "salary_benchmark_current.find_by_role_slug",
    `select source, source_url, cbo, role_slug, seniority, employment_model, uf, municipio,
            competencia::text, n_amostra, p25, mediana, p75, media, collected_at::text
       from salary_benchmark_current
      where source = $2
        and role_slug = any($1::text[])`,
    [roleSlugs, source],
  );
}
