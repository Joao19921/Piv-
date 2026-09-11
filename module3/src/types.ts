export interface PublicTender {
  externalId: string;
  source: string;
  object: string;
  state?: string;
  tenderDate?: string;
  url?: string;
  raw: unknown;
}

export interface Module3Config {
  databaseUrl?: string;
  port: number;
  apiKey?: string;
  requestTimeoutMs: number;
  maxRetries: number;
}