// Frontend Sentry-initialisatie. Spiegelt het inline blok in Veynoris'
// apps/web/src/main.tsx (was nooit in een eigen module ondergebracht daar —
// deze package is de eerste keer dat dit als herbruikbare functie bestaat).
// No-op zolang geen dsn is meegegeven.
import * as Sentry from "@sentry/react";
import { schoonEvent, type ExtraSleutels } from "../shared/redactie.js";

export interface FrontendSentryOptions {
  dsn?: string;
  environment?: string;
  release?: string;
  tracesSampleRate?: number;
  serviceName?: string;
}

export function initFrontendSentry(options: FrontendSentryOptions = {}): void {
  if (!options.dsn) return;

  const environment = options.environment ?? "production";

  Sentry.init({
    dsn: options.dsn,
    environment,
    release: options.release,
    // Was standaard 1.0, ook in productie: elke paginanavigatie een transactie.
    // Buiten productie blijft alles bemonsterd, want daar is volume geen bezwaar.
    tracesSampleRate: options.tracesSampleRate ?? (environment === "production" ? 0.1 : 1.0),
    integrations: [Sentry.browserTracingIntegration()],
    initialScope: options.serviceName ? { tags: { service: options.serviceName } } : undefined,
    // Dezelfde redactie als de backend. Zonder dit legden breadcrumbs elke fetch-
    // en XHR-URL vast, query string incluis, en ging het volledige gebruikersobject
    // mee.
    beforeSend(event) {
      return schoonEvent(event);
    },
  });
}
