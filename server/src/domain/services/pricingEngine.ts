import { getAzureFunctionsPrice, getAzureLoadBalancerPrice, getAzureSqlPrice, getAzureStoragePrice, getAzureUnitPrice } from "../../infrastructure/collectors/azureCollector";
import { getPtax } from "../../infrastructure/collectors/bacenCollector";
import { AWS_REGION_AVG_USD_PER_HOUR, DEFAULT_REGION_KEY, GCP_REGION_AVG_USD_PER_HOUR } from "../../infrastructure/collectors/staticFallbacks";
import { isDatabaseConfigured } from "../../infrastructure/db/client";
import { logger } from "../../infrastructure/observability/logger";
import { insertPrice } from "../../infrastructure/repositories/cloudPricingRepository";
import { getCloudSku, getLatestKnownPrice, getLatestKnownStoragePrice, type CloudPricePoint } from "./cloudCatalog";
import { getCloudServiceDefinition, type CloudProvider } from "./cloudServiceCatalog";

/** Evita reinserir o preco Azure a cada request: so grava se o ultimo preco conhecido tiver mais de 1h. */
const PRICE_REFRESH_THROTTLE_MS = 60 * 60 * 1000;

export interface ServicePricing {
  monthlyUsd: number;
  monthlyBrl: number;
  fxRate: number;
  source: "catalog" | "live_api" | "scheduled_ingestion";
  estimated: boolean;
  lastUpdated: string;
  sourceUrl: string;
  note?: string;
  warning?: string;
}

