-- Fundacao do benchmark salarial com fonte real e rastreavel (Fase 2).
--
-- Ate aqui o benchmark saia de `laborProfiles`, uma tabela hardcoded em
-- server/src/domain/services/catalogs.ts com 73 perfis marcados
-- `sourceStatus: "FALLBACK_STALE"` e `benchmarkSource: "CAGED/MTE - snapshot tecnologia"`.
-- Ou seja: a tela ja dizia ao usuario que a fonte era o CAGED, mas o CAGED nunca havia sido
-- ingerido -- os numeros eram estimativa parametrizada, nao dado observado.
--
-- Esta tabela guarda OBSERVACAO, nao "o salario do cargo":
--
--   * Uma linha por (fonte, ocupacao, recorte geografico, competencia, regime). Cada ingestao
--     mensal acrescenta a competencia nova em vez de sobrescrever a anterior, entao a serie
--     historica se preserva -- da para mostrar tendencia salarial depois, que e um dos ativos
--     mais valiosos que esse dado tem. O UPDATE cego previsto na proposta original destruiria
--     exatamente isso.
--
--   * Guarda DISPERSAO (p25/mediana/p75) e TAMANHO DA AMOSTRA, nao um numero solto. Benchmark
--     salarial sem dispersao nao permite negociar nada, e sem `n_amostra` nao da para saber se
--     a mediana veio de 3 contratacoes ou de 3 mil.
--
--   * Guarda a PROVENIENCIA (`source` + `source_url` + `competencia`). O Pivo estima custo para
--     contratacao publica, onde o numero so vale se a origem puder ser citada no processo.

create table salary_observations (
  id bigint generated always as identity primary key,

  source text not null check (source in ('CAGED', 'SISP', 'PNCP', 'IBGE')),
  -- Endereco exato de onde o dado veio, para o usuario poder auditar a estimativa.
  source_url text not null,

  -- CBO 2002 com 6 digitos, SEM hifen -- e o formato do proprio CAGED. O catalogo interno usa
  -- com hifen ("2124-05"); a conversao acontece no codigo, nao aqui.
  cbo text,
  -- Para fontes que nao usam CBO (SISP, PNCP), o cargo normalizado do catalogo interno.
  role_slug text,
  seniority text,

  employment_model text not null check (employment_model in ('CLT', 'PJ')),

  -- null = Brasil inteiro; municipio null = UF inteira. Permite guardar o agregado nacional e o
  -- recorte local na mesma tabela, e responder a busca por cidade caindo para UF e depois para
  -- Brasil quando nao houver amostra local suficiente.
  uf text,
  municipio text,

  -- Primeiro dia do mes de referencia (o CAGED e mensal).
  competencia date not null,

  n_amostra integer not null check (n_amostra > 0),
  p25 numeric,
  mediana numeric not null,
  p75 numeric,
  media numeric,

  collected_at timestamptz not null default now(),

  -- `nulls not distinct` (Postgres 15+) e essencial aqui: sem isso, como `uf`/`municipio`/`cbo`
  -- sao nulos nos agregados nacionais, o Postgres trataria cada NULL como distinto e a mesma
  -- competencia entraria duplicada a cada reprocessamento.
  unique nulls not distinct (source, cbo, role_slug, uf, municipio, competencia, employment_model)
);

create index salary_observations_lookup_idx
  on salary_observations (cbo, uf, employment_model, competencia desc);

create index salary_observations_role_idx
  on salary_observations (role_slug, uf, employment_model, competencia desc);

-- Valor corrente = a competencia mais recente de cada recorte. View simples (nao materializada)
-- de proposito: o volume e pequeno (dezenas de CBOs x 27 UFs) e uma view materializada exigiria
-- REFRESH apos cada ingestao, um passo a mais para alguem esquecer.
create view salary_benchmark_current as
select distinct on (source, cbo, role_slug, uf, municipio, employment_model)
  source, source_url, cbo, role_slug, seniority, employment_model,
  uf, municipio, competencia, n_amostra, p25, mediana, p75, media, collected_at
from salary_observations
order by source, cbo, role_slug, uf, municipio, employment_model, competencia desc;

-- Mesmo padrao das demais tabelas: bloqueia acesso via PostgREST/anon key.
alter table salary_observations enable row level security;
