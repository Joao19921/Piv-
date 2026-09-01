import { readCache, writeCache } from "../cache/fileCache";
import { executeWithFallback, type ResilienceResult } from "../resilience/resilienceManager";
import { DEFAULT_REGION_KEY, GCP_REGION_AVG_USD_PER_HOUR } from "./staticFallbacks";

const REQUEST_TIMEOUT_MS = 8_000;
const MAX_PAGES = 6;
// Id fixo do servico "Compute Engine" no catalogo publico da Cloud Billing Catalog API.
const COMPUTE_ENGINE_SERVICE_ID = "6F81-5844-456A";

/** Familia de maquina (usada para casar SKUs de nucleo/RAM pela descricao) por instancia do catalogo Pivo. */
const MACHINE_SERIES_BY_TYPE: Record<string, string> = {
  "e2-micro": "E2",
  "e2-standard-2": "E2",
  "c3-standard-4": "C3",
  "n2-highmem-2": "N2",
};

export interface GcpUnitPrice {
  pricePerHourUsd: number;
  skuName: string;
  region: string;
}

interface GcpSku {
  description: string;
  category: { resourceGroup?: string; usageType: string };
  serviceRegions: string[];
  pricingInfo: Array<{ pricingExpression: { tieredRates: Array<{ unitPrice: { units?: string; nanos?: number } }> } }>;
}

async function listComputeSkus(apiKey: string, pageToken?: string): Promise<{ skus: GcpSku[]; nextPageToken?: string }> {
  const url = new URL(`https://cloudbilling.googleapis.com/v1/services/${COMPUTE_ENGINE_SERVICE_ID}/skus`);
  url.searchParams.set("key", apiKey);
  url.searchParams.set("pageSize", "5000");
  if (pageToken) url.searchParams.set("pageToken", pageToken);

  const res = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`GCP Cloud Billing Catalog respondeu HTTP ${res.status}`);
  const json = (await res.json()) as { skus?: GcpSku[]; nextPageToken?: string };
  return { skus: json.skus ?? [], nextPageToken: json.nextPageToken };
}

function unitPriceUsd(sku: GcpSku): number {
  const tier = sku.pricingInfo[0]?.pricingExpression.tieredRates.at(-1);
  if (!tier) throw new Error(`SKU GCP '${sku.description}' sem tieredRates`);
  return Number(tier.unitPrice.units ?? 0) + (tier.unitPrice.nanos ?? 0) / 1e9;
}

function findRatePerUnit(skus: GcpSku[], series: string, region: string, kind: "Core" | "Ram"): number {
  const match = skus.find(
    (sku) =>
      sku.category.usageType === "OnDemand" &&
      sku.serviceRegions.includes(region) &&
      sku.description.includes(series) &&
      sku.description.includes(`Instance ${kind} running`),
  );
  if (!match) throw new Error(`SKU GCP nao encontrado (serie=${series}, regiao=${region}, tipo=${kind})`);
  return unitPriceUsd(match);
}

/**
 * Instancias predefinidas da GCP sao precificadas por vCPU + RAM separadamente (nao ha um SKU
 * unico "por instancia" como AWS/Azure). Este calculo replica a formula publica da GCP:
 * preco/h = vcpu * preco_nucleo/h + memoriaGiB * preco_ram_GiB/h.
 */
async function fetchGcpUnitPrice(regionKey: string, machineType: string, vcpu: number, memoryGiB: number): Promise<GcpUnitPrice> {
  const apiKey = process.env.GOOGLE_CLOUD_BILLING_API_KEY;
  if (!apiKey) throw new Error("GOOGLE_CLOUD_BILLING_API_KEY nao configurada");
  const series = MACHINE_SERIES_BY_TYPE[machineType];
  if (!series) throw new Error(`Familia de maquina GCP desconhecida para '${machineType}'`);

  const allSkus: GcpSku[] = [];
  let pageToken: string | undefined;
  let pages = 0;
  do {
    const page = await listComputeSkus(apiKey, pageToken);
    allSkus.push(...page.skus);
    pageToken = page.nextPageToken;
    pages += 1;
  } while (pageToken && pages < MAX_PAGES);

  const coreRate = findRatePerUnit(allSkus, series, regionKey, "Core");
  const ramRate = findRatePerUnit(allSkus, series, regionKey, "Ram");
  return { pricePerHourUsd: vcpu * coreRate + memoryGiB * ramRate, skuName: machineType, region: regionKey };
}

export async function getGcpUnitPrice(
  regionKey: string,
  machineType: string,
  vcpu: number,
  memoryGiB: number,
  fallbackPrice?: number,
): Promise<ResilienceResult<GcpUnitPrice>> {
  const cacheKey = `gcp-unit-price-${regionKey}-${machineType}`;
  return executeWithFallback<GcpUnitPrice>({
    serviceName: `GCP_BILLING_${regionKey}_${machineType}`,
    primary: async () => {
      const price = await fetchGcpUnitPrice(regionKey, machineType, vcpu, memoryGiB);
      writeCache(cacheKey, price);
      return price;
    },
    fallback: async () => {
      const cached = readCache<GcpUnitPrice>(cacheKey);
      if (cached) return cached;
      return {
        data: {
          pricePerHourUsd: fallbackPrice ?? GCP_REGION_AVG_USD_PER_HOUR[regionKey] ?? GCP_REGION_AVG_USD_PER_HOUR[DEFAULT_REGION_KEY],
          skuName: machineType,
          region: regionKey,
        },
        updatedAt: new Date().toISOString(),
      };
    },
  });
}
