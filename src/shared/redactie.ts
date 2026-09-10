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

function isGevoelig(sleutel: string, extra: ExtraSleutels = []): boolean {
  const kaal = sleutel.toLowerCase().replace(/[^a-z]/g, '');
  const kaalExtra = extra.map((s) => s.toLowerCase().replace(/[^a-z]/g, ''));
  return (
    GEHEIME_SLEUTELS.some((s) => kaal.includes(s)) ||
    VERTROUWELIJKE_SLEUTELS.some((s) => kaal.includes(s)) ||
    kaalExtra.some((s) => s.length > 0 && kaal.includes(s))
  );
}

/**
 * Redacteert een willekeurige waarde recursief.
 *
 * Diepte begrensd: een cyclische of extreem geneste structuur mag de foutafhandeling
 * niet laten vastlopen — dat zou van een fout een storing maken.
 */
export function redacteer(waarde: unknown, diepte = 0, extra: ExtraSleutels = []): unknown {
  if (diepte > 6) return GEREDACTEERD;
  if (waarde === null || waarde === undefined) return waarde;

  if (Array.isArray(waarde)) {
    return waarde.slice(0, 20).map((item) => redacteer(item, diepte + 1, extra));
  }

  if (typeof waarde === 'object') {
    const uit: Record<string, unknown> = {};
    for (const [sleutel, inhoud] of Object.entries(waarde as Record<string, unknown>)) {
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

export function redacteerHeaders(
  headers: Record<string, unknown> | undefined
): Record<string, unknown> {
  if (!headers) return {};
  const uit: Record<string, unknown> = {};
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
export function redacteerUrl(url: string | undefined): string | undefined {
  if (!url) return url;
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
export function redacteerTekst(tekst: string): string;
export function redacteerTekst(tekst: string | undefined): string | undefined;
export function redacteerTekst(tekst: string | undefined): string | undefined {
  if (typeof tekst !== 'string' || tekst.length === 0) return tekst;

  let uit = tekst;

  // 1. Verbindingssnoeren: postgres://gebruiker:geheim@host, en elk ander schema.
  //    Alleen het wachtwoord gaat weg — host en gebruiker zijn nodig om de fout
  //    te kunnen plaatsen, en zijn op zichzelf geen sleutel.
  uit = uit.replace(
    /([a-z][a-z0-9+.-]*:\/\/)([^\s:@/]+):([^\s@/]+)@/gi,
    (_t, schema: string, gebruiker: string) => `${schema}${gebruiker}:${GEREDACTEERD}@`
  );

  // 2. sleutel=waarde en sleutel: waarde, waarbij de sleutel gevoelig heet.
  //    Dekt PGPASSWORD=..., --password=..., "token": "...", Authorization: ...
  uit = uit.replace(
    // Het aanhalingsteken na de sleutel is optioneel: in JSON staat er
    // "token": "...", in een omgevingsvariabele TOKEN=...
    /\b([A-Za-z_][A-Za-z0-9_.-]*)(["']?\s*[=:]\s*)("[^"]*"|'[^']*'|[^\s,;)\]}"']+)/g,
    (volledig, sleutel: string, scheiding: string) =>
      isGevoelig(sleutel) ? `${sleutel}${scheiding}${GEREDACTEERD}` : volledig
  );

  // 3. Dezelfde sleutels als losse vlag: --password geheim.
  uit = uit.replace(
    /(--?[A-Za-z][A-Za-z0-9_-]*)(\s+)([^\s-][^\s]*)/g,
    (volledig, vlag: string, spatie: string) =>
      isGevoelig(vlag) ? `${vlag}${spatie}${GEREDACTEERD}` : volledig
  );

  // 4. Authorization-schema's in vrije tekst.
  uit = uit.replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, `$1 ${GEREDACTEERD}`);

  // 5. Sleutels met een herkenbare vorm. Alleen vormen die per definitie geheim
  //    zijn: Stripe's pk_ staat er bewust niet bij, die hoort publiek te zijn.
  const VORMEN: readonly RegExp[] = [
    /\b[sr]k_(?:live|test)_[A-Za-z0-9]{8,}/g, // Stripe secret en restricted
    /\bre_[A-Za-z0-9_-]{16,}/g, // Resend
    /\bgh[pousr]_[A-Za-z0-9]{20,}/g, // GitHub
    /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
    /\bxox[baprs]-[A-Za-z0-9-]{10,}/g, // Slack
    /\bAKIA[0-9A-Z]{16}\b/g, // AWS access key id
    /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, // JWT
  ];
  for (const vorm of VORMEN) uit = uit.replace(vorm, GEREDACTEERD);

  return uit;
}

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
  breadcrumbs?: Array<{ data?: unknown; message?: string }>;
  user?: Record<string, unknown>;
  tags?: Record<string, unknown>;
  message?: string;
  /** De foutmelding zelf. Vrije tekst, dus zonder sleutels om op te matchen. */
  exception?: {
    values?: Array<{
      type?: string;
      value?: string;
      stacktrace?: { frames?: Array<{ vars?: Record<string, unknown> }> };
    }>;
  };
  /** De sjabloonvorm van captureMessage; Sentry vult hier `params` los bij. */
  logentry?: { message?: string; params?: unknown[] };
}

/**
 * Schoont een volledig Sentry-event.
 *
 * De request body wordt in zijn geheel verwijderd in plaats van geschoond: een body
 * kan elke vorm hebben, en veld-voor-veld schonen mist onvermijdelijk het veld dat
 * volgende maand wordt toegevoegd.
 */
export function schoonEvent<T extends SentryAchtigEvent>(event: T, extra: ExtraSleutels = []): T {
  const uit: SentryAchtigEvent = { ...event };

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

  if (uit.extra) uit.extra = redacteer(uit.extra, 0, extra) as Record<string, unknown>;
  if (uit.contexts) uit.contexts = redacteer(uit.contexts, 0, extra) as Record<string, unknown>;

  if (uit.breadcrumbs) {
    uit.breadcrumbs = uit.breadcrumbs.map((kruimel) => ({
      ...kruimel,
      // Breadcrumbs van fetch en XHR bevatten de volledige URL, query string incluis.
      // Een breadcrumb-message is net zo goed vrije tekst als een foutmelding.
      ...(typeof kruimel['message'] === 'string'
        ? { message: redacteerTekst(kruimel['message'] as string) }
        : {}),
      ...(typeof kruimel['data'] === 'object' && kruimel['data'] !== null
        ? { data: redacteerBreadcrumbData(kruimel['data'] as Record<string, unknown>) }
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
                frames: fout.stacktrace.frames.map((frame) =>
                  frame.vars
                    ? { ...frame, vars: redacteer(frame.vars, 0, extra) as Record<string, unknown> }
                    : frame
                ),
              },
            }
          : {}),
      })),
    };
  }

  if (uit.message !== undefined) uit.message = redacteerTekst(uit.message);

  if (uit.logentry) {
    uit.logentry = {
      ...uit.logentry,
      message: redacteerTekst(uit.logentry.message),
      ...(uit.logentry.params
        ? { params: redacteer(uit.logentry.params, 0, extra) as unknown[] }
        : {}),
    };
  }

  // Van de gebruiker houden we alleen het id. Naam en e-mailadres zijn persoonsgegevens
  // die niets toevoegen aan het oplossen van een fout.
  if (uit.user) {
    uit.user = { id: uit.user['id'] };
  }

  return uit as T;
}

function redacteerBreadcrumbData(data: Record<string, unknown>): Record<string, unknown> {
  const geschoond = redacteer(data) as Record<string, unknown>;
  if (typeof geschoond['url'] === 'string') {
    geschoond['url'] = redacteerUrl(geschoond['url'] as string);
  }
  return geschoond;
}
