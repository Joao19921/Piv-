import type { ResilienceResult } from "../resilience/resilienceManager";

export const DEFAULT_REGION_KEY = "us-east-1";

/**
 * Nível 2 de fallback (matriz de resiliência): tabela genérica de custo médio por região,
 * usada enquanto não há credenciais/integração real com AWS Pricing API e GCP Billing API.
 */
export const AWS_REGION_AVG_USD_PER_HOUR: Record<string, number> = {
  "us-east-1": 0.084,
  "sa-east-1": 0.101,
  "eu-west-1": 0.089,
};

export const GCP_REGION_AVG_USD_PER_HOUR: Record<string, number> = {
  "us-east-1": 0.079,
  "sa-east-1": 0.095,
  "eu-west-1": 0.083,
};

/** Usado apenas como base do fallback estático da Azure quando a API retail está fora do ar. */
export const AZURE_REGION_AVG_USD_PER_HOUR: Record<string, number> = {
  "us-east-1": 0.096,
  "sa-east-1": 0.112,
  "eu-west-1": 0.098,
};

export interface StaticSourceInfo {
  name: string;
  status: ResilienceResult<unknown>["status"];
  source: string;
  timestamp: string;
  warning: string;
}

/** Fontes cuja ingestão real (PNCP/CAGED) ainda não foi implementada nesta fase do projeto. */
export function getPendingSources(): StaticSourceInfo[] {
  const now = new Date().toISOString();
  return [
    {
      name: "CAGED / MTE",
      status: "FALLBACK_STALE",
      source: "STATIC_SNAPSHOT",
      timestamp: now,
      warning: "Ingestão do CAGED ainda não implementada; usando snapshot histórico de CBOs de tecnologia.",
    },
    {
      name: "PNCP",
      status: "OFFLINE",
      source: "NONE",
      timestamp: now,
      warning: "Integração com o PNCP prevista para uma próxima fase do projeto.",
    },
  ];
}
