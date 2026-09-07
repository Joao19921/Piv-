import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  ArrowLeft,
  Boxes,
  Cloud,
  Copy,
  Cpu,
  Database,
  Download,
  Globe,
  HardDrive,
  Loader2,
  Network,
  Pencil,
  Plus,
  Search,
  Trash2,
  X,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useCloudArchitecture,
  useCloudArchitectures,
  useCreateArchitecture,
  useDeleteArchitecture,
  useDuplicateArchitecture,
  useUpdateArchitecture,
} from "@/hooks/useCloudArchitectures";
import { useCloudServices } from "@/hooks/useCloudServices";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { downloadCsv } from "@/lib/csv";
import { priceCloudService, type ArchitectureSummary, type CloudProvider, type CloudService, type ServiceCategory, type ServicePricing } from "@/lib/api";

/**
 * Exemplo pronto pro estado vazio (ambiente de testes): web app 3 camadas com serviços
 * estáticos do catálogo (sem SKU dinâmico), pra sempre calcular na hora, sem depender de API externa.
 */
const EXAMPLE_ARCHITECTURE: { name: string; services: { serviceId: string; region: string; config: Record<string, unknown> }[] } = {
  name: "Exemplo — Web app 3 camadas",
  services: [
    { serviceId: "aws-elb", region: "us-east-1", config: { hours: 730, dataProcessedGb: 500 } },
    { serviceId: "aws-rds", region: "us-east-1", config: { engine: "postgres", instanceClass: "db.t3.medium", storageGb: 100, multiAz: false, hours: 730 } },
    { serviceId: "aws-s3", region: "us-east-1", config: { storageClass: "standard", storageGb: 100, requestsThousands: 100 } },
  ],
};

const formatBRL = (value: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(value);
const formatUSD = (value: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);

function formatRelativeTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "agora mesmo";
  const diffMin = Math.round((Date.now() - date.getTime()) / 60_000);
  if (diffMin < 1) return "agora mesmo";
  if (diffMin < 60) return `há ${diffMin} min`;
  const diffH = Math.round(diffMin / 60);
  if (diffH < 24) return `há ${diffH} h`;
  return `há ${Math.round(diffH / 24)} d`;
}

const CATEGORY_ICON: Record<ServiceCategory, React.ElementType> = {
  Compute: Cpu,
  Storage: HardDrive,
  Database: Database,
  Networking: Network,
  Containers: Boxes,
  Serverless: Zap,
  CDN: Globe,
};

/** Ordem de camadas para o diagrama: edge -> compute -> dados. Não inventa conexões ponto-a-ponto. */
const DIAGRAM_LAYERS: { label: string; categories: ServiceCategory[] }[] = [
  { label: "Edge / Rede", categories: ["CDN", "Networking"] },
  { label: "Aplicação", categories: ["Compute", "Containers", "Serverless"] },
  { label: "Dados", categories: ["Database", "Storage"] },
];

interface DraftService {
  localId: string;
  serviceId: string;
  provider: CloudProvider;
  category: ServiceCategory;
  name: string;
  region: string;
  config: Record<string, unknown>;
  pricing: ServicePricing | null;
}

export default function CloudArchitect() {
  const [view, setView] = useState<"list" | "builder">("list");
  const [editingId, setEditingId] = useState<string | undefined>(undefined);
  const [seedExample, setSeedExample] = useState(false);

  if (view === "builder") {
    return <ArchitectureBuilder architectureId={editingId} seedExample={seedExample} onClose={() => { setView("list"); setSeedExample(false); }} />;
  }
  return (
    <ArchitectureList
      onCreate={() => { setEditingId(undefined); setSeedExample(false); setView("builder"); }}
      onCreateExample={() => { setEditingId(undefined); setSeedExample(true); setView("builder"); }}
      onOpen={(id) => { setEditingId(id); setSeedExample(false); setView("builder"); }}
    />
  );
}

