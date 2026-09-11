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
export function redacteer(waarde, diepte = 0, extra = []) {
    if (diepte > 6)
        return GEREDACTEERD;
    if (waarde === null || waarde === undefined)
        return waarde;
    if (Array.isArray(waarde)) {
        return waarde.slice(0, 20).map((item) => redacteer(item, diepte + 1, extra));
    }
    if (typeof waarde === 'object') {
        const uit = {};
        for (const [sleutel, inhoud] of Object.entries(waarde)) {
            uit[sleutel] = isGevoelig(sleutel, extra) ? GEREDACTEERD : redacteer(inhoud, diepte + 1, extra);
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
 * Redacteert geheimen in vrije tekst.
 *
 * WAAROM DIT NAAST `redacteer` MOET BESTAAN
 *
 * `redacteer` werkt op sleutelnamen: een veld dat `password` heet, verliest zijn
 * waarde. Dat is de juiste aanpak voor gestructureerde gegevens en de verkeerde
 * voor een foutmelding, want vrije tekst heeft geen sleutels. Een geheim dat
 * middenin een zin staat, heeft geen veldnaam om op te matchen.
 *
 * En juist daar komen geheimen terecht. Node zet bij `execFile` de volledige
 * opdrachtregel in de fout — inclusief het verbindingssnoer dat als argument
 * meeging. Dat is de vorm die dit soort lekken heeft: niet een geheim dat iemand
 * opschrijft, maar een geheim dat een bibliotheek meestuurt in een veld waar
 * niemand aan dacht. Zie PLAT-140 en TEN-86, waar het wachtwoord van een
 * productiedatabase zo in een foutmelding belandde.
 *
 * DE GRENS VAN DEZE AANPAK, en die hoort erbij. Dit is een patroonlijst, en een
 * patroonlijst is per definitie onvolledig: een geheim zonder herkenbare vorm,
 * in een zin zonder sleutelwoord, komt hier ongeschonden doorheen. Het vangnet
 * vervangt het dichtzetten aan de bron dus niet — het vangt wat daar ontsnapt.
 */
/**
 * Ziet dit eruit als een referentie en niet als een gewoon woord?
 *
 * Alleen nodig bij regel 4, waar er géén sleutel vóór het schema staat. Daar is
 * `Basic authentication failed` een zin en `Basic dXNlcjpwYXNz` een geheim, en
 * het verschil zit in de vorm: een referentie draagt cijfers, scheidingstekens
 * of een mengeling van hoofd- en kleine letters. Een gewoon woord niet.
 *
 * Staat er wél een gevoelige sleutel vóór het schema, dan is die toets
 * overbodig — de sleutel zegt al dat wat volgt een referentie is. Vandaar dat
 * regel 2a geen lengte- of vormeis stelt.
 */
function lijktOpReferentie(kandidaat) {
    if (/[0-9._~+/=-]/.test(kandidaat))
        return true;
    return /[a-z]/.test(kandidaat) && /[A-Z]/.test(kandidaat);
}
/** Authenticatieschema's: het woord vóór de referentie, nooit de referentie zelf. */
const SCHEMAS = /^(Bearer|Basic|Token|Digest)$/i;
export function redacteerTekst(tekst) {
    if (typeof tekst !== 'string' || tekst.length === 0)
        return tekst;
    let uit = tekst;
    // 1. Verbindingssnoeren: postgres://gebruiker:geheim@host, en elk ander schema.
    //    Alleen het wachtwoord gaat weg — host en gebruiker zijn nodig om de fout
    //    te kunnen plaatsen, en zijn op zichzelf geen sleutel.
    uit = uit.replace(/([a-z][a-z0-9+.-]*:\/\/)([^\s:@/]+):([^\s@/]+)@/gi, (_t, schema, gebruiker) => `${schema}${gebruiker}:${GEREDACTEERD}@`);
    // 2a. Een gevoelige sleutel gevolgd door een authenticatieschema. Het geheim
    //     staat ná het schema — `Authorization: Bearer <token>`. Dit moet vóór
    //     regel 2, anders vervangt die de waarde achter de sleutel, en dat is
    //     hier het woord `Bearer` en niet het token (PLAT-154).
    //
    //     Geen minimumlengte zoals bij regel 4: wat er na een schema staat achter
    //     een gevoelige sleutel, is per definitie de referentie. Twijfel is hier
    //     goedkoper dan een gemist token.
    uit = uit.replace(/\b([A-Za-z_][A-Za-z0-9_.-]*)(["']?\s*[=:]\s*)(Bearer|Basic|Token|Digest)(\s+)([^\s,;)\]}"']+)/gi, (volledig, sleutel, scheiding, schema, spatie) => isGevoelig(sleutel) ? `${sleutel}${scheiding}${schema}${spatie}${GEREDACTEERD}` : volledig);
    // 2. sleutel=waarde en sleutel: waarde, waarbij de sleutel gevoelig heet.
    //    Dekt PGPASSWORD=..., --password=..., "token": "...", Authorization: ...
    uit = uit.replace(
    // Het aanhalingsteken na de sleutel is optioneel: in JSON staat er
    // "token": "...", in een omgevingsvariabele TOKEN=...
    /\b([A-Za-z_][A-Za-z0-9_.-]*)(["']?\s*[=:]\s*)("[^"]*"|'[^']*'|[^\s,;)\]}"']+)/g, (volledig, sleutel, scheiding, waarde) => {
        if (!isGevoelig(sleutel))
            return volledig;
        // Een authenticatieschema is niet het geheim, het staat ervóór. Regel 2a
        // hierboven heeft dat geval al afgehandeld; hier alleen niet nog eens
        // het schema zelf wegpoetsen. Zonder deze uitzondering wordt
        // `Authorization: Bearer abc123` tot `Authorization: [weggelaten] abc123`
        // — het woord weg, het token bewaard. Zie PLAT-154.
        if (SCHEMAS.test(waarde))
            return volledig;
        return `${sleutel}${scheiding}${GEREDACTEERD}`;
    });
    // 3. Dezelfde sleutels als losse vlag: --password geheim.
    uit = uit.replace(/(--?[A-Za-z][A-Za-z0-9_-]*)(\s+)([^\s-][^\s]*)/g, (volledig, vlag, spatie) => isGevoelig(vlag) ? `${vlag}${spatie}${GEREDACTEERD}` : volledig);
    // 4. Authenticatieschema's in vrije tekst, zonder sleutel ervoor.
    //     Hier wél een minimumlengte: `Basic authentication failed` is een zin en
    //     geen geheim, en een vangnet dat gewone tekst onleesbaar maakt wordt
    //     uitgezet.
    uit = uit.replace(/\b(Bearer|Basic|Token|Digest)(\s+)([A-Za-z0-9._~+/=-]{8,})/gi, (volledig, schema, spatie, kandidaat) => lijktOpReferentie(kandidaat) ? `${schema}${spatie}${GEREDACTEERD}` : volledig);
    // 5. Sleutels met een herkenbare vorm. Alleen vormen die per definitie geheim
    //    zijn: Stripe's pk_ staat er bewust niet bij, die hoort publiek te zijn.
    const VORMEN = [
        // Stripe: geheim, beperkt én het webhook-geheim, ook in gemaskeerde vorm.
        // Juist die vorm lekt — Stripe zet zelf "sk_test_51H...wxyz" in een
        // foutmelding. pk_ staat er bewust niet bij: die hoort publiek te zijn.
        // Overgenomen uit Founder OS' eigen redactor (PLAT-155), die breder was
        // dan wat hier stond.
        /\b(?:sk|rk|whsec)_[A-Za-z0-9*]+(?:[._-]+[A-Za-z0-9*]+)*/g,
        /\bre_[A-Za-z0-9_-]{16,}/g, // Resend
        /\bAIza[A-Za-z0-9_-]{10,}/g, // Google API-sleutel
        /\bya29\.[A-Za-z0-9._-]{10,}/g, // Google OAuth-toegangstoken
        // Een PEM-blok. Een privésleutel hoort nooit in een boodschap; staat hij er
        // toch, dan mag er niets van overblijven.
        /-----BEGIN[^-]*PRIVATE KEY-----[\s\S]*?-----END[^-]*PRIVATE KEY-----/g,
        /\bgh[pousr]_[A-Za-z0-9]{20,}/g, // GitHub
        /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
        /\bxox[baprs]-[A-Za-z0-9-]{10,}/g, // Slack
        /\bAKIA[0-9A-Z]{16}\b/g, // AWS access key id
        /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, // JWT
    ];
    // WAT HIER BEWUST NIET STAAT (PLAT-155). Founder OS' redactor draagt daarnaast
    // een vangnet voor lange willekeurige reeksen: minstens 32 tekens met
    // hoofdletters, kleine letters én cijfers. Dat is daar geijkt op korte
    // connectorfoutmeldingen en werkt er goed.
    //
    // Hier zou het schaden. Deze functie draait op stacktraces, en die zitten vol
    // reeksen die aan die drie eisen voldoen zonder een geheim te zijn:
    // commit-sha's, contenthashes uit een bundler, base64-fragmenten, module-id's.
    // Een vangnet dat die wegpoetst maakt de foutmelding onleesbaar, en een
    // onleesbare foutmelding is zijn eigen probleem — dan wordt de redactie
    // uitgezet en is er niets meer beschermd.
    //
    // De benoemde patronen zijn dus samengevoegd, het vangnet blijft
    // product-specifiek. Dat is de uitkomst die PLAT-155 zelf als mogelijk
    // noemde, met de reden erbij.
    for (const vorm of VORMEN)
        uit = uit.replace(vorm, GEREDACTEERD);
    return uit;
}
/**
 * Schoont een volledig Sentry-event.
 *
 * De request body wordt in zijn geheel verwijderd in plaats van geschoond: een body
 * kan elke vorm hebben, en veld-voor-veld schonen mist onvermijdelijk het veld dat
 * volgende maand wordt toegevoegd.
 */
export function schoonEvent(event, extra = []) {
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
