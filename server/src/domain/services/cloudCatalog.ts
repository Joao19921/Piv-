import { isDatabaseConfigured } from "../../infrastructure/db/client";
import { listLatestPrices, listRegions, listSkus, type CloudPriceRow } from "../../infrastructure/repositories/cloudPricingRepository";
import { getLatestStoragePrice } from "../../infrastructure/repositories/storagePricingRepository";
import { logger } from "../../infrastructure/observability/logger";

export type CloudProvider = "AWS" | "Azure" | "GCP";

export interface CloudRegion {
  key: string;
  provider: CloudProvider;
  label: string;
  providerRegion: string;
}

export interface CloudSku {
  id: string;
  provider: CloudProvider;
  family: "Burstable" | "General purpose" | "Compute optimized" | "Memory optimized";
  skuName: string;
  displayName: string;
  vcpu: number;
  memoryGiB: number;
  os: "Linux";
  pricingModel: "OnDemand";
  azureArmSkuName?: string;
  sourceName: string;
  sourceUrl: string;
  notes: string;
}

export interface CloudPricePoint {
  skuId: string;
  regionKey: string;
  pricePerHourUsd: number;
  sourceStatus: "OPERATIONAL" | "DEGRADED" | "FALLBACK_STALE" | "OFFLINE";
}

/**
 * Ultimo recurso quando o Postgres esta fora do ar ou ainda nao foi configurado (DATABASE_URL vazio):
 * mesmo catalogo/precos que o app usava antes da carga em banco (fase de ingestao periodica).
 */
const STATIC_FALLBACK_REGIONS: CloudRegion[] = [
  { key: "us-east-1", provider: "AWS", label: "US East - N. Virginia", providerRegion: "us-east-1" },
  { key: "sa-east-1", provider: "AWS", label: "South America - Sao Paulo", providerRegion: "sa-east-1" },
  { key: "eu-west-1", provider: "AWS", label: "Europe - Ireland", providerRegion: "eu-west-1" },
  { key: "us-east-1", provider: "Azure", label: "East US", providerRegion: "eastus" },
  { key: "sa-east-1", provider: "Azure", label: "Brazil South", providerRegion: "brazilsouth" },
  { key: "eu-west-1", provider: "Azure", label: "West Europe", providerRegion: "westeurope" },
  { key: "us-east-1", provider: "GCP", label: "Iowa - us-central1", providerRegion: "us-central1" },
  { key: "sa-east-1", provider: "GCP", label: "Sao Paulo - southamerica-east1", providerRegion: "southamerica-east1" },
  { key: "eu-west-1", provider: "GCP", label: "Belgium - europe-west1", providerRegion: "europe-west1" },
];

const STATIC_FALLBACK_SKUS: CloudSku[] = [
  { id: "aws-t3-medium", provider: "AWS", family: "Burstable", skuName: "t3.medium", displayName: "t3.medium - 2 vCPU / 4 GiB", vcpu: 2, memoryGiB: 4, os: "Linux", pricingModel: "OnDemand", sourceName: "AWS EC2 On-Demand", sourceUrl: "https://aws.amazon.com/ec2/pricing/on-demand/", notes: "Snapshot estatico; Postgres/ingestao indisponivel." },
  { id: "aws-m6i-large", provider: "AWS", family: "General purpose", skuName: "m6i.large", displayName: "m6i.large - 2 vCPU / 8 GiB", vcpu: 2, memoryGiB: 8, os: "Linux", pricingModel: "OnDemand", sourceName: "AWS EC2 On-Demand", sourceUrl: "https://aws.amazon.com/ec2/pricing/on-demand/", notes: "Snapshot estatico; Postgres/ingestao indisponivel." },
  { id: "aws-c6i-large", provider: "AWS", family: "Compute optimized", skuName: "c6i.large", displayName: "c6i.large - 2 vCPU / 4 GiB", vcpu: 2, memoryGiB: 4, os: "Linux", pricingModel: "OnDemand", sourceName: "AWS EC2 On-Demand", sourceUrl: "https://aws.amazon.com/ec2/pricing/on-demand/", notes: "Snapshot estatico; Postgres/ingestao indisponivel." },
  { id: "azure-b2s", provider: "Azure", family: "Burstable", skuName: "Standard_B2s", azureArmSkuName: "Standard_B2s", displayName: "B2s - 2 vCPU / 4 GiB", vcpu: 2, memoryGiB: 4, os: "Linux", pricingModel: "OnDemand", sourceName: "Azure Retail Prices API", sourceUrl: "https://learn.microsoft.com/en-us/rest/api/cost-management/retail-prices/azure-retail-prices", notes: "Snapshot estatico; Postgres/ingestao indisponivel." },
  { id: "azure-d2s-v3", provider: "Azure", family: "General purpose", skuName: "Standard_D2s_v3", azureArmSkuName: "Standard_D2s_v3", displayName: "D2s v3 - 2 vCPU / 8 GiB", vcpu: 2, memoryGiB: 8, os: "Linux", pricingModel: "OnDemand", sourceName: "Azure Retail Prices API", sourceUrl: "https://learn.microsoft.com/en-us/rest/api/cost-management/retail-prices/azure-retail-prices", notes: "Snapshot estatico; Postgres/ingestao indisponivel." },
  { id: "azure-f2s-v2", provider: "Azure", family: "Compute optimized", skuName: "Standard_F2s_v2", azureArmSkuName: "Standard_F2s_v2", displayName: "F2s v2 - 2 vCPU / 4 GiB", vcpu: 2, memoryGiB: 4, os: "Linux", pricingModel: "OnDemand", sourceName: "Azure Retail Prices API", sourceUrl: "https://learn.microsoft.com/en-us/rest/api/cost-management/retail-prices/azure-retail-prices", notes: "Snapshot estatico; Postgres/ingestao indisponivel." },
  { id: "gcp-e2-standard-2", provider: "GCP", family: "General purpose", skuName: "e2-standard-2", displayName: "e2-standard-2 - 2 vCPU / 8 GiB", vcpu: 2, memoryGiB: 8, os: "Linux", pricingModel: "OnDemand", sourceName: "Google Cloud Compute Engine pricing", sourceUrl: "https://cloud.google.com/products/compute/pricing/general-purpose", notes: "Snapshot estatico; Postgres/ingestao indisponivel." },
  { id: "gcp-c3-standard-4", provider: "GCP", family: "Compute optimized", skuName: "c3-standard-4", displayName: "c3-standard-4 - 4 vCPU / 16 GiB", vcpu: 4, memoryGiB: 16, os: "Linux", pricingModel: "OnDemand", sourceName: "Google Cloud Compute Engine pricing", sourceUrl: "https://cloud.google.com/products/compute/pricing/general-purpose", notes: "Snapshot estatico; Postgres/ingestao indisponivel." },
];

