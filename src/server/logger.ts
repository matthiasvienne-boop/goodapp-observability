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

import { AsyncLocalStorage } from "async_hooks";
import { Sentry } from "./sentry";

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_WEIGHT: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

// Per-request correlatiecontext. Gevuld door de request-context-middleware van de
// consumer zodat élke logregel binnen een request automatisch het juiste request-id
// draagt — zonder dat het door de hele call-stack doorgegeven hoeft te worden.
export interface RequestContext {
  requestId: string;
  method?: string;
  path?: string;
  userId?: string;
  organizationId?: string;
}

export const requestContext = new AsyncLocalStorage<RequestContext>();

/** Het huidige request-id (indien binnen een request-scope), anders undefined. */
export function currentRequestId(): string | undefined {
  return requestContext.getStore()?.requestId;
}

let configuredServiceName: string | undefined;

/**
 * Optionele, eenmalige configuratie voor de hele package. Wanneer `serviceName`
 * gezet wordt, krijgt elke logregel een `service`-veld — handig zodra meerdere
 * GoodApp-producten dezelfde Sentry/log-pijplijn delen. Zonder aanroep is de
 * output byte-identiek aan vóór deze package bestond.
 */
export function configureObservability(options: { serviceName?: string }): void {
  if (options.serviceName) configuredServiceName = options.serviceName;
}

function resolveMinLevel(): LogLevel {
  const explicit = process.env.LOG_LEVEL?.toLowerCase();
  if (explicit && explicit in LEVEL_WEIGHT) return explicit as LogLevel;
  const env = process.env.NODE_ENV;
  if (env === "test") return "error";       // testsuite schoon houden
  if (env === "development") return "debug"; // maximale zichtbaarheid lokaal
  return "info";                             // productie/staging
}

const MIN_LEVEL = resolveMinLevel();

type Meta = Record<string, unknown>;

interface ErrShape {
  name: string;
  message: string;
  stack?: string;
}

function serializeError(err: Error): ErrShape {
  return { name: err.name, message: err.message, stack: err.stack };
}

// Ontleedt variadische argumenten in { msg, err?, meta } zodat zowel de
// console-stijl (`"tekst:", value`) als de gestructureerde stijl
// (`"tekst", { key: value }`) verliesloos werken.
function parseArgs(parts: unknown[]): { msg: string; err?: Error; meta?: Meta } {
  const words: string[] = [];
  let err: Error | undefined;
  let meta: Meta | undefined;

  for (const p of parts) {
    if (p === undefined || p === null) continue;
    if (p instanceof Error) {
      if (!err) err = p;
      else words.push(p.message);
    } else if (typeof p === "object") {
      meta = { ...(meta ?? {}), ...(p as Meta) };
    } else {
      words.push(String(p));
    }
  }

  return { msg: words.join(" "), err, meta };
}

function emit(level: LogLevel, component: string, parts: unknown[]): void {
  if (LEVEL_WEIGHT[level] < LEVEL_WEIGHT[MIN_LEVEL]) return;

  const { msg, err, meta } = parseArgs(parts);
  const ctx = requestContext.getStore();
  const record: Record<string, unknown> = {
    ts: new Date().toISOString(),
    level,
    component,
    msg,
  };
  if (configuredServiceName) record.service = configuredServiceName;
  if (ctx?.requestId) record.requestId = ctx.requestId;
  if (ctx?.userId) record.userId = ctx.userId;
  if (ctx?.organizationId) record.organizationId = ctx.organizationId;
  if (meta) Object.assign(record, meta);
  if (err) record.err = serializeError(err);

  const line = safeStringify(record) + "\n";
  if (level === "error" || level === "warn") {
    process.stderr.write(line);
  } else {
    process.stdout.write(line);
  }

  // Diagnostiek naar Sentry: errors als exception (met stack), zodat alerting/
  // grouping blijft werken. captureException/captureMessage is een no-op wanneer
  // geen DSN is geconfigureerd, dus onvoorwaardelijk aanroepen is veilig.
  if (level === "error") {
    const tags = { component, ...(ctx?.requestId ? { requestId: ctx.requestId } : {}) };
    const extra = { ...meta, msg };
    if (err) {
      Sentry.captureException(err, { tags, extra });
    } else {
      Sentry.captureMessage(msg || "error", { level: "error", tags, extra });
    }
  }
}

function safeStringify(record: Record<string, unknown>): string {
  try {
    return JSON.stringify(record);
  } catch {
    // Circular of niet-serialiseerbare meta: val terug op een minimale regel.
    return JSON.stringify({ ts: record.ts, level: record.level, component: record.component, msg: record.msg });
  }
}

export interface Logger {
  debug(...parts: unknown[]): void;
  info(...parts: unknown[]): void;
  warn(...parts: unknown[]): void;
  error(...parts: unknown[]): void;
}

/**
 * Maakt een aan een component gebonden logger. Gebruik één per module/subsysteem,
 * bv. `const log = createLogger("cron");`.
 */
export function createLogger(component: string): Logger {
  return {
    debug: (...parts) => emit("debug", component, parts),
    info: (...parts) => emit("info", component, parts),
    warn: (...parts) => emit("warn", component, parts),
    error: (...parts) => emit("error", component, parts),
  };
}

// Algemene logger voor code die (nog) geen eigen component heeft.
export const logger = createLogger("app");
