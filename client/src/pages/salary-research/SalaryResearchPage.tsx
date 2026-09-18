import { useState } from "react";
import { AlertCircle, Search, Users } from "lucide-react";
import { toast } from "sonner";
import { fetchLaborProfiles, type LaborProfile } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type EmploymentModel = "CLT" | "PJ";

const formatBRL = (value: number) =>
  new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0,
  }).format(value);

function matchesRole(profile: LaborProfile, role: string) {
  const terms = role.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return terms.every((term) => profile.title.toLowerCase().includes(term));
}

export default function SalaryResearchPage() {
  const [role, setRole] = useState("");
  const [state, setState] = useState("");
  const [city, setCity] = useState("");
  const [employmentModel, setEmploymentModel] = useState<EmploymentModel>("CLT");
  const [notes, setNotes] = useState("");
  const [profiles, setProfiles] = useState<LaborProfile[]>([]);
  const [searched, setSearched] = useState(false);
  const [loading, setLoading] = useState(false);

  const sources = profiles.filter(
    (profile) => profile.employmentModel === employmentModel && matchesRole(profile, role),
  );

  const suggested = sources.length
    ? Math.round(sources.reduce((sum, item) => sum + item.monthlyCompensation, 0) / sources.length)
    : null;

  async function handleSearch() {
    if (!role.trim()) {
      toast.error("Informe o cargo ou perfil.");
      return;
    }

    setLoading(true);
    setSearched(false);

    try {
      const response = await fetchLaborProfiles();
      setProfiles(response.profiles);
      setSearched(true);

      const matches = response.profiles.filter(
        (profile) => profile.employmentModel === employmentModel && matchesRole(profile, role),
      );

      if (!matches.length) {
        toast.error("Nenhum cargo " + employmentModel + " encontrado na pesquisa de cargos atual.");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível realizar a pesquisa.");
    } finally {
      setLoading(false);
    }
  }

  function handleReset() {
    setRole("");
    setState("");
    setCity("");
    setEmploymentModel("CLT");
    setNotes("");
    setProfiles([]);
    setSearched(false);
  }

  return (
    <div>
      <div className="mb-8">
        <div className="mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-[#C2660D]">
          <span className="h-px w-6 bg-[#F57F17]" /> Inteligência salarial
        </div>
        <h1 className="font-display text-3xl font-semibold tracking-[-0.04em] text-[#333333] sm:text-[40px]">
          Pesquisa salarial
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-[#658080]">
          A busca usa a mesma pesquisa de cargos existente na aplicação. CLT e PJ são apenas
          selecionados como regimes da pesquisa, sem utilizar o antigo módulo de benchmark.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Card className="rounded-2xl border-[#DDD7CC] bg-[#FBF7F1]">
          <CardHeader>
            <CardTitle>Critérios da pesquisa</CardTitle>
            <CardDescription>Informe o cargo e o regime que deseja consultar.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div>
              <Label htmlFor="salary-role">Cargo / perfil</Label>
              <Input
                id="salary-role"
                className="mt-2"
                value={role}
                onChange={(event) => setRole(event.target.value)}
                placeholder="Ex.: Desenvolvedor Backend, DBA, Arquiteto de Soluções"
                onKeyDown={(event) => {
                  if (event.key === "Enter") void handleSearch();
                }}
              />
            </div>

            <div>
              <Label>Regime</Label>
              <div className="mt-2 grid grid-cols-2 gap-2">
                {(["CLT", "PJ"] as EmploymentModel[]).map((model) => (
                  <button
                    key={model}
                    type="button"
                    onClick={() => setEmploymentModel(model)}
                    className={`rounded-xl border px-4 py-3 text-left transition-colors ${
                      employmentModel === model
                        ? "border-[#0D5C5C] bg-[#0D5C5C] text-white"
                        : "border-[#D8D1C7] bg-white text-[#536969] hover:border-[#9EB9B9]"
                    }`}
                  >
                    <span className="text-sm font-semibold">{model}</span>
                    <span className={`mt-1 block text-[11px] ${
                      employmentModel === model ? "text-[#C7DEDE]" : "text-[#829090]"
                    }`}>
                      {model === "CLT" ? "Vínculo empregatício" : "Prestação de serviços"}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="salary-state">UF</Label>
                <Input id="salary-state" className="mt-2" value={state} onChange={(event) => setState(event.target.value)} placeholder="SP" />
              </div>
              <div>
                <Label htmlFor="salary-city">Cidade</Label>
                <Input id="salary-city" className="mt-2" value={city} onChange={(event) => setCity(event.target.value)} placeholder="São Paulo" />
              </div>
            </div>

            <div>
              <Label htmlFor="salary-notes">Observação (opcional)</Label>
              <Textarea
                id="salary-notes"
                className="mt-2"
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                placeholder="Contexto da pesquisa ou anotações do analista."
                rows={3}
              />
            </div>

            <div className="flex gap-2 pt-1">
              <Button
                onClick={() => void handleSearch()}
                disabled={loading || !role.trim()}
                className="pressable flex-1 rounded-full bg-[#F57F17] text-white hover:bg-[#D96D0C]"
              >
                <Search className="mr-2 h-4 w-4" />
                {loading ? "Pesquisando..." : "Pesquisar"}
              </Button>
              <Button onClick={handleReset} variant="outline" disabled={loading} className="rounded-full">
                Limpar
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-2xl border-[#DDD7CC] bg-[#0D5C5C] text-[#F7F2E8] shadow-paper">
          <CardHeader>
            <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-xl bg-white/10">
              <Users className="h-5 w-5 text-[#F57F17]" />
            </div>
            <CardTitle className="text-[#F7F2E8]">Regra da pesquisa</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm leading-6 text-[#C3D4D4]">
            <p><strong className="text-white">CLT</strong> consulta os perfis CLT da base existente.</p>
            <p><strong className="text-white">PJ</strong> consulta os perfis PJ da mesma base.</p>
            <p>O cargo é pesquisado uma única vez; o regime apenas define quais referências são apresentadas.</p>
          </CardContent>
        </Card>
      </div>

      {searched && (
        <section className="mt-8 space-y-5">
          {sources.length === 0 ? (
            <Card className="border-[#E8CBA9] bg-[#FAEFE2]">
              <CardContent className="flex gap-3 p-5 text-sm text-[#79521F]">
                <AlertCircle className="h-5 w-5 shrink-0" />
                <div>
                  <p className="font-semibold">Nenhuma referência encontrada</p>
                  <p className="mt-1">
                    Não há perfil {employmentModel} compatível com "{role.trim()}" na pesquisa de cargos atual.
                  </p>
                </div>
              </CardContent>
            </Card>
          ) : (
            <>
              <Card className="rounded-2xl border-t-2 border-t-[#0D5C5C] border-[#DDD7CC] bg-[#FBF7F1]">
                <CardContent className="p-6">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#C2660D]">
                        Resultado · {employmentModel}
                      </p>
                      <h2 className="mt-1 font-display text-2xl font-semibold text-[#333333]">{role.trim()}</h2>
                      <p className="mt-1 text-sm text-[#728383]">
                        {city.trim() || "Brasil"}{state.trim() ? " / " + state.trim().toUpperCase() : ""}
                      </p>
                    </div>
                    {suggested !== null && (
                      <div className="rounded-xl border border-[#D8D1C7] bg-white px-5 py-4 text-right">
                        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#7B8B8B]">
                          Referência média exibida
                        </p>
                        <p className="mt-1 font-display text-2xl font-semibold text-[#0D5C5C]">{formatBRL(suggested)}</p>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>

              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {sources.map((profile) => (
                  <Card key={profile.id} className="rounded-2xl border-[#DDD7CC]">
                    <CardHeader>
                      <CardDescription>{profile.seniority}</CardDescription>
                      <CardTitle className="mt-1 text-lg">{profile.title}</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <p className="font-display text-3xl font-semibold tracking-[-0.04em] text-[#333333]">
                        {formatBRL(profile.monthlyCompensation)}
                      </p>
                      <p className="mt-1 text-xs text-[#7B8B8B]">
                        Referência mensal · Fator K {profile.factorK.toFixed(2)}
                      </p>
                      <p className="mt-4 border-t border-[#E1DBD2] pt-3 text-xs leading-5 text-[#718282]">
                        {profile.benchmarkSource}
                      </p>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </>
          )}
        </section>
      )}
    </div>
  );
}