const STATIC_FALLBACK_PRICES: CloudPricePoint[] = [
  { skuId: "aws-t3-medium", regionKey: "us-east-1", pricePerHourUsd: 0.0416, sourceStatus: "FALLBACK_STALE" },
  { skuId: "aws-t3-medium", regionKey: "sa-east-1", pricePerHourUsd: 0.0672, sourceStatus: "FALLBACK_STALE" },
  { skuId: "aws-t3-medium", regionKey: "eu-west-1", pricePerHourUsd: 0.0448, sourceStatus: "FALLBACK_STALE" },
  { skuId: "aws-m6i-large", regionKey: "us-east-1", pricePerHourUsd: 0.096, sourceStatus: "FALLBACK_STALE" },
  { skuId: "aws-m6i-large", regionKey: "sa-east-1", pricePerHourUsd: 0.154, sourceStatus: "FALLBACK_STALE" },
  { skuId: "aws-m6i-large", regionKey: "eu-west-1", pricePerHourUsd: 0.107, sourceStatus: "FALLBACK_STALE" },
  { skuId: "aws-c6i-large", regionKey: "us-east-1", pricePerHourUsd: 0.085, sourceStatus: "FALLBACK_STALE" },
  { skuId: "aws-c6i-large", regionKey: "sa-east-1", pricePerHourUsd: 0.136, sourceStatus: "FALLBACK_STALE" },
  { skuId: "aws-c6i-large", regionKey: "eu-west-1", pricePerHourUsd: 0.094, sourceStatus: "FALLBACK_STALE" },
  { skuId: "azure-b2s", regionKey: "us-east-1", pricePerHourUsd: 0.0416, sourceStatus: "FALLBACK_STALE" },
  { skuId: "azure-b2s", regionKey: "sa-east-1", pricePerHourUsd: 0.0608, sourceStatus: "FALLBACK_STALE" },
  { skuId: "azure-b2s", regionKey: "eu-west-1", pricePerHourUsd: 0.0464, sourceStatus: "FALLBACK_STALE" },
  { skuId: "azure-d2s-v3", regionKey: "us-east-1", pricePerHourUsd: 0.096, sourceStatus: "FALLBACK_STALE" },
  { skuId: "azure-d2s-v3", regionKey: "sa-east-1", pricePerHourUsd: 0.112, sourceStatus: "FALLBACK_STALE" },
  { skuId: "azure-d2s-v3", regionKey: "eu-west-1", pricePerHourUsd: 0.098, sourceStatus: "FALLBACK_STALE" },
  { skuId: "azure-f2s-v2", regionKey: "us-east-1", pricePerHourUsd: 0.085, sourceStatus: "FALLBACK_STALE" },
  { skuId: "azure-f2s-v2", regionKey: "sa-east-1", pricePerHourUsd: 0.102, sourceStatus: "FALLBACK_STALE" },
  { skuId: "azure-f2s-v2", regionKey: "eu-west-1", pricePerHourUsd: 0.091, sourceStatus: "FALLBACK_STALE" },
  { skuId: "gcp-e2-standard-2", regionKey: "us-east-1", pricePerHourUsd: 0.06701142, sourceStatus: "FALLBACK_STALE" },
  { skuId: "gcp-e2-standard-2", regionKey: "sa-east-1", pricePerHourUsd: 0.095, sourceStatus: "FALLBACK_STALE" },
  { skuId: "gcp-e2-standard-2", regionKey: "eu-west-1", pricePerHourUsd: 0.073, sourceStatus: "FALLBACK_STALE" },
  { skuId: "gcp-c3-standard-4", regionKey: "us-east-1", pricePerHourUsd: 0.2089, sourceStatus: "FALLBACK_STALE" },
  { skuId: "gcp-c3-standard-4", regionKey: "sa-east-1", pricePerHourUsd: 0.2925, sourceStatus: "FALLBACK_STALE" },
  { skuId: "gcp-c3-standard-4", regionKey: "eu-west-1", pricePerHourUsd: 0.2298, sourceStatus: "FALLBACK_STALE" },
];

