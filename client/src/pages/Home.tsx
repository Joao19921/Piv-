/* Observatório Operacional: cockpit neo-editorial para transformar fontes dispersas em decisões de preço defensáveis. */
import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  Bell,
  BriefcaseBusiness,
  Calculator,
  Check,
  CheckCircle,
  ChevronRight,
  CircleDollarSign,
  Cloud,
  CloudCog,
  Database,
  FileChartColumnIncreasing,
  FilePlus2,
  Gauge,
  KeyRound,
  LayoutDashboard,
  LifeBuoy,
  Menu,
  MoreHorizontal,
  PanelLeft,
  RefreshCw,
  Search,
  ServerCog,
  Settings2,
  ShieldCheck,
  Sparkles,
  Users,
  WalletCards,
  X,
  Zap,
} from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip as ChartTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { PivoMark } from "@/components/PivoMark";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useCloudEstimate } from "@/hooks/useCloudEstimate";
import { useCloudCatalog } from "@/hooks/useCloudCatalog";
import { useLaborCatalog } from "@/hooks/useLaborCatalog";
import { useLaborEstimate } from "@/hooks/useLaborEstimate";
import { useLicenseCatalog } from "@/hooks/useLicenseCatalog";
import { useMarketBenchmarkHistory, useMarketBenchmarkSearch } from "@/hooks/useMarketBenchmark";
import { useSystemHealth } from "@/hooks/useSystemHealth";
import type { ApiSourceResult, IngestionRun, LicenseCatalogItem, MarketBenchmarkSalarySource, QueryStat, SourceStatus } from "@/lib/api";

const heroAsset = "/manus-storage/pricing-engine-hero_b3241730.png";
const laborAsset = "/manus-storage/pricing-engine-labor_15768d4a.png";
const cloudAsset = "/manus-storage/pricing-engine-cloud_846255ee.png";

type SectionId = "dashboard" | "labor" | "cloud" | "licenses" | "proposals" | "sources";
type ServiceState = "live" | "warn" | "stale" | "offline";

const navigation = [
  { id: "dashboard" as SectionId, label: "Visão geral", short: "01", icon: LayoutDashboard },
  { id: "labor" as SectionId, label: "Mão de obra", short: "02", icon: Users },
  { id: "cloud" as SectionId, label: "Infra cloud", short: "03", icon: Cloud },
  { id: "licenses" as SectionId, label: "Licenças", short: "04", icon: KeyRound },
  { id: "proposals" as SectionId, label: "Propostas", short: "05", icon: FileChartColumnIncreasing },
];

function mapApiStatus(status: SourceStatus): ServiceState {
  if (status === "OPERATIONAL") return "live";
  if (status === "DEGRADED") return "warn";
  if (status === "FALLBACK_STALE") return "stale";
  return "offline";
}

function formatRelativeTime(iso: string | undefined): string {
  if (!iso) return "sem leitura";
  if (iso === "static-contingency") return "referência estática";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "agora mesmo";
  const diffMin = Math.round((Date.now() - date.getTime()) / 60_000);
  if (diffMin < 1) return "agora mesmo";
  if (diffMin < 60) return `há ${diffMin} min`;
  const diffH = Math.round(diffMin / 60);
  if (diffH < 24) return `há ${diffH} h`;
  return `há ${Math.round(diffH / 24)} d`;
}

function formatSourceDetail(source: ApiSourceResult): string {
  const data = source.data as Record<string, unknown> | null;
  if (data && typeof data.rate === "number") return `Cotação R$ ${(data.rate as number).toFixed(2)}`;
  if (data && typeof data.pricePerHourUsd === "number") return `US$ ${(data.pricePerHourUsd as number).toFixed(3)} / h`;
  return source.warning ?? `Fonte: ${source.source}`;
}

const trendData = [
  { month: "MAR", value: 182000 },
  { month: "ABR", value: 194000 },
  { month: "MAI", value: 210000 },
  { month: "JUN", value: 205000 },
  { month: "JUL", value: 238000 },
  { month: "AGO", value: 264000 },
];

const proposalRows = [
  { code: "PRJ-042", name: "Modernização de dados · Varejo Norte", scope: "Cloud + dados", total: "R$ 418.620", status: "Em revisão", tone: "coral" },
  { code: "PRJ-039", name: "Fábrica de software · Setor público", scope: "Mão de obra", total: "R$ 286.400", status: "Pronto para envio", tone: "sage" },
  { code: "PRJ-037", name: "FinOps contínuo · Operação Sul", scope: "Cloud + câmbio", total: "R$ 92.180", status: "Rascunho", tone: "ink" },
];

const brazilStates = [
  ["SP", "Sao Paulo"],
  ["RJ", "Rio de Janeiro"],
  ["MG", "Minas Gerais"],
  ["PR", "Parana"],
  ["SC", "Santa Catarina"],
  ["RS", "Rio Grande do Sul"],
  ["DF", "Distrito Federal"],
  ["BA", "Bahia"],
  ["PE", "Pernambuco"],
  ["CE", "Ceara"],
  ["GO", "Goias"],
  ["ES", "Espirito Santo"],
  ["MT", "Mato Grosso"],
  ["MS", "Mato Grosso do Sul"],
  ["PA", "Para"],
  ["AM", "Amazonas"],
  ["PB", "Paraiba"],
  ["RN", "Rio Grande do Norte"],
  ["AL", "Alagoas"],
  ["SE", "Sergipe"],
  ["PI", "Piaui"],
  ["MA", "Maranhao"],
  ["RO", "Rondonia"],
  ["AC", "Acre"],
  ["AP", "Amapa"],
  ["RR", "Roraima"],
  ["TO", "Tocantins"],
];

const formatBRL = (value: number, digits = 0) =>
  new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  }).format(value);

function ServiceBadge({ state, label }: { state: ServiceState; label?: string }) {
  const styles = {
    live: "bg-[#EBECEC] text-[#3F746D] border-[#BDD3D0]",
    warn: "bg-[#FAEFE2] text-[#C2660D] border-[#E8CBA9]",
    stale: "bg-[#F5EADD] text-[#956126] border-[#E3CA9E]",
    offline: "bg-[#FBEFE1] text-[#B0712A] border-[#EECFAB]",
  };
  const labels = { live: "Online", warn: "Instável", stale: "Cache local", offline: "Fora do ar" };
  return (
    <Badge variant="outline" className={`gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] ${styles[state]}`}>
      <span className={`status-dot ${state}`} />
      {label || labels[state]}
    </Badge>
  );
}

