import { GetProductsCommand, PricingClient } from "@aws-sdk/client-pricing";
import { readCache, writeCache } from "../cache/fileCache";
import { executeWithFallback, type ResilienceResult } from "../resilience/resilienceManager";
import { AWS_REGION_AVG_USD_PER_HOUR, DEFAULT_REGION_KEY } from "./staticFallbacks";

const REQUEST_TIMEOUT_MS = 6_000;

export interface AwsUnitPrice {
  pricePerHourUsd: number;
  skuName: string;
  regionCode: string;
}

let client: PricingClient | null = null;

/** A AWS Price List Query API so existe nos endpoints globais us-east-1 e ap-south-1. */
function getClient(): PricingClient {
  if (!client) client = new PricingClient({ region: "us-east-1" });
  return client;
}

function extractOnDemandUsd(rawProduct: string): number {
  const parsed = JSON.parse(rawProduct) as {
    terms?: { OnDemand?: Record<string, { priceDimensions: Record<string, { pricePerUnit: { USD?: string } }> }> };
  };
  const onDemand = parsed.terms?.OnDemand;
  const termKey = onDemand && Object.keys(onDemand)[0];
  if (!onDemand || !termKey) throw new Error("Produto AWS sem termos OnDemand");
  const priceDimensions = onDemand[termKey].priceDimensions;
  const dimKey = Object.keys(priceDimensions)[0];
  const usd = Number(priceDimensions[dimKey]?.pricePerUnit?.USD);
  if (!Number.isFinite(usd)) throw new Error("Preco OnDemand AWS invalido");
  return usd;
}

async function fetchAwsUnitPrice(regionKey: string, instanceType: string): Promise<AwsUnitPrice> {
  if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
    throw new Error("Credenciais AWS (AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY) nao configuradas");
  }

  // Filtra por instancia Linux, tenancy compartilhada, sem software pre-instalado e capacidade sob demanda
  // (exclui reserva de capacidade nao utilizada), igual ao que o console de precos da AWS usa.
  const response = await getClient().send(
    new GetProductsCommand({
      ServiceCode: "AmazonEC2",
      Filters: [
        { Type: "TERM_MATCH", Field: "instanceType", Value: instanceType },
        { Type: "TERM_MATCH", Field: "regionCode", Value: regionKey },
        { Type: "TERM_MATCH", Field: "operatingSystem", Value: "Linux" },
        { Type: "TERM_MATCH", Field: "tenancy", Value: "Shared" },
        { Type: "TERM_MATCH", Field: "preInstalledSw", Value: "NA" },
        { Type: "TERM_MATCH", Field: "capacitystatus", Value: "Used" },
      ],
      MaxResults: 5,
    }),
    { abortSignal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) },
  );

  const priceListEntry = response.PriceList?.[0];
  if (!priceListEntry) throw new Error(`AWS Pricing API sem itens para ${instanceType} em ${regionKey}`);

  return { pricePerHourUsd: extractOnDemandUsd(priceListEntry as string), skuName: instanceType, regionCode: regionKey };
}

export async function getAwsUnitPrice(regionKey: string, instanceType: string, fallbackPrice?: number): Promise<ResilienceResult<AwsUnitPrice>> {
  const cacheKey = `aws-unit-price-${regionKey}-${instanceType}`;
  return executeWithFallback<AwsUnitPrice>({
    serviceName: `AWS_PRICING_${regionKey}_${instanceType}`,
    primary: async () => {
      const price = await fetchAwsUnitPrice(regionKey, instanceType);
      writeCache(cacheKey, price);
      return price;
    },
    fallback: async () => {
      const cached = readCache<AwsUnitPrice>(cacheKey);
      if (cached) return cached;
      return {
        data: {
          pricePerHourUsd: fallbackPrice ?? AWS_REGION_AVG_USD_PER_HOUR[regionKey] ?? AWS_REGION_AVG_USD_PER_HOUR[DEFAULT_REGION_KEY],
          skuName: instanceType,
          regionCode: regionKey,
        },
        updatedAt: new Date().toISOString(),
      };
    },
  });
}
