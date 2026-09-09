-- Abre `salary_observations` para fontes PUBLICADAS, alem das amostradas.
--
-- A tabela nasceu modelada para o CAGED, que e microdado: cada linha resume uma amostra real de
-- admissoes, entao `n_amostra` era `not null check (n_amostra > 0)` e `mediana` era literalmente
-- a mediana da amostra.
--
-- O SISP nao funciona assim. O "Mapa de Pesquisa Salarial" das Portarias SGD/MGI publica UM valor
-- de referencia por cargo e senioridade -- ja e o resultado de uma pesquisa que o proprio governo
-- conduziu e nao divulga o n. Forcar um `n_amostra` ali seria inventar numero para satisfazer
-- constraint, exatamente o que este projeto vem evitando.

alter table salary_observations
  alter column n_amostra drop not null;

-- O check antigo (`n_amostra > 0`) ja aceita null por semantica de SQL (null nao viola check),
-- entao continua valendo para quem preenche.

comment on column salary_observations.n_amostra is
  'Tamanho da amostra. NULL para fonte publicada (ex.: Portaria SGD/MGI), que divulga valor de referencia sem expor o n.';

comment on column salary_observations.mediana is
  'Valor central da fonte: mediana da amostra em fonte amostrada (CAGED), valor de referencia publicado em fonte tabelada (SISP).';

comment on column salary_observations.p25 is
  'Primeiro quartil. NULL quando a fonte publica um valor unico, sem dispersao.';

comment on column salary_observations.p75 is
  'Terceiro quartil. NULL quando a fonte publica um valor unico, sem dispersao.';

comment on column salary_observations.competencia is
  'Mes de referencia. Para o CAGED, a competencia dos microdados; para o SISP, a data da Portaria que publicou o valor.';
