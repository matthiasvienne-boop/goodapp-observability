// Frontend Sentry-initialisatie. Spiegelt het inline blok in Veynoris'
// apps/web/src/main.tsx (was nooit in een eigen module ondergebracht daar —
// deze package is de eerste keer dat dit als herbruikbare functie bestaat).
// Gedrag ongewijzigd: no-op zolang geen dsn is meegegeven.
import * as Sentry from "@sentry/react";

export interface FrontendSentryOptions {
  dsn?: string;
  environment?: string;
  release?: string;
  tracesSampleRate?: number;
  serviceName?: string;
}

export function initFrontendSentry(options: FrontendSentryOptions = {}): void {
  if (!options.dsn) return;

  Sentry.init({
    dsn: options.dsn,
    environment: options.environment ?? "production",
    release: options.release,
    tracesSampleRate: options.tracesSampleRate ?? 1.0,
    integrations: [Sentry.browserTracingIntegration()],
    initialScope: options.serviceName ? { tags: { service: options.serviceName } } : undefined,
  });
}
