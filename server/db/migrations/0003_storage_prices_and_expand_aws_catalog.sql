-- Aplicada no projeto Supabase "pivo" via MCP em 2026-09-02.
-- Custo de armazenamento (EBS gp3 na AWS por enquanto): preco flat $/GB-mes por regiao,
-- nao amarrado a um SKU de instancia. Historico insert-only, igual cloud_prices.
create table storage_prices (
  id bigint generated always as identity primary key,
  provider text not null check (provider in ('AWS','Azure','GCP')),
  region_key text not null,
  storage_type text not null,
  price_per_gb_month_usd numeric not null,
  source_status text not null check (source_status in ('OPERATIONAL','DEGRADED','FALLBACK_STALE','OFFLINE')),
  captured_at timestamptz not null default now()
);
create index storage_prices_latest_idx on storage_prices (provider, region_key, storage_type, captured_at desc);
alter table storage_prices enable row level security;

-- Amplia o catalogo de instancias EC2 (mais tamanhos por familia, igual a calculadora oficial da AWS).
-- Sem preco inventado: cloud_prices so recebe uma linha para esses SKUs na proxima ingestao real.
insert into cloud_skus (id, provider, family, sku_name, display_name, vcpu, memory_gib, os, pricing_model, source_name, source_url, notes) values
  ('aws-t3-small', 'AWS', 'Burstable', 't3.small', 't3.small - 2 vCPU / 2 GiB', 2, 2, 'Linux', 'OnDemand', 'AWS EC2 On-Demand', 'https://aws.amazon.com/ec2/pricing/on-demand/', 'Preco preenchido pela ingestao periodica.'),
  ('aws-t3-large', 'AWS', 'Burstable', 't3.large', 't3.large - 2 vCPU / 8 GiB', 2, 8, 'Linux', 'OnDemand', 'AWS EC2 On-Demand', 'https://aws.amazon.com/ec2/pricing/on-demand/', 'Preco preenchido pela ingestao periodica.'),
  ('aws-m6i-xlarge', 'AWS', 'General purpose', 'm6i.xlarge', 'm6i.xlarge - 4 vCPU / 16 GiB', 4, 16, 'Linux', 'OnDemand', 'AWS EC2 On-Demand', 'https://aws.amazon.com/ec2/pricing/on-demand/', 'Preco preenchido pela ingestao periodica.'),
  ('aws-m6i-2xlarge', 'AWS', 'General purpose', 'm6i.2xlarge', 'm6i.2xlarge - 8 vCPU / 32 GiB', 8, 32, 'Linux', 'OnDemand', 'AWS EC2 On-Demand', 'https://aws.amazon.com/ec2/pricing/on-demand/', 'Preco preenchido pela ingestao periodica.'),
  ('aws-c6i-xlarge', 'AWS', 'Compute optimized', 'c6i.xlarge', 'c6i.xlarge - 4 vCPU / 8 GiB', 4, 8, 'Linux', 'OnDemand', 'AWS EC2 On-Demand', 'https://aws.amazon.com/ec2/pricing/on-demand/', 'Preco preenchido pela ingestao periodica.'),
  ('aws-c6i-2xlarge', 'AWS', 'Compute optimized', 'c6i.2xlarge', 'c6i.2xlarge - 8 vCPU / 16 GiB', 8, 16, 'Linux', 'OnDemand', 'AWS EC2 On-Demand', 'https://aws.amazon.com/ec2/pricing/on-demand/', 'Preco preenchido pela ingestao periodica.'),
  ('aws-r6i-xlarge', 'AWS', 'Memory optimized', 'r6i.xlarge', 'r6i.xlarge - 4 vCPU / 32 GiB', 4, 32, 'Linux', 'OnDemand', 'AWS EC2 On-Demand', 'https://aws.amazon.com/ec2/pricing/on-demand/', 'Preco preenchido pela ingestao periodica.'),
  ('aws-r6i-2xlarge', 'AWS', 'Memory optimized', 'r6i.2xlarge', 'r6i.2xlarge - 8 vCPU / 64 GiB', 8, 64, 'Linux', 'OnDemand', 'AWS EC2 On-Demand', 'https://aws.amazon.com/ec2/pricing/on-demand/', 'Preco preenchido pela ingestao periodica.');
