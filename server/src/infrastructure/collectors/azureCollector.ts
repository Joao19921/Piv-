import { readCache, writeCache } from "../cache/fileCache";
import { executeWithFallback, type ResilienceResult } from "../resilience/resilienceManager";
import { AZURE_REGION_AVG_USD_PER_HOUR, DEFAULT_REGION_KEY } from "./staticFallbacks";

const REQUEST_TIMEOUT_MS = 4_000;
const REFERENCE_SKU = "Standard_D2s_v3";

/** Mapeia as regiões exibidas na UI (estilo AWS) para o código de região ARM da Azure. */
const REGION_TO_ARM_REGION: Record<string, string> = {
  "us-east-1": "eastus",
  "sa-east-1": "brazilsouth",
  "eu-west-1": "westeurope",
};

export interface AzureUnitPrice {
  pricePerHourUsd: number;
  skuName: string;
  armRegion: string;
}

async function fetchAzureUnitPrice(regionKey: string, armSkuName = REFERENCE_SKU): Promise<AzureUnitPrice> {
  const armRegion = REGION_TO_ARM_REGION[regionKey] ?? REGION_TO_ARM_REGION[DEFAULT_REGION_KEY];
  const filter = [
    `armRegionName eq '${armRegion}'`,
    `serviceName eq 'Virtual Machines'`,
    `armSkuName eq '${armSkuName}'`,
    `priceType eq 'Consumption'`,
  ].join(" and ");

  const url = `https://prices.azure.com/api/retail/prices?$filter=${encodeURIComponent(filter)}&$top=10`;
  const res = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (!res.ok) {
    throw new Error(`Azure Retail Prices respondeu HTTP ${res.status}`);
  }

  const json = (await res.json()) as {
    Items?: Array<{ retailPrice: number; armSkuName: string; armRegionName: string; productName: string }>;
  };

  // Prioriza o SKU Linux "puro" (produtos Windows têm o mesmo armSkuName com licença embutida).
  const item =
    json.Items?.find((i) => !/windows/i.test(i.productName)) ?? json.Items?.[0];
  if (!item) {
    throw new Error(`Azure Retail Prices sem itens para ${armSkuName} em ${armRegion}`);
  }

  return { pricePerHourUsd: item.retailPrice, skuName: item.armSkuName, armRegion: item.armRegionName };
}

export async function getAzureUnitPrice(regionKey: string, armSkuName = REFERENCE_SKU, fallbackPrice?: number): Promise<ResilienceResult<AzureUnitPrice>> {
  const cacheKey = `azure-unit-price-${regionKey}-${armSkuName}`;
  return executeWithFallback<AzureUnitPrice>({
    serviceName: `AZURE_RETAIL_${regionKey}_${armSkuName}`,
    primary: async () => {
      const price = await fetchAzureUnitPrice(regionKey, armSkuName);
      writeCache(cacheKey, price);
      return price;
    },
    fallback: async () => {
      const cached = readCache<AzureUnitPrice>(cacheKey);
      if (cached) return cached;
      return {
        data: {
          pricePerHourUsd: fallbackPrice ?? AZURE_REGION_AVG_USD_PER_HOUR[regionKey] ?? AZURE_REGION_AVG_USD_PER_HOUR[DEFAULT_REGION_KEY],
          skuName: armSkuName,
          armRegion: REGION_TO_ARM_REGION[regionKey] ?? REGION_TO_ARM_REGION[DEFAULT_REGION_KEY],
        },
        updatedAt: new Date().toISOString(),
      };
    },
  });
}
