-- Seed de dimensao (regioes e SKUs). Nao inclui precos inventados: os precos das
-- combinacoes novas (regiao us-west-2 e as 3 SKUs de memoria/burstable adicionadas
-- nesta fase) sao preenchidos pela ingestao real (server/scripts/refreshSources.ts).
-- Os precos das 8 combinacoes ja existentes no catalogo estatico anterior (cloudCatalog.ts)
-- sao migrados como estavam, marcados FALLBACK_STALE ate a primeira ingestao real substituir.

insert into cloud_regions (provider, region_key, label, provider_region) values
  ('AWS', 'us-east-1', 'US East - N. Virginia', 'us-east-1'),
  ('AWS', 'sa-east-1', 'South America - Sao Paulo', 'sa-east-1'),
  ('AWS', 'eu-west-1', 'Europe - Ireland', 'eu-west-1'),
  ('AWS', 'us-west-2', 'US West - Oregon', 'us-west-2'),
  ('Azure', 'us-east-1', 'East US', 'eastus'),
  ('Azure', 'sa-east-1', 'Brazil South', 'brazilsouth'),
  ('Azure', 'eu-west-1', 'West Europe', 'westeurope'),
  ('Azure', 'us-west-2', 'West US 2', 'westus2'),
  ('GCP', 'us-east-1', 'Iowa - us-central1', 'us-central1'),
  ('GCP', 'sa-east-1', 'Sao Paulo - southamerica-east1', 'southamerica-east1'),
  ('GCP', 'eu-west-1', 'Belgium - europe-west1', 'europe-west1'),
  ('GCP', 'us-west-2', 'Oregon - us-west1', 'us-west1');

insert into cloud_skus (id, provider, family, sku_name, display_name, vcpu, memory_gib, os, pricing_model, azure_arm_sku_name, source_name, source_url, notes) values
  ('aws-t3-medium', 'AWS', 'Burstable', 't3.medium', 't3.medium - 2 vCPU / 4 GiB', 2, 4, 'Linux', 'OnDemand', null, 'AWS EC2 On-Demand', 'https://aws.amazon.com/ec2/pricing/on-demand/', 'Preco Linux on-demand. AWS Price List Bulk API substitui o snapshot via ingestao periodica.'),
  ('aws-m6i-large', 'AWS', 'General purpose', 'm6i.large', 'm6i.large - 2 vCPU / 8 GiB', 2, 8, 'Linux', 'OnDemand', null, 'AWS EC2 On-Demand', 'https://aws.amazon.com/ec2/pricing/on-demand/', 'SKU general purpose x86 para workload persistente.'),
  ('aws-c6i-large', 'AWS', 'Compute optimized', 'c6i.large', 'c6i.large - 2 vCPU / 4 GiB', 2, 4, 'Linux', 'OnDemand', null, 'AWS EC2 On-Demand', 'https://aws.amazon.com/ec2/pricing/on-demand/', 'SKU compute optimized para API/servicos CPU-bound.'),
  ('aws-r6i-large', 'AWS', 'Memory optimized', 'r6i.large', 'r6i.large - 2 vCPU / 16 GiB', 2, 16, 'Linux', 'OnDemand', null, 'AWS EC2 On-Demand', 'https://aws.amazon.com/ec2/pricing/on-demand/', 'SKU memory optimized para cache/in-memory. Preco preenchido na primeira ingestao.'),
  ('azure-b2s', 'Azure', 'Burstable', 'Standard_B2s', 'B2s - 2 vCPU / 4 GiB', 2, 4, 'Linux', 'OnDemand', 'Standard_B2s', 'Azure Retail Prices API', 'https://learn.microsoft.com/en-us/rest/api/cost-management/retail-prices/azure-retail-prices', 'Preco buscado ao vivo pela Azure Retail Prices API quando disponivel.'),
  ('azure-d2s-v3', 'Azure', 'General purpose', 'Standard_D2s_v3', 'D2s v3 - 2 vCPU / 8 GiB', 2, 8, 'Linux', 'OnDemand', 'Standard_D2s_v3', 'Azure Retail Prices API', 'https://learn.microsoft.com/en-us/rest/api/cost-management/retail-prices/azure-retail-prices', 'Referencia historica do app, selecionavel no catalogo.'),
  ('azure-f2s-v2', 'Azure', 'Compute optimized', 'Standard_F2s_v2', 'F2s v2 - 2 vCPU / 4 GiB', 2, 4, 'Linux', 'OnDemand', 'Standard_F2s_v2', 'Azure Retail Prices API', 'https://learn.microsoft.com/en-us/rest/api/cost-management/retail-prices/azure-retail-prices', 'SKU compute optimized para servicos sensiveis a CPU.'),
  ('azure-e2s-v3', 'Azure', 'Memory optimized', 'Standard_E2s_v3', 'E2s v3 - 2 vCPU / 16 GiB', 2, 16, 'Linux', 'OnDemand', 'Standard_E2s_v3', 'Azure Retail Prices API', 'https://learn.microsoft.com/en-us/rest/api/cost-management/retail-prices/azure-retail-prices', 'SKU memory optimized; preco ao vivo via Azure Retail Prices API.'),
  ('gcp-e2-micro', 'GCP', 'Burstable', 'e2-micro', 'e2-micro - 2 vCPU (shared-core) / 1 GiB', 2, 1, 'Linux', 'OnDemand', null, 'Google Cloud Compute Engine pricing', 'https://cloud.google.com/products/compute/pricing/general-purpose', 'Equivalente shared-core da GCP; nao usa credito de burst como AWS T3/Azure B-series.'),
  ('gcp-e2-standard-2', 'GCP', 'General purpose', 'e2-standard-2', 'e2-standard-2 - 2 vCPU / 8 GiB', 2, 8, 'Linux', 'OnDemand', null, 'Google Cloud Compute Engine pricing', 'https://cloud.google.com/products/compute/pricing/general-purpose', 'Preco on-demand da familia E2; Billing Catalog API alimenta a ingestao periodica.'),
  ('gcp-c3-standard-4', 'GCP', 'Compute optimized', 'c3-standard-4', 'c3-standard-4 - 4 vCPU / 16 GiB', 4, 16, 'Linux', 'OnDemand', null, 'Google Cloud Compute Engine pricing', 'https://cloud.google.com/products/compute/pricing/general-purpose', 'SKU de nova geracao para workloads de maior desempenho.'),
  ('gcp-n2-highmem-2', 'GCP', 'Memory optimized', 'n2-highmem-2', 'n2-highmem-2 - 2 vCPU / 16 GiB', 2, 16, 'Linux', 'OnDemand', null, 'Google Cloud Compute Engine pricing', 'https://cloud.google.com/products/compute/pricing/general-purpose', 'SKU memory optimized; preco preenchido na primeira ingestao.');

