export type CloudProvider = "AWS" | "Azure" | "GCP";

export interface CloudRegion {
  key: string;
  provider: CloudProvider;
  label: string;
  providerRegion: string;
  sourceStatus: "LIVE_API" | "STATIC_SNAPSHOT";
}

export interface CloudSku {
  id: string;
  provider: CloudProvider;
  family: "Burstable" | "General purpose" | "Compute optimized" | "Memory optimized";
  skuName: string;
  displayName: string;
  vcpu: number;
  memoryGiB: number;
  os: "Linux";
  pricingModel: "OnDemand";
  azureArmSkuName?: string;
  sourceName: string;
  sourceUrl: string;
  regionalPricesUsd: Record<string, number>;
  notes: string;
}

export const cloudRegions: CloudRegion[] = [
  { key: "us-east-1", provider: "AWS", label: "US East - N. Virginia", providerRegion: "us-east-1", sourceStatus: "STATIC_SNAPSHOT" },
  { key: "sa-east-1", provider: "AWS", label: "South America - Sao Paulo", providerRegion: "sa-east-1", sourceStatus: "STATIC_SNAPSHOT" },
  { key: "eu-west-1", provider: "AWS", label: "Europe - Ireland", providerRegion: "eu-west-1", sourceStatus: "STATIC_SNAPSHOT" },
  { key: "us-east-1", provider: "Azure", label: "East US", providerRegion: "eastus", sourceStatus: "LIVE_API" },
  { key: "sa-east-1", provider: "Azure", label: "Brazil South", providerRegion: "brazilsouth", sourceStatus: "LIVE_API" },
  { key: "eu-west-1", provider: "Azure", label: "West Europe", providerRegion: "westeurope", sourceStatus: "LIVE_API" },
  { key: "us-east-1", provider: "GCP", label: "Iowa - us-central1", providerRegion: "us-central1", sourceStatus: "STATIC_SNAPSHOT" },
  { key: "sa-east-1", provider: "GCP", label: "Sao Paulo - southamerica-east1", providerRegion: "southamerica-east1", sourceStatus: "STATIC_SNAPSHOT" },
  { key: "eu-west-1", provider: "GCP", label: "Belgium - europe-west1", providerRegion: "europe-west1", sourceStatus: "STATIC_SNAPSHOT" },
];

