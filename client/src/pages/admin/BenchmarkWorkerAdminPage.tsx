import { useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, ClipboardList, Clock3, ExternalLink, Landmark, Search, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useBenchmarkRuns,
  useBenchmarkSources,
  useCreateManualObservation,
  useOpenSources,
  useOpenSourceTriggers,
  useRoleLookup,
} from "@/hooks/useBenchmarkWorker";
import type { BenchmarkRun, OpenSourceTrigger } from "@/lib/api";

// Mesmas 27 UFs da V1 (benchmark-worker/src/benchmark_worker/normalization/states.py) --
// mantidas em sincronia manualmente com o backend, os dois lados sao pequenos e estaveis.
const BRAZILIAN_STATES: Array<[string, string]> = [
  ["SP", "São Paulo"], ["RJ", "Rio de Janeiro"], ["MG", "Minas Gerais"], ["PR", "Paraná"],
  ["SC", "Santa Catarina"], ["RS", "Rio Grande do Sul"], ["DF", "Distrito Federal"], ["BA", "Bahia"],
  ["PE", "Pernambuco"], ["CE", "Ceará"], ["GO", "Goiás"], ["ES", "Espírito Santo"], ["MT", "Mato Grosso"],
  ["MS", "Mato Grosso do Sul"], ["PA", "Pará"], ["AM", "Amazonas"], ["PB", "Paraíba"],
  ["RN", "Rio Grande do Norte"], ["AL", "Alagoas"], ["SE", "Sergipe"], ["PI", "Piauí"],
  ["MA", "Maranhão"], ["RO", "Rondônia"], ["AC", "Acre"], ["AP", "Amapá"], ["RR", "Roraima"], ["TO", "Tocantins"],
];

const SOURCE_LABELS: Record<string, string> = { indeed: "Indeed", glassdoor: "Glassdoor", infojobs: "InfoJobs", manual: "Manual" };

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function formatBRL(value: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(value);
}

function daysSince(iso: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000));
}

interface PrefillTarget {
  roleTitle: string;
  seniority: string;
  state: string;
}

export default function BenchmarkWorkerAdminPage() {
  const [prefill, setPrefill] = useState<PrefillTarget | null>(null);

  return (
    <div>
      <div className="mb-7">
        <div className="mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-[#C2660D]">
          <span className="h-px w-6 bg-[#F57F17]" /> Administração
        </div>
        <h1 className="font-display text-3xl font-semibold tracking-[-0.04em] text-[#333333] sm:text-[40px]">Benchmark worker</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-[#658080]">
          Coleta de referências salariais de mercado (cargo/senioridade/UF), independente da aplicação. Mesmo conceito da seção
          Mão de obra: duas pesquisas de mercado, uma na <strong>base pública do governo</strong> (CAGED/SISP, automatizada) e
          outra em <strong>base aberta</strong> — hoje só a Robert Half atende aos critérios de uso (pública, sem cadastro, sem
          restrição de reuso identificada nos termos); Salary.com, Mercer e Aon foram avaliadas e descartadas.
        </p>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <SourcesCard />
        <RunsCard />
      </div>

      <RoleLookupSection />

      <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1.3fr)_minmax(300px,.9fr)]">
        <ManualEntryCard prefill={prefill} onPrefillConsumed={() => setPrefill(null)} />
        <OpenSourceTriggersCard onSelect={setPrefill} />
      </div>
    </div>
  );
}

