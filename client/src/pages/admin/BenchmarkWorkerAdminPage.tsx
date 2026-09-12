import { useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, ClipboardList, Search, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useBenchmarkRuns, useBenchmarkSources, useRoleLookup } from "@/hooks/useBenchmarkWorker";
import type { BenchmarkRun, GovernmentProfileResult } from "@/lib/api";

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

function formatBRL(value: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(value);
}

const SENIORITY_ORDER = ["Júnior", "Pleno", "Sênior", "Especialista"];

interface GovernmentMatrixRow {
  seniority: string;
  clt: GovernmentProfileResult | null;
  pj: GovernmentProfileResult | null;
}

interface GovernmentMatrixGroup {
  title: string;
  rows: GovernmentMatrixRow[];
}

/** Agrupa os perfis casados por título e monta uma linha por senioridade, com CLT e PJ lado a
 * lado -- a maioria dos cargos do catálogo só tem um dos dois regimes cadastrado (a Portaria SISP
 * referencia serviço contratado, não os dois regimes do mesmo cargo), então a célula sem dado
 * mostra "—" em vez de inventar ou esconder a ausência. */
function buildGovernmentMatrix(profiles: GovernmentProfileResult[]): GovernmentMatrixGroup[] {
  const byTitle = new Map<string, Map<string, { clt: GovernmentProfileResult | null; pj: GovernmentProfileResult | null }>>();
  for (const profile of profiles) {
    if (!byTitle.has(profile.title)) byTitle.set(profile.title, new Map());
    const bySeniority = byTitle.get(profile.title)!;
    if (!bySeniority.has(profile.seniority)) bySeniority.set(profile.seniority, { clt: null, pj: null });
    const cell = bySeniority.get(profile.seniority)!;
    if (profile.employmentModel === "CLT") cell.clt = profile;
    else cell.pj = profile;
  }
  return [...byTitle.entries()].map(([title, bySeniority]) => ({
    title,
    rows: SENIORITY_ORDER.filter((seniority) => bySeniority.has(seniority)).map((seniority) => ({ seniority, ...bySeniority.get(seniority)! })),
  }));
}

function GovernmentMatrixCell({ profile }: { profile: GovernmentProfileResult | null }) {
  if (!profile) return <span className="text-[#C7C2B8]">—</span>;
  return (
    <div>
      <span className="font-mono text-[#2A675F]">{formatBRL(profile.monthlyCompensation)}</span>
      <span className="block text-[9px] uppercase tracking-[0.08em] text-[#899A9A]">
        {profile.sourceStatus === "OPERATIONAL" ? profile.observed?.source ?? "observado" : "estimativa"}
      </span>
    </div>
  );
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
          Coleta de referências salariais de mercado (cargo/senioridade/UF), independente da aplicação. A busca abaixo consulta
          a <strong>base pública do governo</strong> (CAGED/SISP) — 100% automatizada, sem entrada manual.
        </p>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <SourcesCard />
        <RunsCard />
      </div>

      <RoleLookupSection />
      <OpenSourceNote />
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
        Digite um cargo e veja o valor pago por senioridade e regime (CLT/PJ), direto da base pública do governo (CAGED/SISP).
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
          {result.government.length ? (
            <div className="space-y-3">
              {buildGovernmentMatrix(result.government).map((group) => (
                <div key={group.title} className="rounded-lg border border-[#E5E0D6] bg-white/55 p-3">
                  <p className="text-xs font-semibold text-[#333333]">{group.title}</p>
                  <table className="mt-2 w-full text-left text-[11px]">
                    <thead>
                      <tr className="text-[#899A9A]">
                        <th className="pb-1 font-medium">Senioridade</th>
                        <th className="pb-1 font-medium">CLT</th>
                        <th className="pb-1 font-medium">PJ</th>
                      </tr>
                    </thead>
                    <tbody>
                      {group.rows.map((row) => (
                        <tr key={row.seniority} className="border-t border-[#E5E0D6]">
                          <td className="py-1.5 pr-2 font-semibold text-[#345555]">{row.seniority}</td>
                          <td className="py-1.5 pr-2"><GovernmentMatrixCell profile={row.clt} /></td>
                          <td className="py-1.5"><GovernmentMatrixCell profile={row.pj} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-[#899A9A]">Nenhum perfil do catálogo corresponde a este cargo.</p>
          )}
        </div>
      )}
    </Card>
  );
}

/** Só um aviso informativo -- não é mais uma seção funcional. Ate 2026-09-12 esta tela permitia
 * registrar manualmente uma observação da base aberta (guias públicos de terceiros, ex. Robert
 * Half); removido porque a única forma de coletar isso é um humano ler a página e digitar --
 * automatizar violaria o ToS dessas fontes -- e o produto decidiu não sustentar esse fluxo. */
function OpenSourceNote() {
  return (
    <Card className="mt-5 rounded-2xl border-[#DDD7CC] bg-[#FBF7F1] p-5 shadow-paper">
      <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#C2660D]">Base aberta</p>
      <p className="mt-2 max-w-2xl text-xs leading-5 text-[#658080]">
        Guias salariais públicos de terceiros (ex.: Robert Half) não têm alimentação automática hoje — nenhuma dessas fontes
        tem API oficial autorizada, e automatizar a leitura da página violaria os Termos de Uso delas. Sem um jeito legítimo
        de coletar isso, esta seção fica só como referência do conceito até que uma fonte com API oficial exista.
      </p>
    </Card>
  );
}
