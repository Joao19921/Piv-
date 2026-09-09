import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["server/**/*.test.ts"],
    environment: "node",
    setupFiles: ["server/tests/setup.ts"],

    /**
     * O padrao do vitest (5s) e estruturalmente curto demais para esta suite, e os testes que
     * batem em `/api/v1/system-health` falhavam de forma intermitente por causa disso -- nao por
     * bug, mas por latencia de rede.
     *
     * Essa rota faz fan-out para tres APIs externas de verdade, e cada uma tem timeout proprio
     * mais retry com backoff (`resilienceManager`): PNCP 6s x 2 tentativas + 300ms = ~12,3s de
     * pior caso, Azure ~8,3s, BACEN ~6,3s. Como rodam em Promise.all, o pior caso da rota fica
     * em ~12,3s -- mais que o dobro do teto padrao. Quando a rede do runner estava rapida o
     * teste passava; quando nao estava, quebrava o build sem nada de errado no codigo.
     *
     * 30s da margem confortavel sobre esse pior caso. O teste que travar de verdade ainda falha,
     * so demora mais para reportar.
     *
     * A correcao de raiz e a suite nao depender de API externa (injetar/stubar os coletores) --
     * registrada como pendencia em docs/RUNBOOK.md.
     */
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
