import "dotenv/config";
// Sem isso, uma rejeicao numa rota async (a maioria das rotas do app) nao chega no
// middleware de erro abaixo — vira uma promise rejeitada silenciosa, sem resposta ao
// cliente e sem log/Sentry. Precisa ser importado antes de qualquer rota ser definida.
import "express-async-errors";
import express from "express";
import { createServer } from "http";
import path from "path";
import { fileURLToPath } from "url";
import { isDatabaseConfigured } from "./src/infrastructure/db/client";
import { logger } from "./src/infrastructure/observability/logger";
import { attachUser } from "./src/presentation/authMiddleware";
import { createApiRouter } from "./src/presentation/app";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const server = createServer(app);
  const isProduction = process.env.NODE_ENV === "production";

  // Sem banco nao ha usuarios possiveis (RBAC e todo persistido no Postgres) -- app.use
  // condicional aqui evita atrasar toda requisicao com uma consulta que sempre falharia.
  if (isDatabaseConfigured) {
    app.use("/api/v1", attachUser);
  }

  app.use("/api/v1", createApiRouter());

  // Handler de erro global: qualquer excecao (sincrona ou, via express-async-errors, de
  // dentro de uma rota async) que nao foi tratada dentro da propria rota cai aqui. Loga
  // via logger.error (que encaminha pro Sentry quando SENTRY_DSN estiver configurada) e
  // devolve JSON em vez da pagina de erro HTML padrao do Express.
  app.use("/api/v1", (err: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
    logger.error("Erro nao tratado numa rota da API", {
      path: req.path,
      method: req.method,
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: "Erro interno. Ja foi registrado para investigacao." });
  });

  if (isProduction) {
    // Em produção o bundle (esbuild) coloca este arquivo em dist/index.js, então
    // dist/public fica um nível abaixo de __dirname.
    const staticPath = path.resolve(__dirname, "public");
    app.use(express.static(staticPath));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(staticPath, "index.html"));
    });
  }

  const port = Number(process.env.PORT) || (isProduction ? 3000 : 3001);

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
}

startServer().catch(console.error);
