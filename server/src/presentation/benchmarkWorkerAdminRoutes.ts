/**
 * Visão do admin sobre o benchmark worker: fontes, execuções recentes e registro manual
 * de observação (ver docs/BENCHMARK-WORKER-MANUAL.md, seção 3.2). Somente leitura para
 * fontes/execuções -- a coleta automatizada continua exclusivamente com o worker Python
 * (benchmark-worker/), agendado via GitHub Actions. Esta tela nunca aciona scraping nem
 * qualquer automação contra Indeed/Glassdoor/InfoJobs.
 */
import express, { type Router } from "express";
import { isAllowedManualSourceReference } from "../domain/services/benchmarkSourceValidation";
import { recordAuditEvent } from "../infrastructure/repositories/auditRepository";
import { insertManualObservation, listBenchmarkSources, listRecentBenchmarkRuns } from "../infrastructure/repositories/benchmarkWorkerRepository";
import { requirePermission } from "./authMiddleware";

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

  router.post("/admin/benchmark-worker/manual-entry", async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const { roleTitle, seniority, state, regime, salaryMin, salaryMax, currency, periodicity, observedAt, sourceReference } = body;

    if (typeof roleTitle !== "string" || !roleTitle.trim()) {
      res.status(400).json({ error: "Cargo é obrigatório." });
      return;
    }
    if (typeof sourceReference !== "string" || !sourceReference.trim()) {
      res.status(400).json({ error: "A referência da fonte (URL/relatório consultado) é obrigatória." });
      return;
    }
    if (!isAllowedManualSourceReference(sourceReference)) {
      res.status(400).json({
        error: "Use uma fonte pública autorizada e legítima, como Robert Half, Salary.com ou outro material institucional reconhecido. URLs genéricas, lead-gen e sites não autorizados são bloqueados.",
      });
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
      sourceReference: sourceReference.trim(),
    });

    void recordAuditEvent({
      action: "BENCHMARK_MANUAL_OBSERVATION_CREATED",
      actorUserId: req.user!.id,
      metadata: { roleTitle: roleTitle.trim(), sourceReference: sourceReference.trim(), runId },
    });

    res.status(201).json({ ok: true, runId });
  });

  return router;
}