function SectionHeading({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: React.ReactNode }) {
  return (
    <div className="mb-7 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
      <div>
        <div className="mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-[#C2660D]">
          <span className="h-px w-6 bg-[#F57F17]" /> {eyebrow}
        </div>
        <h1 className="font-display text-3xl font-semibold tracking-[-0.04em] text-[#333333] sm:text-[40px]">{title}</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-[#658080]">{description}</p>
      </div>
      {action}
    </div>
  );
}

function Dashboard({
  onNavigate,
  sources,
  sourcesLoading,
}: {
  onNavigate: (section: SectionId) => void;
  sources: ApiSourceResult[];
  sourcesLoading: boolean;
}) {
  const degradedSource = sources.find((s) => s.status !== "OPERATIONAL");
  return (
    <>
      <section className="grain paper-grid relative mb-7 min-h-[300px] overflow-hidden rounded-[0.75rem] border-t-2 border-t-[#0D5C5C] bg-[#F7F2E8] shadow-paper">
        <div className="relative z-10 max-w-[54%] px-6 py-7 sm:px-10 sm:py-9 lg:max-w-[52%] lg:px-12 lg:py-12">
          <div className="mb-5 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-[#C2660D]"><span className="h-1.5 w-1.5 rounded-full bg-[#F57F17]" /> Briefing de precificação · 31 ago 2026</div>
          <h1 className="font-display max-w-xl text-[30px] font-semibold leading-[1.05] tracking-[-0.055em] text-[#333333] sm:text-[42px]">Preço defensável começa com contexto.</h1>
          <p className="mt-5 max-w-md text-sm leading-6 text-[#5F7474]">Quatro sinais operacionais já estão prontos para orientar a próxima estimativa. O estado de cada fonte acompanha o cálculo.</p>
          <div className="mt-7 flex flex-wrap gap-3">
            <Button onClick={() => onNavigate("proposals")} className="pressable h-10 rounded-full bg-[#F57F17] px-5 text-xs font-semibold text-white shadow-[0_8px_18px_rgba(232,91,69,.2)] hover:bg-[#D96D0C]">Abrir proposta <ArrowUpRight className="ml-2 h-4 w-4" /></Button>
            <Button onClick={() => onNavigate("labor")} variant="outline" className="pressable h-10 rounded-full border-[#C9C6C2] bg-[#F7F2E8]/80 px-5 text-xs font-semibold text-[#333333] hover:bg-white">Novo cálculo</Button>
          <div className="mt-7 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-[#D8D1C6] pt-3 text-[9px] font-semibold uppercase tracking-[0.16em] text-[#7D8D8D]"><span className="text-[#C2660D]">01</span> mão de obra <span className="text-[#C2660D]">02</span> cloud <span className="text-[#C2660D]">03</span> PTAX <span className="text-[#C2660D]">04</span> PNCP <span className="text-[#333333]">→ decisão</span></div>
          </div>
        </div>
        <div className="absolute inset-y-0 right-0 w-[56%] overflow-hidden sm:w-[51%]">
          <div className="absolute inset-0 z-10 bg-gradient-to-r from-[#F7F2E8] via-[#F7F2E8]/65 to-transparent" />
          <img src={heroAsset} alt="Fluxo abstrato de dados convergindo em um ponto de decisão" className="h-full w-full object-cover object-right opacity-90 mix-blend-multiply" />
          <div className="absolute bottom-6 right-7 z-20 hidden rounded-lg border border-white/40 bg-[#0D5C5C]/90 px-3 py-2 text-[10px] text-[#F7F2E8] shadow-xl sm:block"><span className="mr-2 inline-block h-1.5 w-1.5 rounded-full bg-[#85B9B2]" />4 fontes em uso</div>
        </div>
      </section>

      <div className="mb-7 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Margem média" value="27,4%" change="+2,1 pp" icon={Gauge} tone="coral" />
        <MetricCard label="Projetos em rascunho" value="08" change="3 atualizados hoje" icon={FilePlus2} tone="navy" />
        <MetricCard label="Fontes operacionais" value="04 / 05" change="1 em cache local" icon={ShieldCheck} tone="sage" />
        <MetricCard label="PTAX de referência" value="R$ 5,42" change="+0,8% na semana" icon={CircleDollarSign} tone="sand" />
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.65fr)_minmax(310px,.9fr)]">
        <Card className="fade-up overflow-hidden rounded-[0.75rem] border-t-2 border-t-[#0D5C5C] border-[#DDD7CC] bg-[#FBF7F1] p-5 shadow-paper sm:p-7">
          <div className="mb-6 flex items-start justify-between gap-3">
            <div><div className="mb-1 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-[#7A8787]"><BarChart3 className="h-3.5 w-3.5" /> Valor estimado · últimos 6 meses</div><h2 className="font-display text-xl font-semibold tracking-[-0.03em] text-[#333333]">Pipeline de propostas</h2></div>
            <button onClick={() => toast.info("Filtro de período disponível quando a API estiver conectada.")} className="pressable rounded-full border border-[#D6D3CF] p-2 text-[#687E7E] hover:bg-[#E9EAEA]" aria-label="Filtrar período"><MoreHorizontal className="h-4 w-4" /></button>
          </div>
          <div className="h-[230px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={trendData} margin={{ top: 8, right: 4, left: -20, bottom: 0 }}>
                <defs><linearGradient id="areaFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#F57F17" stopOpacity={0.28} /><stop offset="100%" stopColor="#F57F17" stopOpacity={0.02} /></linearGradient></defs>
                <CartesianGrid stroke="#E7E1D6" strokeDasharray="2 5" vertical={false} />
                <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fill: "#8B9696", fontSize: 10, fontFamily: "Inter" }} dy={10} />
                <YAxis axisLine={false} tickLine={false} tick={{ fill: "#8B9696", fontSize: 10, fontFamily: "Inter" }} tickFormatter={(v) => `${Math.round(v / 1000)}k`} />
                <ChartTooltip cursor={{ stroke: "#D8D0C1", strokeDasharray: "3 3" }} contentStyle={{ border: "1px solid #DDD7CC", borderRadius: 10, background: "#FBF7F1", fontSize: 12, boxShadow: "0 8px 22px rgba(22,38,61,.08)" }} formatter={(value) => [formatBRL(Number(value)), "Estimado"]} />
                <Area type="monotone" dataKey="value" stroke="#F57F17" strokeWidth={2.5} fill="url(#areaFill)" dot={{ r: 3.5, fill: "#FBF7F1", stroke: "#F57F17", strokeWidth: 2 }} activeDot={{ r: 5, fill: "#F57F17", stroke: "#FBF7F1", strokeWidth: 3 }} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-5 flex items-center justify-between border-t border-[#0D5C5C]/20 pt-4 text-xs"><span className="text-[#798A8A]">Total no período · origem: estimativas salvas</span><span className="font-display font-semibold text-[#333333]">R$ 1,29 mi <span className="ml-1 font-sans text-[10px] font-medium text-[#4F8A82]">↑ 18,6%</span></span></div>
        </Card>

        <Card className="fade-up rounded-2xl border-[#DDD7CC] bg-[#0D5C5C] p-5 text-[#F7F2E8] shadow-paper sm:p-7">
          <div className="mb-6 flex items-start justify-between"><div><div className="mb-1 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-[#AEC4C4]"><Zap className="h-3.5 w-3.5 text-[#F57F17]" /> Integridade operacional</div><h2 className="font-display text-xl font-semibold tracking-[-0.03em]">Fontes em uso</h2></div><button onClick={() => onNavigate("sources")} className="rounded-full p-2 text-[#B2C8C8] transition-colors hover:bg-white/10 hover:text-white" aria-label="Ver todas as fontes"><ChevronRight className="h-4 w-4" /></button></div>
          <div className="space-y-0">
            {sourcesLoading
              ? Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="flex items-center justify-between gap-3 border-b border-white/10 py-4 first:pt-0 last:border-0 last:pb-0">
                    <div className="min-w-0 flex-1"><Skeleton className="h-3.5 w-32 bg-white/10" /><Skeleton className="mt-2 h-3 w-40 bg-white/10" /></div>
                    <Skeleton className="h-6 w-20 rounded-full bg-white/10" />
                  </div>
                ))
              : sources.map((source) => <div key={source.name} className="flex items-center justify-between gap-3 border-b border-white/10 py-4 first:pt-0 last:border-0 last:pb-0"><div className="min-w-0"><p className="truncate text-sm font-medium text-white">{source.name}</p><p className="mt-1 truncate text-[11px] text-[#AEC4C4]">{formatSourceDetail(source)} · {formatRelativeTime(source.timestamp)}</p></div><ServiceBadge state={mapApiStatus(source.status)} /></div>)}
          </div>
          {degradedSource && <div className="mt-6 rounded-xl border border-white/10 bg-white/5 p-3 text-[11px] leading-5 text-[#B8CECE]"><span className="font-semibold text-[#F7F2E8]">Fallback ativo:</span> {degradedSource.warning ?? `${degradedSource.name} está em modo degradado.`}</div>}
        </Card>
      </div>

      <section className="mt-7">
        <div className="mb-4 flex items-center justify-between"><div><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#C2660D]">Próximas decisões</p><h2 className="mt-1 font-display text-xl font-semibold tracking-[-0.03em] text-[#333333]">Atalhos para o próximo cálculo</h2></div><button onClick={() => toast.info("A visão de todos os atalhos entra na próxima etapa do produto.")} className="text-xs font-semibold text-[#C2660D] hover:underline">Ver catálogo <ArrowUpRight className="ml-1 inline h-3.5 w-3.5" /></button></div>
        <div className="grid gap-4 md:grid-cols-3"><QuickAction number="01" title="Precificar mão de obra" description="CLT, PJ e Fator K em uma base comparável." asset={laborAsset} icon={Users} onClick={() => onNavigate("labor")} /><QuickAction number="02" title="Simular infraestrutura" description="SKU, região e câmbio com rastreabilidade." asset={cloudAsset} icon={CloudCog} onClick={() => onNavigate("cloud")} /><QuickAction number="03" title="Consolidar proposta" description="Reúna premissas, margem e origem dos dados." asset={null} icon={WalletCards} onClick={() => onNavigate("proposals")} /></div>
      </section>
    </>
  );
}

function MetricCard({ label, value, change, icon: Icon, tone }: { label: string; value: string; change: string; icon: React.ElementType; tone: "coral" | "navy" | "sage" | "sand" }) {
  const iconStyles = { coral: "bg-[#FAEEE0] text-[#C5863E]", navy: "bg-[#EBECED] text-[#366D6D]", sage: "bg-[#E9EAEB] text-[#4F7E78]", sand: "bg-[#F3EADB] text-[#9E703C]" };
  return <Card className="metric-card fade-up rounded-2xl border-[#DDD7CC] p-5"><div className="flex items-start justify-between"><span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#7B8B8B]">{label}</span><span className={`rounded-lg p-2 ${iconStyles[tone]}`}><Icon className="h-4 w-4" /></span></div><div className="mt-5 font-display text-[31px] font-semibold tracking-[-0.06em] text-[#333333]">{value}</div><div className="mt-1 flex items-center gap-1.5 text-[11px] text-[#728A8A]"><ArrowUpRight className="h-3 w-3 text-[#4F8A82]" /> {change}</div></Card>;
}

