import express, { type Request, type Response } from "express";
import { getModule3Config } from "./config";
import { saveSearch } from "./db";
import { listEquipment, listProfiles } from "./db";
import { searchComprasGov, searchPncp } from "./sources";
import type { Module3Config, PublicTender } from "./types";

function requireApiKey(config: Module3Config, req: Request, res: Response): boolean {
  if (!config.apiKey || req.header("x-api-key") === config.apiKey) return true;
  res.status(401).json({ error: "x-api-key inválida ou ausente." });
  return false;
}

function validateTerm(req: Request, res: Response): string | undefined {
  const term = typeof req.query.term === "string" ? req.query.term.trim() : "";
  if (term.length < 2 || term.length > 160) {
    res.status(400).json({ error: "term deve ter entre 2 e 160 caracteres." });
    return undefined;
  }
  return term;
}

export function createModule3App(config = getModule3Config()) {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "256kb" }));

  app.get("/healthz", (_req, res) => res.json({ status: "ok", service: "module3-public-data" }));

  app.get("/v1/mod3/public-tenders", async (req, res) => {
    if (!requireApiKey(config, req, res)) return;
    const term = validateTerm(req, res);
    if (!term) return;
    try {
      const [pncp, comprasGov] = await Promise.all([searchPncp(term, config), searchComprasGov(term, config)]);
      const tenders: PublicTender[] = [...pncp, ...comprasGov];
      await saveSearch(term, tenders);
      res.json({ term, count: tenders.length, tenders });
    } catch (error) {
      res.status(502).json({ error: "As fontes públicas não responderam.", detail: error instanceof Error ? error.message : String(error) });
    }
  });

  app.get("/v1/mod3/profiles", async (req, res) => {
    res.json({ data: await listProfiles(typeof req.query.term === "string" ? req.query.term : undefined), source: "mod3_perfis_talents" });
  });
  app.get("/v1/mod3/equipment", async (req, res) => {
    res.json({ data: await listEquipment(typeof req.query.term === "string" ? req.query.term : undefined), source: "mod3_equipamentos" });
  });
  return app;
}