function SourcesCard() {
  const { data: sources, isLoading } = useBenchmarkSources();

  return (
    <Card className="rounded-2xl border-[#DDD7CC] bg-[#FBF7F1] p-5 shadow-paper">
      <h2 className="font-display text-lg font-semibold text-[#333333]">Fontes</h2>
      {isLoading ? (
        <div className="mt-3 space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10 w-full rounded-lg" />)}</div>
      ) : (
        <div className="mt-3 space-y-2">
          {sources?.map((source) => (
            <div key={source.name} className="flex items-start justify-between gap-3 rounded-lg border border-[#E5E0D6] bg-white/55 p-3">
              <div>
                <p className="text-xs font-semibold text-[#333333]">{SOURCE_LABELS[source.name] ?? source.name}</p>
                {source.disabled_reason && <p className="mt-1 max-w-md text-[11px] leading-4 text-[#899A9A]">{source.disabled_reason}</p>}
              </div>
              <Badge
                variant="outline"
                className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] ${
                  source.status === "enabled" ? "border-[#BDD3D0] bg-[#EBECEC] text-[#3F746D]" : "border-[#D4D1CC] bg-white text-[#899A9A]"
                }`}
              >
                {source.status === "enabled" ? "Habilitada" : "Desabilitada"}
              </Badge>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function RunStatusIcon({ status }: { status: BenchmarkRun["status"] }) {
  if (status === "success") return <CheckCircle2 className="h-4 w-4 text-[#4F8A82]" />;
  if (status === "partial") return <AlertTriangle className="h-4 w-4 text-[#C2660D]" />;
  return <XCircle className="h-4 w-4 text-[#B0453A]" />;
}

function RunsCard() {
  const { data: runs, isLoading } = useBenchmarkRuns();

  return (
    <Card className="rounded-2xl border-[#DDD7CC] bg-[#FBF7F1] p-5 shadow-paper">
      <h2 className="font-display text-lg font-semibold text-[#333333]">Execuções recentes</h2>
      {isLoading ? (
        <div className="mt-3 space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-14 w-full rounded-lg" />)}</div>
      ) : !runs || runs.length === 0 ? (
        <div className="mt-4 flex flex-col items-center gap-2 py-6 text-center">
          <ClipboardList className="h-8 w-8 text-[#9EB4B4]" />
          <p className="text-xs text-[#899A9A]">Nenhuma execução registrada ainda.</p>
        </div>
      ) : (
        <div className="mt-3 space-y-2">
          {runs.map((run) => (
            <div key={run.id} className="rounded-lg border border-[#E5E0D6] bg-white/55 p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <RunStatusIcon status={run.status} />
                  <span className="text-xs font-semibold text-[#333333]">
                    {run.triggered_by === "manual" ? "Manual" : "Agendada"}
                  </span>
                </div>
                <span className="text-[11px] text-[#899A9A]">{new Date(run.finished_at).toLocaleString("pt-BR")}</span>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {run.source_summary.map((item, i) => (
                  <span key={i} className="rounded-full border border-[#E5E0D6] bg-[#FBF7F1] px-2 py-0.5 text-[10px] text-[#658080]">
                    {SOURCE_LABELS[item.source] ?? item.source}: {item.status} ({item.observations})
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function RoleLookupSection() {
  const [roleInput, setRoleInput] = useState("");
  const [stateInput, setStateInput] = useState("");
  const [searched, setSearched] = useState<{ role: string; state: string | null } | null>(null);
  const lookup = useRoleLookup(searched?.role ?? "", searched?.state ?? null);

  const handleSearch = () => {
    if (!roleInput.trim()) {
      toast.error("Informe o cargo para consultar.");
      return;
    }
    setSearched({ role: roleInput.trim(), state: stateInput || null });
  };

  const result = lookup.data;

  return (
    <Card className="mt-5 rounded-2xl border-[#DDD7CC] bg-[#FBF7F1] p-5 shadow-paper sm:p-7">
      <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#C2660D]">Pesquisa salarial</p>
      <h2 className="mt-1 font-display text-xl font-semibold text-[#333333]">Consultar por cargo</h2>
      <p className="mt-1 max-w-2xl text-xs leading-5 text-[#658080]">
        Digite um cargo e veja a visão de cada base: o que já está automatizado (governo) e o que foi registrado manualmente
        (base aberta), lado a lado, com a média dos pontos reais encontrados nas duas.
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_180px_auto]">
        <Input
          value={roleInput}
          onChange={(e) => setRoleInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSearch()}
          placeholder="ex: Analista de BI"
          className="h-10 border-[#D4D1CC] bg-white text-sm text-[#333333]"
        />
        <select value={stateInput} onChange={(e) => setStateInput(e.target.value)} className="h-10 rounded-md border border-[#D4D1CC] bg-white px-3 text-sm text-[#333333] outline-none focus:border-[#F57F17] focus:ring-2 focus:ring-[#F57F17]/20">
          <option value="">Nacional</option>
          {BRAZILIAN_STATES.map(([uf, name]) => <option key={uf} value={uf}>{uf} - {name}</option>)}
        </select>
        <Button onClick={handleSearch} disabled={lookup.isFetching} className="pressable h-10 rounded-full bg-[#F57F17] px-5 text-xs font-semibold text-white hover:bg-[#D96D0C]">
          <Search className="mr-2 h-4 w-4" /> Buscar
        </Button>
      </div>

      {lookup.isFetching && <div className="mt-5 space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12 w-full rounded-lg" />)}</div>}

      {result && !lookup.isFetching && (
        <div className="mt-5">
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-xl border border-[#E5E0D6] bg-white/55 p-4">
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#C2660D]">Pesquisa na base pública do governo</p>
              <p className="mt-1 text-[11px] leading-5 text-[#899A9A]">CAGED/SISP — 100% automatizada, sem entrada manual.</p>
              {result.government.length ? (
                <div className="mt-3 space-y-2">
                  {result.government.map((profile) => (
                    <div key={`${profile.id}-${profile.employmentModel}`} className="rounded-lg border border-[#E5E0D6] bg-[#FBF7F1] p-3">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs font-semibold text-[#333333]">{profile.title} · {profile.seniority} · {profile.employmentModel}</p>
                        <span className="font-display text-sm font-semibold text-[#C2660D]">{formatBRL(profile.monthlyCompensation)}</span>
                      </div>
                      <p className="mt-1 text-[10px] text-[#899A9A]">
                        {profile.sourceStatus === "OPERATIONAL" ? `${profile.observed?.source} — dado observado` : "Estimativa do catálogo (sem observação real)"}
                      </p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-3 text-xs text-[#899A9A]">Nenhum perfil do catálogo corresponde a este cargo.</p>
              )}
            </div>

            <div className="rounded-xl border border-[#E5E0D6] bg-white/55 p-4">
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#C2660D]">Pesquisa em base aberta</p>
              <p className="mt-1 text-[11px] leading-5 text-[#899A9A]">Registrado manualmente a partir de guias públicos (ex.: Robert Half).</p>
              {result.openResults.length ? (
                <div className="mt-3 space-y-2">
                  {result.openResults.map((item) => (
                    <div key={item.id} className="rounded-lg border border-[#E5E0D6] bg-[#FBF7F1] p-3">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs font-semibold text-[#333333]">{item.role_title}{item.seniority ? ` · ${item.seniority}` : ""}{item.state ? ` · ${item.state}` : ""}</p>
                        <span className="font-display text-sm font-semibold text-[#C2660D]">{formatBRL(Number(item.salary_min))} - {formatBRL(Number(item.salary_max))}</span>
                      </div>
                      <div className="mt-1 flex items-center justify-between text-[10px] text-[#899A9A]">
                        <span>Observado em {new Date(item.observed_at).toLocaleDateString("pt-BR")}</span>
                        {item.open_source_url && (
                          <a href={item.open_source_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold text-[#C2660D] hover:underline">
                            {item.open_source_label ?? "Fonte"} <ExternalLink className="h-3 w-3" />
                          </a>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-3 text-xs text-[#899A9A]">Nenhuma observação manual registrada para este cargo ainda.</p>
              )}
            </div>
          </div>

          {result.average !== null ? (
            <div className="mt-4 rounded-xl border border-[#0D5C5C] bg-[#0D5C5C] p-4 text-[#F7F2E8]">
              <div className="flex items-center justify-between gap-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#AEC4C4]">Média das bases</p>
                <span className="font-display text-2xl font-semibold">{formatBRL(result.average)}</span>
              </div>
              <div className="mt-3 space-y-1 border-t border-white/10 pt-3 text-[11px] text-[#B8CECE]">
                {result.points.map((point, i) => (
                  <div key={i} className="flex items-center justify-between gap-3">
                    <span className="truncate">{point.base === "governo" ? "Governo" : "Aberta"} · {point.label}</span>
                    <span className="shrink-0 font-mono">{formatBRL(point.value)}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p className="mt-4 text-xs text-[#899A9A]">Nenhum dado real (observado) encontrado em nenhuma das bases para calcular uma média.</p>
          )}
        </div>
      )}
    </Card>
  );
}

function OpenSourceTriggersCard({ onSelect }: { onSelect: (target: PrefillTarget) => void }) {
  const { data: triggers, isLoading } = useOpenSourceTriggers();

  return (
    <Card className="rounded-2xl border-[#DDD7CC] bg-[#FBF7F1] p-5 shadow-paper">
      <div className="flex items-center gap-2">
        <Clock3 className="h-4 w-4 text-[#C2660D]" />
        <h2 className="font-display text-lg font-semibold text-[#333333]">Pendências de reavaliação</h2>
      </div>
      <p className="mt-1 text-xs leading-5 text-[#658080]">
        Gerado a cada 10 dias por um cron que só compara datas no banco — nunca acessa a Robert Half automaticamente (o ToS
        deles proíbe scraping). Um admin decide se reabre a página e registra um valor novo.
      </p>
      {isLoading ? (
        <div className="mt-3 space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-14 w-full rounded-lg" />)}</div>
      ) : !triggers || triggers.length === 0 ? (
        <div className="mt-4 flex flex-col items-center gap-2 py-6 text-center">
          <Landmark className="h-8 w-8 text-[#9EB4B4]" />
          <p className="text-xs text-[#899A9A]">Nenhuma pendência no momento.</p>
        </div>
      ) : (
        <div className="mt-3 space-y-2">
          {triggers.map((trigger: OpenSourceTrigger) => (
            <div key={trigger.job_id} className="rounded-lg border border-[#E5E0D6] bg-white/55 p-3">
              <p className="text-xs font-semibold text-[#333333]">{trigger.role_title}{trigger.seniority ? ` · ${trigger.seniority}` : ""}{trigger.state ? ` · ${trigger.state}` : ""}</p>
              <div className="mt-1 flex items-center justify-between gap-2">
                <span className="text-[10px] text-[#899A9A]">Sem reavaliação há {daysSince(trigger.requested_at)} dia(s)</span>
                <button
                  onClick={() => onSelect({ roleTitle: trigger.role_title, seniority: trigger.seniority ?? "", state: trigger.state ?? "" })}
                  className="rounded-full border border-[#F0C48A] px-3 py-1 text-[11px] font-semibold text-[#C2660D] hover:bg-white"
                >
                  Registrar observação
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function ManualEntryCard({ prefill, onPrefillConsumed }: { prefill: PrefillTarget | null; onPrefillConsumed: () => void }) {
  const [roleTitle, setRoleTitle] = useState(prefill?.roleTitle ?? "");
  const [seniority, setSeniority] = useState(prefill?.seniority ?? "");
  const [state, setState] = useState(prefill?.state ?? "");
  const [regime, setRegime] = useState<"clt" | "pj" | "unknown">("unknown");
  const [salaryMin, setSalaryMin] = useState("");
  const [salaryMax, setSalaryMax] = useState("");
  const [currency, setCurrency] = useState<"brl" | "usd">("brl");
  const [periodicity, setPeriodicity] = useState<"monthly" | "annual">("monthly");
  const [observedAt, setObservedAt] = useState(todayIso());
  const [openSource, setOpenSource] = useState("");
  const { data: openSources, isLoading: openSourcesLoading } = useOpenSources();
  const createManualObservation = useCreateManualObservation();

  // Aplica o prefill vindo de "Pendências de reavaliação" quando ele muda -- sem useEffect: o
  // valor só precisa ser lido uma vez, no clique que gera o prefill novo.
  const [appliedPrefill, setAppliedPrefill] = useState(prefill);
  if (prefill && prefill !== appliedPrefill) {
    setAppliedPrefill(prefill);
    setRoleTitle(prefill.roleTitle);
    setSeniority(prefill.seniority);
    setState(prefill.state);
    onPrefillConsumed();
  }

  const handleSubmit = () => {
    const min = Number(salaryMin);
    const max = Number(salaryMax);

    if (!roleTitle.trim()) {
      toast.error("Informe o cargo.");
      return;
    }
    if (!openSource) {
      toast.error("Selecione a fonte aberta consultada.");
      return;
    }
    if (!Number.isFinite(min) || !Number.isFinite(max) || min <= 0 || max <= 0) {
      toast.error("Informe valores de salário válidos.");
      return;
    }
    if (min > max) {
      toast.error("O valor mínimo não pode ser maior que o máximo.");
      return;
    }

    toast.promise(
      createManualObservation.mutateAsync({
        roleTitle: roleTitle.trim(),
        seniority: seniority.trim() || null,
        state: state || null,
        regime,
        salaryMin: min,
        salaryMax: max,
        currency,
        periodicity,
        observedAt,
        openSource,
      }),
      {
        loading: "Registrando observação...",
        success: () => {
          setRoleTitle("");
          setSeniority("");
          setSalaryMin("");
          setSalaryMax("");
          return "Observação registrada.";
        },
        error: (err) => (err instanceof Error ? err.message : "Não foi possível registrar agora."),
      },
    );
  };

  return (
    <Card className="rounded-2xl border-[#DDD7CC] bg-[#FBF7F1] p-5 shadow-paper">
      <h2 className="font-display text-lg font-semibold text-[#333333]">Registrar observação — base aberta</h2>
      <p className="mt-1 max-w-2xl text-xs leading-5 text-[#658080]">
        Para um valor lido diretamente numa fonte pública já aprovada. A fonte não é mais um campo livre: escolha na lista —
        cada item já traz a URL exata que foi avaliada quanto a cadastro/paywall e termos de uso.
      </p>

      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div>
          <Label className="text-xs font-semibold text-[#345555]">Cargo</Label>
          <Input value={roleTitle} onChange={(e) => setRoleTitle(e.target.value)} placeholder="Analista de BI" className="mt-2 h-10 border-[#D4D1CC] bg-white text-sm text-[#333333]" />
        </div>
        <div>
          <Label className="text-xs font-semibold text-[#345555]">Senioridade</Label>
          <select value={seniority} onChange={(e) => setSeniority(e.target.value)} className="mt-2 h-10 w-full rounded-md border border-[#D4D1CC] bg-white px-3 text-sm text-[#333333] outline-none focus:border-[#F57F17] focus:ring-2 focus:ring-[#F57F17]/20">
            <option value="">Não informada</option>
            <option value="Estágio">Estágio</option>
            <option value="Júnior">Júnior</option>
            <option value="Pleno">Pleno</option>
            <option value="Sênior">Sênior</option>
            <option value="Especialista">Especialista</option>
          </select>
        </div>
        <div>
          <Label className="text-xs font-semibold text-[#345555]">UF</Label>
          <select value={state} onChange={(e) => setState(e.target.value)} className="mt-2 h-10 w-full rounded-md border border-[#D4D1CC] bg-white px-3 text-sm text-[#333333] outline-none focus:border-[#F57F17] focus:ring-2 focus:ring-[#F57F17]/20">
            <option value="">Nacional</option>
            {BRAZILIAN_STATES.map(([uf, name]) => <option key={uf} value={uf}>{uf} - {name}</option>)}
          </select>
        </div>
        <div>
          <Label className="text-xs font-semibold text-[#345555]">Regime</Label>
          <select value={regime} onChange={(e) => setRegime(e.target.value as typeof regime)} className="mt-2 h-10 w-full rounded-md border border-[#D4D1CC] bg-white px-3 text-sm text-[#333333] outline-none focus:border-[#F57F17] focus:ring-2 focus:ring-[#F57F17]/20">
            <option value="unknown">Desconhecido</option>
            <option value="clt">CLT</option>
            <option value="pj">PJ</option>
          </select>
        </div>
        <div>
          <Label className="text-xs font-semibold text-[#345555]">Salário mínimo</Label>
          <Input type="number" min="0" value={salaryMin} onChange={(e) => setSalaryMin(e.target.value)} placeholder="Ex.: 10000" className="mt-2 h-10 border-[#D4D1CC] bg-white text-sm text-[#333333]" />
        </div>
        <div>
          <Label className="text-xs font-semibold text-[#345555]">Salário máximo</Label>
          <Input type="number" min="0" value={salaryMax} onChange={(e) => setSalaryMax(e.target.value)} placeholder="Ex.: 15000" className="mt-2 h-10 border-[#D4D1CC] bg-white text-sm text-[#333333]" />
        </div>
        <div>
          <Label className="text-xs font-semibold text-[#345555]">Moeda</Label>
          <select value={currency} onChange={(e) => setCurrency(e.target.value as typeof currency)} className="mt-2 h-10 w-full rounded-md border border-[#D4D1CC] bg-white px-3 text-sm text-[#333333] outline-none focus:border-[#F57F17] focus:ring-2 focus:ring-[#F57F17]/20">
            <option value="brl">BRL</option>
            <option value="usd">USD</option>
          </select>
        </div>
        <div>
          <Label className="text-xs font-semibold text-[#345555]">Periodicidade</Label>
          <select value={periodicity} onChange={(e) => setPeriodicity(e.target.value as typeof periodicity)} className="mt-2 h-10 w-full rounded-md border border-[#D4D1CC] bg-white px-3 text-sm text-[#333333] outline-none focus:border-[#F57F17] focus:ring-2 focus:ring-[#F57F17]/20">
            <option value="monthly">Mensal</option>
            <option value="annual">Anual</option>
          </select>
        </div>
        <div>
          <Label className="text-xs font-semibold text-[#345555]">Data da observação</Label>
          <Input type="date" value={observedAt} onChange={(e) => setObservedAt(e.target.value)} className="mt-2 h-10 border-[#D4D1CC] bg-white text-sm text-[#333333]" />
        </div>
        <div className="sm:col-span-2 lg:col-span-3">
          <Label className="text-xs font-semibold text-[#345555]">Fonte</Label>
          <select
            value={openSource}
            onChange={(e) => setOpenSource(e.target.value)}
            disabled={openSourcesLoading}
            className="mt-2 h-10 w-full rounded-md border border-[#D4D1CC] bg-white px-3 text-sm text-[#333333] outline-none focus:border-[#F57F17] focus:ring-2 focus:ring-[#F57F17]/20"
          >
            <option value="">{openSourcesLoading ? "Carregando..." : "Selecione a fonte"}</option>
            {openSources?.map((source) => <option key={source.name} value={source.name}>{source.label}</option>)}
          </select>
          {openSource && openSources?.find((s) => s.name === openSource) && (
            <a
              href={openSources.find((s) => s.name === openSource)!.url}
              target="_blank"
              rel="noreferrer"
              className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-semibold text-[#C2660D] hover:underline"
            >
              Abrir página da fonte <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>
      </div>

      <div className="mt-5 flex justify-end">
        <Button onClick={handleSubmit} disabled={createManualObservation.isPending} className="pressable rounded-full bg-[#F57F17] px-5 text-xs font-semibold text-white hover:bg-[#D96D0C]">
          Registrar observação
        </Button>
      </div>
    </Card>
  );
}
