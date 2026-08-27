// Backend Sentry-initialisatie. Geëxtraheerd uit Veynoris (apps/api/src/lib/sentry.ts).
//
// Gedrag ongewijzigd t.o.v. het origineel: no-op zolang geen DSN geconfigureerd is,
// zodat elke consumer dit veilig onvoorwaardelijk kan aanroepen. Opties zijn
// toegevoegd zodat een consumer expliciet dsn/environment/release/serviceName kan
// meegeven i.p.v. altijd op dezelfde env-var-namen te vertrouwen — elke optie valt
// terug op exact de env vars die Veynoris vandaag al leest.
import * as Sentry from "@sentry/node";
import { schoonEvent } from "../shared/redactie.js";
export function initBackendSentry(options = {}) {
    const dsn = options.dsn ?? process.env.SENTRY_DSN;
    if (!dsn)
        return;
    Sentry.init({
        dsn,
        environment: options.environment ?? process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? "production",
        release: options.release ?? process.env.SENTRY_RELEASE ?? undefined,
        tracesSampleRate: options.tracesSampleRate ?? (process.env.NODE_ENV === "production" ? 0.1 : 1.0),
        initialScope: options.serviceName ? { tags: { service: options.serviceName } } : undefined,
        // Hier stond een filter op alleen `request.data`. Headers, cookies en query
        // string gingen ongefilterd mee, inclusief authorization en het servicetoken
        // tussen de producten onderling.
        beforeSend(event) {
            return schoonEvent(event, options.extraGevoeligeSleutels);
        },
    });
}
// Controleert of Sentry daadwerkelijk geïnitialiseerd is (i.p.v. de env var opnieuw
// te lezen) zodat dit ook correct werkt wanneer de dsn via `options` is meegegeven
// in plaats van via SENTRY_DSN.
export function setupBackendSentryErrorHandler(app) {
    if (!Sentry.getClient())
        return;
    Sentry.setupExpressErrorHandler(app);
}
export { Sentry };
