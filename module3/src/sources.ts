import type { Module3Config } from "./types";
import type { PublicTender, ServicePriceObservation } from "./types";

function compactDate(date: Date): string {
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
}

export interface PncpSearchOptions {
  uf?: string;
  page?: number;
  pageSize?: number;
  startDate?: string;
  endDate?: string;
}

export function buildPncpSearchUrl(term: string, now = new Date(), options: PncpSearchOptions = {}): URL {
  const start = new Date(now);
  start.setDate(start.getDate() - 30);
  const url = new URL("https://pncp.gov.br/api/consulta/v1/contratacoes/publicacao");
  url.searchParams.set("dataInicial", options.startDate?.replaceAll("-", "") ?? compactDate(start));
  url.searchParams.set("dataFinal", options.endDate?.replaceAll("-", "") ?? compactDate(now));
  url.searchParams.set("pagina", String(options.page ?? 1));
  url.searchParams.set("tamanhoPagina", String(options.pageSize ?? 10));
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
      const transient = response.status === 429 || response.status >= 500;
      if (!transient || attempt >= maxRetries) {
        throw new Error(`Fonte respondeu HTTP ${response.status}: ${url.hostname}`);
      }
      const retryAfter = Number(response.headers.get("retry-after"));
      const delayMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 250 * 2 ** attempt;
      await new Promise((resolve) => setTimeout(resolve, Math.min(delayMs, 5_000)));
      continue;
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

/**
 * Preço praticado por item de serviço (CATSER), via o módulo "Pesquisa de Preço" do
 * Compras.gov.br -- sucessor do extinto Painel de Preços, único caminho que devolve preço
 * unitário de contratação de verdade (não uma lista de editais, que já vem do PNCP).
 *
 * Endpoint, parâmetros e formato de resposta confirmados AO VIVO em 12-13/09/2026 (não
 * documentação sozinha): `GET .../modulo-pesquisa-preco/3_consultarServico
 * ?pagina=&tamanhoPagina=&codigoItemCatalogo=` devolve `{ resultado: [...], totalRegistros,
 * totalPaginas, paginasRestantes }`, sem exigir chave/cadastro. Não existe busca por texto
 * nessa API -- `codigoItemCatalogo` vem do catálogo fixo em `catserCatalog.ts`, navegado
 * manualmente pela hierarquia real da API (nunca um código estimado).
 */
export function buildPesquisaPrecoUrl(codigoItemCatalogo: number, options: { pageSize?: number } = {}): URL {
  // A API rejeita com HTTP 400 fora do intervalo 10-500 (confirmado ao vivo) -- clampar aqui
  // evita que um valor de fora quebre a chamada em silencio.
  const tamanhoPagina = Math.min(500, Math.max(10, options.pageSize ?? 100));
  const url = new URL("https://dadosabertos.compras.gov.br/modulo-pesquisa-preco/3_consultarServico");
  url.searchParams.set("pagina", "1");
  url.searchParams.set("tamanhoPagina", String(tamanhoPagina));
  url.searchParams.set("codigoItemCatalogo", String(codigoItemCatalogo));
  return url;
}

export async function consultarPrecoServico(
  codigoItemCatalogo: number,
  config: Module3Config,
  options: { pageSize?: number } = {},
): Promise<ServicePriceObservation[]> {
  const url = buildPesquisaPrecoUrl(codigoItemCatalogo, options);
  const payload = (await getJson(url, config.requestTimeoutMs, config.maxRetries)) as { resultado?: Record<string, unknown>[] };
  return (payload.resultado ?? [])
    .map((item) => ({
      idItemCompra: Number(item.idItemCompra),
      codigoItemCatalogo: Number(item.codigoItemCatalogo),
      descricaoItem: String(item.descricaoItem ?? item.objetoCompra ?? ""),
      precoUnitario: Number(item.precoUnitario),
      unidadeMedida: String(item.siglaUnidadeMedida ?? item.nomeUnidadeMedida ?? ""),
      municipio: typeof item.municipio === "string" ? item.municipio : undefined,
      estado: typeof item.estado === "string" ? item.estado : undefined,
      orgao: typeof item.nomeOrgao === "string" ? item.nomeOrgao : undefined,
      dataCompra: typeof item.dataCompra === "string" ? item.dataCompra : undefined,
      raw: item,
    }))
    .filter((item) => Number.isFinite(item.idItemCompra) && Number.isFinite(item.precoUnitario) && item.precoUnitario > 0);
}