export interface CloudCatalog {
  regions: CloudRegion[];
  skus: CloudSku[];
  prices: CloudPricePoint[];
  origin: "DATABASE" | "STATIC_FALLBACK";
}

function toCloudPricePoint(row: CloudPriceRow): CloudPricePoint {
  return { skuId: row.sku_id, regionKey: row.region_key, pricePerHourUsd: Number(row.price_per_hour_usd), sourceStatus: row.source_status };
}

let cachedCatalog: { catalog: CloudCatalog; expiresAt: number } | null = null;
const CATALOG_CACHE_MS = 60_000;

/** Catalogo (regioes + SKUs + preco mais recente conhecido) lido do Postgres, com fallback estatico. */
export async function getCloudCatalog(): Promise<CloudCatalog> {
  if (cachedCatalog && cachedCatalog.expiresAt > Date.now()) return cachedCatalog.catalog;

  if (isDatabaseConfigured) {
    try {
      const [regionRows, skuRows, priceRows] = await Promise.all([listRegions(), listSkus(), listLatestPrices()]);
      if (regionRows.length && skuRows.length) {
        const catalog: CloudCatalog = {
          regions: regionRows.map((r) => ({ key: r.region_key, provider: r.provider, label: r.label, providerRegion: r.provider_region })),
          skus: skuRows.map((s) => ({
            id: s.id,
            provider: s.provider,
            family: s.family,
            skuName: s.sku_name,
            displayName: s.display_name,
            vcpu: s.vcpu,
            memoryGiB: Number(s.memory_gib),
            os: s.os,
            pricingModel: s.pricing_model,
            azureArmSkuName: s.azure_arm_sku_name ?? undefined,
            sourceName: s.source_name,
            sourceUrl: s.source_url,
            notes: s.notes ?? "",
          })),
          prices: priceRows.map(toCloudPricePoint),
          origin: "DATABASE",
        };
        cachedCatalog = { catalog, expiresAt: Date.now() + CATALOG_CACHE_MS };
        return catalog;
      }
    } catch (err) {
      logger.error("Falha ao ler catalogo cloud do Postgres; usando snapshot estatico", { error: err instanceof Error ? err.message : String(err) });
    }
  }

  return { regions: STATIC_FALLBACK_REGIONS, skus: STATIC_FALLBACK_SKUS, prices: STATIC_FALLBACK_PRICES, origin: "STATIC_FALLBACK" };
}

export async function getCloudSku(skuId: string | undefined, provider: string): Promise<CloudSku> {
  const { skus } = await getCloudCatalog();
  return skus.find((sku) => sku.id === skuId) ?? skus.find((sku) => sku.provider === provider) ?? skus[0];
}

export async function getCloudRegions(provider: string): Promise<CloudRegion[]> {
  const { regions } = await getCloudCatalog();
  return regions.filter((region) => region.provider === provider);
}

export async function getLatestKnownPrice(skuId: string, regionKey: string): Promise<CloudPricePoint | undefined> {
  const { prices } = await getCloudCatalog();
  return prices.find((price) => price.skuId === skuId && price.regionKey === regionKey);
}

export interface StoragePricePoint {
  pricePerGbMonthUsd: number;
  sourceStatus: "OPERATIONAL" | "DEGRADED" | "FALLBACK_STALE" | "OFFLINE";
}

/** EBS gp3 (AWS) por enquanto — Azure/GCP ainda nao tem ingestao de storage. */
export async function getLatestKnownStoragePrice(provider: CloudProvider, regionKey: string, storageType = "gp3"): Promise<StoragePricePoint | undefined> {
  if (!isDatabaseConfigured) return undefined;
  try {
    const row = await getLatestStoragePrice(provider, regionKey, storageType);
    if (!row) return undefined;
    return { pricePerGbMonthUsd: Number(row.price_per_gb_month_usd), sourceStatus: row.source_status };
  } catch (err) {
    logger.error("Falha ao ler preco de storage do Postgres", { error: err instanceof Error ? err.message : String(err) });
    return undefined;
  }
}
