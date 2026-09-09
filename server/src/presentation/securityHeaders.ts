/**
 * Cabecalhos de seguranca HTTP.
 *
 * Vive num modulo proprio (e nao inline em server/index.ts) para que o app dos testes
 * (`server/tests/testApp.ts`) monte exatamente a mesma pilha do processo de producao -- caso
 * contrario a suite validaria um app sem estes cabecalhos, e uma regressao aqui passaria batido.
 *
 * Antes disso o app nao enviava cabecalho de seguranca nenhum: sem HSTS, sem `nosniff`, sem
 * protecao de clickjacking, e ainda anunciando `x-powered-by: Express` (o proprio
 * docs/REQUISITOS-INFRA.md usava esse header como confirmacao de que o deploy tinha subido).
 */
import type { Express } from "express";
import helmet from "helmet";

export function applySecurityHeaders(app: Express, options: { isProduction: boolean }): void {
  app.use(
    helmet({
      // Definida separadamente abaixo, em modo report-only.
      contentSecurityPolicy: false,
      // O front e servido pela mesma origem e nao usa SharedArrayBuffer; COEP so quebraria
      // fontes/imagens externas sem ganho real aqui.
      crossOriginEmbedderPolicy: false,
      // HSTS so em producao: em dev o app roda em http://localhost, e o header faria o
      // navegador passar a exigir HTTPS de localhost -- travando o ambiente local por meses,
      // porque o cache de HSTS do navegador nao expira ao desligar o servidor.
      hsts: options.isProduction ? { maxAge: 31_536_000, includeSubDomains: true, preload: false } : false,
    }),
  );

  /**
   * CSP em REPORT-ONLY, primeira etapa de um rollout em duas fases.
   *
   * A UI usa Radix e Framer Motion, que aplicam estilo inline (atributo `style`) o tempo todo.
   * Uma CSP restritiva em modo bloqueio pode quebrar a tela na hora, e nao da para afirmar que
   * nao quebra sem exercitar o app num navegador de verdade. Report-only envia a mesma politica
   * e apenas RELATA a violacao, sem bloquear nada -- da para observar o que de fato viola antes
   * de fazer valer.
   *
   * Proximo passo (registrado em docs/RUNBOOK.md): revisar os relatorios e migrar para modo
   * bloqueio trocando `reportOnly` por false.
   */
  app.use(
    helmet.contentSecurityPolicy({
      reportOnly: true,
      directives: {
        defaultSrc: ["'self'"],
        // Consequencia direta do estilo inline de Radix/Framer Motion.
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'"],
        imgSrc: ["'self'", "data:"],
        fontSrc: ["'self'", "data:"],
        // O front so chama a propria API. O Sentry, quando configurado, envia do backend.
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
      },
    }),
  );
}
