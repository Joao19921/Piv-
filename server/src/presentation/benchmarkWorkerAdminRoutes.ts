/**
 * Visão do admin sobre o benchmark worker: fontes, execuções recentes e registro manual
 * de observação (ver docs/BENCHMARK-WORKER-MANUAL.md, seção 3.2). Somente leitura para
 * fontes/execuções -- a coleta automatizada continua exclusivamente com o worker Python
 * (benchmark-worker/), agendado via GitHub Actions. Esta tela nunca aciona scraping nem
 * qualquer automação contra Indeed/Glassdoor/InfoJobs.
 */
import express, { type Router } from "express";
import { getEnrichedLaborProfiles, type EnrichedLaborProfile } from "../domain/services/laborBenchmark";
import { recordAuditEvent } from "../infrastructure/repositories/auditRepository";
import {
  getOpenSourceByName,
  insertManualObservation,
  listBenchmarkSources,
  listOpenSources,
  listOpenSourceTriggers,
  listRecentBenchmarkRuns,
  searchOpenBenchmarkResults,
} from "../infrastructure/repositories/benchmarkWorkerRepository";
import { requirePermission } from "./authMiddleware";

function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(new RegExp("[\\u0300-\\u036f]", "g"), "")
    .toLowerCase()
    .trim();
}

