import { Pool, type QueryResultRow } from "pg";
import { logger } from "../observability/logger";
import { recordQuery } from "../observability/queryStats";

const SLOW_QUERY_MS = 500;

const connectionString = process.env.DATABASE_URL;

/** Falso quando DATABASE_URL nao esta configurado; repositorios devem cair para fallback estatico neste caso. */
export const isDatabaseConfigured = Boolean(connectionString);

/**
 * TLS da conexao com o Postgres.
 *
 * Em producao (Supabase via pooler Supavisor) a cadeia de certificados tem uma raiz que nao
 * esta no bundle padrao de CAs do Node ("self-signed certificate in certificate chain"),
 * mesmo sendo uma conexao TLS legitima -- verificado em producao (Lambda us-east-1) apos
 * tentar rejectUnauthorized: true. Ate pinarmos o CA correto da Supabase, a conexao segue
 * criptografada, mas sem verificacao de identidade do servidor.
 *
 * Num Postgres local (o service container do CI, ou docker-compose em dev) nao ha TLS
 * nenhum: insistir em SSL faz o servidor recusar a conexao com "The server does not support
 * SSL connections" e derruba a suite inteira. Por isso host local desliga o TLS
 * automaticamente, e DATABASE_SSL=disable/require permite forcar os dois lados quando a
 * deteccao por host nao servir.
 */
export function resolveSslConfig(url: string | undefined): { rejectUnauthorized: boolean } | false {
  if (process.env.DATABASE_SSL === "disable") return false;
  if (process.env.DATABASE_SSL === "require") return { rejectUnauthorized: false };
  if (!url) return false;
  try {
    const host = new URL(url).hostname;
    if (host === "localhost" || host === "127.0.0.1" || host === "::1") return false;
  } catch {
    // Connection string em formato nao-URL (ex.: "host=... dbname=..."): mantem o padrao
    // seguro (TLS ligado) em vez de adivinhar.
  }
  return { rejectUnauthorized: false };
}

let pool: Pool | null = null;

function getPool(): Pool {
  if (!connectionString) {
    throw new Error("DATABASE_URL nao configurado");
  }
  if (!pool) {
    pool = new Pool({
      connectionString,
      ssl: resolveSslConfig(connectionString),
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
