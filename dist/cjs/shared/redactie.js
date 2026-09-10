"use strict";
// Wat er nooit naar Sentry mag.
//
// Pure functies, geen Sentry-import: daardoor is elke regel hier testbaar zonder
// netwerk, zonder DSN en zonder een echte foutmelding te versturen. `initBackendSentry`
// en `initFrontendSentry` hangen dit allebei in hun `beforeSend`.
//
// WAAROM DIT HIER STAAT
//
// De backend-init filterde alleen `request.data`. Headers, cookies en query string
// gingen ongefilterd mee — inclusief `authorization`, `cookie` en het servicetoken
// dat de producten onderling gebruiken. De frontend-init had helemaal geen
// `beforeSend`. Elke backendfout stuurde daarmee een werkend token naar een externe
// dienst, en elke frontendfout de volledige URL's uit de breadcrumbs.
//
// De aanpak is een allowlist waar het kan en een denylist waar het moet. Een pure
// denylist mist onvermijdelijk een veld dat later wordt toegevoegd; daarom worden
// request bodies in hun geheel verwijderd in plaats van veld voor veld geschoond.
Object.defineProperty(exports, "__esModule", { value: true });
exports.GEREDACTEERD = void 0;
exports.redacteer = redacteer;
exports.redacteerHeaders = redacteerHeaders;
exports.redacteerUrl = redacteerUrl;
exports.redacteerTekst = redacteerTekst;
exports.schoonEvent = schoonEvent;
/** Sleutels waarvan de waarde nooit meegaat, ongeacht waar ze staan. */
const GEHEIME_SLEUTELS = [
    'password',
    'wachtwoord',
    'wachtwoordhash',
    'token',
    'jwt',
    'secret',
    'geheim',
    'apikey',
    'api_key',
    'authorization',
    'cookie',
    'session',
    'sessie',
    'recoverycodes',
    'twofactorsecret',
    'creditcard',
    'iban',
];
/** Sleutels met bedrijfsgevoelige inhoud: geen secrets, wél vertrouwelijk. */
const VERTROUWELIJKE_SLEUTELS = [
    'bericht',
    'omschrijving',
    'beschrijving',
    'notities',
    'opmerking',
    'feedback',
    'document',
    'bijlage',
    'verkoopprijs',
    'kostprijs',
    'basiskost',
    'marge',
    'bedrag',
    'prijs',
    'tarief',
    'email',
    'telefoon',
    'contactpersoon',
    'klantnaam',
];
exports.GEREDACTEERD = '[weggelaten]';
function isGevoelig(sleutel, extra = []) {
    const kaal = sleutel.toLowerCase().replace(/[^a-z]/g, '');
    const kaalExtra = extra.map((s) => s.toLowerCase().replace(/[^a-z]/g, ''));
    return (GEHEIME_SLEUTELS.some((s) => kaal.includes(s)) ||
        VERTROUWELIJKE_SLEUTELS.some((s) => kaal.includes(s)) ||
        kaalExtra.some((s) => s.length > 0 && kaal.includes(s)));
}
/**
 * Redacteert een willekeurige waarde recursief.
 *
 * Diepte begrensd: een cyclische of extreem geneste structuur mag de foutafhandeling
 * niet laten vastlopen — dat zou van een fout een storing maken.
 */
function redacteer(waarde, diepte = 0, extra = []) {
    if (diepte > 6)
        return exports.GEREDACTEERD;
    if (waarde === null || waarde === undefined)
        return waarde;
    if (Array.isArray(waarde)) {
        return waarde.slice(0, 20).map((item) => redacteer(item, diepte + 1, extra));
    }
    if (typeof waarde === 'object') {
        const uit = {};
        for (const [sleutel, inhoud] of Object.entries(waarde)) {
            uit[sleutel] = isGevoelig(sleutel, extra) ? exports.GEREDACTEERD : redacteer(inhoud, diepte + 1, extra);
        }
        return uit;
    }
    return waarde;
}
/**
 * Headers die wél mee mogen.
 *
 * Een allowlist, niet een denylist: er komen voortdurend headers bij, en één vergeten
 * uitsluiting is genoeg om een sessiecookie of een servicetoken te lekken.
 */
const TOEGESTANE_HEADERS = ['content-type', 'user-agent', 'accept-language', 'referer'];
function redacteerHeaders(headers) {
    if (!headers)
        return {};
    const uit = {};
    for (const [naam, waarde] of Object.entries(headers)) {
        uit[naam] = TOEGESTANE_HEADERS.includes(naam.toLowerCase()) ? waarde : exports.GEREDACTEERD;
    }
    return uit;
}
/**
 * Strip de querystring en het fragment uit een URL.
 *
 * `/api/klanten?naam=Acme%20NV&bedrag=45000` zou anders klantnaam en bedrag naar
 * Sentry sturen via het pad alleen.
 */
