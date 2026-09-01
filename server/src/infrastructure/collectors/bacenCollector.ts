import { readCache, writeCache } from "../cache/fileCache";
import { executeWithFallback, type ResilienceResult } from "../resilience/resilienceManager";

const CACHE_KEY = "bacen-ptax";
const REQUEST_TIMEOUT_MS = 3_000;

/** Fallback estático de nível 2 (contingência de configuração) quando não há cache local ainda. */
const STATIC_CONTINGENCY_RATE = 5.4;

export interface PtaxQuote {
  rate: number;
  quotedAt: string;
}

function formatDateBr(date: Date): string {
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${mm}-${dd}-${date.getFullYear()}`;
}

async function fetchLatestPtax(): Promise<PtaxQuote> {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - 7);

  const url =
    `https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/CotacaoDolarPeriodo(dataInicial=@dataInicial,dataFinalCotacao=@dataFinalCotacao)` +
    `?@dataInicial='${formatDateBr(start)}'&@dataFinalCotacao='${formatDateBr(end)}'&$top=1&$orderby=dataHoraCotacao%20desc&$format=json`;

  const res = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (!res.ok) {
    throw new Error(`BACEN PTAX respondeu HTTP ${res.status}`);
  }

  const json = (await res.json()) as { value?: Array<{ cotacaoVenda: number; dataHoraCotacao: string }> };
  const entry = json.value?.[0];
  if (!entry) {
    throw new Error("BACEN PTAX não retornou cotação no período consultado");
  }

  return { rate: entry.cotacaoVenda, quotedAt: entry.dataHoraCotacao };
}

export async function getPtax(): Promise<ResilienceResult<PtaxQuote>> {
  return executeWithFallback<PtaxQuote>({
    serviceName: "BACEN_PTAX",
    primary: async () => {
      const quote = await fetchLatestPtax();
      writeCache(CACHE_KEY, quote);
      return quote;
    },
    fallback: async () => {
      const cached = readCache<PtaxQuote>(CACHE_KEY);
      if (cached) return cached;
      return {
        data: { rate: STATIC_CONTINGENCY_RATE, quotedAt: "static-contingency" },
        updatedAt: new Date().toISOString(),
      };
    },
  });
}
