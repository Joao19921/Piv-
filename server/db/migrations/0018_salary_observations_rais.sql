-- Adiciona 'RAIS' como fonte valida em salary_observations (migration 0009). A RAIS
-- (Relacao Anual de Informacoes Sociais, mesmo MTE/PDET do Novo CAGED) e o estoque de
-- vinculos empregaticios ativos em 31/12, com amostra por CBO/UF muito maior que uma unica
-- competencia mensal do CAGED -- mas e anual, com defasagem de ~12 meses. Fica sempre ao
-- lado do CAGED (nunca substitui): mesmo padrao ja usado para a SISP (`referenciaOficial`),
-- que tambem convive lado a lado com o valor de mercado observado, sem escolher um no lugar
-- do outro.
--
-- 'PNCP' e 'IBGE' ja estavam reservados no check original (migration 0009) mas nunca foram
-- populados -- permanecem como estao, essa migration so acrescenta 'RAIS'.

alter table salary_observations drop constraint salary_observations_source_check;
alter table salary_observations add constraint salary_observations_source_check
  check (source in ('CAGED', 'SISP', 'PNCP', 'IBGE', 'RAIS'));
