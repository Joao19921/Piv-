import { useEffect, useState } from "react";
import { ArrowUpRight, FileSearch, LoaderCircle, Search, Tags } from "lucide-react";
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

interface ServicePriceCategory {
  key: string;
  label: string;
}

interface ServicePriceItem {
  id: number;
  codigoServico: number;
  nomeServico: string;
  precoUnitario: string;
  unidadeMedida: string | null;
  uf: string | null;
  municipio: string | null;
  orgao: string | null;
  dataCompra: string | null;
}

const MODULE3_API_URL = (import.meta.env.VITE_MODULE3_API_URL as string | undefined)?.replace(/\/$/, "") ?? "/api/v1/mod3";

function formatBRL(value: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 2 }).format(value);
}

export default function PublicTendersPage() {
  const [term, setTerm] = useState("desenvolvimento de software");
  const [uf, setUf] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [results, setResults] = useState<Tender[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  const [categories, setCategories] = useState<ServicePriceCategory[]>([]);
  const [categoriaChave, setCategoriaChave] = useState("");
  const [priceData, setPriceData] = useState<{ mediana: number | null; itens: ServicePriceItem[] } | null>(null);
  const [priceLoading, setPriceLoading] = useState(false);

  const search = async () => {
    if (term.trim().length < 2) {
      toast.error("Informe pelo menos 2 caracteres para buscar.");
      return;
    }
    if ((startDate && !endDate) || (!startDate && endDate) || (startDate && endDate && startDate > endDate)) {
      toast.error("Informe um intervalo de datas válido.");
      return;
    }
    setLoading(true);
    setSearched(true);
    try {
      const params = new URLSearchParams({ term: term.trim() });
      if (uf) params.set("uf", uf);
      if (startDate) params.set("dataInicial", startDate);
      if (endDate) params.set("dataFinal", endDate);
      const response = await fetch(`${MODULE3_API_URL}/public-tenders?${params}`);
      const body = (await response.json().catch(() => null)) as { tenders?: Tender[]; error?: string } | null;
      if (!response.ok) throw new Error(body?.error ?? "Não foi possível consultar o Módulo 3.");
      setResults(body?.tenders ?? []);
    } catch (error) {
      setResults([]);
      toast.error(error instanceof Error ? error.message : "Falha na consulta pública.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetch(`${MODULE3_API_URL}/service-price-categories`)
      .then((res) => res.json())
      .then((body: { data?: ServicePriceCategory[] }) => setCategories(body.data ?? []))
      .catch(() => setCategories([]));
  }, []);

  const consultarPreco = async (chave: string) => {
    setCategoriaChave(chave);
    if (!chave) {
      setPriceData(null);
      return;
    }
    setPriceLoading(true);
    try {
      const response = await fetch(`${MODULE3_API_URL}/service-prices?categoria=${encodeURIComponent(chave)}`);
      const body = (await response.json().catch(() => null)) as { mediana: number | null; itens: ServicePriceItem[]; error?: string } | null;
      if (!response.ok) throw new Error(body?.error ?? "Não foi possível consultar o preço de referência.");
      setPriceData({ mediana: body?.mediana ?? null, itens: body?.itens ?? [] });
    } catch (error) {
      setPriceData(null);
      toast.error(error instanceof Error ? error.message : "Falha na consulta de preço.");
    } finally {
      setPriceLoading(false);
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
          <div><h2 className="font-display text-lg font-semibold text-[#333333]">Buscar em fontes oficiais</h2><p className="text-xs text-[#788D8D]">PNCP</p></div>
        </div>
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_100px_150px_150px_auto]">
          <div className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#819494]" /><Input value={term} onChange={(event) => setTerm(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void search(); }} className="h-11 rounded-xl border-[#D4D1CC] bg-white pl-10 text-sm" placeholder="Ex.: notebook i7, consultoria SAP" aria-label="Termo da busca" /></div>
          <Input value={uf} onChange={(event) => setUf(event.target.value.toUpperCase().slice(0, 2))} className="h-11 rounded-xl border-[#D4D1CC] bg-white text-sm uppercase" placeholder="UF" aria-label="Estado" maxLength={2} />
          <Input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} className="h-11 rounded-xl border-[#D4D1CC] bg-white text-sm" aria-label="Data inicial" title="Data inicial" />
          <Input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} className="h-11 rounded-xl border-[#D4D1CC] bg-white text-sm" aria-label="Data final" title="Data final" />
          <Button onClick={() => void search()} disabled={loading} className="h-11 rounded-xl bg-[#F57F17] px-5 text-xs font-semibold text-white hover:bg-[#D96D0C]">{loading ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />} Buscar</Button>
        </div>
      </Card>
      <div className="mt-5 space-y-3">
        {searched && !loading && results.length === 0 && <Card className="rounded-2xl border-dashed border-[#D4D1CC] bg-transparent p-8 text-center"><p className="text-sm text-[#657B7B]">Nenhum edital encontrado para esta busca.</p></Card>}
        {results.map((tender) => <Card key={`${tender.source}-${tender.externalId}`} className="rounded-2xl border-[#DDD7CC] bg-[#FBF7F1] p-5 shadow-paper"><div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div className="min-w-0"><div className="mb-2 flex flex-wrap items-center gap-2"><Badge variant="outline" className="rounded-full border-[#BDD3D0] bg-[#EBECEC] text-[10px] uppercase tracking-[0.08em] text-[#3F746D]">{tender.source}</Badge>{tender.state && <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#899A9A]">{tender.state}</span>}</div><h3 className="text-sm font-semibold leading-6 text-[#333333]">{tender.object}</h3><p className="mt-1 text-[11px] text-[#899A9A]">{tender.externalId}{tender.tenderDate ? ` · ${new Date(tender.tenderDate).toLocaleDateString("pt-BR")}` : ""}</p></div>{tender.url && <Button asChild variant="outline" className="shrink-0 rounded-full border-[#C9C6C2] bg-transparent text-xs"><a href={tender.url} target="_blank" rel="noreferrer">Abrir fonte <ArrowUpRight className="ml-2 h-3.5 w-3.5" /></a></Button>}</div></Card>)}
      </div>

      <Card className="mt-5 rounded-2xl border-[#DDD7CC] bg-[#FBF7F1] p-5 shadow-paper sm:p-7">
        <div className="mb-5 flex items-center gap-3">
          <div className="rounded-xl bg-[#E8E9E9] p-3 text-[#0D5C5C]"><Tags className="h-5 w-5" /></div>
          <div><h2 className="font-display text-lg font-semibold text-[#333333]">Preço de referência por serviço de TI</h2><p className="text-xs text-[#788D8D]">Compras.gov.br · Pesquisa de Preço (preço unitário efetivamente contratado, por item de serviço)</p></div>
        </div>
        <select
          value={categoriaChave}
          onChange={(event) => void consultarPreco(event.target.value)}
          className="h-11 w-full rounded-xl border border-[#D4D1CC] bg-white px-3 text-sm text-[#333333] outline-none focus:border-[#F57F17] focus:ring-2 focus:ring-[#F57F17]/20 md:max-w-md"
        >
          <option value="">Selecione um serviço</option>
          {categories.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
        </select>

        {priceLoading && <div className="mt-5 flex items-center gap-2 text-xs text-[#657B7B]"><LoaderCircle className="h-4 w-4 animate-spin" /> Consultando...</div>}

        {!priceLoading && priceData && (
          <div className="mt-5">
            {priceData.mediana !== null ? (
              <div className="mb-4 rounded-xl border border-[#0D5C5C] bg-[#0D5C5C] p-4 text-[#F7F2E8]">
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#AEC4C4]">Mediana dos preços praticados</p>
                <span className="font-display text-2xl font-semibold">{formatBRL(Number(priceData.mediana))}</span>
              </div>
            ) : (
              <p className="mb-4 text-xs text-[#899A9A]">Nenhum preço coletado ainda para esta categoria — o worker roda a cada 10 dias.</p>
            )}
            <div className="space-y-2">
              {priceData.itens.map((item) => (
                <div key={item.id} className="rounded-lg border border-[#E5E0D6] bg-white/55 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs font-semibold text-[#333333]">{item.orgao ?? "Órgão não identificado"}</p>
                    <span className="font-display text-sm font-semibold text-[#C2660D]">{formatBRL(Number(item.precoUnitario))} / {item.unidadeMedida ?? "un."}</span>
                  </div>
                  <p className="mt-1 text-[10px] text-[#899A9A]">
                    {item.municipio ?? "—"}/{item.uf ?? "BR"}
                    {item.dataCompra ? ` · ${new Date(item.dataCompra).toLocaleDateString("pt-BR")}` : ""}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
