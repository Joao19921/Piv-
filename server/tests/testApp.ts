import "dotenv/config";
import express from "express";
import { attachUser } from "../src/presentation/authMiddleware";
import { createApiRouter } from "../src/presentation/app";

/** Monta o Express app do mesmo jeito que server/index.ts, sem os arquivos estaticos (nao precisam de teste). */
export function buildTestApp() {
  const app = express();
  app.use("/api/v1", attachUser);
  app.use("/api/v1", createApiRouter());
  return app;
}
