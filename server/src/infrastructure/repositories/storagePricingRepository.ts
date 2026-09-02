import { query } from "../db/client";

export interface StoragePriceRow {
  provider: "AWS" | "Azure" | "GCP";
  region_key: string;
  storage_type: string;
  price_per_gb_month_usd: string;
  source_status: "OPERATIONAL" | "DEGRADED" | "FALLBACK_STALE" | "OFFLINE";
  captured_at: string;
}

export async function insertStoragePrice(input: {
  provider: "AWS" | "Azure" | "GCP";
  regionKey: string;
  storageType: string;
  pricePerGbMonthUsd: number;
  sourceStatus: "OPERATIONAL" | "DEGRADED" | "FALLBACK_STALE" | "OFFLINE";
}): Promise<void> {
  await query(
    "storage_prices.insert",
    `insert into storage_prices (provider, region_key, storage_type, price_per_gb_month_usd, source_status) values ($1, $2, $3, $4, $5)`,
    [input.provider, input.regionKey, input.storageType, input.pricePerGbMonthUsd, input.sourceStatus],
  );
}

export async function getLatestStoragePrice(provider: string, regionKey: string, storageType: string): Promise<StoragePriceRow | undefined> {
  const rows = await query<StoragePriceRow>(
    "storage_prices.get_latest",
    `select provider, region_key, storage_type, price_per_gb_month_usd, source_status, captured_at
     from storage_prices
     where provider = $1 and region_key = $2 and storage_type = $3
     order by captured_at desc
     limit 1`,
    [provider, regionKey, storageType],
  );
  return rows[0];
}

/** Todas as combinacoes provider/regiao/tipo com preco mais recente conhecido — usado como fallback em memoria pelo catalogo. */
export async function listLatestStoragePrices(): Promise<StoragePriceRow[]> {
  return query<StoragePriceRow>(
    "storage_prices.list_latest",
    `select distinct on (provider, region_key, storage_type) provider, region_key, storage_type, price_per_gb_month_usd, source_status, captured_at
     from storage_prices
     order by provider, region_key, storage_type, captured_at desc`,
  );
}
