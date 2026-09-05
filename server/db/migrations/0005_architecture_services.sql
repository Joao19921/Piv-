-- Aplicada no projeto Supabase "pivo" (sa-east-1) via MCP em 2026-09-05.
-- Refatora cloud_architectures de "1 SKU por arquitetura" para composicao de N servicos
-- (Architecture Calculator, nao mais uma cesta de compute unica). Sem dados reais de usuario
-- na tabela anterior (so um registro de teste, ja removido) — recriar em vez de alterar.

drop table if exists cloud_architectures;

create table cloud_architectures (
  id bigint generated always as identity primary key,
  name text not null,
  provider text not null check (provider in ('AWS','Azure','GCP')),
  region_key text not null,
  currency text not null default 'BRL' check (currency in ('BRL','USD')),
  monthly_usd numeric not null default 0,
  monthly_brl numeric not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index cloud_architectures_created_idx on cloud_architectures (created_at desc);

create table architecture_services (
  id bigint generated always as identity primary key,
  architecture_id bigint not null references cloud_architectures(id) on delete cascade,
  service_id text not null,
  provider text not null check (provider in ('AWS','Azure','GCP')),
  category text not null,
  name text not null,
  region_key text not null,
  configuration jsonb not null default '{}'::jsonb,
  monthly_usd numeric not null default 0,
  monthly_brl numeric not null default 0,
  position integer not null default 0
);
create index architecture_services_architecture_idx on architecture_services (architecture_id, position);

alter table cloud_architectures enable row level security;
alter table architecture_services enable row level security;
