import fs from "node:fs";
import path from "node:path";

const CACHE_DIR = path.resolve(process.cwd(), "data", "cache");

function ensureCacheDir(): void {
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  }
}

/** Camada 3 (Local Cache / Stale DB) da matriz de resiliência: cache write-through em disco. */
export function readCache<T>(key: string): { data: T; updatedAt: string } | null {
  try {
    const file = path.join(CACHE_DIR, `${key}.json`);
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch {
    return null;
  }
}

export function writeCache<T>(key: string, data: T): void {
  try {
    ensureCacheDir();
    const file = path.join(CACHE_DIR, `${key}.json`);
    const payload = { data, updatedAt: new Date().toISOString() };
    fs.writeFileSync(file, JSON.stringify(payload, null, 2), "utf-8");
  } catch {
    /* cache é best-effort; falha de escrita não deve derrubar a requisição */
  }
}
