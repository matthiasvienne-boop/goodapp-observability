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
export const GEREDACTEERD = '[weggelaten]';
function isGevoelig(sleutel) {
    const kaal = sleutel.toLowerCase().replace(/[^a-z]/g, '');
    return (GEHEIME_SLEUTELS.some((s) => kaal.includes(s)) ||
        VERTROUWELIJKE_SLEUTELS.some((s) => kaal.includes(s)));
}
/**
 * Redacteert een willekeurige waarde recursief.
 *
 * Diepte begrensd: een cyclische of extreem geneste structuur mag de foutafhandeling
 * niet laten vastlopen — dat zou van een fout een storing maken.
 */
export function redacteer(waarde, diepte = 0) {
    if (diepte > 6)
        return GEREDACTEERD;
    if (waarde === null || waarde === undefined)
        return waarde;
    if (Array.isArray(waarde)) {
        return waarde.slice(0, 20).map((item) => redacteer(item, diepte + 1));
    }
    if (typeof waarde === 'object') {
        const uit = {};
        for (const [sleutel, inhoud] of Object.entries(waarde)) {
            uit[sleutel] = isGevoelig(sleutel) ? GEREDACTEERD : redacteer(inhoud, diepte + 1);
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
export function redacteerHeaders(headers) {
    if (!headers)
        return {};
    const uit = {};
    for (const [naam, waarde] of Object.entries(headers)) {
        uit[naam] = TOEGESTANE_HEADERS.includes(naam.toLowerCase()) ? waarde : GEREDACTEERD;
    }
    return uit;
}
/**
 * Strip de querystring en het fragment uit een URL.
 *
 * `/api/klanten?naam=Acme%20NV&bedrag=45000` zou anders klantnaam en bedrag naar
 * Sentry sturen via het pad alleen.
 */
export function redacteerUrl(url) {
    if (!url)
        return url;
    const [zonderFragment] = url.split('#');
    const [zonderQuery] = (zonderFragment ?? url).split('?');
    return zonderQuery ?? url;
}
/**
 * Schoont een volledig Sentry-event.
 *
 * De request body wordt in zijn geheel verwijderd in plaats van geschoond: een body
 * kan elke vorm hebben, en veld-voor-veld schonen mist onvermijdelijk het veld dat
 * volgende maand wordt toegevoegd.
 */
export function schoonEvent(event) {
    const uit = { ...event };
    if (uit.request) {
        uit.request = {
            ...uit.request,
            url: redacteerUrl(uit.request.url),
            // Volledig weg, niet geschoond. Zie de toelichting hierboven.
            data: uit.request.data === undefined ? undefined : GEREDACTEERD,
            headers: redacteerHeaders(uit.request.headers),
            cookies: uit.request.cookies === undefined ? undefined : GEREDACTEERD,
            query_string: uit.request.query_string === undefined ? undefined : GEREDACTEERD,
        };
    }
    if (uit.extra)
        uit.extra = redacteer(uit.extra);
    if (uit.contexts)
        uit.contexts = redacteer(uit.contexts);
    if (uit.breadcrumbs) {
        uit.breadcrumbs = uit.breadcrumbs.map((kruimel) => ({
            ...kruimel,
            // Breadcrumbs van fetch en XHR bevatten de volledige URL, query string incluis.
            ...(typeof kruimel['data'] === 'object' && kruimel['data'] !== null
                ? { data: redacteerBreadcrumbData(kruimel['data']) }
                : {}),
        }));
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
