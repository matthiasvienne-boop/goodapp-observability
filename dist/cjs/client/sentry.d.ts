export interface FrontendSentryOptions {
    dsn?: string;
    environment?: string;
    release?: string;
    tracesSampleRate?: number;
    serviceName?: string;
}
export declare function initFrontendSentry(options?: FrontendSentryOptions): void;