// As mesmas 27 UFs da V1 (ver benchmark-worker/src/benchmark_worker/normalization/states.py)
// -- mantidas em sincronia manualmente, os dois lados sao pequenos e estaveis.
const BRAZILIAN_STATES = new Set([
  "AC", "AL", "AM", "AP", "BA", "CE", "DF", "ES", "GO", "MA", "MG", "MS", "MT",
  "PA", "PB", "PE", "PI", "PR", "RJ", "RN", "RO", "RR", "RS", "SC", "SE", "SP", "TO",
]);

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function createBenchmarkWorkerAdminRouter(): Router {
  const router = express.Router();
  router.use(requirePermission("BENCHMARK_WORKER"));

  router.get("/admin/benchmark-worker/sources", async (_req, res) => {
    const sources = await listBenchmarkSources();
    res.json({ sources });
  });

  router.get("/admin/benchmark-worker/runs", async (req, res) => {
    const rawLimit = Number(req.query.limit);
    const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 100) : 20;
    const runs = await listRecentBenchmarkRuns(limit);
    res.json({ runs });
  });

  // Catalogo das fontes abertas aprovadas (migration 0014) -- alimenta o dropdown "Fonte" do
  // registro manual no lugar do campo de texto livre que existia antes.
  router.get("/admin/benchmark-worker/open-sources", async (_req, res) => {
    const openSources = await listOpenSources();
    res.json({ openSources });
  });

  // Gatilhos pendentes de reavaliacao (server/scripts/refreshOpenBenchmarkTriggers.ts, cron a
  // cada 10 dias) -- nunca dado coletado automaticamente, so um lembrete pro admin reabrir a
  // pagina da fonte e decidir se registra um valor novo.
  router.get("/admin/benchmark-worker/open-source-triggers", async (_req, res) => {
    const triggers = await listOpenSourceTriggers();
    res.json({ triggers });
  });

  // Junta, para um cargo digitado, a visao da base publica do governo (CAGED/SISP, via
  // getEnrichedLaborProfiles -- mesma logica que ja funde catalogo + observacao real) com a da
  // base aberta (benchmark_results de fonte 'manual'), e calcula a media dos pontos reais
  // encontrados nas duas. So entra na media dado efetivamente observado -- nunca a estimativa
  // estatica do catalogo (sourceStatus === "FALLBACK_STALE"), para nao misturar dado real com
  // chute sem avisar.
  router.get("/admin/benchmark-worker/role-lookup", async (req, res) => {
    const role = typeof req.query.role === "string" ? req.query.role.trim() : "";
    const stateRaw = typeof req.query.state === "string" ? req.query.state.trim().toUpperCase() : "";
    const state = stateRaw && BRAZILIAN_STATES.has(stateRaw) ? stateRaw : null;

    if (!role) {
      res.status(400).json({ error: "Informe o cargo para consultar." });
      return;
    }

    const normalizedQuery = normalizeText(role);
    const [allProfiles, openResults] = await Promise.all([
      getEnrichedLaborProfiles({ uf: state }),
      searchOpenBenchmarkResults(role, state),
    ]);
    const government = allProfiles.filter((p: EnrichedLaborProfile) => normalizeText(p.title).includes(normalizedQuery));

    const points: Array<{ base: "governo" | "aberta"; label: string; value: number }> = [];
    for (const profile of government) {
      if (profile.sourceStatus === "OPERATIONAL") {
        points.push({ base: "governo", label: `${profile.title} (${profile.seniority}) — ${profile.observed?.source}`, value: profile.monthlyCompensation });
      }
    }
    for (const result of openResults) {
      const midpoint = (Number(result.salary_min) + Number(result.salary_max)) / 2;
      if (Number.isFinite(midpoint)) {
        points.push({ base: "aberta", label: `${result.role_title} — ${result.open_source_label ?? result.open_source}`, value: midpoint });
      }
    }
    const average = points.length ? points.reduce((total, p) => total + p.value, 0) / points.length : null;

    res.json({ role, state, government, openResults, average, points });
  });

  router.post("/admin/benchmark-worker/manual-entry", async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const { roleTitle, seniority, state, regime, salaryMin, salaryMax, currency, periodicity, observedAt, openSource } = body;

    if (typeof roleTitle !== "string" || !roleTitle.trim()) {
      res.status(400).json({ error: "Cargo é obrigatório." });
      return;
    }
    if (typeof openSource !== "string" || !openSource.trim()) {
      res.status(400).json({ error: "Selecione a fonte aberta consultada." });
      return;
    }
    const openSourceRow = await getOpenSourceByName(openSource.trim());
    if (!openSourceRow) {
      res.status(400).json({ error: "Fonte desconhecida. Escolha uma das fontes já aprovadas na lista." });
      return;
    }
    if (state !== null && state !== undefined && (typeof state !== "string" || !BRAZILIAN_STATES.has(state))) {
      res.status(400).json({ error: "UF inválida." });
      return;
    }
    if (regime !== "clt" && regime !== "pj" && regime !== "unknown") {
      res.status(400).json({ error: "Regime deve ser CLT, PJ ou desconhecido." });
      return;
    }
    if (currency !== "brl" && currency !== "usd") {
      res.status(400).json({ error: "Moeda deve ser BRL ou USD." });
      return;
    }
    if (periodicity !== "monthly" && periodicity !== "annual") {
      res.status(400).json({ error: "Periodicidade deve ser mensal ou anual." });
      return;
    }
    if (!isFiniteNumber(salaryMin) || !isFiniteNumber(salaryMax) || salaryMin <= 0 || salaryMax <= 0) {
      res.status(400).json({ error: "Informe valores de salário positivos." });
      return;
    }
    if (salaryMin > salaryMax) {
      res.status(400).json({ error: "O valor mínimo não pode ser maior que o máximo." });
      return;
    }
    if (typeof observedAt !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(observedAt)) {
      res.status(400).json({ error: "Data da observação deve estar no formato AAAA-MM-DD." });
      return;
    }

    const { runId } = await insertManualObservation({
      roleTitle: roleTitle.trim(),
      seniority: typeof seniority === "string" && seniority.trim() ? seniority.trim() : null,
      state: (state as string | null | undefined) ?? null,
      regime,
      salaryMin,
      salaryMax,
      currency,
      periodicity,
      observedAt,
      openSource: openSourceRow.name,
      sourceReference: openSourceRow.url,
    });

    void recordAuditEvent({
      action: "BENCHMARK_MANUAL_OBSERVATION_CREATED",
      actorUserId: req.user!.id,
      metadata: { roleTitle: roleTitle.trim(), openSource: openSourceRow.name, sourceReference: openSourceRow.url, runId },
    });

    res.status(201).json({ ok: true, runId });
  });

  return router;
}