function QuickAction({ number, title, description, asset, icon: Icon, onClick }: { number: string; title: string; description: string; asset: string | null; icon: React.ElementType; onClick: () => void }) {
  return <button onClick={onClick} className="pressable group relative min-h-[154px] overflow-hidden rounded-[0.7rem] border border-t-2 border-t-[#0D5C5C] border-[#DDD7CC] bg-[#FBF7F1] p-5 text-left shadow-[0_10px_30px_rgba(22,38,61,.04)] transition-shadow hover:shadow-paper"><div className="relative z-10 flex h-full flex-col justify-between"><div className="flex items-center justify-between"><span className="font-display text-xs font-semibold text-[#F57F17]">{number}</span><Icon className="h-4 w-4 text-[#658080] transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" /></div><div><h3 className="font-display text-base font-semibold text-[#333333]">{title}</h3><p className="mt-1 max-w-[220px] text-xs leading-5 text-[#798A8A]">{description}</p></div></div>{asset && <img src={asset} alt="" className="absolute -bottom-5 -right-5 h-32 w-44 object-cover opacity-35 mix-blend-multiply transition-transform duration-200 group-hover:scale-105" />}</button>;
}

function LaborPricing() {
  const { data: catalogData, isLoading: catalogLoading } = useLaborCatalog();
  const { data: historyData } = useMarketBenchmarkHistory();
  const benchmarkSearch = useMarketBenchmarkSearch();
  const profiles = catalogData?.profiles ?? [];
  const [selectedProfileId, setSelectedProfileId] = useState("dev-senior-pj");
  const selectedProfile = profiles.find((profile) => profile.id === selectedProfileId) ?? profiles[0];
  const [monthlySalary, setMonthlySalary] = useState("");
  const [factorK, setFactorK] = useState("");
  const [margin, setMargin] = useState("22");
  const [benchmarkRole, setBenchmarkRole] = useState("Consultor SAP FI/CO senior");
  const [benchmarkState, setBenchmarkState] = useState("SP");
  const [benchmarkCity, setBenchmarkCity] = useState("Sao Paulo");
  const [benchmarkNotes, setBenchmarkNotes] = useState("");
  const salary = Number(monthlySalary || selectedProfile?.monthlyCompensation) || 0;
  const factor = Number(factorK || selectedProfile?.factorK) || 0;
  const { data: estimate, isFetching } = useLaborEstimate({ profileId: selectedProfile?.id, monthlySalary: salary, factorK: factor, marginPct: Number(margin) || 0 });
  const monthlyCost = estimate?.monthlyCost ?? 0;
  const hourlyCost = estimate?.hourlyCost ?? 0;
  const suggestedRate = estimate?.suggestedRate ?? 0;
  const sourceState = catalogData ? mapApiStatus(catalogData.source.status) : "stale";
  const benchmark = benchmarkSearch.data?.data ?? historyData?.entries[0];
  const benchmarkServiceState = benchmarkSearch.data ? mapApiStatus(benchmarkSearch.data.status) : "stale";
  const benchmarkHistory = historyData?.entries ?? [];

  const handleProfileChange = (profileId: string) => {
    const nextProfile = profiles.find((profile) => profile.id === profileId);
    setSelectedProfileId(profileId);
    setMonthlySalary(nextProfile ? String(nextProfile.monthlyCompensation) : "");
    setFactorK(nextProfile ? String(nextProfile.factorK) : "");
  };

  const handleBenchmarkSearch = () => {
    if (!benchmarkRole.trim()) {
      toast.error("Informe o cargo ou perfil para buscar benchmark.");
      return;
    }

    toast.promise(benchmarkSearch.mutateAsync({ role: benchmarkRole, state: benchmarkState, city: benchmarkCity, notes: benchmarkNotes }), {
      loading: "Buscando benchmark de mercado...",
      success: "Benchmark atualizado.",
      error: "Nao foi possivel buscar benchmark agora.",
    });
  };

  const applyBenchmarkSource = (source: MarketBenchmarkSalarySource) => {
    setSelectedProfileId(source.profileId);
    setMonthlySalary(String(source.monthlyCompensation));
    setFactorK(String(source.factorK));
    toast.success(`Perfil ${source.employmentModel} (${source.profileTitle}) aplicado ao calculo.`);
  };

  return <div>
    <SectionHeading eyebrow="Modulo 02 - Laboratorio" title="Mao de obra" description="Escolha um perfil profissional, revise remuneracao, Fator K e margem, depois leve a taxa-hora para a proposta." action={<Button onClick={() => toast.success("Calculo salvo como rascunho local.")} className="pressable rounded-full bg-[#0D5C5C] px-5 text-xs text-white hover:bg-[#275959]"><Check className="mr-2 h-4 w-4" /> Salvar simulacao</Button>} />
    <Card className="mb-5 rounded-2xl border-[#DDD7CC] bg-[#FBF7F1] p-5 shadow-paper sm:p-7"><div className="mb-5 flex items-start justify-between gap-4"><div><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#C2660D]">Benchmark de mercado</p><h2 className="mt-1 font-display text-xl font-semibold text-[#333333]">Busca por cargo e localidade</h2><p className="mt-1 max-w-2xl text-xs leading-5 text-[#658080]">Consulta o catalogo interno de perfis e retorna o salario CLT e/ou PJ correspondente ao cargo buscado, em valor bruto, sem margem, imposto ou ajuste regional nesta V1.</p></div><ServiceBadge state={benchmarkServiceState} /></div><div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_190px_180px]"><div><Label htmlFor="benchmark-role" className="text-xs font-semibold text-[#345555]">Cargo / perfil</Label><Input id="benchmark-role" value={benchmarkRole} onChange={(e) => setBenchmarkRole(e.target.value)} className="mt-2 h-10 border-[#D4D1CC] bg-white text-sm text-[#333333]" placeholder="ex: Consultor SAP FI/CO senior, foco fiscal" /></div><div><Label htmlFor="benchmark-state" className="text-xs font-semibold text-[#345555]">Estado</Label><select id="benchmark-state" value={benchmarkState} onChange={(e) => setBenchmarkState(e.target.value)} className="mt-2 h-10 w-full rounded-md border border-[#D4D1CC] bg-white px-3 text-sm text-[#333333] outline-none focus:border-[#F57F17] focus:ring-2 focus:ring-[#F57F17]/20">{brazilStates.map(([uf, name]) => <option key={uf} value={uf}>{uf} - {name}</option>)}</select></div><div><Label htmlFor="benchmark-city" className="text-xs font-semibold text-[#345555]">Cidade</Label><Input id="benchmark-city" value={benchmarkCity} onChange={(e) => setBenchmarkCity(e.target.value)} className="mt-2 h-10 border-[#D4D1CC] bg-white text-sm text-[#333333]" placeholder="Sao Paulo" /></div></div><div className="mt-4"><Label htmlFor="benchmark-notes" className="text-xs font-semibold text-[#345555]">Observacoes</Label><Input id="benchmark-notes" value={benchmarkNotes} onChange={(e) => setBenchmarkNotes(e.target.value)} className="mt-2 h-10 border-[#D4D1CC] bg-white text-sm text-[#333333]" placeholder="ex: espanhol, assessment de 3 a 5 meses, fiscal" /></div><div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center"><Button onClick={handleBenchmarkSearch} disabled={benchmarkSearch.isPending} className="pressable rounded-full bg-[#F57F17] px-5 text-xs text-white hover:bg-[#D96D0C]"><Search className="mr-2 h-4 w-4" /> Buscar benchmark</Button><span className="text-[11px] text-[#879A9A]">Salario de mercado nao e valor de venda. Use "Aplicar" numa fonte abaixo para levar o perfil ao calculo.</span></div>{benchmark && <div className="mt-6 grid gap-5 xl:grid-cols-[minmax(0,1fr)_260px]"><div><div className="mb-3 flex items-center justify-between gap-3"><p className="text-sm font-semibold text-[#333333]">{benchmark.roleSearched} - {benchmark.city}/{benchmark.state}</p><p className="font-display text-lg font-semibold text-[#C2660D]">{formatBRL(benchmark.suggestedMonthlyCompensation)}</p></div><p className="mb-4 text-xs leading-5 text-[#658080]">{benchmark.summary}</p><div className="overflow-hidden rounded-xl border border-[#E5E0D6]"><table className="w-full text-left text-xs"><thead className="bg-[#E8E9E9] text-[10px] uppercase tracking-[0.14em] text-[#7B8F8F]"><tr><th className="px-3 py-2 font-semibold">Fonte</th><th className="px-3 py-2 font-semibold">Salario mensal</th><th className="px-3 py-2 font-semibold">Observacao</th><th className="px-3 py-2 font-semibold" /></tr></thead><tbody>{benchmark.sources.length ? benchmark.sources.map((item) => <tr key={item.profileId} className="border-t border-[#E5E0D6] bg-white/50"><td className="px-3 py-3 font-semibold text-[#333333]">Salario {item.employmentModel}<span className="mt-0.5 block font-normal text-[10px] uppercase tracking-[0.1em] text-[#899A9A]">{item.profileTitle} - {item.seniority}</span></td><td className="px-3 py-3 font-mono text-[#2A675F]">{formatBRL(item.monthlyCompensation)}</td><td className="px-3 py-3 text-[#658080]">{item.observation}</td><td className="px-3 py-3 text-right"><button onClick={() => applyBenchmarkSource(item)} className="rounded-full border border-[#F0C48A] px-3 py-1 text-[11px] font-semibold text-[#C2660D] hover:bg-white">Aplicar</button></td></tr>) : <tr><td colSpan={4} className="px-3 py-3 text-[#899A9A]">Nenhum perfil do catalogo corresponde a este cargo ainda.</td></tr>}</tbody></table></div></div><div className="rounded-xl border border-[#E5E0D6] bg-white/45 p-4"><p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#C2660D]">Historico</p><div className="mt-3 space-y-2">{benchmarkHistory.length ? benchmarkHistory.slice(0, 4).map((entry) => <button key={entry.id} onClick={() => { setBenchmarkRole(entry.roleSearched); setBenchmarkState(entry.state ?? "SP"); setBenchmarkCity(entry.city); setBenchmarkNotes(entry.notes ?? ""); }} className="w-full rounded-lg border border-[#E5E0D6] bg-[#FBF7F1] p-3 text-left hover:border-[#F0C48A]"><p className="truncate text-xs font-semibold text-[#333333]">{entry.roleSearched}</p><p className="mt-1 text-[10px] text-[#879A9A]">{entry.city}/{entry.state ?? "BR"} - {formatRelativeTime(entry.generatedAt)}</p></button>) : <p className="text-xs text-[#879A9A]">Nenhuma consulta salva ainda.</p>}</div></div></div>}</Card>
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1.1fr)_minmax(320px,.9fr)]">
      <Card className="rounded-2xl border-[#DDD7CC] bg-[#FBF7F1] p-5 shadow-paper sm:p-7"><div className="mb-6 flex items-start justify-between gap-4"><div><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#C2660D]">Entrada de premissas</p><h2 className="mt-1 font-display text-xl font-semibold text-[#333333]">Perfil e composicao da taxa</h2></div><div className="rounded-lg bg-[#E8E9E9] p-2 text-[#5D7979]"><BriefcaseBusiness className="h-4 w-4" /></div></div>
        <div className="mb-6"><Label htmlFor="profile" className="text-xs font-semibold text-[#345555]">Perfil profissional</Label><select id="profile" value={selectedProfile?.id ?? selectedProfileId} onChange={(e) => handleProfileChange(e.target.value)} className="mt-2 h-11 w-full rounded-md border border-[#D4D1CC] bg-white px-3 text-sm text-[#333333] outline-none focus:border-[#F57F17] focus:ring-2 focus:ring-[#F57F17]/20" disabled={catalogLoading}>{catalogLoading ? <option>Carregando perfis...</option> : profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.title} - {profile.seniority} - {profile.employmentModel}</option>)}</select><p className="mt-1.5 text-[11px] text-[#879A9A]">CBO {selectedProfile?.cbo ?? "-"} - {selectedProfile?.benchmarkSource ?? "catalogo local"}</p></div>
        <div className="mb-6 grid gap-3 sm:grid-cols-3">{profiles.slice(0, 3).map((profile) => <button key={profile.id} onClick={() => handleProfileChange(profile.id)} className={`rounded-xl border p-3 text-left transition-colors ${selectedProfile?.id === profile.id ? "border-[#F57F17] bg-white" : "border-[#E5E0D6] bg-white/55 hover:border-[#F0C48A]"}`}><p className="text-[11px] font-semibold text-[#333333]">{profile.title}</p><p className="mt-1 text-[10px] uppercase tracking-[0.12em] text-[#899A9A]">{profile.seniority} - {profile.employmentModel}</p><p className="mt-3 font-display text-sm font-semibold text-[#C2660D]">{formatBRL(profile.monthlyCompensation)}</p></button>)}</div>
        <div className="grid gap-5 sm:grid-cols-2"><div><Label htmlFor="salary" className="text-xs font-semibold text-[#345555]">Remuneracao mensal</Label><div className="relative mt-2"><span className="absolute left-3 top-2.5 text-xs text-[#8A9797]">R$</span><Input id="salary" value={String(salary)} onChange={(e) => setMonthlySalary(e.target.value)} className="h-10 border-[#D4D1CC] bg-white pl-9 text-sm text-[#333333]" inputMode="numeric" /></div><p className="mt-1.5 text-[11px] text-[#879A9A]">Valor bruto do perfil selecionado, editavel</p></div><div><Label htmlFor="factor" className="text-xs font-semibold text-[#345555]">Fator K</Label><div className="relative mt-2"><Input id="factor" value={String(factor)} onChange={(e) => setFactorK(e.target.value)} className="h-10 border-[#D4D1CC] bg-white pr-12 text-sm text-[#333333]" inputMode="decimal" /><span className="absolute right-3 top-2.5 text-xs text-[#8A9797]">x</span></div><p className="mt-1.5 text-[11px] text-[#879A9A]">Encargos, beneficios, indiretos e risco contratual</p></div><div><Label htmlFor="margin" className="text-xs font-semibold text-[#345555]">Margem alvo</Label><div className="relative mt-2"><Input id="margin" value={margin} onChange={(e) => setMargin(e.target.value)} className="h-10 border-[#D4D1CC] bg-white pr-12 text-sm text-[#333333]" inputMode="numeric" /><span className="absolute right-3 top-2.5 text-xs text-[#8A9797]">%</span></div><p className="mt-1.5 text-[11px] text-[#879A9A]">Aplicada sobre o custo total</p></div><div><Label className="text-xs font-semibold text-[#345555]">Fonte do benchmark</Label><div className="mt-2 flex h-10 w-full items-center justify-between rounded-md border border-[#D4D1CC] bg-white px-3 text-left text-sm text-[#333333]"><span>CAGED / MTE - snapshot</span><ServiceBadge state={sourceState} /></div><p className="mt-1.5 text-[11px] text-[#879A9A]">{catalogData?.source.warning ?? "Consultando catalogo de perfis"}</p></div></div>
      </Card>
      <Card className="overflow-hidden rounded-2xl border-[#0D5C5C] bg-[#0D5C5C] p-5 text-[#F7F2E8] shadow-paper sm:p-7"><div className="flex items-start justify-between"><div><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#AEC4C4]">Saida do modelo</p><h2 className="mt-1 font-display text-xl font-semibold">Taxa-hora sugerida</h2></div><div className="rounded-lg bg-[#F57F17] p-2 text-white"><Calculator className="h-4 w-4" /></div></div>{isFetching && !estimate ? <Skeleton className="mt-10 h-12 w-44 bg-white/10" /> : <div className="mt-10 font-display text-5xl font-semibold tracking-[-0.06em] text-white">{formatBRL(suggestedRate)}</div>}<p className="mt-2 text-xs leading-5 text-[#AFC7C7]">por hora faturavel - {selectedProfile?.title ?? "perfil"} / {selectedProfile?.employmentModel ?? "-"}</p><div className="mt-9 space-y-3 border-t border-white/10 pt-5 text-xs"><div className="flex justify-between"><span className="text-[#AEC4C4]">Custo mensal carregado</span><strong className="font-medium text-[#F7F2E8]">{formatBRL(monthlyCost)}</strong></div><div className="flex justify-between"><span className="text-[#AEC4C4]">Custo-hora base</span><strong className="font-medium text-[#F7F2E8]">{formatBRL(hourlyCost)}</strong></div><div className="flex justify-between"><span className="text-[#AEC4C4]">Horas faturaveis</span><strong className="font-medium text-[#F7F2E8]">{estimate?.billableHours ?? 168} h/mes</strong></div><div className="flex justify-between"><span className="text-[#AEC4C4]">Margem aplicada</span><strong className="font-medium text-[#F57F17]">{margin}%</strong></div></div><div className="mt-8 rounded-xl border border-white/10 bg-white/5 p-3 text-[11px] leading-5 text-[#B8CECE]"><span className="font-semibold text-white">Nota de integridade:</span> perfis vindos do endpoint /labor/profiles. A fonte CAGED real ainda esta marcada como fallback ate a ingestao ser ligada.</div></Card>
    </div>
  </div>;
}

