"use strict";
// Gecentraliseerde, gestructureerde logger (RB-8).
//
// Vervangt losse `console.*`-aanroepen door één logger die:
//   • gestructureerde JSON-regels naar stdout/stderr schrijft (machine-leesbaar,
//     doorzoekbaar in Railway/Grafana Loki/Better Stack);
//   • elke regel voorziet van timestamp, severity, component en — waar beschikbaar —
//     een request-correlatie-id (zie de request-context-middleware van de consumer);
//   • foutobjecten met stacktrace serialiseert;
//   • fouten automatisch naar Sentry doorstuurt (met request-id als tag).
//
// De methodes zijn console-compatibel (variadisch): `log.error("iets mislukt", err)`
// of `log.info("gestart", { port })`. Argumenten worden ontleed — Error-objecten
// leveren de stacktrace, plain objects worden als structured metadata samengevoegd,
// primitieven vormen de boodschap. Zo is de migratie vanaf `console.*` verliesloos.
//
// Zero-dependency met opzet: geen extra runtime-afhankelijkheid, volledig onder
// eigen controle, en veilig in elke omgeving (dev/test/prod).
//
// Geëxtraheerd uit Veynoris (apps/api/src/lib/logger.ts) naar @goodapp/observability.
// Gedrag ongewijzigd; enige toevoeging is `configureObservability({ serviceName })`,
// optioneel en zonder effect als nooit aangeroepen.
Object.defineProperty(exports, "__esModule", { value: true });
exports.logger = exports.requestContext = void 0;
exports.currentRequestId = currentRequestId;
exports.configureObservability = configureObservability;
exports.createLogger = createLogger;
const async_hooks_1 = require("async_hooks");
const sentry_js_1 = require("./sentry.js");
const redactie_js_1 = require("../shared/redactie.js");
const LEVEL_WEIGHT = { debug: 10, info: 20, warn: 30, error: 40 };
exports.requestContext = new async_hooks_1.AsyncLocalStorage();
/** Het huidige request-id (indien binnen een request-scope), anders undefined. */
function currentRequestId() {
    return exports.requestContext.getStore()?.requestId;
}
let configuredServiceName;
/**
 * Optionele, eenmalige configuratie voor de hele package. Wanneer `serviceName`
 * gezet wordt, krijgt elke logregel een `service`-veld — handig zodra meerdere
 * GoodApp-producten dezelfde Sentry/log-pijplijn delen. Zonder aanroep is de
 * output byte-identiek aan vóór deze package bestond.
 */
function configureObservability(options) {
    if (options.serviceName)
        configuredServiceName = options.serviceName;
}
function resolveMinLevel() {
    const explicit = process.env.LOG_LEVEL?.toLowerCase();
    if (explicit && explicit in LEVEL_WEIGHT)
        return explicit;
    const env = process.env.NODE_ENV;
    if (env === "test")
        return "error"; // testsuite schoon houden
    if (env === "development")
        return "debug"; // maximale zichtbaarheid lokaal
    return "info"; // productie/staging
}
const MIN_LEVEL = resolveMinLevel();
function serializeError(err) {
    // PLAT-184: een foutmelding en stack kunnen een geheim dragen (een
    // verbindingssnoer in een opdrachtregel, een Authorization-header).
    return {
        name: err.name,
        message: (0, redactie_js_1.redacteerTekst)(err.message),
        stack: err.stack === undefined ? undefined : (0, redactie_js_1.redacteerTekst)(err.stack),
    };
}
// Ontleedt variadische argumenten in { msg, err?, meta } zodat zowel de
// console-stijl (`"tekst:", value`) als de gestructureerde stijl
// (`"tekst", { key: value }`) verliesloos werken.
function parseArgs(parts) {
    const words = [];
    let err;
    let meta;
    for (const p of parts) {
        if (p === undefined || p === null)
            continue;
        if (p instanceof Error) {
            if (!err)
                err = p;
            else
                words.push(p.message);
        }
        else if (typeof p === "object") {
            meta = { ...(meta ?? {}), ...p };
        }
        else {
            words.push(String(p));
        }
    }
    return { msg: words.join(" "), err, meta };
}
function emit(level, component, parts) {
    if (LEVEL_WEIGHT[level] < LEVEL_WEIGHT[MIN_LEVEL])
        return;
    const gelezen = parseArgs(parts);
    // PLAT-184: de logger schreef tot nu toe ongefilterd; alleen Sentry redigeerde.
    // Zie `redacteerVoorLog` voor wat wel en wat bewust niet wordt weggehaald.
    const msg = (0, redactie_js_1.redacteerTekst)(gelezen.msg);
    const meta = gelezen.meta ? (0, redactie_js_1.redacteerVoorLog)(gelezen.meta) : undefined;
    const err = gelezen.err;
    const ctx = exports.requestContext.getStore();
    const record = {
        ts: new Date().toISOString(),
        level,
        component,
        msg,
    };
    if (configuredServiceName)
        record.service = configuredServiceName;
    if (ctx?.requestId)
        record.requestId = ctx.requestId;
    if (ctx?.userId)
        record.userId = ctx.userId;
    if (ctx?.organizationId)
        record.organizationId = ctx.organizationId;
    if (meta)
        Object.assign(record, meta);
    if (err)
        record.err = serializeError(err);
    const line = safeStringify(record) + "\n";
    if (level === "error" || level === "warn") {
        process.stderr.write(line);
    }
    else {
        process.stdout.write(line);
    }
    // Diagnostiek naar Sentry: errors als exception (met stack), zodat alerting/
    // grouping blijft werken. captureException/captureMessage is een no-op wanneer
    // geen DSN is geconfigureerd, dus onvoorwaardelijk aanroepen is veilig.
    if (level === "error") {
        const tags = { component, ...(ctx?.requestId ? { requestId: ctx.requestId } : {}) };
        const extra = { ...meta, msg };
        if (err) {
            sentry_js_1.Sentry.captureException(err, { tags, extra });
        }
        else {
            sentry_js_1.Sentry.captureMessage(msg || "error", { level: "error", tags, extra });
        }
    }
}
function safeStringify(record) {
    try {
        return JSON.stringify(record);
    }
    catch {
        // Circular of niet-serialiseerbare meta: val terug op een minimale regel.
        return JSON.stringify({ ts: record.ts, level: record.level, component: record.component, msg: record.msg });
    }
}
/**
 * Maakt een aan een component gebonden logger. Gebruik één per module/subsysteem,
 * bv. `const log = createLogger("cron");`.
 */
function createLogger(component) {
    return {
        debug: (...parts) => emit("debug", component, parts),
        info: (...parts) => emit("info", component, parts),
        warn: (...parts) => emit("warn", component, parts),
        error: (...parts) => emit("error", component, parts),
    };
}
// Algemene logger voor code die (nog) geen eigen component heeft.
exports.logger = createLogger("app");
