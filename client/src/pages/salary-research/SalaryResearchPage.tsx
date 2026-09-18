import { useMemo, useState } from "react";
import { AlertCircle, Search, Users } from "lucide-react";
import { toast } from "sonner";
import { fetchLaborProfiles, type LaborProfile } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

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

function average(profiles: LaborProfile[]) {
  return profiles.length
    ? Math.round(profiles.reduce((sum, item) => sum + item.monthlyCompensation, 0) / profiles.length)
    : null;
}

export default function SalaryResearchPage() {
  const [role, setRole] = useState("");
  const [profiles, setProfiles] = useState<LaborProfile[]>([]);
  const [searched, setSearched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);

  const suggestions = useMemo(() => {
    if (!role.trim()) return profiles.slice(0, 8);
    return profiles.filter((profile) => matchesRole(profile, role)).slice(0, 8);
  }, [profiles, role]);

  const sources = useMemo(
    () => profiles.filter((profile) => matchesRole(profile, role)),
    [profiles, role],
  );
  const cltSources = sources.filter((profile) => profile.employmentModel === "CLT");
  const pjSources = sources.filter((profile) => profile.employmentModel === "PJ");

  async function loadCatalog() {
    if (profiles.length || catalogLoading) return;
    setCatalogLoading(true);
    try {
      const response = await fetchLaborProfiles();
      setProfiles(response.profiles);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível carregar os cargos.");
    } finally {
      setCatalogLoading(false);
    }
  }

  async function handleSearch() {
    if (!role.trim()) {
      toast.error("Informe o cargo ou perfil.");
      return;
    }

    setLoading(true);
    setShowSuggestions(false);
    setSearched(false);

    try {
      const response = await fetchLaborProfiles();
      setProfiles(response.profiles);
      setSearched(true);

      const matches = response.profiles.filter((profile) => matchesRole(profile, role));
      if (!matches.length) {
        toast.error("Nenhum cargo encontrado na pesquisa de cargos atual.");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível realizar a pesquisa.");
    } finally {
      setLoading(false);
    }
  }

  function handleReset() {
    setRole("");
    setProfiles([]);
    setSearched(false);
    setShowSuggestions(false);
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
          Pesquise o cargo na mesma base de cargos da aplicação. O resultado apresenta as referências CLT e PJ juntas.
        </p>
      </div>

      <Card className="rounded-2xl border-[#DDD7CC] bg-[#FBF7F1]">
        <CardHeader>
          <CardTitle>Pesquisar cargo</CardTitle>
          <CardDescription>Comece a digitar para selecionar um cargo existente na base.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="relative">
            <Label htmlFor="salary-role">Cargo / perfil</Label>
            <Input
              id="salary-role"
              className="mt-2"
              value={role}
              onFocus={() => {
                void loadCatalog();
                setShowSuggestions(true);
              }}
              onChange={(event) => {
                setRole(event.target.value);
                setShowSuggestions(true);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") void handleSearch();
                if (event.key === "Escape") setShowSuggestions(false);
              }}
              placeholder="Ex.: Desenvolvedor Backend, DBA, Arquiteto de Soluções"
              autoComplete="off"
            />
            {showSuggestions && (suggestions.length > 0 || catalogLoading) && (
              <div className="absolute z-20 mt-1 max-h-72 w-full overflow-auto rounded-xl border border-[#D8D1C7] bg-white shadow-lg">
                {catalogLoading ? (
                  <p className="px-4 py-3 text-sm text-[#7B8B8B]">Carregando cargos...</p>
                ) : (
                  suggestions.map((profile) => (
                    <button
                      key={profile.id}
                      type="button"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => {
                        setRole(profile.title);
                        setShowSuggestions(false);
                      }}
                      className="block w-full border-b border-[#EEE9E1] px-4 py-3 text-left last:border-0 hover:bg-[#FBF7F1]"
                    >
                      <span className="block text-sm font-semibold text-[#333333]">{profile.title}</span>
                      <span className="mt-1 block text-[10px] uppercase tracking-[0.12em] text-[#899A9A]">
                        {profile.seniority} · {profile.employmentModel}
                      </span>
                    </button>
                  ))
                )}
              </div>
            )}
            <p className="mt-1.5 text-[11px] text-[#879A9A]">
              O nome do cargo vem da base existente; você pode selecionar a sugestão ou digitar para localizar.
            </p>
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

      {searched && (
        <section className="mt-8 space-y-5">
          {sources.length === 0 ? (
            <Card className="border-[#E8CBA9] bg-[#FAEFE2]">
              <CardContent className="flex gap-3 p-5 text-sm text-[#79521F]">
                <AlertCircle className="h-5 w-5 shrink-0" />
                <div>
                  <p className="font-semibold">Nenhuma referência encontrada</p>
                  <p className="mt-1">
                    Não há referência CLT ou PJ compatível com "{role.trim()}" na pesquisa de cargos atual.
                  </p>
                </div>
              </CardContent>
            </Card>
          ) : (
            <>
              <div className="grid gap-4 md:grid-cols-2">
                {[
                  { model: "CLT", items: cltSources, value: average(cltSources), subtitle: "Vínculo empregatício" },
                  { model: "PJ", items: pjSources, value: average(pjSources), subtitle: "Prestação de serviços" },
                ].map(({ model, items, value, subtitle }) => (
                  <Card key={model} className="rounded-2xl border-[#DDD7CC] bg-[#FBF7F1]">
                    <CardHeader>
                      <CardDescription>{subtitle}</CardDescription>
                      <CardTitle className="text-xl">Referência {model}</CardTitle>
                    </CardHeader>
                    <CardContent>
                      {value !== null ? (
                        <>
                          <p className="font-display text-3xl font-semibold tracking-[-0.04em] text-[#0D5C5C]">
                            {formatBRL(value)}
                          </p>
                          <p className="mt-1 text-xs text-[#7B8B8B]">
                            Média das referências encontradas · {items.length} registro{items.length === 1 ? "" : "s"}
                          </p>
                        </>
                      ) : (
                        <p className="text-sm text-[#7B8B8B]">Não há referência {model} para este cargo na base atual.</p>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>

              <Card className="rounded-2xl border-t-2 border-t-[#0D5C5C] border-[#DDD7CC] bg-[#FBF7F1]">
                <CardHeader>
                  <CardTitle>Referências encontradas</CardTitle>
                  <CardDescription>
                    Cargo pesquisado: <strong>{role.trim()}</strong>
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                    {sources.map((profile) => (
                      <Card key={profile.id} className="rounded-2xl border-[#DDD7CC] bg-white">
                        <CardHeader>
                          <CardDescription>
                            {profile.employmentModel} · {profile.seniority}
                          </CardDescription>
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
                </CardContent>
              </Card>
            </>
          )}
        </section>
      )}

      <Card className="mt-6 rounded-2xl border-[#DDD7CC] bg-[#0D5C5C] text-[#F7F2E8] shadow-paper">
        <CardContent className="flex items-start gap-3 p-5 text-sm leading-6 text-[#C3D4D4]">
          <Users className="mt-0.5 h-5 w-5 shrink-0 text-[#F57F17]" />
          <p>
            A pesquisa consulta a mesma base de cargos existente na aplicação e separa as referências por regime.
            O antigo módulo de benchmark não é utilizado.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
