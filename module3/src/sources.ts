import type { Module3Config } from "./types";
import type { PublicTender } from "./types";

function compactDate(date: Date): string {
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
}

export function buildPncpSearchUrl(term: string, now = new Date()): URL {
  const start = new Date(now);
  start.setDate(start.getDate() - 30);
  const url = new URL("https://pncp.gov.br/api/consulta/v1/contratacoes/publicacao");
  url.searchParams.set("dataInicial", compactDate(start));
  url.searchParams.set("dataFinal", compactDate(now));
  url.searchParams.set("pagina", "1");
  url.searchParams.set("tamanhoPagina", "100");
  url.searchParams.set("criterioBusca", term.trim());
  return url;
}

async function getJson(url: URL, timeoutMs: number): Promise<unknown> {
  const response = await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`Fonte respondeu HTTP ${response.status}: ${url.hostname}`);
  return response.json();
}

export async function searchPncp(term: string, config: Module3Config): Promise<PublicTender[]> {
  const payload = (await getJson(buildPncpSearchUrl(term), config.requestTimeoutMs)) as { data?: Record<string, unknown>[] };
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
  const payload = (await getJson(url, config.requestTimeoutMs)) as { data?: Record<string, unknown>[] };
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
