-- Fase 3 do benchmark-worker (docs/PLANO-BENCHMARK-WORKER.md): modelo de dados isolado
-- para o worker independente. Migration puramente aditiva -- nao altera nenhuma tabela,
-- constraint ou view existente. A aplicacao atual continua lendo `salary_observations`,
-- `market_benchmark_searches` e `market_benchmark_sources` sem nenhuma mudanca.
--
-- O worker (benchmark-worker/, Python) roda fora do processo do Express e persiste aqui.
-- Nenhum adapter real de Indeed, Glassdoor ou InfoJobs existe ainda -- ver
-- docs/FASE-1-CONFORMIDADE-BENCHMARK-WORKER.md. `benchmark_sources` comeca com as tres
-- fontes desabilitadas e a razao documentada; so muda quando uma fonte tiver autorizacao.

-- Catalogo de fontes e seu estado de autorizacao. Espelha `AdapterStatus` do worker
-- (benchmark-worker/src/benchmark_worker/domain/models.py): o pipeline consulta este
-- status antes de chamar qualquer adapter e nunca faz fallback para scraping.
create table benchmark_sources (
  name text primary key check (name in ('indeed', 'glassdoor', 'infojobs')),
  status text not null check (status in ('enabled', 'disabled')) default 'disabled',
  disabled_reason text,
  updated_at timestamptz not null default now()
);

insert into benchmark_sources (name, status, disabled_reason) values
  ('indeed', 'disabled', 'Fase 1: nenhuma API publica de benchmark salarial identificada; requer parceria/autorizacao contratual.'),
  ('glassdoor', 'disabled', 'Fase 1: termos exigem acordo separado para uso comercial; requer autorizacao explicita.'),
  ('infojobs', 'disabled', 'Fase 1: nenhum contrato de API de benchmark confirmado; requer confirmacao do canal oficial.');

-- O que o worker deve coletar: cargo, senioridade e UF. Uma linha por combinacao unica;
-- `state` nulo significa recorte nacional (mesmo padrao de `salary_observations.uf`).
create table benchmark_profiles (
  id bigint generated always as identity primary key,
  role_title text not null,
  seniority text,
  state text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique nulls not distinct (role_title, seniority, state)
);

-- Solicitacoes de coleta, pendentes ou ja processadas. `source` nulo = todas as fontes
-- habilitadas no momento em que o job for pego. A Fase 7 decide quem cria jobs (agendador
-- e/ou administracao); esta tabela so define a forma.
create table benchmark_jobs (
  id bigint generated always as identity primary key,
  profile_id bigint not null references benchmark_profiles(id) on delete cascade,
  source text references benchmark_sources(name),
  status text not null check (status in ('pending', 'running', 'done', 'failed')) default 'pending',
  requested_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  error_summary text
);
create index benchmark_jobs_status_idx on benchmark_jobs (status, requested_at);
create index benchmark_jobs_profile_idx on benchmark_jobs (profile_id);

-- Uma linha por execucao do worker (`WorkerRunner.run_once`, ver
-- benchmark-worker/src/benchmark_worker/runner.py). `source_summary` guarda o resultado
-- por fonte (status + contagem + erro resumido, nunca segredo ou dado pessoal) --
-- equivalente persistido de `RunSummary`/`SourceRunResult` do worker.
create table benchmark_runs (
  id bigint generated always as identity primary key,
  status text not null check (status in ('success', 'partial', 'failed')),
  triggered_by text not null check (triggered_by in ('manual', 'scheduled')),
  source_summary jsonb not null default '[]',
  started_at timestamptz not null,
  finished_at timestamptz not null default now()
);
create index benchmark_runs_finished_idx on benchmark_runs (finished_at desc);

-- Observacoes normalizadas e validadas, persistidas pelo `Repository` do worker. Espelha
-- `SalaryObservation` (mesmo arquivo domain/models.py citado acima) campo a campo.
-- `source_reference` guarda somente a referencia auditavel que a fonte permite expor
-- (id publico, URL de listagem agregada) -- nunca copia de pagina autenticada nem dado
-- de uma pessoa especifica (proibido pela Fase 1).
create table benchmark_results (
  id bigint generated always as identity primary key,
  run_id bigint not null references benchmark_runs(id) on delete cascade,
  job_id bigint references benchmark_jobs(id) on delete set null,
  source text not null references benchmark_sources(name),
  source_reference text not null,
  role_title text not null,
  seniority text,
  state text,
  regime text not null check (regime in ('clt', 'pj', 'unknown')),
  salary_min numeric,
  salary_max numeric,
  currency text not null check (currency in ('brl', 'usd', 'unknown')),
  periodicity text not null check (periodicity in ('monthly', 'annual', 'unknown')),
  observed_at date not null,
  confidence numeric not null check (confidence >= 0 and confidence <= 1),
  collected_at timestamptz not null default now(),
  -- Idempotencia: reprocessar a mesma fonte/referencia/data nao duplica a observacao.
  unique nulls not distinct (source, source_reference, observed_at)
);
create index benchmark_results_lookup_idx on benchmark_results (role_title, state, observed_at desc);
create index benchmark_results_run_idx on benchmark_results (run_id);

-- Mesmo padrao das demais tabelas (ver 0001_core_schema.sql): RLS habilitado sem policies
-- bloqueia qualquer acesso via PostgREST/anon key. O worker conecta com uma connection
-- string propria (separada da do backend Express), pendente de configuracao em secret
-- manager -- ver "Pendencias para liberar uma fonte" em
-- docs/FASE-1-CONFORMIDADE-BENCHMARK-WORKER.md.
alter table benchmark_sources enable row level security;
alter table benchmark_profiles enable row level security;
alter table benchmark_jobs enable row level security;
alter table benchmark_runs enable row level security;
alter table benchmark_results enable row level security;
