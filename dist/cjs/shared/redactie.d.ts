export declare const GEREDACTEERD = "[weggelaten]";
/**
 * Sleutels die dít product gevoelig vindt, bovenop de gedeelde lijsten.
 *
 * WAAROM DIT ERBIJ MOET
 *
 * TenderDesk droeg een eigen kopie van dit bestand — 203 regels, nagenoeg
 * identiek. Het enige verschil was één sleutel: `tendertekst`. Dat is een
 * woord uit één domein, en dat hoort niet in een gedeeld pakket: een pakket dat
 * de woordenschat van elk product opneemt wordt een framework, en dan zit elk
 * product vast aan de kleinste gemene deler.
 *
 * Maar 203 regels onderhouden om één sleutel is ook geen antwoord. Een kopie
 * heeft geen historie en loopt af.
 *
 * Vandaar dit: het mechanisme gedeeld, de woordenschat eigen. Dezelfde
 * verhouding die env-validation.ts bij drie producten al volgt — het gedeelde
 * pakket levert de controle, het product verklaart zijn eigen regels.
 */
export type ExtraSleutels = readonly string[];
/**
 * Redacteert een willekeurige waarde recursief.
 *
 * Diepte begrensd: een cyclische of extreem geneste structuur mag de foutafhandeling
 * niet laten vastlopen — dat zou van een fout een storing maken.
 */
export declare function redacteer(waarde: unknown, diepte?: number, extra?: ExtraSleutels): unknown;
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
export declare function schoonEvent<T extends SentryAchtigEvent>(event: T, extra?: ExtraSleutels): T;
