# Fase 3 - Modelo de dados isolado

**Status:** concluida
**Escopo:** migration aditiva com as tabelas do worker. Nenhuma tabela, constraint ou view existente foi alterada.

## O que foi criado

[server/db/migrations/0011_benchmark_worker_schema.sql](../server/db/migrations/0011_benchmark_worker_schema.sql)
adiciona cinco tabelas, todas novas:

| Tabela | Papel |
| :--- | :--- |
| `benchmark_sources` | Catalogo de fontes e estado de autorizacao (`enabled`/`disabled`). Comeca com Indeed, Glassdoor e InfoJobs `disabled`, com a razao da Fase 1 gravada em `disabled_reason`. |
| `benchmark_profiles` | O que coletar: cargo, senioridade, UF. |
| `benchmark_jobs` | Solicitacoes de coleta, pendentes ou processadas (`pending`/`running`/`done`/`failed`). Quem cria jobs e decisao da Fase 7. |
| `benchmark_runs` | Uma linha por execucao do worker (`WorkerRunner.run_once`), com status agregado e `source_summary` (jsonb) por fonte. |
| `benchmark_results` | Observacoes normalizadas e validadas -- espelha `SalaryObservation` do worker campo a campo. |

## Relacao com o worker (Fase 2)

`benchmark_sources.status` e `benchmark_sources.disabled_reason` sao a
persistencia do `AdapterStatus` que hoje vive so em codigo
(`benchmark-worker/src/benchmark_worker/adapters/base.py`,
`DisabledAdapter`). `benchmark_runs` e `benchmark_results` sao o destino de
`RunSummary` e `SalaryObservation` quando o `Repository` (interface definida
na Fase 2, ainda sem implementacao real) gravar no Supabase -- isso e
trabalho da Fase 4, nao desta fase.

## Chaves, indices e idempotencia

- `benchmark_profiles`: `unique nulls not distinct (role_title, seniority, state)`
  evita duplicar o mesmo perfil quando `seniority`/`state` sao nulos
  (recorte nacional), mesmo padrao ja usado em `salary_observations`
  (migration 0009).
- `benchmark_results`: `unique nulls not distinct (source, source_reference, observed_at)`
  garante que reprocessar a mesma fonte/referencia/data nao duplica a
  observacao -- a constraint de idempotencia pedida pelo plano.
- Foreign keys: `benchmark_jobs.profile_id -> benchmark_profiles`,
  `benchmark_jobs.source` / `benchmark_results.source -> benchmark_sources(name)`,
  `benchmark_results.run_id -> benchmark_runs` (cascade),
  `benchmark_results.job_id -> benchmark_jobs` (set null -- um resultado nao
  deve sumir se o job for limpo).
- Indices: `benchmark_jobs (status, requested_at)` para o agendador varrer
  pendentes; `benchmark_runs (finished_at desc)` para historico recente;
  `benchmark_results (role_title, state, observed_at desc)` para consulta
  por cargo/UF; `benchmark_results (run_id)` e `benchmark_jobs (profile_id)`
  para os joins mais obvios.

## RLS e acesso

Mesmo padrao das tabelas existentes (`0001_core_schema.sql`): RLS habilitado
sem nenhuma policy, o que bloqueia qualquer acesso via PostgREST/anon key.
O worker deve conectar com uma connection string propria (nao a do backend
Express), configurada em secret manager -- essa credencial continua como
pendencia registrada na Fase 1 ("mecanismo de credencial em secret manager")
e nao foi criada nesta fase. Nenhuma role nova de Postgres foi criada: dado
que nenhuma tabela aqui e alcancavel por PostgREST, uma connection string
direta (mesmo mecanismo que o backend ja usa) e suficiente para o worker
conectar sem expor as tabelas a mais acesso do que o necessario.

## Validacao de nao regressao

- Migration puramente aditiva: nenhum `alter`/`drop` em tabela existente.
- Nomes conferidos contra todas as migrations existentes -- sem colisao
  (`market_benchmark_sources` e `benchmark_sources` sao tabelas distintas).
- `pnpm run migrate` aplica as migrations em ordem e falha se o SQL for
  invalido; o job "Testes automatizados" do CI roda isso contra um
  `postgres:17-alpine` efemero antes da suite, o que valida esta migration
  de forma real ao abrir o PR.
- Sem Postgres local disponivel nesta sessao para um dry-run adicional; a
  validacao ficou por conta da revisao do SQL e da execucao no CI.

## O que fica fora desta fase

- Nenhuma implementacao do `Repository` do worker contra estas tabelas --
  isso e Fase 4 (nucleo executavel com adapters fake/fixture).
- Nenhuma credencial ou role de Postgres nova para o worker.
- Nenhuma leitura destas tabelas pela aplicacao Pivo (Fase 8, depois de
  estabilidade).

## Proximo passo

Fase 4: criar o projeto executavel do worker com adapters fake/fixture,
scheduler/job manager e observabilidade, exercitando o pipeline completo
(incluindo gravacao real nestas tabelas via `Repository`) sem tocar
Indeed, Glassdoor ou InfoJobs de verdade.
