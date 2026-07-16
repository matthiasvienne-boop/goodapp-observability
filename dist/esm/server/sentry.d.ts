import * as Sentry from "@sentry/node";
import type { Application } from "express";
export interface BackendSentryOptions {
    dsn?: string;
    environment?: string;
    release?: string;
    tracesSampleRate?: number;
    serviceName?: string;
}
export declare function initBackendSentry(options?: BackendSentryOptions): void;
export declare function setupBackendSentryErrorHandler(app: Application): void;
export { Sentry };
