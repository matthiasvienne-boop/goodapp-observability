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
exports.initFrontendSentry = initFrontendSentry;
// Frontend Sentry-initialisatie. Spiegelt het inline blok in Veynoris'
// apps/web/src/main.tsx (was nooit in een eigen module ondergebracht daar —
// deze package is de eerste keer dat dit als herbruikbare functie bestaat).
// No-op zolang geen dsn is meegegeven.
const Sentry = __importStar(require("@sentry/react"));
const redactie_js_1 = require("../shared/redactie.js");
function initFrontendSentry(options = {}) {
    if (!options.dsn)
        return;
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
            return (0, redactie_js_1.schoonEvent)(event);
        },
    });
}
