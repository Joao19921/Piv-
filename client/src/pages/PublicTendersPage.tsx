import { useState } from "react";
import { ArrowUpRight, FileSearch, LoaderCircle, Search } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { SectionHeading } from "@/pages/Home";

interface Tender {
  externalId: string;
  source: string;
  object: string;
  state?: string;
  tenderDate?: string;
  url?: string;
}

const MODULE3_API_URL = (import.meta.env.VITE_MODULE3_API_URL as string | undefined)?.replace(/\/$/, "") ?? "";

function buildPncpUrl(term: string, uf: string): URL {
  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - 30);
  const compact = (date: Date) => `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
  const url = new URL("https://pncp.gov.br/api/consulta/v1/contratacoes/publicacao");
  url.searchParams.set("dataInicial", compact(start));
  url.searchParams.set("dataFinal", compact(end));
  url.searchParams.set("pagina", "1");
  url.searchParams.set("tamanhoPagina", "100");
  url.searchParams.set("criterioBusca", term);
  url.searchParams.set("codigoModalidadeContratacao", "6");
  if (uf) url.searchParams.set("uf", uf);
  return url;
}

async function fetchPncpDirect(term: string, uf: string): Promise<Tender[]> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(buildPncpUrl(term, uf), { headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error(`PNCP respondeu HTTP ${response.status}.`);
      const body = (await response.json()) as { data?: Record<string, unknown>[] };
      return (body.data ?? []).map((item) => ({
        externalId: String(item.numeroControlePNCP ?? item.id ?? ""),
        source: "PNCP",
        object: String(item.objetoCompra ?? item.objeto ?? term),
        state: typeof item.uf === "string" ? item.uf : undefined,
        tenderDate: typeof item.dataPublicacaoPncp === "string" ? item.dataPublicacaoPncp : undefined,
        url: typeof item.linkSistemaOrigem === "string" ? item.linkSistemaOrigem : undefined,
      })).filter((item) => item.externalId);
    } catch (error) {
      lastError = error;
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 400 * 2 ** attempt));
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Falha ao consultar o PNCP.");
}

export default function PublicTendersPage() {
  const [term, setTerm] = useState("desenvolvimento de software");
  const [uf, setUf] = useState("");
  const [results, setResults] = useState<Tender[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  const search = async () => {
    if (term.trim().length < 2) {
      toast.error("Informe pelo menos 2 caracteres para buscar.");
      return;
    }
    setLoading(true);
    setSearched(true);
    try {
      const params = new URLSearchParams({ term: term.trim() });
      if (uf) params.set("uf", uf);
      if (MODULE3_API_URL) {
        const response = await fetch(`${MODULE3_API_URL}/v1/mod3/public-tenders?${params}`);
        const body = (await response.json().catch(() => null)) as { tenders?: Tender[]; error?: string } | null;
        if (!response.ok) throw new Error(body?.error ?? "Não foi possível consultar o Módulo 3.");
        setResults(body?.tenders ?? []);
      } else {
        setResults(await fetchPncpDirect(term.trim(), uf));
      }
    } catch (error) {
      setResults([]);
      toast.error(error instanceof Error ? error.message : "Falha na consulta pública.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <SectionHeading
        eyebrow="Módulo 3 · Dados públicos"
        title="Editais e referências de TI"
        description="Consulte licitações públicas, perfis profissionais e insumos de tecnologia sem misturar o banco do core com a coleta externa."
      />
      <Card className="rounded-2xl border-[#DDD7CC] bg-[#FBF7F1] p-5 shadow-paper sm:p-7">
        <div className="mb-5 flex items-center gap-3">
          <div className="rounded-xl bg-[#E8E9E9] p-3 text-[#0D5C5C]"><FileSearch className="h-5 w-5" /></div>
          <div><h2 className="font-display text-lg font-semibold text-[#333333]">Buscar em fontes oficiais</h2><p className="text-xs text-[#788D8D]">PNCP e Compras.gov.br</p></div>
        </div>
        <div className="grid gap-3 md:grid-cols-[1fr_120px_auto]">
          <div className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#819494]" /><Input value={term} onChange={(event) => setTerm(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void search(); }} className="h-11 rounded-xl border-[#D4D1CC] bg-white pl-10 text-sm" placeholder="Ex.: notebook i7, consultoria SAP" aria-label="Termo da busca" /></div>
          <Input value={uf} onChange={(event) => setUf(event.target.value.toUpperCase().slice(0, 2))} className="h-11 rounded-xl border-[#D4D1CC] bg-white text-sm uppercase" placeholder="UF" aria-label="Estado" maxLength={2} />
          <Button onClick={() => void search()} disabled={loading} className="h-11 rounded-xl bg-[#F57F17] px-5 text-xs font-semibold text-white hover:bg-[#D96D0C]">{loading ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />} Buscar</Button>
        </div>
      </Card>
      <div className="mt-5 space-y-3">
        {searched && !loading && results.length === 0 && <Card className="rounded-2xl border-dashed border-[#D4D1CC] bg-transparent p-8 text-center"><p className="text-sm text-[#657B7B]">Nenhum edital encontrado para esta busca.</p></Card>}
        {results.map((tender) => <Card key={`${tender.source}-${tender.externalId}`} className="rounded-2xl border-[#DDD7CC] bg-[#FBF7F1] p-5 shadow-paper"><div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div className="min-w-0"><div className="mb-2 flex flex-wrap items-center gap-2"><Badge variant="outline" className="rounded-full border-[#BDD3D0] bg-[#EBECEC] text-[10px] uppercase tracking-[0.08em] text-[#3F746D]">{tender.source}</Badge>{tender.state && <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#899A9A]">{tender.state}</span>}</div><h3 className="text-sm font-semibold leading-6 text-[#333333]">{tender.object}</h3><p className="mt-1 text-[11px] text-[#899A9A]">{tender.externalId}{tender.tenderDate ? ` · ${new Date(tender.tenderDate).toLocaleDateString("pt-BR")}` : ""}</p></div>{tender.url && <Button asChild variant="outline" className="shrink-0 rounded-full border-[#C9C6C2] bg-transparent text-xs"><a href={tender.url} target="_blank" rel="noreferrer">Abrir fonte <ArrowUpRight className="ml-2 h-3.5 w-3.5" /></a></Button>}</div></Card>)}
      </div>
    </div>
  );
}
