import { Pool, type QueryResultRow } from "pg";
import { logger } from "../observability/logger";
import { recordQuery } from "../observability/queryStats";

const SLOW_QUERY_MS = 500;

const connectionString = process.env.DATABASE_URL;

/** Falso quando DATABASE_URL nao esta configurado; repositorios devem cair para fallback estatico neste caso. */
export const isDatabaseConfigured = Boolean(connectionString);

let pool: Pool | null = null;

function getPool(): Pool {
  if (!connectionString) {
    throw new Error("DATABASE_URL nao configurado");
  }
  if (!pool) {
    pool = new Pool({
      connectionString,
      ssl: { rejectUnauthorized: false },
      max: 5,
      idleTimeoutMillis: 30_000,
    });
    pool.on("error", (err) => logger.error("Erro inesperado no pool do Postgres", { error: err.message }));
  }
  return pool;
}

/**
 * Executa uma query parametrizada com observabilidade (duracao, erros) via queryStats/logger.
 * `name` identifica a consulta nas estatisticas expostas em /system-health.
 */
export async function query<T extends QueryResultRow = QueryResultRow>(
  name: string,
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  const startedAt = Date.now();
  try {
    const result = await getPool().query<T>(text, params);
    const durationMs = Date.now() - startedAt;
    recordQuery(name, durationMs);
    if (durationMs > SLOW_QUERY_MS) {
      logger.warn(`Consulta '${name}' lenta`, { durationMs });
    }
    return result.rows;
  } catch (err) {
    const durationMs = Date.now() - startedAt;
    recordQuery(name, durationMs, err);
    logger.error(`Consulta '${name}' falhou`, { durationMs, error: err instanceof Error ? err.message : String(err) });
    throw err;
  }
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
