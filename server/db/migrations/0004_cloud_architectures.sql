-- Aplicada no projeto Supabase "pivo" (sa-east-1) via MCP em 2026-09-05.
-- Unica coisa que o produto persiste hoje alem do historico de precificacao: uma arquitetura
-- de infra cloud (provider + regiao + SKU + instancias/horas/storage) salva com nome pelo usuario.

create table cloud_architectures (
  id bigint generated always as identity primary key,
  name text not null,
  provider text not null check (provider in ('AWS','Azure','GCP')),
  region_key text not null,
  sku_id text not null,
  sku_display_name text not null,
  instances integer not null check (instances >= 0),
  hours integer not null check (hours >= 0),
  storage_gb numeric not null default 0 check (storage_gb >= 0),
  unit_price_usd numeric not null,
  fx_rate numeric not null,
  monthly_usd numeric not null,
  monthly_brl numeric not null,
  created_at timestamptz not null default now()
);
create index cloud_architectures_created_idx on cloud_architectures (created_at desc);

-- RLS habilitado sem policies (mesmo padrao das demais tabelas): bloqueia acesso via
-- PostgREST/anon key; o backend conecta direto e ignora RLS.
alter table cloud_architectures enable row level security;
