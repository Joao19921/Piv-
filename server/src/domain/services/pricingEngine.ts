import { getAzureUnitPrice } from "../../infrastructure/collectors/azureCollector";
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
      warning: knownPrice.sourceStatus === "OPERATIONAL" ? undefined : "Preco vem da ultima ingestao periodica bem-sucedida; pode nao refletir o valor mais recente.",
    };
  }
  const table = provider === "AWS" ? AWS_REGION_AVG_USD_PER_HOUR : GCP_REGION_AVG_USD_PER_HOUR;
  return {
    pricePerHourUsd: table[region] ?? table[DEFAULT_REGION_KEY],
    status: "OFFLINE",
    warning: "Ingestao periodica ainda nao rodou para este SKU/regiao; usando media generica de custo por regiao.",
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

export async function calculateServicePrice(serviceId: string, region: string, config: Record<string, unknown>): Promise<ServicePricing> {
  const definition = getCloudServiceDefinition(serviceId);
  if (!definition) throw new Error(`Servico '${serviceId}' nao encontrado no catalogo.`);

  if (definition.category === "Compute") {
    return calculateComputePrice(definition.provider, region, config);
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
