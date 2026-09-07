// Carrega .env antes de qualquer arquivo de teste importar server/src/infrastructure/db/client.ts
// (que le DATABASE_URL uma unica vez, no topo do modulo -- precisa estar populado antes disso).
import "dotenv/config";
