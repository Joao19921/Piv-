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
export interface DbSslConfig {
  rejectUnauthorized: boolean;
  ca?: string;
}

/**
 * Quando `DATABASE_CA_CERT` traz o certificado raiz em PEM, a conexao passa a VERIFICAR a
 * identidade do servidor (`rejectUnauthorized: true`) em vez de apenas criptografar. E o unico
 * jeito de fechar de fato a exposicao a um MITM ativo entre o app e o banco.
 *
 * Fica em variavel de ambiente, e nao versionado no repositorio, de proposito: o CA da Supabase
 * tem validade e e rotacionado: um .crt commitado vira uma bomba-relogio que derruba producao
 * no dia da troca, com um erro de TLS que ninguem relaciona com um arquivo esquecido no repo.
 * Onde pegar: Supabase Dashboard > Project Settings > Database > SSL Configuration >
 * "Download certificate". Ver docs/RUNBOOK.md.
 */
function certificateAuthority(): string | undefined {
  const pem = process.env.DATABASE_CA_CERT?.trim();
  if (!pem) return undefined;
  // Permite colar o PEM com "\n" literais, que e como ele sobrevive a um campo de env var de
  // uma linha so nos paineis do Render e da AWS Lambda.
  return pem.includes("\\n") ? pem.replace(/\\n/g, "\n") : pem;
}

export function resolveSslConfig(url: string | undefined): DbSslConfig | false {
  if (process.env.DATABASE_SSL === "disable") return false;

  const ca = certificateAuthority();
  // Com o CA em maos, verifica a identidade do servidor. Sem ele, mantem o comportamento
  // historico: criptografado, mas sem verificacao -- ver o comentario acima.
  const secure: DbSslConfig = ca ? { rejectUnauthorized: true, ca } : { rejectUnauthorized: false };

  if (process.env.DATABASE_SSL === "require") return secure;
  if (!url) return false;
  try {
    const host = new URL(url).hostname;
    if (host === "localhost" || host === "127.0.0.1" || host === "::1") return false;
  } catch {
    // Connection string em formato nao-URL (ex.: "host=... dbname=..."): mantem o padrao
    // seguro (TLS ligado) em vez de adivinhar.
  }
  return secure;
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

export interface DbHealth {
  /** "ok" | "unreachable" | "not_configured" */
  status: "ok" | "unreachable" | "not_configured";
  latencyMs?: number;
  /** Motivo resumido da falha. Nunca contem credencial: so a mensagem do driver. */
  reason?: string;
}

/**
 * Prova de vida da conexao com o Postgres, para o /healthz.
 *
 * Existe por causa de um incidente real: a aplicacao em producao ficou sem conseguir falar com o
 * banco -- toda rota que consultava dava 500, enquanto /healthz seguia respondendo 200 porque
 * nao tocava o banco. O deploy passou verde com o app inutilizavel, e ninguem soube ate um
 * usuario relatar que o login parou.
 *
 * Deliberadamente NAO derruba o /healthz: o Render usa esse endpoint como health check, e
 * devolver erro faria o servico entrar em loop de restart justamente quando o problema esta
 * fora dele. Liveness (o processo esta de pe) e readiness (as dependencias respondem) sao
 * perguntas diferentes; aqui a segunda vira um campo, nao um status HTTP.
 */
export async function pingDatabase(timeoutMs = 3_000): Promise<DbHealth> {
  if (!isDatabaseConfigured) return { status: "not_configured" };

  const startedAt = Date.now();
  try {
    // Promise.race em vez de statement_timeout: o custo aqui e o handshake/pool, nao a consulta,
    // e um `select 1` pendurado nao segura recurso relevante.
    await Promise.race([
      getPool().query("select 1"),
      new Promise((_, reject) => setTimeout(() => reject(new Error(`sem resposta em ${timeoutMs}ms`)), timeoutMs)),
    ]);
    return { status: "ok", latencyMs: Date.now() - startedAt };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    logger.error("Banco inacessivel na verificacao do /healthz", { reason, latencyMs: Date.now() - startedAt });
    return { status: "unreachable", latencyMs: Date.now() - startedAt, reason };
  }
}
