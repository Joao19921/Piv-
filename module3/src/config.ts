import type { Module3Config } from "./types";

export function getModule3Config(env: NodeJS.ProcessEnv = process.env): Module3Config {
  return {
    databaseUrl: env.MOD3_DATABASE_URL,
    port: Number(env.MOD3_PORT ?? 3013),
    apiKey: env.MOD3_API_KEY,
    requestTimeoutMs: Number(env.MOD3_REQUEST_TIMEOUT_MS ?? 10_000),
  };
}