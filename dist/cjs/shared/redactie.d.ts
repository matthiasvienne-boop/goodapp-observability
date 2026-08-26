export declare const GEREDACTEERD = "[weggelaten]";
/**
 * Redacteert een willekeurige waarde recursief.
 *
 * Diepte begrensd: een cyclische of extreem geneste structuur mag de foutafhandeling
 * niet laten vastlopen — dat zou van een fout een storing maken.
 */
export declare function redacteer(waarde: unknown, diepte?: number): unknown;
export declare function redacteerHeaders(headers: Record<string, unknown> | undefined): Record<string, unknown>;
/**
 * Strip de querystring en het fragment uit een URL.
 *
 * `/api/klanten?naam=Acme%20NV&bedrag=45000` zou anders klantnaam en bedrag naar
 * Sentry sturen via het pad alleen.
 */
export declare function redacteerUrl(url: string | undefined): string | undefined;
/** Minimale vorm van een Sentry-event, zodat deze module geen Sentry-SDK hoeft te importeren. */
export interface SentryAchtigEvent {
    request?: {
        url?: string;
        data?: unknown;
        headers?: Record<string, unknown>;
        cookies?: unknown;
        query_string?: unknown;
    };
    extra?: Record<string, unknown>;
    contexts?: Record<string, unknown>;
    breadcrumbs?: Array<{
        data?: unknown;
        message?: string;
    }>;
    user?: Record<string, unknown>;
    tags?: Record<string, unknown>;
    message?: string;
}
/**
 * Schoont een volledig Sentry-event.
 *
 * De request body wordt in zijn geheel verwijderd in plaats van geschoond: een body
 * kan elke vorm hebben, en veld-voor-veld schonen mist onvermijdelijk het veld dat
 * volgende maand wordt toegevoegd.
 */
export declare function schoonEvent<T extends SentryAchtigEvent>(event: T): T;
