import * as Sentry from "@sentry/node";
import type { Application } from "express";
import { type ExtraSleutels } from "../shared/redactie.js";
export interface BackendSentryOptions {
    dsn?: string;
    environment?: string;
    release?: string;
    tracesSampleRate?: number;
    serviceName?: string;
    /**
     * Sleutels die dit product gevoelig vindt, bovenop de gedeelde lijsten.
     *
     * Voor een product met eigen domeinwoorden — TenderDesk redigeert bijvoorbeeld
     * `tendertekst`. Zonder deze uitweg houdt zo'n product een eigen kopie van de
     * hele redactiemodule, en een kopie heeft geen historie en loopt af.
     */
    extraGevoeligeSleutels?: ExtraSleutels;
}
export declare function initBackendSentry(options?: BackendSentryOptions): void;
export declare function setupBackendSentryErrorHandler(app: Application): void;
export { Sentry };
