/**
 * Aplica as migrations de `server/db/migrations/` em ordem alfabetica, uma unica vez cada,
 * registrando o que ja rodou na tabela `schema_migrations`.
 *
 * Antes disso os arquivos eram aplicados na mao (via MCP da Supabase, ver o cabecalho de cada
 * .sql) -- nao havia como um banco vazio (o service container do CI, ou um Postgres local de
 * dev) chegar no schema atual sem alguem colar SQL manualmente.
 *
 * Uso:
 *   pnpm run migrate                 aplica as pendentes
 *   pnpm run migrate -- --dry-run    so lista o que rodaria, sem executar nada
 *   pnpm run migrate -- --baseline   marca todas as pendentes como aplicadas SEM executar
 *
 * `--baseline` existe para o banco de producao, que ja tem o schema aplicado fora deste
 * runner: rodar sem ele tentaria recriar tabelas existentes e falharia. Rode o baseline UMA
 * vez contra a Supabase e, dali em diante, `pnpm run migrate` normal.
 */
import "dotenv/config";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import { resolveSslConfig } from "../src/infrastructure/db/client";

const MIGRATIONS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "db", "migrations");

/**
 * Normaliza CRLF -> LF antes de hashear: o mesmo arquivo tem checksum diferente numa maquina
 * Windows e no runner Linux do CI (git converte a quebra de linha no checkout), o que faria a
 * verificacao de imutabilidade abaixo acusar alteracao falsa em toda migration ja aplicada.
 */
function checksumOf(sql: string): string {
  return createHash("sha256").update(sql.replace(/\r\n/g, "\n")).digest("hex");
}

async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2));
  const baseline = args.has("--baseline");
  const dryRun = args.has("--dry-run");

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL nao configurado. Defina a variavel (ou crie um .env na raiz) antes de rodar as migrations.");
  }

  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith(".sql") || file.endsWith(".sql.txt"))
    .sort();

  if (!files.length) {
    console.log(`Nenhuma migration encontrada em ${MIGRATIONS_DIR}.`);
    return;
  }

  const client = new Client({ connectionString, ssl: resolveSslConfig(connectionString) });
  await client.connect();

  try {
    await client.query(`create table if not exists schema_migrations (
      filename text primary key,
      checksum text not null,
      applied_at timestamptz not null default now()
    )`);

    const { rows } = await client.query<{ filename: string; checksum: string }>("select filename, checksum from schema_migrations");
    const applied = new Map(rows.map((row) => [row.filename, row.checksum]));

    let executed = 0;
    let pending = 0;

    for (const file of files) {
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf-8");
      const checksum = checksumOf(sql);
      const previousChecksum = applied.get(file);

      if (previousChecksum) {
        // Migration ja aplicada e imutavel: editar o .sql depois de aplicado deixa o banco e o
        // repositorio dizendo coisas diferentes, sem ninguem perceber. Corrigir algo ja aplicado
        // exige um arquivo novo.
        if (previousChecksum !== checksum) {
          throw new Error(
            `${file} foi alterada depois de aplicada (checksum diferente do registrado em schema_migrations). ` +
              `Migrations sao imutaveis -- crie um arquivo novo com a correcao em vez de editar este.`,
          );
        }
        console.log(`  = ${file} (ja aplicada)`);
        continue;
      }

      pending += 1;

      if (dryRun) {
        console.log(`  ~ ${file} (pendente -- dry run, nada executado)`);
        continue;
      }

      if (baseline) {
        await client.query("insert into schema_migrations (filename, checksum) values ($1, $2)", [file, checksum]);
        console.log(`  ^ ${file} (marcada como aplicada; SQL NAO executado -- baseline)`);
        continue;
      }

      // Uma transacao por arquivo: se o SQL falhar no meio, nem o efeito parcial dele nem o
      // registro em schema_migrations sobrevivem -- a migration continua pendente e pode ser
      // corrigida e rodada de novo.
      await client.query("begin");
      try {
        await client.query(sql);
        await client.query("insert into schema_migrations (filename, checksum) values ($1, $2)", [file, checksum]);
        await client.query("commit");
      } catch (err) {
        await client.query("rollback").catch(() => undefined);
        throw new Error(`Falha ao aplicar ${file}: ${err instanceof Error ? err.message : String(err)}`);
      }

      executed += 1;
      console.log(`  + ${file} (aplicada)`);
    }

    if (!pending) {
      console.log("\nBanco ja esta atualizado; nenhuma migration pendente.");
    } else if (dryRun) {
      console.log(`\n${pending} migration(s) pendente(s). Rode sem --dry-run para aplicar.`);
    } else if (baseline) {
      console.log(`\n${pending} migration(s) marcadas como aplicadas sem execucao (baseline).`);
    } else {
      console.log(`\n${executed} migration(s) aplicada(s).`);
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(`\nMigrations falharam: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