function ArchitectureList({ onCreate, onCreateExample, onOpen }: { onCreate: () => void; onCreateExample: () => void; onOpen: (id: string) => void }) {
  const { data, isLoading } = useCloudArchitectures();
  const deleteArchitecture = useDeleteArchitecture();
  const duplicateArchitecture = useDuplicateArchitecture();
  const architectures = data?.architectures ?? [];

  const handleDelete = (arch: ArchitectureSummary) => {
    if (!window.confirm(`Excluir a arquitetura "${arch.name}"? Essa ação não pode ser desfeita.`)) return;
    toast.promise(deleteArchitecture.mutateAsync(arch.id), {
      loading: "Excluindo...",
      success: "Arquitetura excluída.",
      error: (err) => (err instanceof Error ? err.message : "Não foi possível excluir agora."),
    });
  };

  const handleDuplicate = (arch: ArchitectureSummary) => {
    toast.promise(duplicateArchitecture.mutateAsync({ id: arch.id }), {
      loading: "Duplicando...",
      success: "Arquitetura duplicada.",
      error: (err) => (err instanceof Error ? err.message : "Não foi possível duplicar agora."),
    });
  };

  return (
    <div>
      <div className="mb-7 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <div className="mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-[#C2660D]">
            <span className="h-px w-6 bg-[#F57F17]" /> Cloud Architecture Calculator
          </div>
          <h1 className="font-display text-3xl font-semibold tracking-[-0.04em] text-[#333333] sm:text-[40px]">Arquiteturas</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[#658080]">Monte, calcule e salve arquiteturas de infraestrutura cloud com múltiplos serviços.</p>
        </div>
        <Button onClick={onCreate} className="pressable h-10 rounded-full bg-[#F57F17] px-5 text-xs font-semibold text-white hover:bg-[#D96D0C]">
          <Plus className="mr-2 h-4 w-4" /> Nova arquitetura
        </Button>
      </div>

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-40 w-full rounded-2xl" />)}
        </div>
      ) : architectures.length === 0 ? (
        <Card className="rounded-2xl border-[#DDD7CC] bg-[#FBF7F1] p-10 text-center shadow-paper">
          <Cloud className="mx-auto h-10 w-10 text-[#9EB4B4]" />
          <h2 className="mt-4 font-display text-xl font-semibold text-[#333333]">Nenhuma arquitetura criada</h2>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[#658080]">Monte sua primeira arquitetura de cloud selecionando serviços, configurando recursos e estimando seus custos.</p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <Button onClick={onCreate} className="pressable rounded-full bg-[#F57F17] px-5 text-xs font-semibold text-white hover:bg-[#D96D0C]">
              <Plus className="mr-2 h-4 w-4" /> Criar arquitetura
            </Button>
            <Button onClick={onCreateExample} variant="outline" className="pressable rounded-full border-[#C9C6C2] bg-white px-5 text-xs text-[#333333] hover:bg-[#E9EAEA]">
              Ver exemplo pronto
            </Button>
          </div>
          <p className="mx-auto mt-3 max-w-md text-[11px] text-[#899A9A]">O exemplo carrega 3 serviços AWS já configurados no calculador — nada é salvo até você clicar em "Salvar".</p>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {architectures.map((arch) => (
            <Card key={arch.id} className="fade-up flex flex-col rounded-2xl border-[#DDD7CC] bg-[#FBF7F1] p-5 shadow-paper">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-display text-base font-semibold text-[#333333]">{arch.name}</p>
                  <p className="mt-1 text-[11px] uppercase tracking-[0.1em] text-[#899A9A]">{arch.provider} · {arch.region}</p>
                </div>
                <span className="shrink-0 rounded-full bg-[#E8E9E9] px-2.5 py-1 text-[10px] font-semibold text-[#5D7979]">{arch.serviceCount} serviço{arch.serviceCount === 1 ? "" : "s"}</span>
              </div>
              <div className="mt-5 font-display text-2xl font-semibold tracking-[-0.04em] text-[#333333]">{formatBRL(arch.monthlyBrl)}<span className="ml-1 text-xs font-normal text-[#899A9A]">/mês</span></div>
              <p className="mt-1 text-[11px] text-[#899A9A]">Atualizada {formatRelativeTime(arch.updatedAt)}</p>
              <div className="mt-5 flex items-center gap-2 border-t border-[#E7E1D6] pt-4">
                <Button onClick={() => onOpen(arch.id)} variant="outline" className="h-8 flex-1 rounded-full border-[#C9C6C2] bg-white text-xs text-[#333333] hover:bg-[#E9EAEA]"><Pencil className="mr-1.5 h-3.5 w-3.5" /> Abrir</Button>
                <button onClick={() => handleDuplicate(arch)} className="rounded-full p-2 text-[#7E9393] hover:bg-[#E8E9E9] hover:text-[#333333]" aria-label="Duplicar" title="Duplicar"><Copy className="h-4 w-4" /></button>
                <button onClick={() => handleDelete(arch)} className="rounded-full p-2 text-[#B0712A] hover:bg-[#FBEFE1]" aria-label="Excluir" title="Excluir"><Trash2 className="h-4 w-4" /></button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function makeLocalId(): string {
  return `svc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function ArchitectureBuilder({ architectureId, seedExample, onClose }: { architectureId: string | undefined; seedExample: boolean; onClose: () => void }) {
  const { data: existing, isLoading: existingLoading } = useCloudArchitecture(architectureId);
  const { data: fullCatalog } = useCloudServices({});
  const createArchitecture = useCreateArchitecture();
  const updateArchitecture = useUpdateArchitecture();

  const [name, setName] = useState("");
  const [currency, setCurrency] = useState<"BRL" | "USD">("BRL");
  const [services, setServices] = useState<DraftService[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [configuring, setConfiguring] = useState<CloudService | null>(null);

  useEffect(() => {
    if (architectureId) {
      if (existing && !hydrated) {
        setName(existing.name);
        setCurrency(existing.currency);
        setServices(
          existing.services.map((s) => ({
            localId: makeLocalId(),
            serviceId: s.serviceId,
            provider: s.provider,
            category: s.category as ServiceCategory,
            name: s.name,
            region: s.region,
            config: s.configuration,
            pricing: { monthlyUsd: s.monthlyUsd, monthlyBrl: s.monthlyBrl, fxRate: 0, source: "catalog", estimated: true, lastUpdated: existing.updatedAt, sourceUrl: "" },
          })),
        );
        setHydrated(true);
      }
      return;
    }

    if (!seedExample) {
      setHydrated(true);
      return;
    }

    if (!fullCatalog || hydrated) return;
    let cancelled = false;
    (async () => {
      const results = await Promise.all(
        EXAMPLE_ARCHITECTURE.services.map(async (item): Promise<DraftService | null> => {
          const def = fullCatalog.services.find((s) => s.id === item.serviceId);
          if (!def) return null;
          try {
            const pricing = await priceCloudService(item.serviceId, { region: item.region, config: item.config });
            return { localId: makeLocalId(), serviceId: def.id, provider: def.provider, category: def.category, name: def.name, region: item.region, config: item.config, pricing };
          } catch {
            return null;
          }
        }),
      );
      if (cancelled) return;
      setServices(results.filter((r): r is DraftService => r !== null));
      setName(EXAMPLE_ARCHITECTURE.name);
      setHydrated(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [architectureId, existing, hydrated, seedExample, fullCatalog]);

  const totalUsd = services.reduce((sum, s) => sum + (s.pricing?.monthlyUsd ?? 0), 0);
  const totalBrl = services.reduce((sum, s) => sum + (s.pricing?.monthlyBrl ?? 0), 0);
  const totalDisplay = currency === "BRL" ? formatBRL(totalBrl) : formatUSD(totalUsd);
  const annualDisplay = currency === "BRL" ? formatBRL(totalBrl * 12) : formatUSD(totalUsd * 12);

  const byCategory = useMemo(() => {
    const map = new Map<ServiceCategory, number>();
    for (const s of services) {
      const value = currency === "BRL" ? (s.pricing?.monthlyBrl ?? 0) : (s.pricing?.monthlyUsd ?? 0);
      map.set(s.category, (map.get(s.category) ?? 0) + value);
    }
    return map;
  }, [services, currency]);

  const handleAddService = (service: CloudService, region: string, config: Record<string, unknown>, pricing: ServicePricing) => {
    setServices((current) => [
      ...current,
      { localId: makeLocalId(), serviceId: service.id, provider: service.provider, category: service.category, name: service.name, region, config, pricing },
    ]);
    setConfiguring(null);
  };

  const handleRemoveService = (localId: string) => {
    setServices((current) => current.filter((s) => s.localId !== localId));
  };

  const handleSave = () => {
    if (!name.trim()) {
      toast.error("De um nome para a arquitetura antes de salvar.");
      return;
    }
    if (services.length === 0) {
      toast.error("Adicione pelo menos 1 serviço antes de salvar.");
      return;
    }
    const payload = {
      name: name.trim(),
      currency,
      services: services.map((s) => ({ serviceId: s.serviceId, region: s.region, config: s.config })),
    };
    const promise = architectureId ? updateArchitecture.mutateAsync({ id: architectureId, ...payload }) : createArchitecture.mutateAsync(payload);
    toast.promise(promise, {
      loading: "Salvando arquitetura...",
      success: () => {
        onClose();
        return "Arquitetura salva.";
      },
      error: (err) => (err instanceof Error ? err.message : "Não foi possível salvar agora."),
    });
  };

  const handleExportCsv = () => {
    const rows: (string | number)[][] = [
      ["Serviço", "Provider", "Categoria", "Região", "Custo mensal (USD)", "Custo mensal (BRL)"],
      ...services.map((s) => [s.name, s.provider, s.category, s.region, (s.pricing?.monthlyUsd ?? 0).toFixed(2), (s.pricing?.monthlyBrl ?? 0).toFixed(2)]),
      ["", "", "", "Total", totalUsd.toFixed(2), totalBrl.toFixed(2)],
    ];
    downloadCsv(`pivo-arquitetura-${(name || "sem-nome").toLowerCase().replace(/[^a-z0-9]+/g, "-")}.csv`, rows);
  };

  if (architectureId && (existingLoading || !hydrated)) {
    return <Skeleton className="h-96 w-full rounded-2xl" />;
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between gap-4">
        <button onClick={onClose} className="flex items-center gap-2 text-xs font-semibold text-[#536D6D] hover:text-[#333333]"><ArrowLeft className="h-4 w-4" /> Voltar para arquiteturas</button>
        <div className="flex items-center gap-2 rounded-full bg-[#E8E9E9] p-1">
          {(["BRL", "USD"] as const).map((c) => (
            <button key={c} onClick={() => setCurrency(c)} className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${currency === c ? "bg-white text-[#333333] shadow-sm" : "text-[#7C8B8B] hover:text-[#333333]"}`}>{c}</button>
          ))}
        </div>
      </div>

      <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome da arquitetura" className="mb-6 h-12 max-w-md border-[#D4D1CC] bg-white font-display text-lg text-[#333333]" />

      <div className="grid gap-5 xl:grid-cols-[minmax(0,0.85fr)_minmax(0,1.3fr)_minmax(280px,0.85fr)]">
        <ServiceCatalogPane onSelect={setConfiguring} />

        <div className="space-y-5">
          <ArchitectureDiagram services={services} />
          <Card className="rounded-2xl border-[#DDD7CC] bg-[#FBF7F1] p-5 shadow-paper">
            <p className="mb-4 text-[10px] font-semibold uppercase tracking-[0.18em] text-[#C2660D]">Serviços na arquitetura ({services.length})</p>
            {services.length === 0 ? (
              <p className="text-xs text-[#879A9A]">Nenhum serviço adicionado ainda. Escolha um serviço no catálogo a esquerda.</p>
            ) : (
              <div className="space-y-2">
                {services.map((s) => {
                  const Icon = CATEGORY_ICON[s.category];
                  return (
                    <div key={s.localId} className="flex items-center justify-between gap-3 rounded-xl border border-[#E5E0D6] bg-white/55 p-3">
                      <div className="flex min-w-0 items-center gap-3">
                        <div className="rounded-lg bg-[#E8E9E9] p-2 text-[#5D7979]"><Icon className="h-4 w-4" /></div>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-[#333333]">{s.name}</p>
                          <p className="truncate text-[11px] text-[#899A9A]">{s.provider} · {s.region}</p>
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-3">
                        <span className="text-xs font-semibold text-[#333333]">{currency === "BRL" ? formatBRL(s.pricing?.monthlyBrl ?? 0) : formatUSD(s.pricing?.monthlyUsd ?? 0)}</span>
                        <button onClick={() => handleRemoveService(s.localId)} className="rounded-full p-1.5 text-[#B0712A] hover:bg-[#FBEFE1]" aria-label={`Remover ${s.name}`}><X className="h-3.5 w-3.5" /></button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </div>

        <Card className="h-fit rounded-2xl border-[#DDD7CC] bg-[#0D5C5C] p-5 text-[#F7F2E8] shadow-paper">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#AEC4C4]">Estimativa</p>
          <h2 className="mt-1 font-display text-xl font-semibold">{services.length} serviço{services.length === 1 ? "" : "s"}</h2>
          <div className="mt-6 space-y-2 border-t border-white/10 pt-4 text-xs">
            {Array.from(byCategory.entries()).map(([category, value]) => (
              <div key={category} className="flex justify-between"><span className="text-[#AEC4C4]">{category}</span><strong className="font-medium text-white">{currency === "BRL" ? formatBRL(value) : formatUSD(value)}</strong></div>
            ))}
            {services.length === 0 && <p className="text-[#AEC4C4]">Sem serviços ainda.</p>}
          </div>
          <div className="mt-6 border-t border-white/10 pt-4">
            <div className="flex items-baseline justify-between"><span className="text-xs text-[#AEC4C4]">Mensal</span><span className="font-display text-3xl font-semibold">{totalDisplay}</span></div>
            <div className="mt-2 flex items-baseline justify-between"><span className="text-xs text-[#AEC4C4]">Anual</span><span className="font-display text-lg font-semibold text-[#F57F17]">{annualDisplay}</span></div>
          </div>
          <Button onClick={handleSave} disabled={createArchitecture.isPending || updateArchitecture.isPending} className="pressable mt-6 h-11 w-full rounded-full bg-[#F57F17] text-sm font-semibold text-white hover:bg-[#D96D0C]">
            {architectureId ? "Salvar alterações" : "Salvar arquitetura"}
          </Button>
          <Button onClick={handleExportCsv} disabled={services.length === 0} variant="outline" className="pressable mt-3 h-10 w-full rounded-full border-white/20 bg-transparent text-xs text-white hover:bg-white/10">
            <Download className="mr-2 h-4 w-4" /> Baixar CSV
          </Button>
        </Card>
      </div>

      {configuring && <ServiceConfigDrawer service={configuring} onCancel={() => setConfiguring(null)} onAdd={handleAddService} />}
    </div>
  );
}

function ServiceCatalogPane({ onSelect }: { onSelect: (service: CloudService) => void }) {
  const [q, setQ] = useState("");
  const [provider, setProvider] = useState<CloudProvider | undefined>(undefined);
  const debouncedQ = useDebouncedValue(q, 250);
  const { data, isLoading } = useCloudServices({ q: debouncedQ || undefined, provider });
  const services = data?.services ?? [];

  return (
    <Card className="h-fit rounded-2xl border-[#DDD7CC] bg-[#FBF7F1] p-5 shadow-paper">
      <p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-[#C2660D]">Catálogo de serviços</p>
      <div className="relative mb-3">
        <Search className="pointer-events-none absolute left-3 top-2.5 h-3.5 w-3.5 text-[#8A9797]" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar serviço (ex: database, storage)" className="h-9 border-[#D4D1CC] bg-white pl-9 text-sm text-[#333333]" />
      </div>
      <div className="mb-4 flex flex-wrap gap-1.5">
        {([undefined, "AWS", "Azure", "GCP"] as const).map((p) => (
          <button key={p ?? "all"} onClick={() => setProvider(p)} className={`rounded-full px-2.5 py-1 text-[11px] font-semibold transition-colors ${provider === p ? "bg-[#0D5C5C] text-white" : "bg-[#E8E9E9] text-[#5D7979] hover:bg-[#DEE0E0]"}`}>{p ?? "Todos"}</button>
        ))}
      </div>
      {isLoading ? (
        <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-14 w-full rounded-xl" />)}</div>
      ) : services.length === 0 ? (
        <p className="text-xs text-[#879A9A]">Nenhum serviço encontrado.</p>
      ) : (
        <div className="max-h-[560px] space-y-2 overflow-y-auto pr-1">
          {services.map((service) => {
            const Icon = CATEGORY_ICON[service.category];
            return (
              <button key={service.id} onClick={() => onSelect(service)} className="flex w-full items-center gap-3 rounded-xl border border-[#E5E0D6] bg-white/55 p-3 text-left transition-colors hover:border-[#F0C48A]">
                <div className="rounded-lg bg-[#E8E9E9] p-2 text-[#5D7979]"><Icon className="h-4 w-4" /></div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-[#333333]">{service.name}</p>
                  <p className="truncate text-[11px] text-[#899A9A]">{service.provider} · {service.category}</p>
                </div>
                <Plus className="h-4 w-4 shrink-0 text-[#C2660D]" />
              </button>
            );
          })}
        </div>
      )}
    </Card>
  );
}

function ServiceConfigDrawer({
  service,
  onCancel,
  onAdd,
}: {
  service: CloudService;
  onCancel: () => void;
  onAdd: (service: CloudService, region: string, config: Record<string, unknown>, pricing: ServicePricing) => void;
}) {
  const [region, setRegion] = useState(service.regions[0]?.key ?? "us-east-1");
  const [config, setConfig] = useState<Record<string, unknown>>(() => Object.fromEntries(service.configFields.map((f) => [f.key, f.default])));
  const [pricing, setPricing] = useState<ServicePricing | null>(null);
  const [isPricing, setIsPricing] = useState(false);
  const debouncedConfig = useDebouncedValue(config, 400);
  const debouncedRegion = useDebouncedValue(region, 400);

  useEffect(() => {
    let cancelled = false;
    setIsPricing(true);
    priceCloudService(service.id, { region: debouncedRegion, config: debouncedConfig })
      .then((result) => {
        if (!cancelled) setPricing(result);
      })
      .catch(() => {
        if (!cancelled) setPricing(null);
      })
      .finally(() => {
        if (!cancelled) setIsPricing(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [service.id, debouncedRegion, JSON.stringify(debouncedConfig)]);

  const setField = (key: string, value: unknown) => setConfig((current) => ({ ...current, [key]: value }));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0D5C5C]/40 backdrop-blur-sm p-4">
      <Card className="w-full max-w-lg rounded-2xl border-[#DDD7CC] bg-[#FBF7F1] p-6 shadow-2xl">
        <div className="mb-5 flex items-start justify-between">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#C2660D]">{service.provider} · {service.category}</p>
            <h2 className="mt-1 font-display text-xl font-semibold text-[#333333]">{service.name}</h2>
          </div>
          <button onClick={onCancel} className="rounded-full p-1.5 text-[#7E9393] hover:bg-[#E8E9E9]" aria-label="Fechar"><X className="h-4 w-4" /></button>
        </div>

        <div className="mb-4">
          <Label className="text-xs font-semibold text-[#345555]">Região</Label>
          <select value={region} onChange={(e) => setRegion(e.target.value)} className="mt-2 h-10 w-full rounded-md border border-[#D4D1CC] bg-white px-3 text-sm text-[#333333] outline-none focus:border-[#F57F17] focus:ring-2 focus:ring-[#F57F17]/20">
            {service.regions.map((r) => <option key={r.key} value={r.key}>{r.key} - {r.label}</option>)}
          </select>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          {service.configFields.map((field) => (
            <div key={field.key} className={field.type === "toggle" ? "flex items-center justify-between rounded-md border border-[#D4D1CC] bg-white px-3" : ""}>
              {field.type === "select" ? (
                <>
                  <Label className="text-xs font-semibold text-[#345555]">{field.label}</Label>
                  <select value={String(config[field.key] ?? "")} onChange={(e) => setField(field.key, e.target.value)} className="mt-2 h-10 w-full rounded-md border border-[#D4D1CC] bg-white px-3 text-sm text-[#333333] outline-none focus:border-[#F57F17] focus:ring-2 focus:ring-[#F57F17]/20">
                    {(field.options ?? []).map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                  </select>
                </>
              ) : field.type === "toggle" ? (
                <>
                  <span className="text-xs font-semibold text-[#345555]">{field.label}</span>
                  <input type="checkbox" checked={Boolean(config[field.key])} onChange={(e) => setField(field.key, e.target.checked)} className="h-4 w-4 accent-[#F57F17]" />
                </>
              ) : (
                <>
                  <Label className="text-xs font-semibold text-[#345555]">{field.label}{field.unit ? ` (${field.unit})` : ""}</Label>
                  <Input
                    type="number"
                    value={String(config[field.key] ?? "")}
                    min={field.min}
                    max={field.max}
                    step={field.step ?? 1}
                    onChange={(e) => setField(field.key, Number(e.target.value))}
                    className="mt-2 h-10 border-[#D4D1CC] bg-white text-sm text-[#333333]"
                  />
                </>
              )}
            </div>
          ))}
        </div>

        <div className="mt-6 rounded-xl border border-[#E5E0D6] bg-white/55 p-4">
          {isPricing ? (
            <div className="flex items-center gap-2 text-xs text-[#899A9A]"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Calculando preço...</div>
          ) : pricing ? (
            <>
              <div className="flex items-baseline justify-between"><span className="text-xs text-[#778B8B]">Custo mensal</span><span className="font-display text-2xl font-semibold text-[#333333]">{formatBRL(pricing.monthlyBrl)}</span></div>
              <p className="mt-1 text-[11px] text-[#899A9A]">{pricing.estimated ? "Preço estimado" : "Preço ao vivo"} · fonte: {pricing.source === "live_api" ? "API ao vivo" : pricing.source === "scheduled_ingestion" ? "ingestão periódica" : "catálogo configurado"}{pricing.note ? ` · ${pricing.note}` : ""}</p>
            </>
          ) : (
            <p className="text-xs text-[#B0712A]">Não foi possível calcular o preço com essa configuração.</p>
          )}
        </div>

        <div className="mt-6 flex justify-end gap-3">
          <Button onClick={onCancel} variant="outline" className="rounded-full border-[#C9C6C2] bg-transparent text-xs text-[#333333] hover:bg-white">Cancelar</Button>
          <Button onClick={() => pricing && onAdd(service, region, config, pricing)} disabled={!pricing || isPricing} className="pressable rounded-full bg-[#F57F17] px-5 text-xs font-semibold text-white hover:bg-[#D96D0C]">Adicionar a arquitetura</Button>
        </div>
      </Card>
    </div>
  );
}

function ArchitectureDiagram({ services }: { services: DraftService[] }) {
  const layers = DIAGRAM_LAYERS.map((layer) => ({
    ...layer,
    services: services.filter((s) => layer.categories.includes(s.category)),
  })).filter((layer) => layer.services.length > 0);

  return (
    <Card className="rounded-2xl border-[#DDD7CC] bg-[#FBF7F1] p-5 shadow-paper">
      <p className="mb-4 text-[10px] font-semibold uppercase tracking-[0.18em] text-[#C2660D]">Visualização da arquitetura</p>
      {layers.length === 0 ? (
        <p className="text-xs text-[#879A9A]">Adicione serviços para visualizar a arquitetura.</p>
      ) : (
        <div className="space-y-3">
          {layers.map((layer, index) => (
            <div key={layer.label}>
              <div className="flex flex-wrap justify-center gap-3">
                {layer.services.map((s) => {
                  const Icon = CATEGORY_ICON[s.category];
                  return (
                    <div key={s.localId} className="flex min-w-[110px] flex-col items-center gap-1.5 rounded-xl border-2 border-[#0D5C5C] bg-white px-4 py-3 text-center shadow-sm">
                      <Icon className="h-4 w-4 text-[#0D5C5C]" />
                      <span className="text-[11px] font-semibold text-[#333333]">{s.name}</span>
                    </div>
                  );
                })}
              </div>
              {index < layers.length - 1 && (
                <div className="my-2 flex justify-center">
                  <div className="h-5 w-px bg-[#C9C6C2]" />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