function CloudPricing() {
  const [provider, setProvider] = useState("AWS");
  const [region, setRegion] = useState("us-east-1");
  const [family, setFamily] = useState("General purpose");
  const [skuId, setSkuId] = useState("aws-m6i-large");
  const [instances, setInstances] = useState(12);
  const [hours, setHours] = useState(730);
  const { data: catalogData, isLoading: catalogLoading } = useCloudCatalog();
  const skus = catalogData?.skus.filter((sku) => sku.provider === provider) ?? [];
  const families = Array.from(new Set(skus.map((sku) => sku.family)));
  const filteredSkus = skus.filter((sku) => sku.family === family);
  const regions = catalogData?.regions.filter((item) => item.provider === provider) ?? [];
  const selectedSku = skus.find((sku) => sku.id === skuId) ?? filteredSkus[0] ?? skus[0];

  const { data, isFetching } = useCloudEstimate({ provider, region, skuId: selectedSku?.id ?? skuId, instances, hours });
  const monthly = data?.estimate.monthlyBrl ?? 0;
  const unitPriceUsd = data?.unitPrice.data?.pricePerHourUsd ?? 0;
  const fxRate = data?.fx.data?.rate ?? 0;
  const fxState = data ? mapApiStatus(data.fx.status) : "stale";
  const isDegraded = data ? data.unitPrice.status !== "OPERATIONAL" : false;
  const statusMessage = !data
    ? "Consultando fontes de preço…"
    : data.unitPrice.status === "OPERATIONAL"
      ? `Preço em tempo real via ${data.unitPrice.name}.`
      : (data.unitPrice.warning ?? `${data.unitPrice.name} está em modo degradado.`);
  const handleProviderChange = (nextProvider: string) => {
    const nextSkus = catalogData?.skus.filter((sku) => sku.provider === nextProvider) ?? [];
    setProvider(nextProvider);
    setFamily(nextSkus[0]?.family ?? "General purpose");
    setSkuId(nextSkus[0]?.id ?? "");
    setRegion("us-east-1");
  };

  return <div>
    <SectionHeading eyebrow="Modulo 03 - Infraestrutura" title="Infra cloud" description="Monte a cesta por provedor, familia, SKU e regiao. Azure consulta preco ao vivo; AWS e GCP ficam rastreados como snapshot oficial." action={<Button onClick={() => toast.success("Cesta de infraestrutura salva como rascunho local.")} className="pressable rounded-full bg-[#F57F17] px-5 text-xs text-white hover:bg-[#D96D0C]"><Check className="mr-2 h-4 w-4" /> Salvar cesta</Button>} />
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1.1fr)_minmax(320px,.9fr)]">
      <Card className="rounded-2xl border-[#DDD7CC] bg-[#FBF7F1] p-5 shadow-paper sm:p-7"><div className="mb-6 flex items-start justify-between gap-4"><div><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#C2660D]">Catalogo de compute</p><h2 className="mt-1 font-display text-xl font-semibold text-[#333333]">Parametros de infraestrutura</h2></div><img src={cloudAsset} alt="Ilustracao editorial de infraestrutura cloud" className="hidden h-20 w-28 rounded-xl object-cover mix-blend-multiply sm:block" /></div><div className="mb-6 grid grid-cols-3 gap-2 rounded-xl bg-[#E8E9E9] p-1">{["AWS", "Azure", "GCP"].map((item) => <button key={item} onClick={() => handleProviderChange(item)} className={`rounded-lg px-3 py-2.5 text-xs font-semibold transition-colors ${provider === item ? "bg-white text-[#333333] shadow-sm" : "text-[#7C8B8B] hover:text-[#333333]"}`}>{item}</button>)}</div><div className="grid gap-5 sm:grid-cols-2"><div><Label htmlFor="family" className="text-xs font-semibold text-[#345555]">Familia</Label><select id="family" value={family} onChange={(e) => { setFamily(e.target.value); setSkuId(skus.find((sku) => sku.family === e.target.value)?.id ?? ""); }} className="mt-2 h-10 w-full rounded-md border border-[#D4D1CC] bg-white px-3 text-sm text-[#333333] outline-none focus:border-[#F57F17] focus:ring-2 focus:ring-[#F57F17]/20" disabled={catalogLoading}>{families.map((item) => <option key={item} value={item}>{item}</option>)}</select><p className="mt-1.5 text-[11px] text-[#879A9A]">Filtra SKUs por perfil de workload</p></div><div><Label htmlFor="sku" className="text-xs font-semibold text-[#345555]">SKU</Label><select id="sku" value={selectedSku?.id ?? skuId} onChange={(e) => setSkuId(e.target.value)} className="mt-2 h-10 w-full rounded-md border border-[#D4D1CC] bg-white px-3 text-sm text-[#333333] outline-none focus:border-[#F57F17] focus:ring-2 focus:ring-[#F57F17]/20" disabled={catalogLoading}>{filteredSkus.map((sku) => <option key={sku.id} value={sku.id}>{sku.displayName}</option>)}</select><p className="mt-1.5 text-[11px] text-[#879A9A]">{selectedSku ? `${selectedSku.vcpu} vCPU / ${selectedSku.memoryGiB} GiB RAM` : "Carregando SKUs"}</p></div><div><Label htmlFor="region" className="text-xs font-semibold text-[#345555]">Regiao</Label><select id="region" value={region} onChange={(e) => setRegion(e.target.value)} className="mt-2 h-10 w-full rounded-md border border-[#D4D1CC] bg-white px-3 text-sm text-[#333333] outline-none focus:border-[#F57F17] focus:ring-2 focus:ring-[#F57F17]/20">{regions.map((item) => <option key={`${item.provider}-${item.key}`} value={item.key}>{item.key} - {item.label}</option>)}</select><p className="mt-1.5 text-[11px] text-[#879A9A]">Regiao normalizada para comparar provedores</p></div><div><Label className="text-xs font-semibold text-[#345555]">Fonte do preco</Label><div className="mt-2 flex h-10 w-full items-center justify-between rounded-md border border-[#D4D1CC] bg-white px-3 text-sm text-[#333333]"><span>{selectedSku?.sourceName ?? "Catalogo cloud"}</span><ServiceBadge state={data?.unitPrice.status === "OPERATIONAL" ? "live" : "stale"} /></div><p className="mt-1.5 text-[11px] text-[#879A9A]">{selectedSku?.notes ?? catalogData?.source.warning}</p></div></div><div className="mt-7 border-t border-[#E7E1D6] pt-6"><div className="mb-3 flex items-center justify-between"><Label htmlFor="instances" className="text-xs font-semibold text-[#345555]">Quantidade de instancias</Label><span className="font-display text-sm font-semibold text-[#333333]">{instances}</span></div><input id="instances" type="range" min="1" max="80" value={instances} onChange={(e) => setInstances(Number(e.target.value))} className="w-full accent-[#F57F17]" /><div className="mt-5 mb-3 flex items-center justify-between"><Label htmlFor="hours" className="text-xs font-semibold text-[#345555]">Horas por mes</Label><span className="font-display text-sm font-semibold text-[#333333]">{hours} h</span></div><input id="hours" type="range" min="100" max="744" step="10" value={hours} onChange={(e) => setHours(Number(e.target.value))} className="w-full accent-[#F57F17]" /></div></Card><Card className="overflow-hidden rounded-2xl border-[#DDD7CC] bg-[#E7E8E9] p-5 shadow-paper sm:p-7"><div className="flex items-start justify-between"><div><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#C2660D]">Estimativa mensal</p><h2 className="mt-1 font-display text-xl font-semibold text-[#333333]">Custo projetado</h2></div><div className="rounded-lg bg-[#0D5C5C] p-2 text-[#F7F2E8]"><Cloud className="h-4 w-4" /></div></div>{!data && isFetching ? <Skeleton className="mt-10 h-12 w-48" /> : <div className="mt-10 font-display text-5xl font-semibold tracking-[-0.06em] text-[#333333]">{formatBRL(monthly)}</div>}<div className="mt-2 flex items-center gap-2 text-xs text-[#687E7E]"><span className={`status-dot ${fxState}`} /> PTAX {fxRate ? fxRate.toFixed(2) : "-"} - {data ? formatRelativeTime(data.fx.timestamp) : "carregando"}</div><div className="mt-9 space-y-3 border-t border-[#D7CFC0] pt-5 text-xs"><div className="flex justify-between"><span className="text-[#778B8B]">SKU</span><strong className="font-medium text-[#333333]">{selectedSku?.skuName ?? "-"}</strong></div><div className="flex justify-between"><span className="text-[#778B8B]">Provedor / regiao</span><strong className="font-medium text-[#333333]">{provider} - {region}</strong></div><div className="flex justify-between"><span className="text-[#778B8B]">Preco unitario</span><strong className="font-medium text-[#333333]">US$ {unitPriceUsd.toFixed(4)} / h</strong></div><div className="flex justify-between"><span className="text-[#778B8B]">Instancias x horas</span><strong className="font-medium text-[#333333]">{instances} x {hours}</strong></div></div><div className="mt-8 flex items-center gap-2 rounded-xl border border-[#D7CFC0] bg-white/50 p-3 text-[11px] leading-5 text-[#667C7C]">{isDegraded ? <AlertTriangle className="h-4 w-4 shrink-0 text-[#B77831]" /> : <CheckCircle className="h-4 w-4 shrink-0 text-[#4F8A82]" />} {statusMessage}</div></Card></div>
  </div>;
}

