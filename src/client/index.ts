export { initFrontendSentry } from "./sentry.js";
export type { FrontendSentryOptions } from "./sentry.js";

export {
  GEREDACTEERD,
  redacteer,
  redacteerHeaders,
  redacteerTekst,
  redacteerUrl,
  schoonEvent,
} from "../shared/redactie.js";
export type { SentryAchtigEvent } from "../shared/redactie.js";