function redacteerUrl(url) {
    if (!url)
        return url;
    const [zonderFragment] = url.split('#');
    const [zonderQuery] = (zonderFragment ?? url).split('?');
    return zonderQuery ?? url;
}
function redacteerTekst(tekst) {
    if (typeof tekst !== 'string' || tekst.length === 0)
        return tekst;
    let uit = tekst;
    // 1. Verbindingssnoeren: postgres://gebruiker:geheim@host, en elk ander schema.
    //    Alleen het wachtwoord gaat weg — host en gebruiker zijn nodig om de fout
    //    te kunnen plaatsen, en zijn op zichzelf geen sleutel.
    uit = uit.replace(/([a-z][a-z0-9+.-]*:\/\/)([^\s:@/]+):([^\s@/]+)@/gi, (_t, schema, gebruiker) => `${schema}${gebruiker}:${exports.GEREDACTEERD}@`);
    // 2. sleutel=waarde en sleutel: waarde, waarbij de sleutel gevoelig heet.
    //    Dekt PGPASSWORD=..., --password=..., "token": "...", Authorization: ...
    uit = uit.replace(
    // Het aanhalingsteken na de sleutel is optioneel: in JSON staat er
    // "token": "...", in een omgevingsvariabele TOKEN=...
    /\b([A-Za-z_][A-Za-z0-9_.-]*)(["']?\s*[=:]\s*)("[^"]*"|'[^']*'|[^\s,;)\]}"']+)/g, (volledig, sleutel, scheiding) => isGevoelig(sleutel) ? `${sleutel}${scheiding}${exports.GEREDACTEERD}` : volledig);
    // 3. Dezelfde sleutels als losse vlag: --password geheim.
    uit = uit.replace(/(--?[A-Za-z][A-Za-z0-9_-]*)(\s+)([^\s-][^\s]*)/g, (volledig, vlag, spatie) => isGevoelig(vlag) ? `${vlag}${spatie}${exports.GEREDACTEERD}` : volledig);
    // 4. Authorization-schema's in vrije tekst.
    uit = uit.replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, `$1 ${exports.GEREDACTEERD}`);
    // 5. Sleutels met een herkenbare vorm. Alleen vormen die per definitie geheim
    //    zijn: Stripe's pk_ staat er bewust niet bij, die hoort publiek te zijn.
    const VORMEN = [
        /\b[sr]k_(?:live|test)_[A-Za-z0-9]{8,}/g, // Stripe secret en restricted
        /\bre_[A-Za-z0-9_-]{16,}/g, // Resend
        /\bgh[pousr]_[A-Za-z0-9]{20,}/g, // GitHub
        /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
        /\bxox[baprs]-[A-Za-z0-9-]{10,}/g, // Slack
        /\bAKIA[0-9A-Z]{16}\b/g, // AWS access key id
        /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, // JWT
    ];
    for (const vorm of VORMEN)
        uit = uit.replace(vorm, exports.GEREDACTEERD);
    return uit;
}
/**
 * Schoont een volledig Sentry-event.
 *
 * De request body wordt in zijn geheel verwijderd in plaats van geschoond: een body
 * kan elke vorm hebben, en veld-voor-veld schonen mist onvermijdelijk het veld dat
 * volgende maand wordt toegevoegd.
 */
function schoonEvent(event, extra = []) {
    const uit = { ...event };
    if (uit.request) {
        uit.request = {
            ...uit.request,
            url: redacteerUrl(uit.request.url),
            // Volledig weg, niet geschoond. Zie de toelichting hierboven.
            data: uit.request.data === undefined ? undefined : exports.GEREDACTEERD,
            headers: redacteerHeaders(uit.request.headers),
            cookies: uit.request.cookies === undefined ? undefined : exports.GEREDACTEERD,
            query_string: uit.request.query_string === undefined ? undefined : exports.GEREDACTEERD,
        };
    }
    if (uit.extra)
        uit.extra = redacteer(uit.extra, 0, extra);
    if (uit.contexts)
        uit.contexts = redacteer(uit.contexts, 0, extra);
    if (uit.breadcrumbs) {
        uit.breadcrumbs = uit.breadcrumbs.map((kruimel) => ({
            ...kruimel,
            // Breadcrumbs van fetch en XHR bevatten de volledige URL, query string incluis.
            // Een breadcrumb-message is net zo goed vrije tekst als een foutmelding.
            ...(typeof kruimel['message'] === 'string'
                ? { message: redacteerTekst(kruimel['message']) }
                : {}),
            ...(typeof kruimel['data'] === 'object' && kruimel['data'] !== null
                ? { data: redacteerBreadcrumbData(kruimel['data']) }
                : {}),
        }));
    }
    // De foutmelding en de stacktrace. Dit is het deel dat tot PLAT-140 helemaal
    // ongefilterd meeging: `redacteer` raakt het niet aan, want er zijn geen
    // sleutels. `vars` van een frame is wél gestructureerd en gaat dus door de
    // gewone redactie — een lokale variabele die `wachtwoord` heet, verdwijnt daar.
    if (uit.exception?.values) {
        uit.exception = {
            ...uit.exception,
            values: uit.exception.values.map((fout) => ({
                ...fout,
                value: redacteerTekst(fout.value),
                ...(fout.stacktrace?.frames
                    ? {
                        stacktrace: {
                            ...fout.stacktrace,
                            frames: fout.stacktrace.frames.map((frame) => frame.vars
                                ? { ...frame, vars: redacteer(frame.vars, 0, extra) }
                                : frame),
                        },
                    }
                    : {}),
            })),
        };
    }
    if (uit.message !== undefined)
        uit.message = redacteerTekst(uit.message);
    if (uit.logentry) {
        uit.logentry = {
            ...uit.logentry,
            message: redacteerTekst(uit.logentry.message),
            ...(uit.logentry.params
                ? { params: redacteer(uit.logentry.params, 0, extra) }
                : {}),
        };
    }
    // Van de gebruiker houden we alleen het id. Naam en e-mailadres zijn persoonsgegevens
    // die niets toevoegen aan het oplossen van een fout.
    if (uit.user) {
        uit.user = { id: uit.user['id'] };
    }
    return uit;
}
function redacteerBreadcrumbData(data) {
    const geschoond = redacteer(data);
    if (typeof geschoond['url'] === 'string') {
        geschoond['url'] = redacteerUrl(geschoond['url']);
    }
    return geschoond;
}
