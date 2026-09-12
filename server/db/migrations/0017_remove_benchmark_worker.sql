-- Remove o modulo benchmark-worker por completo (codigo + banco), a pedido do produto:
-- nenhuma fonte (Indeed/Glassdoor/InfoJobs) nunca saiu de DISABLED por falta de autorizacao
-- (Fase 1), e o unico caminho legitimo que restava -- entrada manual da base aberta -- foi
-- removido da UI/API em 2026-09-12 (ver docs git-history de
-- BENCHMARK-WORKER-MANUAL.md/PLANO-BENCHMARK-WORKER.md, ja apagados nesta mesma migration
-- de limpeza). Sem nenhum consumidor, o schema fica so como superficie morta.
--
-- Migrations anteriores (0011, 0012, 0013, 0016) permanecem no repositorio como registro
-- historico -- nao sao editadas nem removidas, so revertidas por esta migration nova,
-- seguindo a mesma regra de imutabilidade das demais.
--
-- Ordem: primeiro a permissao 'BENCHMARK_WORKER' (a linha em `permissions` precisa sumir
-- antes de estreitar a constraint de volta, senao a ALTER TABLE falha contra a propria
-- linha que ainda referencia o codigo antigo) e so depois as tabelas do worker.

delete from permissions where code = 'BENCHMARK_WORKER';

alter table permissions drop constraint if exists permissions_code_check;
alter table permissions add constraint permissions_code_check
  check (code in ('LABOR', 'INFRA', 'LICENSES', 'PUBLIC_TENDERS'));

drop table if exists
  benchmark_results,
  benchmark_jobs,
  benchmark_runs,
  benchmark_profiles,
  benchmark_open_sources,
  benchmark_sources
cascade;