-- Precos migrados do catalogo estatico anterior (cloudCatalog.ts), marcados como fallback
-- ate a primeira ingestao real (server/scripts/refreshSources.ts) gravar dados OPERATIONAL.
insert into cloud_prices (sku_id, region_key, price_per_hour_usd, source_status) values
  ('aws-t3-medium', 'us-east-1', 0.0416, 'FALLBACK_STALE'),
  ('aws-t3-medium', 'sa-east-1', 0.0672, 'FALLBACK_STALE'),
  ('aws-t3-medium', 'eu-west-1', 0.0448, 'FALLBACK_STALE'),
  ('aws-m6i-large', 'us-east-1', 0.096, 'FALLBACK_STALE'),
  ('aws-m6i-large', 'sa-east-1', 0.154, 'FALLBACK_STALE'),
  ('aws-m6i-large', 'eu-west-1', 0.107, 'FALLBACK_STALE'),
  ('aws-c6i-large', 'us-east-1', 0.085, 'FALLBACK_STALE'),
  ('aws-c6i-large', 'sa-east-1', 0.136, 'FALLBACK_STALE'),
  ('aws-c6i-large', 'eu-west-1', 0.094, 'FALLBACK_STALE'),
  ('azure-b2s', 'us-east-1', 0.0416, 'FALLBACK_STALE'),
  ('azure-b2s', 'sa-east-1', 0.0608, 'FALLBACK_STALE'),
  ('azure-b2s', 'eu-west-1', 0.0464, 'FALLBACK_STALE'),
  ('azure-d2s-v3', 'us-east-1', 0.096, 'FALLBACK_STALE'),
  ('azure-d2s-v3', 'sa-east-1', 0.112, 'FALLBACK_STALE'),
  ('azure-d2s-v3', 'eu-west-1', 0.098, 'FALLBACK_STALE'),
  ('azure-f2s-v2', 'us-east-1', 0.085, 'FALLBACK_STALE'),
  ('azure-f2s-v2', 'sa-east-1', 0.102, 'FALLBACK_STALE'),
  ('azure-f2s-v2', 'eu-west-1', 0.091, 'FALLBACK_STALE'),
  ('gcp-e2-standard-2', 'us-east-1', 0.06701142, 'FALLBACK_STALE'),
  ('gcp-e2-standard-2', 'sa-east-1', 0.095, 'FALLBACK_STALE'),
  ('gcp-e2-standard-2', 'eu-west-1', 0.073, 'FALLBACK_STALE'),
  ('gcp-c3-standard-4', 'us-east-1', 0.2089, 'FALLBACK_STALE'),
  ('gcp-c3-standard-4', 'sa-east-1', 0.2925, 'FALLBACK_STALE'),
  ('gcp-c3-standard-4', 'eu-west-1', 0.2298, 'FALLBACK_STALE');
