import * as Sentry from "@sentry/node";

const dsn = process.env.SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? "development",
    // Só rastreamento de erro (plano free do Sentry); sem tracing de performance.
    tracesSampleRate: 0,
  });
}

export const sentryEnabled = Boolean(dsn);

/** No-op quando SENTRY_DSN não está configurado (dev local e antes do onboarding). */
export function captureError(message: string, fields?: Record<string, unknown>): void {
  if (!sentryEnabled) return;
  Sentry.captureException(new Error(message), { extra: fields });
}
