import type { Module3Config } from "./types";
import type { PublicTender } from "./types";

function compactDate(date: Date): string {
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
}

export interface PncpSearchOptions {
  uf?: string;
  page?: number;
  pageSize?: number;
}

export function buildPncpSearchUrl(term: string, now = new Date(), options: PncpSearchOptions = {}): URL {
  const start = new Date(now);
  start.setDate(start.getDate() - 30);
  const url = new URL("https://pncp.gov.br/api/consulta/v1/contratacoes/publicacao");
  url.searchParams.set("dataInicial", compactDate(start));
  url.searchParams.set("dataFinal", compactDate(now));
  url.searchParams.set("pagina", String(options.page ?? 1));
  url.searchParams.set("tamanhoPagina", String(options.pageSize ?? 100));
  url.searchParams.set("criterioBusca", term.trim());
  url.searchParams.set("codigoModalidadeContratacao", "6");
  if (options.uf) url.searchParams.set("uf", options.uf.trim().toUpperCase());
  return url;
}

async function getJson(url: URL, timeoutMs: number, maxRetries: number): Promise<unknown> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { Accept: "application/json", "User-Agent": "Pivo-Module3/1.0" },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (response.ok) return response.json();
      if (response.status < 500 || attempt >= maxRetries) {
        throw new Error(`Fonte respondeu HTTP ${response.status}: ${url.hostname}`);
      }
    } catch (error) {
      if (attempt >= maxRetries) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt));
  }
}

export async function searchPncp(term: string, config: Module3Config, options: PncpSearchOptions = {}): Promise<PublicTender[]> {
  const payload = (await getJson(buildPncpSearchUrl(term, new Date(), options), config.requestTimeoutMs, config.maxRetries)) as { data?: Record<string, unknown>[] };
  return (payload.data ?? []).map((item) => ({
    externalId: String(item.numeroControlePNCP ?? item.id ?? ""),
    source: "PNCP",
    object: String(item.objetoCompra ?? item.objeto ?? term),
    state: typeof item.uf === "string" ? item.uf : undefined,
    tenderDate: typeof item.dataPublicacaoPncp === "string" ? item.dataPublicacaoPncp : undefined,
    url: typeof item.linkSistemaOrigem === "string" ? item.linkSistemaOrigem : undefined,
    raw: item,
  })).filter((item) => item.externalId);
}

export async function searchComprasGov(term: string, config: Module3Config): Promise<PublicTender[]> {
  const base = process.env.MOD3_COMPRAS_GOV_API_URL;
  if (!base) return [];
  const url = new URL(base);
  url.searchParams.set("q", term.trim());
  const payload = (await getJson(url, config.requestTimeoutMs, config.maxRetries)) as { data?: Record<string, unknown>[] };
  return (payload.data ?? []).map((item) => ({
    externalId: String(item.id ?? item.numero ?? ""),
    source: "COMPRAS_GOV",
    object: String(item.objeto ?? item.descricao ?? term),
    state: typeof item.uf === "string" ? item.uf : undefined,
    tenderDate: typeof item.data === "string" ? item.data : undefined,
    url: typeof item.url === "string" ? item.url : undefined,
    raw: item,
  })).filter((item) => item.externalId);
}
