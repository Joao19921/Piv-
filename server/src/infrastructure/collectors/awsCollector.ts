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
  // Sem checagem explicita de env vars: o PricingClient usa a cadeia padrao de credenciais do
  // SDK (env vars, shared config, ou a IAM Role de execucao quando rodando na Lambda). Se nao
  // houver credencial nenhuma disponivel, o proprio SDK lanca um erro claro, capturado abaixo
  // pelo resilienceManager (circuit breaker/retry/fallback).

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

export interface AwsStoragePrice {
  pricePerGbMonthUsd: number;
  volumeType: string;
  regionCode: string;
}

async function fetchAwsEbsPrice(regionKey: string, volumeApiName = "gp3"): Promise<AwsStoragePrice> {
  const response = await getClient().send(
    new GetProductsCommand({
      ServiceCode: "AmazonEC2",
      Filters: [
        { Type: "TERM_MATCH", Field: "productFamily", Value: "Storage" },
        { Type: "TERM_MATCH", Field: "volumeApiName", Value: volumeApiName },
        { Type: "TERM_MATCH", Field: "regionCode", Value: regionKey },
      ],
      MaxResults: 5,
    }),
    { abortSignal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) },
  );

  const priceListEntry = response.PriceList?.[0];
  if (!priceListEntry) throw new Error(`AWS Pricing API sem itens de storage (${volumeApiName}) em ${regionKey}`);

  return { pricePerGbMonthUsd: extractOnDemandUsd(priceListEntry as string), volumeType: volumeApiName, regionCode: regionKey };
}

/** Aproximacao generica de EBS gp3 por regiao, usada apenas se nao houver cache nem ingestao ainda. */
const AWS_EBS_GP3_AVG_USD_PER_GB_MONTH: Record<string, number> = {
  "us-east-1": 0.08,
  "sa-east-1": 0.114,
  "eu-west-1": 0.088,
  "us-west-2": 0.08,
};

export async function getAwsEbsPrice(regionKey: string, fallbackPrice?: number): Promise<ResilienceResult<AwsStoragePrice>> {
  const cacheKey = `aws-ebs-price-${regionKey}`;
  return executeWithFallback<AwsStoragePrice>({
    serviceName: `AWS_EBS_${regionKey}`,
    primary: async () => {
      const price = await fetchAwsEbsPrice(regionKey);
      writeCache(cacheKey, price);
      return price;
    },
    fallback: async () => {
      const cached = readCache<AwsStoragePrice>(cacheKey);
      if (cached) return cached;
      return {
        data: {
          pricePerGbMonthUsd: fallbackPrice ?? AWS_EBS_GP3_AVG_USD_PER_GB_MONTH[regionKey] ?? AWS_EBS_GP3_AVG_USD_PER_GB_MONTH[DEFAULT_REGION_KEY],
          volumeType: "gp3",
          regionCode: regionKey,
        },
        updatedAt: new Date().toISOString(),
      };
    },
  });
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
