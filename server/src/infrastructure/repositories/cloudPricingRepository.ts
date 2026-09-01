import { query } from "../db/client";

export interface CloudSkuRow {
  id: string;
  provider: "AWS" | "Azure" | "GCP";
  family: "Burstable" | "General purpose" | "Compute optimized" | "Memory optimized";
  sku_name: string;
  display_name: string;
  vcpu: number;
  memory_gib: string;
  os: "Linux";
  pricing_model: "OnDemand";
  azure_arm_sku_name: string | null;
  source_name: string;
  source_url: string;
  notes: string | null;
}

export interface CloudRegionRow {
  provider: "AWS" | "Azure" | "GCP";
  region_key: string;
  label: string;
  provider_region: string;
}

export interface CloudPriceRow {
  sku_id: string;
  region_key: string;
  price_per_hour_usd: string;
  source_status: "OPERATIONAL" | "DEGRADED" | "FALLBACK_STALE" | "OFFLINE";
  captured_at: string;
}

export async function listSkus(): Promise<CloudSkuRow[]> {
  return query<CloudSkuRow>("cloud_skus.list", `select * from cloud_skus order by provider, family, sku_name`);
}

export async function listRegions(): Promise<CloudRegionRow[]> {
  return query<CloudRegionRow>("cloud_regions.list", `select provider, region_key, label, provider_region from cloud_regions order by provider, region_key`);
}

/** Preco mais recente por (sku, regiao), usando o historico insert-only de cloud_prices. */
export async function listLatestPrices(): Promise<CloudPriceRow[]> {
  return query<CloudPriceRow>(
    "cloud_prices.list_latest",
    `select distinct on (sku_id, region_key) sku_id, region_key, price_per_hour_usd, source_status, captured_at
     from cloud_prices
     order by sku_id, region_key, captured_at desc`,
  );
}

export async function getLatestPrice(skuId: string, regionKey: string): Promise<CloudPriceRow | undefined> {
  const rows = await query<CloudPriceRow>(
    "cloud_prices.get_latest",
    `select sku_id, region_key, price_per_hour_usd, source_status, captured_at
     from cloud_prices
     where sku_id = $1 and region_key = $2
     order by captured_at desc
     limit 1`,
    [skuId, regionKey],
  );
  return rows[0];
}

export async function insertPrice(input: {
  skuId: string;
  regionKey: string;
  pricePerHourUsd: number;
  sourceStatus: "OPERATIONAL" | "DEGRADED" | "FALLBACK_STALE" | "OFFLINE";
}): Promise<void> {
  await query(
    "cloud_prices.insert",
    `insert into cloud_prices (sku_id, region_key, price_per_hour_usd, source_status) values ($1, $2, $3, $4)`,
    [input.skuId, input.regionKey, input.pricePerHourUsd, input.sourceStatus],
  );
}
