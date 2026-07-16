import { AsyncLocalStorage } from "async_hooks";
export type LogLevel = "debug" | "info" | "warn" | "error";
export interface RequestContext {
    requestId: string;
    method?: string;
    path?: string;
    userId?: string;
    organizationId?: string;
}
export declare const requestContext: AsyncLocalStorage<RequestContext>;
/** Het huidige request-id (indien binnen een request-scope), anders undefined. */
export declare function currentRequestId(): string | undefined;
/**
 * Optionele, eenmalige configuratie voor de hele package. Wanneer `serviceName`
 * gezet wordt, krijgt elke logregel een `service`-veld — handig zodra meerdere
 * GoodApp-producten dezelfde Sentry/log-pijplijn delen. Zonder aanroep is de
 * output byte-identiek aan vóór deze package bestond.
 */
export declare function configureObservability(options: {
    serviceName?: string;
}): void;
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
export declare function createLogger(component: string): Logger;
export declare const logger: Logger;
