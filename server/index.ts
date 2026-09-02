import "dotenv/config";
import express from "express";
import { createServer } from "http";
import path from "path";
import { fileURLToPath } from "url";
import { isSessionCookieValid, parseCookie, SESSION_COOKIE_NAME } from "./src/infrastructure/auth/session";
import { createApiRouter } from "./src/presentation/app";

const PUBLIC_AUTH_PATHS = new Set(["/api/v1/healthz", "/api/v1/auth/login", "/api/v1/auth/session", "/api/v1/auth/logout"]);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const server = createServer(app);
  const isProduction = process.env.NODE_ENV === "production";
  const testAccessUser = process.env.TEST_ACCESS_USER;
  const testAccessPassword = process.env.TEST_ACCESS_PASSWORD;

  if (isProduction && testAccessUser && testAccessPassword) {
    // Gate por sessao (cookie assinado), nao Basic Auth: o popup nativo do navegador nao
    // reflete a identidade visual do produto. A SPA sempre carrega; e o React quem decide
    // se mostra a tela de login ou o app, consultando GET /api/v1/auth/session.
    app.use((req, res, next) => {
      if (!req.path.startsWith("/api/v1/") || PUBLIC_AUTH_PATHS.has(req.path)) {
        next();
        return;
      }

      const token = parseCookie(req.headers.cookie, SESSION_COOKIE_NAME);
      if (isSessionCookieValid(token, testAccessPassword)) {
        next();
        return;
      }

      res.status(401).json({ error: "unauthorized" });
    });
  }

  app.use("/api/v1", createApiRouter());

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
