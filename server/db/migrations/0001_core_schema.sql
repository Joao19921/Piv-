-- Aplicada no projeto Supabase "pivo" (sa-east-1) via MCP em 2026-09-01.
-- Mantida aqui para versionamento; para reaplicar em outro projeto, rode este arquivo
-- (e em seguida 0002_seed_cloud_dimensions.sql) contra a instancia Postgres alvo.

-- Catalogo de SKUs de compute cloud (metadados; atualizado por ingestao periodica ou seed manual)
create table cloud_skus (
  id text primary key,
  provider text not null check (provider in ('AWS','Azure','GCP')),
  family text not null,
  sku_name text not null,
  display_name text not null,
  vcpu integer not null,
  memory_gib numeric not null,
  os text not null default 'Linux',
  pricing_model text not null default 'OnDemand',
  azure_arm_sku_name text,
  source_name text not null,
  source_url text not null,
  notes text,
  updated_at timestamptz not null default now()
);

create table cloud_regions (
  id bigint generated always as identity primary key,
  provider text not null check (provider in ('AWS','Azure','GCP')),
  region_key text not null,
  label text not null,
  provider_region text not null,
  updated_at timestamptz not null default now(),
  unique (provider, region_key)
);

-- Historico de precos (insert-only): cada ingestao grava uma linha nova, permitindo tendencia no tempo.
-- Leitura de "preco atual" usa distinct on (sku_id, region_key) order by captured_at desc.
create table cloud_prices (
  id bigint generated always as identity primary key,
  sku_id text not null references cloud_skus(id) on delete cascade,
  region_key text not null,
  price_per_hour_usd numeric not null,
  source_status text not null check (source_status in ('OPERATIONAL','DEGRADED','FALLBACK_STALE','OFFLINE')),
  captured_at timestamptz not null default now()
);
create index cloud_prices_latest_idx on cloud_prices (sku_id, region_key, captured_at desc);

-- Cotacoes PTAX capturadas a cada ingestao (historico + observabilidade)
create table fx_rates (
  id bigint generated always as identity primary key,
  pair text not null default 'USD/BRL',
  rate numeric not null,
  quoted_at timestamptz not null,
  source_status text not null check (source_status in ('OPERATIONAL','DEGRADED','FALLBACK_STALE','OFFLINE')),
  captured_at timestamptz not null default now()
);
create index fx_rates_pair_idx on fx_rates (pair, captured_at desc);

-- Historico de buscas de benchmark salarial (substitui o cache em arquivo)
create table market_benchmark_searches (
  id bigint generated always as identity primary key,
  role_searched text not null,
  state text not null,
  city text not null,
  notes text,
  suggested_monthly_compensation numeric not null,
  source_mode text not null check (source_mode in ('LIVE_CONNECTOR','STATIC_SNAPSHOT')),
  summary text not null,
  generated_at timestamptz not null default now()
);
create index market_benchmark_searches_role_idx on market_benchmark_searches (role_searched, city, state, generated_at desc);

create table market_benchmark_sources (
  id bigint generated always as identity primary key,
  search_id bigint not null references market_benchmark_searches(id) on delete cascade,
  employment_model text not null check (employment_model in ('CLT','PJ')),
  profile_id text not null,
  profile_title text not null,
  seniority text not null,
  monthly_compensation numeric not null,
  factor_k numeric not null,
  observation text not null
);
create index market_benchmark_sources_search_idx on market_benchmark_sources (search_id);

-- Observabilidade: uma linha por execucao de coletor/ingestao (cron a cada 5 dias + chamadas ao vivo).
create table ingestion_runs (
  id bigint generated always as identity primary key,
  service_name text not null,
  status text not null check (status in ('OPERATIONAL','DEGRADED','FALLBACK_STALE','OFFLINE')),
  records_upserted integer not null default 0,
  duration_ms integer not null,
  error_message text,
  started_at timestamptz not null,
  finished_at timestamptz not null default now()
);
create index ingestion_runs_service_idx on ingestion_runs (service_name, finished_at desc);

-- RLS habilitado sem policies: bloqueia qualquer acesso via PostgREST/anon key.
-- O backend conecta via connection string direta (role postgres, bypassa RLS) e continua funcionando normalmente.
alter table cloud_skus enable row level security;
alter table cloud_regions enable row level security;
alter table cloud_prices enable row level security;
alter table fx_rates enable row level security;
alter table market_benchmark_searches enable row level security;
alter table market_benchmark_sources enable row level security;
alter table ingestion_runs enable row level security;
