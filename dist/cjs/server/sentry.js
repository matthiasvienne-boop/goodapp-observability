"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.Sentry = void 0;
exports.initBackendSentry = initBackendSentry;
exports.setupBackendSentryErrorHandler = setupBackendSentryErrorHandler;
// Backend Sentry-initialisatie. Geëxtraheerd uit Veynoris (apps/api/src/lib/sentry.ts).
//
// Gedrag ongewijzigd t.o.v. het origineel: no-op zolang geen DSN geconfigureerd is,
// zodat elke consumer dit veilig onvoorwaardelijk kan aanroepen. Opties zijn
// toegevoegd zodat een consumer expliciet dsn/environment/release/serviceName kan
// meegeven i.p.v. altijd op dezelfde env-var-namen te vertrouwen — elke optie valt
// terug op exact de env vars die Veynoris vandaag al leest.
const Sentry = __importStar(require("@sentry/node"));
exports.Sentry = Sentry;
const redactie_js_1 = require("../shared/redactie.js");
function initBackendSentry(options = {}) {
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
            return (0, redactie_js_1.schoonEvent)(event, options.extraGevoeligeSleutels);
        },
    });
}
// Controleert of Sentry daadwerkelijk geïnitialiseerd is (i.p.v. de env var opnieuw
// te lezen) zodat dit ook correct werkt wanneer de dsn via `options` is meegegeven
// in plaats van via SENTRY_DSN.
function setupBackendSentryErrorHandler(app) {
    if (!Sentry.getClient())
        return;
    Sentry.setupExpressErrorHandler(app);
}
