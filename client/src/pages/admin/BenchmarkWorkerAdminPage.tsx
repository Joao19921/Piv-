import { useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, ClipboardList, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useBenchmarkRuns, useBenchmarkSources, useCreateManualObservation } from "@/hooks/useBenchmarkWorker";
import type { BenchmarkRun } from "@/lib/api";

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

export default function BenchmarkWorkerAdminPage() {
  return (
    <div>
      <div className="mb-7">
        <div className="mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-[#C2660D]">
          <span className="h-px w-6 bg-[#F57F17]" /> Administração
        </div>
        <h1 className="font-display text-3xl font-semibold tracking-[-0.04em] text-[#333333] sm:text-[40px]">Benchmark worker</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-[#658080]">
          Coleta de referências salariais de mercado (cargo/senioridade/UF), independente da aplicação. Indeed, Glassdoor e
          InfoJobs seguem sem automação autorizada — o único jeito de alimentar dados aqui hoje é o registro manual abaixo, a
          partir de uma fonte pública legítima (ex.: guia salarial de TI da Robert Half, sem cadastro).
        </p>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <SourcesCard />
        <RunsCard />
      </div>

      <ManualEntryCard />
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

function ManualEntryCard() {
  const [roleTitle, setRoleTitle] = useState("");
  const [seniority, setSeniority] = useState("");
  const [state, setState] = useState("");
  const [regime, setRegime] = useState<"clt" | "pj" | "unknown">("unknown");
  const [salaryMin, setSalaryMin] = useState("");
  const [salaryMax, setSalaryMax] = useState("");
  const [currency, setCurrency] = useState<"brl" | "usd">("brl");
  const [periodicity, setPeriodicity] = useState<"monthly" | "annual">("monthly");
  const [observedAt, setObservedAt] = useState(todayIso());
  const [sourceReference, setSourceReference] = useState("");
  const createManualObservation = useCreateManualObservation();

  const handleSubmit = () => {
    const min = Number(salaryMin);
    const max = Number(salaryMax);

    if (!roleTitle.trim()) {
      toast.error("Informe o cargo.");
      return;
    }
    if (!sourceReference.trim()) {
      toast.error("Informe a referência da fonte consultada (URL ou nome exato do relatório).");
      return;
    }
    const allowedSourcePattern = /roberthalf\.com|salary\.com|mercer\.com|aon\.com|robert half|salary\.com|mercer|aon|total remuneration survey/i;
    if (!allowedSourcePattern.test(sourceReference.trim())) {
      toast.error("Fonte bloqueada: use uma referência pública autorizada e legítima (ex.: Robert Half, Salary.com, Mercer ou Aon). URLs genéricas ou lead-gen não são permitidas.");
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
        sourceReference: sourceReference.trim(),
      }),
      {
        loading: "Registrando observação...",
        success: () => {
          setRoleTitle("");
          setSeniority("");
          setSalaryMin("");
          setSalaryMax("");
          setSourceReference("");
          return "Observação registrada.";
        },
        error: (err) => (err instanceof Error ? err.message : "Não foi possível registrar agora."),
      },
    );
  };

  return (
    <Card className="mt-5 rounded-2xl border-[#DDD7CC] bg-[#FBF7F1] p-5 shadow-paper">
      <h2 className="font-display text-lg font-semibold text-[#333333]">Registrar observação manual</h2>
      <p className="mt-1 max-w-3xl text-xs leading-5 text-[#658080]">
        Use apenas fontes públicas e institucionalmente autorizadas para benchmark salarial, como Robert Half, Salary.com,
        Mercer ou Aon. URLs genéricas, lead-gen ou páginas que exigem cadastro para liberar o dado não são permitidas.
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
          <Input type="number" min="0" value={salaryMin} onChange={(e) => setSalaryMin(e.target.value)} placeholder="10000" className="mt-2 h-10 border-[#D4D1CC] bg-white text-sm text-[#333333]" />
        </div>
        <div>
          <Label className="text-xs font-semibold text-[#345555]">Salário máximo</Label>
          <Input type="number" min="0" value={salaryMax} onChange={(e) => setSalaryMax(e.target.value)} placeholder="15000" className="mt-2 h-10 border-[#D4D1CC] bg-white text-sm text-[#333333]" />
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
          <Label className="text-xs font-semibold text-[#345555]">Referência da fonte (permitido: Robert Half, Salary.com, Mercer, Aon)</Label>
          <Input
            value={sourceReference}
            onChange={(e) => setSourceReference(e.target.value)}
            placeholder="https://www.roberthalf.com/br/pt/insights/guia-salarial/tecnologia"
            className="mt-2 h-10 border-[#D4D1CC] bg-white text-sm text-[#333333]"
          />
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