function num(config: Record<string, unknown>, key: string, fallback = 0): number {
  const value = config[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/** Mesma resolucao de preco ao vivo/ingestao ja usada pelo app antes desta refatoracao (AWS/GCP le do Postgres; Azure consulta a Retail API por requisicao). */
function resolveIngestedUnitPrice(provider: "AWS" | "GCP", knownPrice: CloudPricePoint | undefined, region: string): { pricePerHourUsd: number; status: string; warning?: string } {
  if (knownPrice) {
    return {
      pricePerHourUsd: knownPrice.pricePerHourUsd,
      status: knownPrice.sourceStatus,
      warning: knownPrice.sourceStatus === "OPERATIONAL" ? undefined : "Preço vem da última ingestão periódica bem-sucedida; pode não refletir o valor mais recente.",
    };
  }
  const table = provider === "AWS" ? AWS_REGION_AVG_USD_PER_HOUR : GCP_REGION_AVG_USD_PER_HOUR;
  return {
    pricePerHourUsd: table[region] ?? table[DEFAULT_REGION_KEY],
    status: "OFFLINE",
    warning: "Ingestão periódica ainda não rodou para este SKU/região; usando média genérica de custo por região.",
  };
}

async function calculateComputePrice(provider: CloudProvider, region: string, config: Record<string, unknown>): Promise<ServicePricing> {
  const skuId = String(config.skuId ?? "");
  const instances = Math.max(num(config, "instances", 1), 0);
  const hours = Math.max(num(config, "hours", 730), 0);
  const storageGb = Math.max(num(config, "storageGb", 0), 0);

  const sku = await getCloudSku(skuId, provider);
  const [fxResult, knownPrice] = await Promise.all([getPtax(), getLatestKnownPrice(sku.id, region)]);
  const fxRate = (fxResult.data as { rate: number } | null)?.rate ?? 5.4;

  let unitPriceUsd: number;
  let source: ServicePricing["source"];
  let warning: string | undefined;

  if (provider === "Azure") {
    const azureResult = await getAzureUnitPrice(region, sku.azureArmSkuName ?? sku.skuName, knownPrice?.pricePerHourUsd);
    unitPriceUsd = (azureResult.data as { pricePerHourUsd: number } | null)?.pricePerHourUsd ?? 0.08;
    source = "live_api";
    warning = azureResult.status === "OPERATIONAL" ? undefined : azureResult.warning;

    // Azure e ao vivo por requisicao: aproveita para manter o Postgres fresco entre as janelas da Lambda.
    // Throttlado por sku/regiao (1h) para o historico insert-only de cloud_prices nao crescer proporcional ao trafego.
    const knownPriceAgeMs = knownPrice?.capturedAt ? Date.now() - new Date(knownPrice.capturedAt).getTime() : Infinity;
    if (isDatabaseConfigured && azureResult.status === "OPERATIONAL" && knownPriceAgeMs > PRICE_REFRESH_THROTTLE_MS) {
      insertPrice({ skuId: sku.id, regionKey: region, pricePerHourUsd: unitPriceUsd, sourceStatus: "OPERATIONAL" }).catch((err) =>
        logger.error("Falha ao gravar preco ao vivo no Postgres", { error: err instanceof Error ? err.message : String(err) }),
      );
    }
  } else {
    const resolved = resolveIngestedUnitPrice(provider as "AWS" | "GCP", knownPrice, region);
    unitPriceUsd = resolved.pricePerHourUsd;
    source = "scheduled_ingestion";
    warning = resolved.warning;
  }

  let storageUsd = 0;
  if (provider === "AWS" && storageGb > 0) {
    const storagePrice = await getLatestKnownStoragePrice("AWS", region);
    storageUsd = storageGb * (storagePrice?.pricePerGbMonthUsd ?? 0);
  }

  const computeUsd = unitPriceUsd * instances * hours;
  const monthlyUsd = computeUsd + storageUsd;

  return {
    monthlyUsd,
    monthlyBrl: monthlyUsd * fxRate,
    fxRate,
    source,
    estimated: source !== "live_api",
    lastUpdated: new Date().toISOString(),
    sourceUrl: sku.sourceUrl,
    warning,
  };
}

/**
 * Servicos Azure alem de compute com preco ao vivo real (Azure Retail Prices API, sem chave,
 * mesmo padrao ja usado para Azure VM). Verificado contra a API real antes de entrar aqui —
 * ver CHANGELOG.md. Diferente de AWS/GCP, a Azure ja e chamada ao vivo por requisicao desde o
 * inicio do projeto (API publica, sem custo de paginacao de milhares de SKUs).
 */
async function calculateAzureLiveServicePrice(serviceId: string, region: string, config: Record<string, unknown>, fxRate: number): Promise<ServicePricing | undefined> {
  const nowIso = new Date().toISOString();

  if (serviceId === "azure-storage") {
    const tier = config.tier === "cool" ? "cool" : "hot";
    const result = await getAzureStoragePrice(region, tier);
    const pricePerGb = result.data?.pricePerGbMonthUsd ?? 0.018;
    const requestCostUsd = (Math.max(num(config, "requestsThousands"), 0) / 1000) * 0.5;
    const monthlyUsd = Math.max(num(config, "storageGb"), 0) * pricePerGb + requestCostUsd;
    return {
      monthlyUsd,
      monthlyBrl: monthlyUsd * fxRate,
      fxRate,
      source: result.status === "OPERATIONAL" ? "live_api" : "catalog",
      estimated: result.status !== "OPERATIONAL",
      lastUpdated: nowIso,
      sourceUrl: "https://azure.microsoft.com/pricing/details/storage/blobs/",
      note: "Armazenamento por GB é preço ao vivo (Azure Retail Prices API); requisições usam taxa de referência do catálogo.",
      warning: result.warning,
    };
  }

  if (serviceId === "azure-sql") {
    const tier = config.tier === "business_critical" ? "business_critical" : "general_purpose";
    const vcores = Math.max(num(config, "vcores", 2), 1);
    const result = await getAzureSqlPrice(region, vcores, tier);
    const pricePerVcoreHour = result.data?.pricePerVcoreHourUsd ?? (tier === "business_critical" ? 0.3 : 0.15);
    const monthlyUsd = pricePerVcoreHour * vcores * Math.max(num(config, "hours", 730), 0) + Math.max(num(config, "storageGb"), 0) * 0.138;
    return {
      monthlyUsd,
      monthlyBrl: monthlyUsd * fxRate,
      fxRate,
      source: result.status === "OPERATIONAL" ? "live_api" : "catalog",
      estimated: result.status !== "OPERATIONAL",
      lastUpdated: nowIso,
      sourceUrl: "https://azure.microsoft.com/pricing/details/azure-sql-database/single/",
      note: "Compute (vCore/hora) é preço ao vivo (Azure Retail Prices API); storage usa taxa de referência do catálogo.",
      warning: result.warning,
    };
  }

  if (serviceId === "azure-lb") {
    const result = await getAzureLoadBalancerPrice();
    const pricePerHour = result.data?.pricePerHourUsd ?? 0.025;
    const pricePerGb = result.data?.pricePerGbUsd ?? 0.005;
    const monthlyUsd = pricePerHour * Math.max(num(config, "hours", 730), 0) + pricePerGb * Math.max(num(config, "dataProcessedGb"), 0);
    return {
      monthlyUsd,
      monthlyBrl: monthlyUsd * fxRate,
      fxRate,
      source: result.status === "OPERATIONAL" ? "live_api" : "catalog",
      estimated: result.status !== "OPERATIONAL",
      lastUpdated: nowIso,
      sourceUrl: "https://azure.microsoft.com/pricing/details/load-balancer/",
      warning: result.warning,
    };
  }

  if (serviceId === "azure-functions") {
    const result = await getAzureFunctionsPrice(region);
    const pricePerExecution = result.data?.pricePerExecutionUsd ?? 0.0000002;
    const pricePerGbSecond = result.data?.pricePerGbSecondUsd ?? 0.000016;
    const requests = Math.max(num(config, "requestsMillions", 5), 0) * 1_000_000;
    const gbSeconds = requests * (Math.max(num(config, "avgDurationMs", 200), 0) / 1000) * (Math.max(num(config, "memoryMb", 512), 0) / 1024);
    const monthlyUsd = requests * pricePerExecution + gbSeconds * pricePerGbSecond;
    return {
      monthlyUsd,
      monthlyBrl: monthlyUsd * fxRate,
      fxRate,
      source: result.status === "OPERATIONAL" ? "live_api" : "catalog",
      estimated: result.status !== "OPERATIONAL",
      lastUpdated: nowIso,
      sourceUrl: "https://azure.microsoft.com/pricing/details/functions/",
      warning: result.warning,
    };
  }

  return undefined;
}

export async function calculateServicePrice(serviceId: string, region: string, config: Record<string, unknown>): Promise<ServicePricing> {
  const definition = getCloudServiceDefinition(serviceId);
  if (!definition) throw new Error(`Serviço '${serviceId}' não encontrado no catálogo.`);

  if (definition.category === "Compute") {
    return calculateComputePrice(definition.provider, region, config);
  }

  if (definition.provider === "Azure") {
    const fxResult = await getPtax();
    const fxRate = (fxResult.data as { rate: number } | null)?.rate ?? 5.4;
    const azureLivePrice = await calculateAzureLiveServicePrice(serviceId, region, config, fxRate);
    if (azureLivePrice) return azureLivePrice;
  }

  const monthlyUsd = Math.max(definition.calculateMonthlyUsd(config), 0);
  const fxResult = await getPtax();
  const fxRate = (fxResult.data as { rate: number } | null)?.rate ?? 5.4;

  return {
    monthlyUsd,
    monthlyBrl: monthlyUsd * fxRate,
    fxRate,
    source: definition.pricingInfo.source,
    estimated: definition.pricingInfo.estimated,
    lastUpdated: definition.pricingInfo.lastUpdated,
    sourceUrl: definition.pricingInfo.sourceUrl,
    note: definition.pricingInfo.note,
  };
}