function LicensesCatalog() {
  const { data, isLoading } = useLicenseCatalog();
  const [seatCounts, setSeatCounts] = useState<Record<string, number>>({});
  const [category, setCategory] = useState("Todos");
  const [vendor, setVendor] = useState("Todos");
  const items = data?.items ?? [];
  const categories = ["Todos", ...Array.from(new Set(items.map((item) => item.category)))];
  const vendors = ["Todos", ...Array.from(new Set(items.map((item) => item.vendor)))];
  const filteredItems = items.filter((item) => (category === "Todos" || item.category === category) && (vendor === "Todos" || item.vendor === vendor));
  const sourceState = data ? mapApiStatus(data.source.status) : "stale";

  const getQuantity = (item: LicenseCatalogItem) => Math.max(seatCounts[item.id] ?? item.minimumSeats, item.minimumSeats);
  const monthlyUsd = filteredItems.reduce((total, item) => total + item.unitPriceUsd * getQuantity(item), 0);

  return <div>
    <SectionHeading eyebrow="Modulo 04 - Catalogo" title="Licencas" description="Filtre planos SaaS por categoria e fornecedor, revise metrica de cobranca, fonte oficial e premissas antes de anexar a proposta." action={<Button onClick={() => toast.success("Catalogo de licencas anexado ao rascunho local.")} className="pressable rounded-full bg-[#0D5C5C] px-5 text-xs text-white hover:bg-[#275959]"><Check className="mr-2 h-4 w-4" /> Usar na proposta</Button>} />
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1.25fr)_minmax(300px,.75fr)]">
      <Card className="rounded-2xl border-[#DDD7CC] bg-[#FBF7F1] p-5 shadow-paper sm:p-7"><div className="mb-6 flex items-start justify-between gap-4"><div><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#C2660D]">Itens parametrizados</p><h2 className="mt-1 font-display text-xl font-semibold text-[#333333]">Catalogo comercial</h2></div><div className="rounded-lg bg-[#E8E9E9] p-2 text-[#5D7979]"><KeyRound className="h-4 w-4" /></div></div>
        <div className="mb-5 grid gap-3 sm:grid-cols-2"><div><Label htmlFor="license-category" className="text-xs font-semibold text-[#345555]">Categoria</Label><select id="license-category" value={category} onChange={(e) => setCategory(e.target.value)} className="mt-2 h-10 w-full rounded-md border border-[#D4D1CC] bg-white px-3 text-sm text-[#333333] outline-none focus:border-[#F57F17] focus:ring-2 focus:ring-[#F57F17]/20">{categories.map((item) => <option key={item} value={item}>{item}</option>)}</select></div><div><Label htmlFor="license-vendor" className="text-xs font-semibold text-[#345555]">Fornecedor</Label><select id="license-vendor" value={vendor} onChange={(e) => setVendor(e.target.value)} className="mt-2 h-10 w-full rounded-md border border-[#D4D1CC] bg-white px-3 text-sm text-[#333333] outline-none focus:border-[#F57F17] focus:ring-2 focus:ring-[#F57F17]/20">{vendors.map((item) => <option key={item} value={item}>{item}</option>)}</select></div></div>
        <div className="space-y-3">{isLoading ? Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-24 w-full rounded-xl" />) : filteredItems.map((item) => { const quantity = getQuantity(item); return <div key={item.id} className="grid gap-4 rounded-xl border border-[#E5E0D6] bg-white/55 p-4 md:grid-cols-[minmax(0,1fr)_120px_150px] md:items-center"><div><div className="flex flex-wrap items-center gap-2"><span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#C2660D]">{item.vendor}</span><Badge variant="outline" className="rounded-full border-[#D4D1CC] bg-[#F7F2E8] px-2 py-0.5 text-[10px] text-[#667C7C]">{item.category}</Badge><span className="text-[10px] uppercase tracking-[0.12em] text-[#899A9A]">{item.billingCycle === "annual-paid-monthly" ? "anual pago mensal" : "mensal"}</span></div><h3 className="mt-1 text-sm font-semibold text-[#333333]">{item.product} - {item.plan}</h3><p className="mt-1 text-[11px] text-[#7B8F8F]">US$ {item.unitPriceUsd.toFixed(2)} por {item.billingMetric} - minimo {item.minimumSeats}</p><p className="mt-1 text-[11px] text-[#7B8F8F]">{item.notes}</p>{item.sourceUrl && <a className="mt-2 inline-flex text-[11px] font-semibold text-[#C2660D] hover:underline" href={item.sourceUrl} target="_blank" rel="noreferrer">Fonte oficial</a>}</div><div><Label htmlFor={`license-${item.id}`} className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#7B8F8F]">Quantidade</Label><Input id={`license-${item.id}`} value={String(quantity)} onChange={(e) => setSeatCounts((current) => ({ ...current, [item.id]: Number(e.target.value) || item.minimumSeats }))} className="mt-1 h-9 border-[#D4D1CC] bg-white text-sm text-[#333333]" inputMode="numeric" /></div><div className="text-left md:text-right"><p className="text-[10px] uppercase tracking-[0.12em] text-[#899A9A]">Subtotal mensal</p><p className="mt-1 font-display text-lg font-semibold text-[#333333]">US$ {(item.unitPriceUsd * quantity).toFixed(2)}</p></div></div>; })}</div>
      </Card>
      <Card className="overflow-hidden rounded-2xl border-[#DDD7CC] bg-[#E7E8E9] p-5 shadow-paper sm:p-7"><div className="flex items-start justify-between"><div><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#C2660D]">Resumo</p><h2 className="mt-1 font-display text-xl font-semibold text-[#333333]">Custo mensal</h2></div><div className="rounded-lg bg-[#0D5C5C] p-2 text-[#F7F2E8]"><WalletCards className="h-4 w-4" /></div></div><div className="mt-10 font-display text-5xl font-semibold tracking-[-0.06em] text-[#333333]">US$ {monthlyUsd.toFixed(0)}</div><p className="mt-2 text-xs text-[#687E7E]">{filteredItems.length} de {items.length} itens exibidos</p><div className="mt-9 space-y-3 border-t border-[#D7CFC0] pt-5 text-xs"><div className="flex justify-between"><span className="text-[#778B8B]">Categoria</span><strong className="font-medium text-[#333333]">{category}</strong></div><div className="flex justify-between"><span className="text-[#778B8B]">Fornecedor</span><strong className="font-medium text-[#333333]">{vendor}</strong></div><div className="flex justify-between"><span className="text-[#778B8B]">Fonte</span><strong className="font-medium text-[#333333]">{data?.source.name ?? "Catalogo"}</strong></div><div className="flex justify-between"><span className="text-[#778B8B]">Estado</span><ServiceBadge state={sourceState} /></div><div className="flex justify-between"><span className="text-[#778B8B]">Atualizacao</span><strong className="font-medium text-[#333333]">{formatRelativeTime(data?.source.timestamp)}</strong></div></div><div className="mt-8 flex items-center gap-2 rounded-xl border border-[#D7CFC0] bg-white/50 p-3 text-[11px] leading-5 text-[#667C7C]"><AlertTriangle className="h-4 w-4 shrink-0 text-[#B77831]" /> {data?.source.warning ?? "Catalogo local carregando."}</div></Card>
    </div>
  </div>;
}

function Proposals() {
  return <div><SectionHeading eyebrow="Módulo 04 · Entrega" title="Propostas" description="Uma fila curta para transformar os cálculos em entregáveis. Cada registro preserva premissas e o estado das fontes no momento da simulação." action={<Button onClick={() => toast.success("Novo rascunho criado localmente.")} className="pressable rounded-full bg-[#F57F17] px-5 text-xs text-white hover:bg-[#D96D0C]"><FilePlus2 className="mr-2 h-4 w-4" /> Nova proposta</Button>} /><Card className="rounded-2xl border-[#DDD7CC] bg-[#FBF7F1] p-5 shadow-paper sm:p-7"><div className="mb-5 flex flex-col justify-between gap-3 sm:flex-row sm:items-center"><div><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#C2660D]">Fila de trabalho</p><h2 className="mt-1 font-display text-xl font-semibold text-[#333333]">Rascunhos recentes</h2></div><button onClick={() => toast.info("Filtros avançados entram com a persistência das propostas.")} className="flex items-center gap-2 self-start rounded-full border border-[#D4D1CC] px-3 py-2 text-xs font-semibold text-[#536D6D] hover:bg-white"><Search className="h-3.5 w-3.5" /> Filtrar</button></div><div className="space-y-3">{proposalRows.map((row) => <div key={row.code} className="group flex flex-col gap-4 rounded-xl border border-[#E5E0D6] bg-white/55 p-4 transition-colors hover:border-[#F0C48A] sm:flex-row sm:items-center sm:justify-between"><div className="flex items-start gap-3"><div className="mt-0.5 rounded-lg bg-[#E8E9E9] p-2 text-[#6F8686]"><FileChartColumnIncreasing className="h-4 w-4" /></div><div><div className="flex flex-wrap items-center gap-2"><span className="font-display text-xs font-semibold text-[#C2660D]">{row.code}</span><span className="text-[10px] uppercase tracking-[0.12em] text-[#9AA4A4]">{row.scope}</span></div><h3 className="mt-1 text-sm font-semibold text-[#333333]">{row.name}</h3></div></div><div className="flex items-center justify-between gap-4 sm:justify-end"><div className="text-right"><p className="font-display text-sm font-semibold text-[#333333]">{row.total}</p><p className="mt-1 text-[10px] text-[#899A9A]">{row.status}</p></div><button onClick={() => toast.info(`Abrindo ${row.code} em modo de revisão.`)} className="rounded-full p-2 text-[#7E9393] opacity-100 transition-colors hover:bg-[#E8E9E9] hover:text-[#333333] sm:opacity-0 sm:group-hover:opacity-100" aria-label={`Abrir ${row.code}`}><ChevronRight className="h-4 w-4" /></button></div></div>)}</div></Card></div>;
}

function SourcesView({
  sources,
  isLoading,
  onRefresh,
  ingestion,
  database,
}: {
  sources: ApiSourceResult[];
  isLoading: boolean;
  onRefresh: () => Promise<unknown>;
  ingestion: IngestionRun[];
  database?: { configured: boolean; queries: QueryStat[] };
}) {
  const handleRefresh = () => {
    toast.promise(onRefresh(), {
      loading: "Consultando fontes…",
      success: "Estado das fontes atualizado.",
      error: "Não foi possível atualizar agora.",
    });
  };
  return <div><SectionHeading eyebrow="Observabilidade · Resiliência" title="Fontes e integridade" description="Cada card reflete o retorno real do backend: circuit breaker, retry exponencial, cache local e fallback estático, sem esconder a procedência do dado." action={<Button onClick={handleRefresh} variant="outline" className="pressable rounded-full border-[#C9C6C2] bg-transparent px-5 text-xs text-[#333333] hover:bg-white"><RefreshCw className="mr-2 h-4 w-4" /> Atualizar fontes</Button>} /><div className="grid gap-4 sm:grid-cols-2">{isLoading
    ? Array.from({ length: 4 }).map((_, i) => <Card key={i} className="rounded-2xl border-[#DDD7CC] bg-[#FBF7F1] p-5 shadow-paper"><Skeleton className="h-8 w-8 rounded-lg" /><Skeleton className="mt-6 h-5 w-32" /><Skeleton className="mt-2 h-3 w-40" /></Card>)
    : sources.map((source) => <Card key={source.name} className="rounded-2xl border-[#DDD7CC] bg-[#FBF7F1] p-5 shadow-paper"><div className="flex items-start justify-between"><div className="rounded-lg bg-[#E8E9E9] p-2 text-[#5D7979]"><Database className="h-4 w-4" /></div><ServiceBadge state={mapApiStatus(source.status)} /></div><h2 className="mt-6 font-display text-lg font-semibold text-[#333333]">{source.name}</h2><p className="mt-1 text-xs text-[#788D8D]">{formatSourceDetail(source)}</p><div className="mt-5 flex items-center justify-between border-t border-[#E7E1D6] pt-4 text-[11px]"><span className="text-[#899A9A]">Última leitura</span><span className="font-medium text-[#4B6767]">{formatRelativeTime(source.timestamp)}</span></div></Card>)}</div><Card className="mt-5 rounded-2xl border-[#DDD7CC] bg-[#0D5C5C] p-5 text-[#F7F2E8] shadow-paper sm:p-7"><div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-center"><div><div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-[#AEC4C4]"><ServerCog className="h-3.5 w-3.5 text-[#F57F17]" /> Camadas de proteção</div><h2 className="mt-2 font-display text-xl font-semibold">Circuit breaker · Retry · Cache · Fallback</h2><p className="mt-2 max-w-xl text-xs leading-5 text-[#AEC4C4]">A experiência de erro não interrompe o analista: ela explica o que mudou, qual fonte está sendo usada e quando revisar o cálculo.</p></div><div className="grid grid-cols-4 gap-2 text-center text-[10px] text-[#C7D7D7] sm:w-[310px]">{["01", "02", "03", "04"].map((step, index) => <div key={step}><div className={`mx-auto flex h-9 w-9 items-center justify-center rounded-full border ${index === 2 ? "border-[#F57F17] bg-[#F57F17] text-white" : "border-white/20 bg-white/5"} font-display font-semibold`}>{step}</div><p className="mt-2">{["Circuit", "Retry", "Cache", "Fallback"][index]}</p></div>)}</div></div></Card>
    <Card className="mt-5 rounded-2xl border-[#DDD7CC] bg-[#FBF7F1] p-5 shadow-paper sm:p-7"><div className="mb-4 flex items-center justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#C2660D]">Carga em banco · cron a cada 5 dias</p><h2 className="mt-1 font-display text-xl font-semibold text-[#333333]">Ingestão periódica</h2></div><Badge variant="outline" className="rounded-full border-[#D4D1CC] bg-white px-2.5 py-1 text-[10px] text-[#667C7C]">{database?.configured ? "Postgres conectado" : "Postgres não configurado"}</Badge></div>{ingestion.length ? <div className="overflow-hidden rounded-xl border border-[#E5E0D6]"><table className="w-full text-left text-xs"><thead className="bg-[#E8E9E9] text-[10px] uppercase tracking-[0.14em] text-[#7B8F8F]"><tr><th className="px-3 py-2 font-semibold">Serviço</th><th className="px-3 py-2 font-semibold">Estado</th><th className="px-3 py-2 font-semibold">Registros</th><th className="px-3 py-2 font-semibold">Duração</th><th className="px-3 py-2 font-semibold">Última execução</th></tr></thead><tbody>{ingestion.map((run) => <tr key={run.serviceName} className="border-t border-[#E5E0D6] bg-white/50"><td className="px-3 py-3 font-semibold text-[#333333]">{run.serviceName}{run.errorMessage && <span className="mt-0.5 block max-w-xs truncate font-normal text-[10px] text-[#B0712A]" title={run.errorMessage}>{run.errorMessage}</span>}</td><td className="px-3 py-3"><ServiceBadge state={mapApiStatus(run.status)} /></td><td className="px-3 py-3 font-mono text-[#2A675F]">{run.recordsUpserted}</td><td className="px-3 py-3 text-[#658080]">{run.durationMs} ms</td><td className="px-3 py-3 text-[#658080]">{formatRelativeTime(run.finishedAt)}</td></tr>)}</tbody></table></div> : <p className="text-xs text-[#879A9A]">Nenhuma execução registrada ainda. O cron do GitHub Actions roda a ingestão a cada 5 dias (ou dispare manualmente via `workflow_dispatch`).</p>}</Card>
    {database?.queries?.length ? <Card className="mt-5 rounded-2xl border-[#DDD7CC] bg-[#FBF7F1] p-5 shadow-paper sm:p-7"><div className="mb-4"><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#C2660D]">Observabilidade · Postgres</p><h2 className="mt-1 font-display text-xl font-semibold text-[#333333]">Consultas ao banco (desde o último deploy)</h2></div><div className="overflow-hidden rounded-xl border border-[#E5E0D6]"><table className="w-full text-left text-xs"><thead className="bg-[#E8E9E9] text-[10px] uppercase tracking-[0.14em] text-[#7B8F8F]"><tr><th className="px-3 py-2 font-semibold">Consulta</th><th className="px-3 py-2 font-semibold">Execuções</th><th className="px-3 py-2 font-semibold">Média</th><th className="px-3 py-2 font-semibold">Máxima</th><th className="px-3 py-2 font-semibold">Erros</th></tr></thead><tbody>{database.queries.map((stat) => <tr key={stat.name} className="border-t border-[#E5E0D6] bg-white/50"><td className="px-3 py-3 font-mono text-[#333333]">{stat.name}</td><td className="px-3 py-3 text-[#658080]">{stat.count}</td><td className="px-3 py-3 text-[#658080]">{stat.avgMs} ms</td><td className="px-3 py-3 text-[#658080]">{stat.maxMs} ms</td><td className="px-3 py-3">{stat.errorCount > 0 ? <span className="font-semibold text-[#B0712A]">{stat.errorCount}</span> : <span className="text-[#899A9A]">0</span>}</td></tr>)}</tbody></table></div></Card> : null}
  </div>;
}

export default function Home() {
  const [activeSection, setActiveSection] = useState<SectionId>("dashboard");
  const [mobileOpen, setMobileOpen] = useState(false);
  const activeLabel = useMemo(() => navigation.find((item) => item.id === activeSection)?.label || "Fontes", [activeSection]);
  const navigate = (section: SectionId) => { setActiveSection(section); setMobileOpen(false); window.scrollTo({ top: 0, behavior: "smooth" }); };
  const { data: healthData, isLoading: sourcesLoading, refetch: refetchHealth } = useSystemHealth();
  const sources = healthData?.sources ?? [];
  const onlineCount = sources.filter((s) => s.status === "OPERATIONAL").length;
  const sourcesSummary = sourcesLoading ? "Consultando fontes…" : `${onlineCount} de ${sources.length} fontes online`;
  const renderContent = () => { if (activeSection === "labor") return <LaborPricing />; if (activeSection === "cloud") return <CloudPricing />; if (activeSection === "licenses") return <LicensesCatalog />; if (activeSection === "proposals") return <Proposals />; if (activeSection === "sources") return <SourcesView sources={sources} isLoading={sourcesLoading} onRefresh={refetchHealth} ingestion={healthData?.ingestion ?? []} database={healthData?.database} />; return <Dashboard onNavigate={navigate} sources={sources} sourcesLoading={sourcesLoading} />; };
  return <div className="min-h-screen bg-[#E8E9E9] text-[#333333]"><div className="flex min-h-screen"><aside className="nav-rail sticky top-0 hidden h-screen w-[242px] shrink-0 flex-col lg:flex"><div className="flex items-center gap-3 px-6 py-7"><PivoMark size={36} /><div><p className="font-display text-lg font-semibold leading-none tracking-[-0.04em]">Pivô</p><p className="mt-1 text-[9px] uppercase tracking-[0.22em] text-[#9EB9B9]">strategic pricing</p></div></div><div className="mx-6 mb-6 h-px bg-white/10" /><div className="px-4"><p className="mb-3 px-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-[#819F9F]">Workspace</p><nav className="space-y-1">{navigation.map((item) => { const Icon = item.icon; const active = item.id === activeSection; return <button key={item.id} onClick={() => navigate(item.id)} className={`group flex w-full items-center gap-3 rounded-xl border-l-2 px-3 py-3 text-left transition-colors ${active ? "border-[#F57F17] bg-white/10 text-white" : "border-transparent text-[#AEC4C4] hover:bg-white/8 hover:text-white"}`}><Icon className={`h-4 w-4 ${active ? "text-white" : "text-[#819F9F] group-hover:text-[#F57F17]"}`} /><span className="text-xs font-medium">{item.label}</span><span className={`ml-auto font-display text-[10px] ${active ? "text-white/70" : "text-[#648686]"}`}>{item.short}</span></button>; })}</nav></div><div className="mt-auto px-4 pb-5"><button onClick={() => navigate("sources")} className={`mb-4 flex w-full items-center gap-3 rounded-xl border px-3 py-3 text-left transition-colors ${activeSection === "sources" ? "border-white/20 bg-white/10" : "border-white/10 hover:bg-white/5"}`}><div className="relative flex h-8 w-8 items-center justify-center rounded-lg bg-[#E9EAEB] text-[#4F7E78]"><ShieldCheck className="h-4 w-4" /><span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-[#78A49E] ring-2 ring-[#0D5C5C]" /></div><div><p className="text-xs font-semibold text-white">Sistema estável</p><p className="mt-0.5 text-[10px] text-[#8DA8A8]">{sourcesSummary}</p></div></button><div className="flex items-center justify-between border-t border-white/10 pt-4"><div className="flex items-center gap-2"><div className="flex h-7 w-7 items-center justify-center rounded-full bg-[#C7E5E5] font-display text-[10px] font-semibold text-[#333333]">MR</div><span className="text-[11px] font-medium text-[#D8E4E4]">Marina R.</span></div><button onClick={() => toast.info("Preferências de conta disponíveis na próxima etapa.")} className="rounded p-1.5 text-[#819F9F] hover:bg-white/10 hover:text-white" aria-label="Configurações"><Settings2 className="h-4 w-4" /></button></div></div></aside><div className="min-w-0 flex-1"><header className="sticky top-0 z-30 border-b border-[#DED8CE] bg-[#E8E9E9]/90 backdrop-blur-xl"><div className="container flex h-[72px] items-center justify-between gap-4"><div className="flex items-center gap-3"><button className="rounded-lg border border-[#D6D3CF] bg-[#F7F2E8] p-2 lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Abrir menu"><Menu className="h-4 w-4" /></button><div className="hidden items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-[#929C9C] sm:flex"><span>Workspace</span><ChevronRight className="h-3 w-3" /><span className="text-[#436D6D]">{activeLabel}</span></div><div className="sm:hidden"><p className="font-display text-sm font-semibold text-[#333333]">{activeLabel}</p><p className="text-[9px] uppercase tracking-[0.16em] text-[#929C9C]">Pivô · pricing intelligence</p></div></div><div className="flex items-center gap-2"><button onClick={() => toast.info("Busca global pronta para receber seus comandos.")} className="hidden items-center gap-2 rounded-full border border-[#D6D3CF] bg-[#F7F2E8] px-3 py-2 text-xs text-[#839292] transition-colors hover:border-[#C6B29C] hover:text-[#333333] md:flex"><Search className="h-3.5 w-3.5" /> Buscar <span className="ml-2 rounded border border-[#D4D1CC] px-1.5 py-0.5 font-display text-[9px]">⌘ K</span></button><button onClick={() => toast.info("Nenhuma nova notificação.")} className="relative rounded-full p-2 text-[#667E7E] hover:bg-[#E6E1D7]" aria-label="Notificações"><Bell className="h-[17px] w-[17px]" /><span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-[#F57F17]" /></button><Button onClick={() => navigate("proposals")} className="pressable hidden h-9 rounded-full bg-[#0D5C5C] px-4 text-xs font-semibold text-[#F7F2E8] hover:bg-[#275959] sm:flex"><FilePlus2 className="mr-2 h-3.5 w-3.5" /> Nova proposta</Button></div></div></header><main className="container py-7 sm:py-9 lg:py-11">{renderContent()}</main><footer className="container flex flex-col gap-2 border-t border-[#DCD6CC] py-5 text-[10px] text-[#929C9C] sm:flex-row sm:items-center sm:justify-between"><span>Pivô · camada de decisão para preços de TI</span><span className="flex items-center gap-2"><span className="status-dot live" /> BACEN PTAX + Azure Retail API em tempo real</span></footer></div></div>{mobileOpen && <div className="fixed inset-0 z-50 lg:hidden"><button className="absolute inset-0 bg-[#0D5C5C]/50 backdrop-blur-sm" onClick={() => setMobileOpen(false)} aria-label="Fechar menu" /><aside className="nav-rail relative flex h-full w-[282px] flex-col shadow-2xl"><div className="flex items-center justify-between px-6 py-7"><div className="flex items-center gap-3"><PivoMark size={36} /><div><p className="font-display text-lg font-semibold leading-none">Pivô</p><p className="mt-1 text-[9px] uppercase tracking-[0.22em] text-[#9EB9B9]">strategic pricing</p></div></div><button onClick={() => setMobileOpen(false)} className="rounded p-2 text-[#AEC4C4] hover:bg-white/10" aria-label="Fechar"><X className="h-4 w-4" /></button></div><div className="mx-6 mb-6 h-px bg-white/10" /><div className="px-4"><p className="mb-3 px-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-[#819F9F]">Workspace</p><nav className="space-y-1">{navigation.map((item) => { const Icon = item.icon; const active = item.id === activeSection; return <button key={item.id} onClick={() => navigate(item.id)} className={`group flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left ${active ? "border-l-2 border-[#F57F17] bg-white/10 text-white" : "border-l-2 border-transparent text-[#AEC4C4] hover:bg-white/8 hover:text-white"}`}><Icon className="h-4 w-4" /><span className="text-xs font-medium">{item.label}</span><span className="ml-auto font-display text-[10px] opacity-60">{item.short}</span></button>; })}<button onClick={() => navigate("sources")} className={`group flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left ${activeSection === "sources" ? "bg-[#F57F17] text-white" : "text-[#AEC4C4] hover:bg-white/8 hover:text-white"}`}><Database className="h-4 w-4" /><span className="text-xs font-medium">Fontes</span></button></nav></div></aside></div>}</div>;
}
