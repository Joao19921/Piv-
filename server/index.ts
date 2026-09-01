import "dotenv/config";
import express from "express";
import { createServer } from "http";
import path from "path";
import { fileURLToPath } from "url";
import { createApiRouter } from "./src/presentation/app";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const server = createServer(app);
  const isProduction = process.env.NODE_ENV === "production";
  const testAccessUser = process.env.TEST_ACCESS_USER;
  const testAccessPassword = process.env.TEST_ACCESS_PASSWORD;

  if (isProduction && testAccessUser && testAccessPassword) {
    app.use((req, res, next) => {
      if (req.path === "/api/v1/healthz") {
        next();
        return;
      }

      const header = req.headers.authorization;
      const encoded = header?.startsWith("Basic ") ? header.slice("Basic ".length) : "";
      const [user, password] = Buffer.from(encoded, "base64").toString("utf-8").split(":");

      if (user === testAccessUser && password === testAccessPassword) {
        next();
        return;
      }

      res.setHeader("WWW-Authenticate", 'Basic realm="Pivo Testes"');
      res.status(401).send("Acesso restrito ao ambiente de testes.");
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
