/**
 * Catalogo estatico de servicos cloud alem de compute (que ja tem preco ao vivo via
 * cloudCatalog.ts/coletores). Estes precos sao referencia publica (catalog), nao API ao vivo —
 * por isso todo item carrega source/estimated/lastUpdated/sourceUrl, nunca escondidos.
 */

export type CloudProvider = "AWS" | "Azure" | "GCP";
export type ServiceCategory = "Compute" | "Storage" | "Database" | "Networking" | "Containers" | "Serverless" | "CDN";

export interface CloudServiceConfigFieldOption {
  value: string;
  label: string;
}

export interface CloudServiceConfigField {
  key: string;
  label: string;
  type: "select" | "number" | "toggle";
  unit?: string;
  min?: number;
  max?: number;
  step?: number;
  default: string | number | boolean;
  options?: CloudServiceConfigFieldOption[];
  /** Quando true, as opcoes vem do catalogo de compute ao vivo (SKUs), preenchidas em runtime. */
  dynamicOptions?: "compute-sku";
}

export interface PricingSourceInfo {
  source: "catalog" | "live_api";
  estimated: boolean;
  lastUpdated: string;
  sourceUrl: string;
  note?: string;
}

export interface CloudServiceDefinition {
  id: string;
  provider: CloudProvider;
  category: ServiceCategory;
  name: string;
  description: string;
  configFields: CloudServiceConfigField[];
  pricingInfo: PricingSourceInfo;
  /** Calculo puro (sem I/O): recebe a configuracao ja normalizada e devolve o custo mensal em USD. */
  calculateMonthlyUsd: (config: Record<string, unknown>) => number;
}

