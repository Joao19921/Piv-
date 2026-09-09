import "dotenv/config";
import express from "express";
import { attachUser } from "../src/presentation/authMiddleware";
import { createApiRouter } from "../src/presentation/app";
import { applySecurityHeaders } from "../src/presentation/securityHeaders";

/**
 * Monta o Express app do mesmo jeito que server/index.ts, sem os arquivos estaticos (nao
 * precisam de teste). Inclui `trust proxy` e os cabecalhos de seguranca de proposito: se a
 * suite montasse uma pilha diferente da de producao, uma regressao nesses middlewares passaria
 * batido justamente nos testes que existem para pega-la.
 */
export function buildTestApp() {
  const app = express();
  app.set("trust proxy", 1);
  applySecurityHeaders(app, { isProduction: false });
  app.use("/api/v1", attachUser);
  app.use("/api/v1", createApiRouter());
  return app;
}
