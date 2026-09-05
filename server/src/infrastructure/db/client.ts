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
      // O pooler Supavisor da Supabase envia uma cadeia de certificados cuja raiz nao esta no
      // bundle padrao de CAs do Node ("self-signed certificate in certificate chain"), mesmo
      // sendo uma conexao TLS legitima. Verificado em producao (Lambda us-east-1) apos tentar
      // rejectUnauthorized: true. Ate pinarmos o CA correto da Supabase, mantemos sem verificacao
      // de certificado (ainda criptografado, mas sem checagem de identidade do servidor).
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

export interface TransactionQuery {
  <T extends QueryResultRow = QueryResultRow>(name: string, text: string, params?: unknown[]): Promise<T[]>;
}

/**
 * Executa `fn` dentro de uma transacao (BEGIN/COMMIT, ROLLBACK em erro) usando uma unica
 * conexao do pool. Necessario para operacoes que gravam mais de uma tabela atomicamente
 * (ex.: uma arquitetura + seus servicos).
 */
export async function withTransaction<T>(fn: (txQuery: TransactionQuery) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const txQuery: TransactionQuery = async (name, text, params = []) => {
      const startedAt = Date.now();
      try {
        const result = await client.query(text, params);
        recordQuery(name, Date.now() - startedAt);
        return result.rows;
      } catch (err) {
        recordQuery(name, Date.now() - startedAt, err);
        throw err;
      }
    };
    const result = await fn(txQuery);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    logger.error("Transacao revertida (ROLLBACK)", { error: err instanceof Error ? err.message : String(err) });
    throw err;
  } finally {
    client.release();
  }
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
