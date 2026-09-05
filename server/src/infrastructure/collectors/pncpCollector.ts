import { readCache, writeCache } from "../cache/fileCache";
import { executeWithFallback, type ResilienceResult } from "../resilience/resilienceManager";

const CACHE_KEY = "pncp-status";
const REQUEST_TIMEOUT_MS = 6_000;
const LOOKBACK_DAYS = 7;
/** Pregao Eletronico (Lei 14.133/2021, Art. 28, I) — modalidade mais usada em contratacoes de TI no setor publico. */
const MODALIDADE_PREGAO_ELETRONICO = 6;
const MIN_PAGE_SIZE = 10;

export interface PncpStatusSample {
  totalRegistros: number;
  windowStart: string;
  windowEnd: string;
}

function formatDateCompact(date: Date): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}${mm}${dd}`;
}

/**
 * Prova de vida da API de consulta publica do PNCP: busca 1 pagina de contratacoes (Pregao
 * Eletronico) publicadas nos ultimos dias. Sem chave/cadastro — API publica do gov.br.
 */
async function fetchPncpStatus(): Promise<PncpStatusSample> {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - LOOKBACK_DAYS);

  const url = new URL("https://pncp.gov.br/api/consulta/v1/contratacoes/publicacao");
  url.searchParams.set("dataInicial", formatDateCompact(start));
  url.searchParams.set("dataFinal", formatDateCompact(end));
  url.searchParams.set("codigoModalidadeContratacao", String(MODALIDADE_PREGAO_ELETRONICO));
  url.searchParams.set("pagina", "1");
  url.searchParams.set("tamanhoPagina", String(MIN_PAGE_SIZE));

  const res = await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (!res.ok) {
    throw new Error(`PNCP respondeu HTTP ${res.status}`);
  }

  const json = (await res.json()) as { totalRegistros?: number };
  if (typeof json.totalRegistros !== "number") {
    throw new Error("PNCP nao retornou 'totalRegistros' no formato esperado");
  }

  return { totalRegistros: json.totalRegistros, windowStart: start.toISOString(), windowEnd: end.toISOString() };
}

export async function getPncpStatus(): Promise<ResilienceResult<PncpStatusSample>> {
  return executeWithFallback<PncpStatusSample>({
    serviceName: "PNCP",
    primary: async () => {
      const sample = await fetchPncpStatus();
      writeCache(CACHE_KEY, sample);
      return sample;
    },
    fallback: async () => readCache<PncpStatusSample>(CACHE_KEY),
  });
}
