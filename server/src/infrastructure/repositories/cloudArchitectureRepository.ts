import { query } from "../db/client";

export interface CloudArchitectureRow {
  id: string;
  name: string;
  provider: "AWS" | "Azure" | "GCP";
  region_key: string;
  sku_id: string;
  sku_display_name: string;
  instances: number;
  hours: number;
  storage_gb: string;
  unit_price_usd: string;
  fx_rate: string;
  monthly_usd: string;
  monthly_brl: string;
  created_at: string;
}

export interface InsertCloudArchitectureInput {
  name: string;
  provider: "AWS" | "Azure" | "GCP";
  regionKey: string;
  skuId: string;
  skuDisplayName: string;
  instances: number;
  hours: number;
  storageGb: number;
  unitPriceUsd: number;
  fxRate: number;
  monthlyUsd: number;
  monthlyBrl: number;
}

export async function insertCloudArchitecture(input: InsertCloudArchitectureInput): Promise<CloudArchitectureRow> {
  const [row] = await query<CloudArchitectureRow>(
    "cloud_architectures.insert",
    `insert into cloud_architectures
       (name, provider, region_key, sku_id, sku_display_name, instances, hours, storage_gb, unit_price_usd, fx_rate, monthly_usd, monthly_brl)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     returning id, name, provider, region_key, sku_id, sku_display_name, instances, hours, storage_gb, unit_price_usd, fx_rate, monthly_usd, monthly_brl, created_at`,
    [
      input.name,
      input.provider,
      input.regionKey,
      input.skuId,
      input.skuDisplayName,
      input.instances,
      input.hours,
      input.storageGb,
      input.unitPriceUsd,
      input.fxRate,
      input.monthlyUsd,
      input.monthlyBrl,
    ],
  );
  return row;
}

export async function listCloudArchitectures(limit = 50): Promise<CloudArchitectureRow[]> {
  return query<CloudArchitectureRow>(
    "cloud_architectures.list_recent",
    `select id, name, provider, region_key, sku_id, sku_display_name, instances, hours, storage_gb, unit_price_usd, fx_rate, monthly_usd, monthly_brl, created_at
     from cloud_architectures
     order by created_at desc
     limit $1`,
    [limit],
  );
}