function num(config: Record<string, unknown>, key: string, fallback = 0): number {
  const value = config[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
function bool(config: Record<string, unknown>, key: string, fallback = false): boolean {
  const value = config[key];
  return typeof value === "boolean" ? value : fallback;
}

const CATALOG_LAST_UPDATED = "2026-09-05";

function catalogInfo(sourceUrl: string, note?: string): PricingSourceInfo {
  return { source: "catalog", estimated: true, lastUpdated: CATALOG_LAST_UPDATED, sourceUrl, note };
}

/** Servicos de compute (EC2/Azure VM/GCE) tem preco ao vivo via cloudCatalog.ts; aqui so metadados de UI. */
const COMPUTE_SERVICES: CloudServiceDefinition[] = [
  {
    id: "aws-ec2",
    provider: "AWS",
    category: "Compute",
    name: "EC2",
    description: "Instancias de maquina virtual sob demanda (Linux).",
    configFields: [
      { key: "skuId", label: "Instance type", type: "select", default: "", options: [], dynamicOptions: "compute-sku" },
      { key: "instances", label: "Quantidade", type: "number", min: 1, max: 200, step: 1, default: 1 },
      { key: "hours", label: "Horas/mes", type: "number", min: 1, max: 744, step: 1, default: 730 },
      { key: "storageGb", label: "Armazenamento EBS gp3 (GB)", type: "number", min: 0, max: 16000, step: 10, default: 0 },
    ],
    pricingInfo: { source: "live_api", estimated: false, lastUpdated: CATALOG_LAST_UPDATED, sourceUrl: "https://aws.amazon.com/ec2/pricing/on-demand/", note: "Preco ao vivo (ingestao periodica) por SKU/regiao; ver /system-health." },
    calculateMonthlyUsd: () => 0, // Compute usa o pipeline ao vivo (pricingEngine.ts), nao esta formula.
  },
  {
    id: "azure-vm",
    provider: "Azure",
    category: "Compute",
    name: "Azure VM",
    description: "Maquinas virtuais sob demanda (Linux).",
    configFields: [
      { key: "skuId", label: "VM size", type: "select", default: "", options: [], dynamicOptions: "compute-sku" },
      { key: "instances", label: "Quantidade", type: "number", min: 1, max: 200, step: 1, default: 1 },
      { key: "hours", label: "Horas/mes", type: "number", min: 1, max: 744, step: 1, default: 730 },
    ],
    pricingInfo: { source: "live_api", estimated: false, lastUpdated: CATALOG_LAST_UPDATED, sourceUrl: "https://azure.microsoft.com/pricing/details/virtual-machines/linux/", note: "Preco ao vivo via Azure Retail Prices API." },
    calculateMonthlyUsd: () => 0,
  },
  {
    id: "gcp-compute-engine",
    provider: "GCP",
    category: "Compute",
    name: "Compute Engine",
    description: "Maquinas virtuais sob demanda (Linux).",
    configFields: [
      { key: "skuId", label: "Machine type", type: "select", default: "", options: [], dynamicOptions: "compute-sku" },
      { key: "instances", label: "Quantidade", type: "number", min: 1, max: 200, step: 1, default: 1 },
      { key: "hours", label: "Horas/mes", type: "number", min: 1, max: 744, step: 1, default: 730 },
    ],
    pricingInfo: { source: "live_api", estimated: false, lastUpdated: CATALOG_LAST_UPDATED, sourceUrl: "https://cloud.google.com/compute/all-pricing", note: "Preco ao vivo (ingestao periodica) via Cloud Billing Catalog API." },
    calculateMonthlyUsd: () => 0,
  },
];

const STORAGE_SERVICES: CloudServiceDefinition[] = [
  {
    id: "aws-s3",
    provider: "AWS",
    category: "Storage",
    name: "S3",
    description: "Armazenamento de objetos.",
    configFields: [
      { key: "storageClass", label: "Classe de armazenamento", type: "select", default: "standard", options: [{ value: "standard", label: "Standard" }, { value: "infrequent_access", label: "Standard-IA" }] },
      { key: "storageGb", label: "Volume armazenado (GB)", type: "number", min: 0, max: 1_000_000, step: 10, default: 100 },
      { key: "requestsThousands", label: "Requisicoes (milhares/mes)", type: "number", min: 0, max: 1_000_000, step: 10, default: 100 },
    ],
    pricingInfo: catalogInfo("https://aws.amazon.com/s3/pricing/", "Preco de referencia us-east-1, Standard; sem variacao regional neste catalogo."),
    calculateMonthlyUsd: (c) => {
      const pricePerGb = c.storageClass === "infrequent_access" ? 0.0125 : 0.023;
      return num(c, "storageGb") * pricePerGb + (num(c, "requestsThousands") / 1000) * 0.4;
    },
  },
  {
    id: "azure-storage",
    provider: "Azure",
    category: "Storage",
    name: "Azure Storage",
    description: "Armazenamento de objetos (Blob Storage).",
    configFields: [
      { key: "tier", label: "Tier de acesso", type: "select", default: "hot", options: [{ value: "hot", label: "Hot" }, { value: "cool", label: "Cool" }] },
      { key: "storageGb", label: "Volume armazenado (GB)", type: "number", min: 0, max: 1_000_000, step: 10, default: 100 },
      { key: "requestsThousands", label: "Requisicoes (milhares/mes)", type: "number", min: 0, max: 1_000_000, step: 10, default: 100 },
    ],
    pricingInfo: catalogInfo("https://azure.microsoft.com/pricing/details/storage/blobs/", "Preco de referencia East US, Hot LRS; sem variacao regional neste catalogo."),
    calculateMonthlyUsd: (c) => {
      const pricePerGb = c.tier === "cool" ? 0.01 : 0.018;
      return num(c, "storageGb") * pricePerGb + (num(c, "requestsThousands") / 1000) * 0.5;
    },
  },
  {
    id: "gcp-cloud-storage",
    provider: "GCP",
    category: "Storage",
    name: "Cloud Storage",
    description: "Armazenamento de objetos.",
    configFields: [
      { key: "storageClass", label: "Classe de armazenamento", type: "select", default: "standard", options: [{ value: "standard", label: "Standard" }, { value: "nearline", label: "Nearline" }] },
      { key: "storageGb", label: "Volume armazenado (GB)", type: "number", min: 0, max: 1_000_000, step: 10, default: 100 },
      { key: "requestsThousands", label: "Requisicoes (milhares/mes)", type: "number", min: 0, max: 1_000_000, step: 10, default: 100 },
    ],
    pricingInfo: catalogInfo("https://cloud.google.com/storage/pricing", "Preco de referencia us-central1, Standard; sem variacao regional neste catalogo."),
    calculateMonthlyUsd: (c) => {
      const pricePerGb = c.storageClass === "nearline" ? 0.01 : 0.02;
      return num(c, "storageGb") * pricePerGb + (num(c, "requestsThousands") / 1000) * 0.4;
    },
  },
];

const DATABASE_SERVICES: CloudServiceDefinition[] = [
  {
    id: "aws-rds",
    provider: "AWS",
    category: "Database",
    name: "RDS",
    description: "Banco relacional gerenciado.",
    configFields: [
      { key: "engine", label: "Engine", type: "select", default: "postgres", options: [{ value: "postgres", label: "PostgreSQL" }, { value: "mysql", label: "MySQL" }] },
      { key: "instanceClass", label: "Instance class", type: "select", default: "db.t3.medium", options: [{ value: "db.t3.medium", label: "db.t3.medium - 2 vCPU / 4 GiB" }, { value: "db.m6i.large", label: "db.m6i.large - 2 vCPU / 8 GiB" }] },
      { key: "storageGb", label: "Storage (GB)", type: "number", min: 20, max: 65_000, step: 10, default: 100 },
      { key: "multiAz", label: "Multi-AZ", type: "toggle", default: false },
      { key: "hours", label: "Horas/mes", type: "number", min: 1, max: 744, step: 1, default: 730 },
    ],
    pricingInfo: catalogInfo("https://aws.amazon.com/rds/pricing/", "Preco de referencia us-east-1, on-demand; sem variacao regional neste catalogo."),
    calculateMonthlyUsd: (c) => {
      const perHour = c.instanceClass === "db.m6i.large" ? 0.192 : 0.068;
      const multiAzMultiplier = bool(c, "multiAz") ? 2 : 1;
      return perHour * num(c, "hours", 730) * multiAzMultiplier + num(c, "storageGb") * 0.115 * multiAzMultiplier;
    },
  },
  {
    id: "azure-sql",
    provider: "Azure",
    category: "Database",
    name: "Azure SQL",
    description: "Banco relacional gerenciado.",
    configFields: [
      { key: "tier", label: "Tier de servico", type: "select", default: "general_purpose", options: [{ value: "general_purpose", label: "General Purpose" }, { value: "business_critical", label: "Business Critical" }] },
      { key: "vcores", label: "vCores", type: "number", min: 1, max: 80, step: 1, default: 2 },
      { key: "storageGb", label: "Storage (GB)", type: "number", min: 5, max: 4_000, step: 5, default: 100 },
      { key: "hours", label: "Horas/mes", type: "number", min: 1, max: 744, step: 1, default: 730 },
    ],
    pricingInfo: catalogInfo("https://azure.microsoft.com/pricing/details/azure-sql-database/single/", "Preco de referencia East US, vCore; sem variacao regional neste catalogo."),
    calculateMonthlyUsd: (c) => {
      const perVcoreHour = c.tier === "business_critical" ? 0.3 : 0.15;
      return perVcoreHour * num(c, "vcores", 2) * num(c, "hours", 730) + num(c, "storageGb") * 0.138;
    },
  },
  {
    id: "gcp-cloud-sql",
    provider: "GCP",
    category: "Database",
    name: "Cloud SQL",
    description: "Banco relacional gerenciado.",
    configFields: [
      { key: "engine", label: "Engine", type: "select", default: "postgres", options: [{ value: "postgres", label: "PostgreSQL" }, { value: "mysql", label: "MySQL" }] },
      { key: "tier", label: "Tier", type: "select", default: "db-custom-2-4096", options: [{ value: "db-custom-2-4096", label: "2 vCPU / 4 GiB" }, { value: "db-custom-2-8192", label: "2 vCPU / 8 GiB" }] },
      { key: "storageGb", label: "Storage (GB)", type: "number", min: 10, max: 65_000, step: 10, default: 100 },
      { key: "hours", label: "Horas/mes", type: "number", min: 1, max: 744, step: 1, default: 730 },
    ],
    pricingInfo: catalogInfo("https://cloud.google.com/sql/pricing", "Preco de referencia us-central1, on-demand; sem variacao regional neste catalogo."),
    calculateMonthlyUsd: (c) => {
      const perHour = c.tier === "db-custom-2-8192" ? 0.1 : 0.07;
      return perHour * num(c, "hours", 730) + num(c, "storageGb") * 0.17;
    },
  },
];

const NETWORKING_SERVICES: CloudServiceDefinition[] = [
  {
    id: "aws-elb",
    provider: "AWS",
    category: "Networking",
    name: "Load Balancer",
    description: "Application Load Balancer.",
    configFields: [
      { key: "hours", label: "Horas/mes", type: "number", min: 1, max: 744, step: 1, default: 730 },
      { key: "dataProcessedGb", label: "Dados processados (GB/mes)", type: "number", min: 0, max: 1_000_000, step: 10, default: 500 },
    ],
    pricingInfo: catalogInfo("https://aws.amazon.com/elasticloadbalancing/pricing/", "Preco de referencia us-east-1, ALB; sem variacao regional neste catalogo."),
    calculateMonthlyUsd: (c) => num(c, "hours", 730) * 0.0225 + num(c, "dataProcessedGb") * 0.008,
  },
  {
    id: "azure-lb",
    provider: "Azure",
    category: "Networking",
    name: "Load Balancer",
    description: "Load Balancer Standard.",
    configFields: [
      { key: "hours", label: "Horas/mes", type: "number", min: 1, max: 744, step: 1, default: 730 },
      { key: "dataProcessedGb", label: "Dados processados (GB/mes)", type: "number", min: 0, max: 1_000_000, step: 10, default: 500 },
    ],
    pricingInfo: catalogInfo("https://azure.microsoft.com/pricing/details/load-balancer/", "Preco de referencia East US, Standard; sem variacao regional neste catalogo."),
    calculateMonthlyUsd: (c) => num(c, "hours", 730) * 0.025 + num(c, "dataProcessedGb") * 0.005,
  },
  {
    id: "gcp-cloud-lb",
    provider: "GCP",
    category: "Networking",
    name: "Cloud Load Balancing",
    description: "Load balancer externo.",
    configFields: [
      { key: "hours", label: "Horas/mes", type: "number", min: 1, max: 744, step: 1, default: 730 },
      { key: "dataProcessedGb", label: "Dados processados (GB/mes)", type: "number", min: 0, max: 1_000_000, step: 10, default: 500 },
    ],
    pricingInfo: catalogInfo("https://cloud.google.com/vpc/network-pricing", "Preco de referencia global; sem variacao regional neste catalogo."),
    calculateMonthlyUsd: (c) => num(c, "hours", 730) * 0.025 + num(c, "dataProcessedGb") * 0.008,
  },
];

const CONTAINER_SERVICES: CloudServiceDefinition[] = [
  {
    id: "aws-eks",
    provider: "AWS",
    category: "Containers",
    name: "EKS",
    description: "Control plane Kubernetes gerenciado (nos ficam em EC2, precificados a parte).",
    configFields: [{ key: "clusters", label: "Clusters", type: "number", min: 1, max: 20, step: 1, default: 1 }, { key: "hours", label: "Horas/mes", type: "number", min: 1, max: 744, step: 1, default: 730 }],
    pricingInfo: catalogInfo("https://aws.amazon.com/eks/pricing/", "Taxa fixa de control plane, sem variacao regional."),
    calculateMonthlyUsd: (c) => num(c, "clusters", 1) * num(c, "hours", 730) * 0.1,
  },
  {
    id: "azure-aks",
    provider: "Azure",
    category: "Containers",
    name: "AKS",
    description: "Control plane Kubernetes gerenciado (tier Standard; nos ficam em VMs, precificados a parte).",
    configFields: [{ key: "clusters", label: "Clusters", type: "number", min: 1, max: 20, step: 1, default: 1 }, { key: "hours", label: "Horas/mes", type: "number", min: 1, max: 744, step: 1, default: 730 }],
    pricingInfo: catalogInfo("https://azure.microsoft.com/pricing/details/kubernetes-service/", "Tier Standard; tier Free tem control plane gratuito."),
    calculateMonthlyUsd: (c) => num(c, "clusters", 1) * num(c, "hours", 730) * 0.1,
  },
  {
    id: "gcp-gke",
    provider: "GCP",
    category: "Containers",
    name: "GKE",
    description: "Control plane Kubernetes gerenciado (nos ficam em Compute Engine, precificados a parte).",
    configFields: [{ key: "clusters", label: "Clusters", type: "number", min: 1, max: 20, step: 1, default: 1 }, { key: "hours", label: "Horas/mes", type: "number", min: 1, max: 744, step: 1, default: 730 }],
    pricingInfo: catalogInfo("https://cloud.google.com/kubernetes-engine/pricing", "Taxa fixa de control plane por cluster (1o cluster/mes por conta e gratuito na GCP; simplificado aqui)."),
    calculateMonthlyUsd: (c) => num(c, "clusters", 1) * num(c, "hours", 730) * 0.1,
  },
];

const SERVERLESS_SERVICES: CloudServiceDefinition[] = [
  {
    id: "aws-lambda",
    provider: "AWS",
    category: "Serverless",
    name: "Lambda",
    description: "Funcoes sob demanda.",
    configFields: [
      { key: "requestsMillions", label: "Requisicoes (milhoes/mes)", type: "number", min: 0, max: 10_000, step: 1, default: 5 },
      { key: "avgDurationMs", label: "Duracao media (ms)", type: "number", min: 1, max: 900_000, step: 10, default: 200 },
      { key: "memoryMb", label: "Memoria (MB)", type: "number", min: 128, max: 10_240, step: 64, default: 512 },
    ],
    pricingInfo: catalogInfo("https://aws.amazon.com/lambda/pricing/", "Preco de referencia us-east-1; sem variacao regional neste catalogo."),
    calculateMonthlyUsd: (c) => {
      const requests = num(c, "requestsMillions", 5) * 1_000_000;
      const gbSeconds = requests * (num(c, "avgDurationMs", 200) / 1000) * (num(c, "memoryMb", 512) / 1024);
      return requests * 0.0000002 + gbSeconds * 0.0000166667;
    },
  },
  {
    id: "azure-functions",
    provider: "Azure",
    category: "Serverless",
    name: "Azure Functions",
    description: "Funcoes sob demanda (plano Consumption).",
    configFields: [
      { key: "requestsMillions", label: "Requisicoes (milhoes/mes)", type: "number", min: 0, max: 10_000, step: 1, default: 5 },
      { key: "avgDurationMs", label: "Duracao media (ms)", type: "number", min: 1, max: 900_000, step: 10, default: 200 },
      { key: "memoryMb", label: "Memoria (MB)", type: "number", min: 128, max: 10_240, step: 64, default: 512 },
    ],
    pricingInfo: catalogInfo("https://azure.microsoft.com/pricing/details/functions/", "Preco de referencia East US, plano Consumption; sem variacao regional neste catalogo."),
    calculateMonthlyUsd: (c) => {
      const requests = num(c, "requestsMillions", 5) * 1_000_000;
      const gbSeconds = requests * (num(c, "avgDurationMs", 200) / 1000) * (num(c, "memoryMb", 512) / 1024);
      return requests * 0.0000002 + gbSeconds * 0.000016;
    },
  },
  {
    id: "gcp-cloud-functions",
    provider: "GCP",
    category: "Serverless",
    name: "Cloud Functions",
    description: "Funcoes sob demanda.",
    configFields: [
      { key: "requestsMillions", label: "Requisicoes (milhoes/mes)", type: "number", min: 0, max: 10_000, step: 1, default: 5 },
      { key: "avgDurationMs", label: "Duracao media (ms)", type: "number", min: 1, max: 900_000, step: 10, default: 200 },
      { key: "memoryMb", label: "Memoria (MB)", type: "number", min: 128, max: 10_240, step: 64, default: 512 },
    ],
    pricingInfo: catalogInfo("https://cloud.google.com/functions/pricing", "Preco de referencia us-central1; sem variacao regional neste catalogo."),
    calculateMonthlyUsd: (c) => {
      const requests = num(c, "requestsMillions", 5) * 1_000_000;
      const gbSeconds = requests * (num(c, "avgDurationMs", 200) / 1000) * (num(c, "memoryMb", 512) / 1024);
      return requests * 0.0000004 + gbSeconds * 0.0000025;
    },
  },
];

const CDN_SERVICES: CloudServiceDefinition[] = [
  {
    id: "aws-cloudfront",
    provider: "AWS",
    category: "CDN",
    name: "CloudFront",
    description: "CDN.",
    configFields: [{ key: "dataTransferGb", label: "Transferencia de dados (GB/mes)", type: "number", min: 0, max: 1_000_000, step: 10, default: 1000 }, { key: "requestsMillions", label: "Requisicoes (milhoes/mes)", type: "number", min: 0, max: 10_000, step: 1, default: 5 }],
    pricingInfo: catalogInfo("https://aws.amazon.com/cloudfront/pricing/", "Preco de referencia (primeiros 10TB, saida para EUA); sem variacao regional neste catalogo."),
    calculateMonthlyUsd: (c) => num(c, "dataTransferGb", 1000) * 0.085 + num(c, "requestsMillions", 5) * 1_000_000 * 0.0000075,
  },
  {
    id: "azure-cdn",
    provider: "Azure",
    category: "CDN",
    name: "Azure CDN",
    description: "CDN.",
    configFields: [{ key: "dataTransferGb", label: "Transferencia de dados (GB/mes)", type: "number", min: 0, max: 1_000_000, step: 10, default: 1000 }],
    pricingInfo: catalogInfo("https://azure.microsoft.com/pricing/details/cdn/", "Preco de referencia (primeiros 10TB, zona 1); sem variacao regional neste catalogo."),
    calculateMonthlyUsd: (c) => num(c, "dataTransferGb", 1000) * 0.081,
  },
  {
    id: "gcp-cloud-cdn",
    provider: "GCP",
    category: "CDN",
    name: "Cloud CDN",
    description: "CDN.",
    configFields: [{ key: "dataTransferGb", label: "Transferencia de dados (GB/mes)", type: "number", min: 0, max: 1_000_000, step: 10, default: 1000 }, { key: "requestsMillions", label: "Requisicoes (milhoes/mes)", type: "number", min: 0, max: 10_000, step: 1, default: 5 }],
    pricingInfo: catalogInfo("https://cloud.google.com/cdn/pricing", "Preco de referencia (saida para EUA/Europa); sem variacao regional neste catalogo."),
    calculateMonthlyUsd: (c) => num(c, "dataTransferGb", 1000) * 0.08 + num(c, "requestsMillions", 5) * 1_000_000 * 0.0000075,
  },
];

const CATALOG: CloudServiceDefinition[] = [
  ...COMPUTE_SERVICES,
  ...STORAGE_SERVICES,
  ...DATABASE_SERVICES,
  ...NETWORKING_SERVICES,
  ...CONTAINER_SERVICES,
  ...SERVERLESS_SERVICES,
  ...CDN_SERVICES,
];

export function listCloudServiceDefinitions(): CloudServiceDefinition[] {
  return CATALOG;
}

export function getCloudServiceDefinition(id: string): CloudServiceDefinition | undefined {
  return CATALOG.find((service) => service.id === id);
}

export function searchCloudServiceDefinitions(params: { q?: string; provider?: CloudProvider; category?: ServiceCategory }): CloudServiceDefinition[] {
  const q = params.q?.trim().toLowerCase();
  return CATALOG.filter((service) => {
    if (params.provider && service.provider !== params.provider) return false;
    if (params.category && service.category !== params.category) return false;
    if (q && !`${service.name} ${service.description} ${service.category}`.toLowerCase().includes(q)) return false;
    return true;
  });
}
