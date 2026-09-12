/**
 * Visão do admin sobre o benchmark worker: fontes, execuções recentes e consulta por cargo na
 * base pública do governo (CAGED/SISP). Somente leitura -- a coleta automatizada continua
 * exclusivamente com o worker Python (benchmark-worker/), agendado via GitHub Actions. Esta
 * tela nunca aciona scraping nem qualquer automação contra terceiros.
 *
 * A "base aberta" (guias públicos de terceiros, ex. Robert Half) NÃO tem alimentação por aqui:
 * o único jeito de ler o valor é um humano abrir a página e digitar, e o produto decidiu não
 * sustentar esse fluxo manual na UI (ver histórico do PR que removeu `manual-entry`,
 * `open-sources` e `open-source-triggers` -- automatizar a coleta violaria o ToS da Robert
 * Half, cláusula 5g, que proíbe "robôs ou sistemas de varredura"). As tabelas
 * `benchmark_open_sources` e as colunas de `benchmark_results` ligadas a isso continuam no
 * banco (dado histórico preservado), só não são mais escritas por esta rota.
 */
import express, { type Router } from "express";
import { getEnrichedLaborProfiles, type EnrichedLaborProfile } from "../domain/services/laborBenchmark";
import { listBenchmarkSources, listRecentBenchmarkRuns } from "../infrastructure/repositories/benchmarkWorkerRepository";
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

  // Cargo digitado -> perfis do catalogo casados (titulo + senioridade + regime), com o valor
  // real observado (CAGED/SISP) quando existir -- getEnrichedLaborProfiles ja funde catalogo e
  // observacao, essa rota so filtra por titulo.
  router.get("/admin/benchmark-worker/role-lookup", async (req, res) => {
    const role = typeof req.query.role === "string" ? req.query.role.trim() : "";
    const stateRaw = typeof req.query.state === "string" ? req.query.state.trim().toUpperCase() : "";
    const state = stateRaw && BRAZILIAN_STATES.has(stateRaw) ? stateRaw : null;

    if (!role) {
      res.status(400).json({ error: "Informe o cargo para consultar." });
      return;
    }

    const normalizedQuery = normalizeText(role);
    const allProfiles = await getEnrichedLaborProfiles({ uf: state });
    const government = allProfiles.filter((p: EnrichedLaborProfile) => normalizeText(p.title).includes(normalizedQuery));

    res.json({ role, state, government });
  });

  return router;
}