export const cloudSkus: CloudSku[] = [
  {
    id: "aws-t3-medium",
    provider: "AWS",
    family: "Burstable",
    skuName: "t3.medium",
    displayName: "t3.medium - 2 vCPU / 4 GiB",
    vcpu: 2,
    memoryGiB: 4,
    os: "Linux",
    pricingModel: "OnDemand",
    sourceName: "AWS EC2 On-Demand",
    sourceUrl: "https://aws.amazon.com/ec2/pricing/on-demand/",
    regionalPricesUsd: { "us-east-1": 0.0416, "sa-east-1": 0.0672, "eu-west-1": 0.0448 },
    notes: "Preco Linux on-demand. AWS Price List Bulk API deve substituir o snapshot quando o coletor for ligado.",
  },
  {
    id: "aws-m6i-large",
    provider: "AWS",
    family: "General purpose",
    skuName: "m6i.large",
    displayName: "m6i.large - 2 vCPU / 8 GiB",
    vcpu: 2,
    memoryGiB: 8,
    os: "Linux",
    pricingModel: "OnDemand",
    sourceName: "AWS EC2 On-Demand",
    sourceUrl: "https://aws.amazon.com/ec2/pricing/on-demand/",
    regionalPricesUsd: { "us-east-1": 0.096, "sa-east-1": 0.154, "eu-west-1": 0.107 },
    notes: "SKU general purpose x86 para workload persistente.",
  },
  {
    id: "aws-c6i-large",
    provider: "AWS",
    family: "Compute optimized",
    skuName: "c6i.large",
    displayName: "c6i.large - 2 vCPU / 4 GiB",
    vcpu: 2,
    memoryGiB: 4,
    os: "Linux",
    pricingModel: "OnDemand",
    sourceName: "AWS EC2 On-Demand",
    sourceUrl: "https://aws.amazon.com/ec2/pricing/on-demand/",
    regionalPricesUsd: { "us-east-1": 0.085, "sa-east-1": 0.136, "eu-west-1": 0.094 },
    notes: "SKU compute optimized para API/servicos CPU-bound.",
  },
  {
    id: "azure-b2s",
    provider: "Azure",
    family: "Burstable",
    skuName: "Standard_B2s",
    azureArmSkuName: "Standard_B2s",
    displayName: "B2s - 2 vCPU / 4 GiB",
    vcpu: 2,
    memoryGiB: 4,
    os: "Linux",
    pricingModel: "OnDemand",
    sourceName: "Azure Retail Prices API",
    sourceUrl: "https://learn.microsoft.com/en-us/rest/api/cost-management/retail-prices/azure-retail-prices",
    regionalPricesUsd: { "us-east-1": 0.0416, "sa-east-1": 0.0608, "eu-west-1": 0.0464 },
    notes: "Preco buscado ao vivo pela Azure Retail Prices API quando disponivel.",
  },
  {
    id: "azure-d2s-v3",
    provider: "Azure",
    family: "General purpose",
    skuName: "Standard_D2s_v3",
    azureArmSkuName: "Standard_D2s_v3",
    displayName: "D2s v3 - 2 vCPU / 8 GiB",
    vcpu: 2,
    memoryGiB: 8,
    os: "Linux",
    pricingModel: "OnDemand",
    sourceName: "Azure Retail Prices API",
    sourceUrl: "https://learn.microsoft.com/en-us/rest/api/cost-management/retail-prices/azure-retail-prices",
    regionalPricesUsd: { "us-east-1": 0.096, "sa-east-1": 0.112, "eu-west-1": 0.098 },
    notes: "Referencia atual do app, agora selecionavel no catalogo.",
  },
  {
    id: "azure-f2s-v2",
    provider: "Azure",
    family: "Compute optimized",
    skuName: "Standard_F2s_v2",
    azureArmSkuName: "Standard_F2s_v2",
    displayName: "F2s v2 - 2 vCPU / 4 GiB",
    vcpu: 2,
    memoryGiB: 4,
    os: "Linux",
    pricingModel: "OnDemand",
    sourceName: "Azure Retail Prices API",
    sourceUrl: "https://learn.microsoft.com/en-us/rest/api/cost-management/retail-prices/azure-retail-prices",
    regionalPricesUsd: { "us-east-1": 0.085, "sa-east-1": 0.102, "eu-west-1": 0.091 },
    notes: "SKU compute optimized para servicos sensiveis a CPU.",
  },
  {
    id: "gcp-e2-standard-2",
    provider: "GCP",
    family: "General purpose",
    skuName: "e2-standard-2",
    displayName: "e2-standard-2 - 2 vCPU / 8 GiB",
    vcpu: 2,
    memoryGiB: 8,
    os: "Linux",
    pricingModel: "OnDemand",
    sourceName: "Google Cloud Compute Engine pricing",
    sourceUrl: "https://cloud.google.com/products/compute/pricing/general-purpose",
    regionalPricesUsd: { "us-east-1": 0.06701142, "sa-east-1": 0.095, "eu-west-1": 0.073 },
    notes: "Preco on-demand da familia E2; Billing Catalog API requer credenciais para coletor vivo.",
  },
  {
    id: "gcp-c3-standard-4",
    provider: "GCP",
    family: "Compute optimized",
    skuName: "c3-standard-4",
    displayName: "c3-standard-4 - 4 vCPU / 16 GiB",
    vcpu: 4,
    memoryGiB: 16,
    os: "Linux",
    pricingModel: "OnDemand",
    sourceName: "Google Cloud Compute Engine pricing",
    sourceUrl: "https://cloud.google.com/products/compute/pricing/general-purpose",
    regionalPricesUsd: { "us-east-1": 0.2089, "sa-east-1": 0.2925, "eu-west-1": 0.2298 },
    notes: "SKU de nova geracao para workloads de maior desempenho.",
  },
];

export function getCloudSku(skuId: string | undefined, provider: string): CloudSku {
  return cloudSkus.find((sku) => sku.id === skuId) ?? cloudSkus.find((sku) => sku.provider === provider) ?? cloudSkus[0];
}

export function getCloudRegions(provider: string): CloudRegion[] {
  return cloudRegions.filter((region) => region.provider === provider);
}
