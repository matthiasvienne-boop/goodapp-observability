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
/**
 * Redacteert een waarde die naar een logregel gaat (PLAT-184).
 *
 * WAAROM NIET GEWOON `redacteer`
 *
 * `redacteer` is gebouwd voor Sentry, waar de lat hoog mag liggen: het haalt
 * naast geheimen ook vertrouwelijke bedrijfswoorden weg (`prijs`, `bedrag`,
 * `email`, `bericht`, ...). In een logregel zou dat de regel onbruikbaar maken:
 * Brickstory logt prijzen, een mailfout hoort het adres te noemen. Een logger
 * die zoveel weghaalt wordt omzeild of uitgezet, en dan is er niets meer
 * beschermd. Deze functie haalt daarom alleen echte geheimen weg, op twee
 * manieren:
 *
 * 1. Sleutels uit de geheime lijst (`password`, `token`, `authorization`, ...):
 *    de waarde gaat weg. Alleen tekst en objecten; een getal of een boolean is
 *    geen inloggegeven, en `inputTokens: 1200` of `sessionCount: 3` hoort te
 *    blijven staan.
 * 2. Elke tekstwaarde gaat door `redacteerTekst`, zodat een verbindingssnoer of
 *    een `Authorization: Bearer ...` in een gewone string ook verdwijnt.
 *
 * Objecten die geen gewoon object zijn (Date, Buffer, Map, ...) blijven ongemoeid:
 * `JSON.stringify` weet er zelf raad mee, en `Object.entries` zou een Date tot
 * `{}` maken. De diepte is begrensd zodat een cyclische structuur de logger niet
 * laat vastlopen.
 */
export declare function redacteerVoorLog(waarde: unknown, diepte?: number, extra?: ExtraSleutels): unknown;
export declare function redacteerHeaders(headers: Record<string, unknown> | undefined): Record<string, unknown>;
/**
 * Strip de querystring en het fragment uit een URL.
 *
 * `/api/klanten?naam=Acme%20NV&bedrag=45000` zou anders klantnaam en bedrag naar
 * Sentry sturen via het pad alleen.
 */
export declare function redacteerUrl(url: string | undefined): string | undefined;
export declare function redacteerTekst(tekst: string): string;
export declare function redacteerTekst(tekst: string | undefined): string | undefined;
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
    /** De foutmelding zelf. Vrije tekst, dus zonder sleutels om op te matchen. */
    exception?: {
        values?: Array<{
            type?: string;
            value?: string;
            stacktrace?: {
                frames?: Array<{
                    vars?: Record<string, unknown>;
                }>;
            };
        }>;
    };
    /** De sjabloonvorm van captureMessage; Sentry vult hier `params` los bij. */
    logentry?: {
        message?: string;
        params?: unknown[];
    };
}
/**
 * Schoont een volledig Sentry-event.
 *
 * De request body wordt in zijn geheel verwijderd in plaats van geschoond: een body
 * kan elke vorm hebben, en veld-voor-veld schonen mist onvermijdelijk het veld dat
 * volgende maand wordt toegevoegd.
 */
export declare function schoonEvent<T extends SentryAchtigEvent>(event: T, extra?: ExtraSleutels): T;
