import { Pool } from "pg";
import type { PublicTender, ServicePriceObservation } from "./types";

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

/** Grava os preços praticados de uma categoria CATSER -- upsert por (codigo_servico,
 * id_item_compra), mesma logica de idempotencia de `saveSearch` (reprocessar nao duplica). */
export async function saveServicePrices(categoriaChave: string, itens: ServicePriceObservation[]): Promise<void> {
  const database = getPool();
  if (!database) return;
  for (const item of itens) {
    await database.query(
      `INSERT INTO mod3_precos_servico
         (categoria_chave, codigo_servico, id_item_compra, nome_servico, preco_unitario, unidade_medida, uf, municipio, orgao, data_compra, payload)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (codigo_servico, id_item_compra) DO UPDATE SET
         categoria_chave = EXCLUDED.categoria_chave, nome_servico = EXCLUDED.nome_servico,
         preco_unitario = EXCLUDED.preco_unitario, unidade_medida = EXCLUDED.unidade_medida,
         uf = EXCLUDED.uf, municipio = EXCLUDED.municipio, orgao = EXCLUDED.orgao,
         data_compra = EXCLUDED.data_compra, payload = EXCLUDED.payload, atualizado_em = now()`,
      [
        categoriaChave,
        item.codigoItemCatalogo,
        item.idItemCompra,
        item.descricaoItem,
        item.precoUnitario,
        item.unidadeMedida,
        item.estado ?? null,
        item.municipio ?? null,
        item.orgao ?? null,
        item.dataCompra ?? null,
        JSON.stringify(item.raw),
      ],
    );
  }
}

/** Preços ja persistidos de uma categoria, mais recentes primeiro, com a mediana calculada em
 * SQL (`percentile_cont`) -- evita puxar tudo pro Node so pra tirar uma mediana. */
export async function listServicePrices(categoriaChave: string): Promise<{ mediana: number | null; itens: unknown[] }> {
  const database = getPool();
  if (!database) return { mediana: null, itens: [] };

  const itens = await database.query(
    `SELECT id, codigo_servico AS "codigoServico", nome_servico AS "nomeServico",
            preco_unitario AS "precoUnitario", unidade_medida AS "unidadeMedida",
            uf, municipio, orgao, data_compra AS "dataCompra"
     FROM mod3_precos_servico WHERE categoria_chave = $1
     ORDER BY data_compra DESC NULLS LAST LIMIT 200`,
    [categoriaChave],
  );
  const mediana = await database.query(
    `SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY preco_unitario) AS mediana
     FROM mod3_precos_servico WHERE categoria_chave = $1`,
    [categoriaChave],
  );
  return { mediana: mediana.rows[0]?.mediana ?? null, itens: itens.rows };
}