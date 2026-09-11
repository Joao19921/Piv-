import { Pool } from "pg";
import type { PublicTender } from "./types";

let pool: Pool | undefined;

function getPool(): Pool | undefined {
  if (!process.env.MOD3_DATABASE_URL) return undefined;
  pool ??= new Pool({ connectionString: process.env.MOD3_DATABASE_URL, max: 3, ssl: process.env.MOD3_DATABASE_SSL === "disable" ? false : { rejectUnauthorized: false } });
  return pool;
}

export async function saveSearch(term: string, tenders: PublicTender[]): Promise<void> {
  const database = getPool();
  if (!database) return;
  await database.query("INSERT INTO mod3_buscas (termo, fontes, quantidade_resultados) VALUES ($1, $2, $3)", [term, [...new Set(tenders.map((item) => item.source))], tenders.length]);
  for (const tender of tenders) {
    await database.query(
      `INSERT INTO mod3_licitacoes (external_id, fonte, objeto, uf, data_licitacao, url_origem, payload)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (external_id, fonte) DO UPDATE SET objeto = EXCLUDED.objeto, uf = EXCLUDED.uf,
         data_licitacao = EXCLUDED.data_licitacao, url_origem = EXCLUDED.url_origem, payload = EXCLUDED.payload,
         atualizado_em = now()`,
      [tender.externalId, tender.source, tender.object, tender.state ?? null, tender.tenderDate ?? null, tender.url ?? null, JSON.stringify(tender.raw)],
    );
  }
}

export async function closeDatabase(): Promise<void> {
  await pool?.end();
  pool = undefined;
}

export async function listProfiles(term?: string): Promise<unknown[]> {
  const database = getPool();
  if (!database) return [];
  const rows = await database.query(
    `SELECT id, licitacao_id AS "licitacaoId", perfil, senioridade, unidade_medicao AS "unidadeMedicao", valor_hora AS "valorHora"
     FROM mod3_perfis_talents WHERE ($1::text IS NULL OR perfil ILIKE '%' || $1 || '%') ORDER BY valor_hora DESC NULLS LAST LIMIT 200`,
    [term?.trim() || null],
  );
  return rows.rows;
}

export async function listEquipment(term?: string): Promise<unknown[]> {
  const database = getPool();
  if (!database) return [];
  const rows = await database.query(
    `SELECT id, licitacao_id AS "licitacaoId", descricao, categoria, unidade, valor_unitario AS "valorUnitario"
     FROM mod3_equipamentos WHERE ($1::text IS NULL OR descricao ILIKE '%' || $1 || '%') ORDER BY valor_unitario DESC NULLS LAST LIMIT 200`,
    [term?.trim() || null],
  );
  return rows.rows;
}