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

interface AzureRetailItem {
  retailPrice: number;
  tierMinimumUnits: number;
}

async function fetchAzureRetailItems(filter: string): Promise<AzureRetailItem[]> {
  const url = `https://prices.azure.com/api/retail/prices?$filter=${encodeURIComponent(filter)}&$top=50`;
  const res = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`Azure Retail Prices respondeu HTTP ${res.status}`);
  const json = (await res.json()) as { Items?: AzureRetailItem[] };
  return json.Items ?? [];
}

/**
 * Alguns medidores (ex.: Functions) tem uma faixa gratuita inicial com retailPrice 0 antes da
 * faixa paga "de verdade" (ex.: 100 mil execucoes gratis, depois USD por execucao). Ignora
 * faixas gratuitas quando existe alguma faixa paga, e entre as pagas usa a de menor volume
 * (a tarifa "padrao", nao o desconto por volume de faixas mais altas).
 */
function representativePrice(items: AzureRetailItem[], errorContext: string): number {
  const paid = items.filter((i) => i.retailPrice > 0);
  const pool = paid.length ? paid : items;
  const item = pool.reduce((min, i) => (i.tierMinimumUnits < min.tierMinimumUnits ? i : min), pool[0]);
  if (!item) throw new Error(`Azure Retail Prices sem itens (${errorContext})`);
  return item.retailPrice;
}

/** Blob Storage (Hot/Cool LRS) — preco de referencia por GB/mes, ao vivo via Azure Retail Prices API. */
export async function getAzureStoragePrice(regionKey: string, tier: "hot" | "cool" = "hot"): Promise<ResilienceResult<{ pricePerGbMonthUsd: number }>> {
  const armRegion = REGION_TO_ARM_REGION[regionKey] ?? REGION_TO_ARM_REGION[DEFAULT_REGION_KEY];
  const skuName = tier === "cool" ? "Cool LRS" : "Hot LRS";
  const cacheKey = `azure-storage-price-${regionKey}-${tier}`;
  return executeWithFallback({
    serviceName: `AZURE_RETAIL_STORAGE_${regionKey}_${tier}`,
    primary: async () => {
      const filter = [`armRegionName eq '${armRegion}'`, `productName eq 'Blob Storage'`, `skuName eq '${skuName}'`, `meterName eq '${skuName} Data Stored'`].join(" and ");
      const price = { pricePerGbMonthUsd: representativePrice(await fetchAzureRetailItems(filter), `storage ${skuName} em ${armRegion}`) };
      writeCache(cacheKey, price);
      return price;
    },
    fallback: async () => readCache(cacheKey),
  });
}

/** Azure SQL Database (Single, vCore) — preco de referencia por vCore/hora, ao vivo via Azure Retail Prices API. */
export async function getAzureSqlPrice(regionKey: string, vcores: number, tier: "general_purpose" | "business_critical" = "general_purpose"): Promise<ResilienceResult<{ pricePerVcoreHourUsd: number }>> {
  const armRegion = REGION_TO_ARM_REGION[regionKey] ?? REGION_TO_ARM_REGION[DEFAULT_REGION_KEY];
  const productTier = tier === "business_critical" ? "Business Critical" : "General Purpose";
  const cacheKey = `azure-sql-price-${regionKey}-${vcores}-${tier}`;
  return executeWithFallback({
    serviceName: `AZURE_RETAIL_SQL_${regionKey}_${tier}`,
    primary: async () => {
      const filter = [
        `armRegionName eq '${armRegion}'`,
        `productName eq 'SQL Database Single/Elastic Pool ${productTier} - Compute Gen5'`,
        `skuName eq '${vcores} vCore'`,
        `meterName eq 'vCore'`,
        `type eq 'Consumption'`,
      ].join(" and ");
      const price = { pricePerVcoreHourUsd: representativePrice(await fetchAzureRetailItems(filter), `SQL ${productTier} ${vcores}vCore em ${armRegion}`) };
      writeCache(cacheKey, price);
      return price;
    },
    fallback: async () => readCache(cacheKey),
  });
}

/** Load Balancer Standard — precificacao global (nao varia por regiao Azure), ao vivo via Azure Retail Prices API. */
export async function getAzureLoadBalancerPrice(): Promise<ResilienceResult<{ pricePerHourUsd: number; pricePerGbUsd: number }>> {
  const cacheKey = "azure-lb-price-global";
  return executeWithFallback({
    serviceName: "AZURE_RETAIL_LOAD_BALANCER",
    primary: async () => {
      const [hourItems, gbItems] = await Promise.all([
        fetchAzureRetailItems(`armRegionName eq 'Global' and productName eq 'Load Balancer' and skuName eq 'Standard' and meterName eq 'Standard Included LB Rules and Outbound Rules'`),
        fetchAzureRetailItems(`armRegionName eq 'Global' and productName eq 'Load Balancer' and skuName eq 'Standard' and meterName eq 'Standard Data Processed'`),
      ]);
      const price = {
        pricePerHourUsd: representativePrice(hourItems, "Load Balancer Standard (hora)"),
        pricePerGbUsd: representativePrice(gbItems, "Load Balancer Standard (dados)"),
      };
      writeCache(cacheKey, price);
      return price;
    },
    fallback: async () => readCache(cacheKey),
  });
}

/** Azure Functions (Consumption/Standard) — preco de referencia por execucao e GB-segundo, ao vivo via Azure Retail Prices API. */
export async function getAzureFunctionsPrice(regionKey: string): Promise<ResilienceResult<{ pricePerExecutionUsd: number; pricePerGbSecondUsd: number }>> {
  const armRegion = REGION_TO_ARM_REGION[regionKey] ?? REGION_TO_ARM_REGION[DEFAULT_REGION_KEY];
  const cacheKey = `azure-functions-price-${regionKey}`;
  return executeWithFallback({
    serviceName: `AZURE_RETAIL_FUNCTIONS_${regionKey}`,
    primary: async () => {
      const [executionItems, durationItems] = await Promise.all([
        fetchAzureRetailItems(`armRegionName eq '${armRegion}' and productName eq 'Functions' and skuName eq 'Standard' and meterName eq 'Standard Total Executions'`),
        fetchAzureRetailItems(`armRegionName eq '${armRegion}' and productName eq 'Functions' and skuName eq 'Standard' and meterName eq 'Standard Execution Time'`),
      ]);
      // "Standard Total Executions" e cobrado a cada 10 execucoes (unitOfMeasure "10").
      const price = {
        pricePerExecutionUsd: representativePrice(executionItems, `Functions execucoes em ${armRegion}`) / 10,
        pricePerGbSecondUsd: representativePrice(durationItems, `Functions duracao em ${armRegion}`),
      };
      writeCache(cacheKey, price);
      return price;
    },
    fallback: async () => readCache(cacheKey),
  });
}
