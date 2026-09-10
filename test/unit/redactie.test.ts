import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  GEREDACTEERD,
  redacteer,
  redacteerHeaders,
  redacteerUrl,
  redacteerTekst,
  schoonEvent,
} from "../../src/shared/redactie.js";

describe("redacteerHeaders", () => {
  it("laat het servicetoken, authorization en cookie niet door", () => {
    const uit = redacteerHeaders({
      authorization: "Bearer echt-token",
      cookie: "sessie=abc123",
      "x-internal-token": "servicetoken-tussen-producten",
      "content-type": "application/json",
    });

    expect(uit["authorization"]).toBe(GEREDACTEERD);
    expect(uit["cookie"]).toBe(GEREDACTEERD);
    expect(uit["x-internal-token"]).toBe(GEREDACTEERD);
    // De allowlist: wat diagnostisch nuttig is en niets prijsgeeft, blijft.
    expect(uit["content-type"]).toBe("application/json");
  });

  it("werkt op een allowlist en niet op een lijst van bekende slechteriken", () => {
    // Een header die vandaag nog niet bestaat hoort ook weggelaten te worden.
    const uit = redacteerHeaders({ "x-nieuwe-header-van-volgend-jaar": "geheim" });
    expect(uit["x-nieuwe-header-van-volgend-jaar"]).toBe(GEREDACTEERD);
  });

  it("herkent hoofdletters in headernamen", () => {
    expect(redacteerHeaders({ "Content-Type": "text/html" })["Content-Type"]).toBe("text/html");
    expect(redacteerHeaders({ Authorization: "Bearer x" })["Authorization"]).toBe(GEREDACTEERD);
  });

  it("geeft een leeg object zonder headers", () => {
    expect(redacteerHeaders(undefined)).toEqual({});
  });
});

describe("redacteerUrl", () => {
  it("strip de query string", () => {
    expect(redacteerUrl("/api/klanten?naam=Acme%20NV&bedrag=45000")).toBe("/api/klanten");
  });

  it("strip het fragment", () => {
    expect(redacteerUrl("https://app.test/pad#token=abc")).toBe("https://app.test/pad");
  });

  it("laat een URL zonder query met rust", () => {
    expect(redacteerUrl("https://app.test/pad")).toBe("https://app.test/pad");
  });

  it("gaat om met undefined", () => {
    expect(redacteerUrl(undefined)).toBeUndefined();
  });
});

describe("redacteer", () => {
  it("verwijdert geheime sleutels, waar ze ook staan", () => {
    const uit = redacteer({ niveau1: { niveau2: { password: "geheim", naam: "Jan" } } }) as Record<
      string,
      Record<string, Record<string, unknown>>
    >;
    expect(uit["niveau1"]?.["niveau2"]?.["password"]).toBe(GEREDACTEERD);
    expect(uit["niveau1"]?.["niveau2"]?.["naam"]).toBe("Jan");
  });

  it("herkent varianten van dezelfde sleutel", () => {
    const uit = redacteer({
      apiKey: "x",
      api_key: "x",
      API_KEY: "x",
      accessToken: "x",
      twoFactorSecret: "x",
    }) as Record<string, unknown>;
    for (const sleutel of Object.keys(uit)) expect(uit[sleutel]).toBe(GEREDACTEERD);
  });

  it("begrenst de diepte zodat een cyclus de foutafhandeling niet laat vastlopen", () => {
    const cyclisch: Record<string, unknown> = {};
    cyclisch["zelf"] = cyclisch;
    expect(() => redacteer(cyclisch)).not.toThrow();
  });

  it("begrenst de lengte van arrays", () => {
    const uit = redacteer(Array.from({ length: 100 }, (_, i) => i)) as unknown[];
    expect(uit).toHaveLength(20);
  });

  it("laat null en undefined staan", () => {
    expect(redacteer(null)).toBeNull();
    expect(redacteer(undefined)).toBeUndefined();
  });
});

describe("schoonEvent", () => {
  it("laat van een verzoek niets gevoeligs over", () => {
    const uit = schoonEvent({
      request: {
        url: "/api/facturen?klant=Acme&bedrag=45000",
        data: { iban: "BE68 5390 0754 7034" },
        headers: { authorization: "Bearer echt", "x-internal-token": "servicetoken" },
        cookies: "sessie=abc",
        query_string: "klant=Acme",
      },
    });

    expect(uit.request?.url).toBe("/api/facturen");
    expect(uit.request?.data).toBe(GEREDACTEERD);
    expect(uit.request?.headers?.["authorization"]).toBe(GEREDACTEERD);
    expect(uit.request?.headers?.["x-internal-token"]).toBe(GEREDACTEERD);
    expect(uit.request?.cookies).toBe(GEREDACTEERD);
    expect(uit.request?.query_string).toBe(GEREDACTEERD);
  });

  it("verwijdert de body in zijn geheel in plaats van veld voor veld", () => {
    // Veld-voor-veld schonen mist onvermijdelijk het veld dat volgende maand
    // wordt toegevoegd.
    const uit = schoonEvent({ request: { data: { onschuldig: 1, nogNietBedacht: "geheim" } } });
    expect(uit.request?.data).toBe(GEREDACTEERD);
  });

  it("houdt van de gebruiker alleen het id over", () => {
    const uit = schoonEvent({
      user: { id: "u-1", email: "klant@voorbeeld.test", username: "klant", ip_address: "1.2.3.4" },
    });
    expect(uit.user).toEqual({ id: "u-1" });
  });

  it("strip de query string uit breadcrumb-URLs", () => {
    // Dit is het frontend-lek: fetch- en XHR-breadcrumbs leggen de volledige URL vast.
    const uit = schoonEvent({
      breadcrumbs: [
        { category: "fetch", data: { url: "/api/klanten?zoek=Acme%20NV", method: "GET" } },
      ],
    });
    expect((uit.breadcrumbs?.[0]?.data as Record<string, unknown>)["url"]).toBe("/api/klanten");
    expect((uit.breadcrumbs?.[0]?.data as Record<string, unknown>)["method"]).toBe("GET");
  });

  it("laat een breadcrumb zonder data met rust", () => {
    const uit = schoonEvent({ breadcrumbs: [{ message: "klik" }] });
    expect(uit.breadcrumbs?.[0]).toEqual({ message: "klik" });
  });

  it("schoont extra en contexts", () => {
    const uit = schoonEvent({
      extra: { token: "geheim", teller: 3 },
      contexts: { eigen: { authorization: "Bearer x" } },
    });
    expect(uit.extra?.["token"]).toBe(GEREDACTEERD);
    expect(uit.extra?.["teller"]).toBe(3);
    expect((uit.contexts?.["eigen"] as Record<string, unknown>)["authorization"]).toBe(GEREDACTEERD);
  });

  it("laat een event zonder verzoek ongemoeid", () => {
    expect(schoonEvent({ message: "iets ging mis" })).toEqual({ message: "iets ging mis" });
  });

  it("verandert het meegegeven event niet", () => {
    const origineel = { request: { url: "/a?b=c", headers: { authorization: "Bearer x" } } };
    schoonEvent(origineel);
    expect(origineel.request.url).toBe("/a?b=c");
    expect(origineel.request.headers.authorization).toBe("Bearer x");
  });
});

/**
 * Broncodescan.
 *
 * De redactie is één regel om weg te halen en het gevolg is onzichtbaar: er
 * verschijnt geen fout, er verdwijnt alleen een bescherming. Deze test faalt zodra
 * een van beide inits zijn beforeSend verliest.
 */
describe("beide Sentry-inits redigeren", () => {
  const SRC = join(__dirname, "..", "..", "src");

  it.each([
    ["server/sentry.ts", "initBackendSentry"],
    ["client/sentry.ts", "initFrontendSentry"],
  ])("%s roept schoonEvent aan in beforeSend", (bestand) => {
    const bron = readFileSync(join(SRC, bestand), "utf8");
    expect(bron).toMatch(/beforeSend\s*\([\s\S]{0,200}?schoonEvent\s*\(/);
  });

  it("de frontend bemonstert niet standaard alles in productie", () => {
    const bron = readFileSync(join(SRC, "client/sentry.ts"), "utf8");
    expect(bron).toMatch(/environment === "production" \? 0\.1/);
  });
});

// ─── Uitbreidbare sleutels (TEN-76) ───

describe('extra gevoelige sleutels per product', () => {
  it('redigeert een eigen sleutel die de gedeelde lijsten niet kennen', () => {
    const uit = redacteer({ tendertekst: 'vertrouwelijk bestek', titel: 'Tender 2026' }, 0, ['tendertekst']) as Record<string, unknown>;
    expect(uit.tendertekst).toBe(GEREDACTEERD);
    expect(uit.titel).toBe('Tender 2026');
  });

  it('laat zonder extra sleutels alles bij het oude', () => {
    // De uitbreiding mag het gedeelde gedrag niet verschuiven: wie niets
    // meegeeft, hoort exact te krijgen wat hij voorheen kreeg.
    const uit = redacteer({ tendertekst: 'vertrouwelijk bestek' }) as Record<string, unknown>;
    expect(uit.tendertekst).toBe('vertrouwelijk bestek');
  });

  it('werkt ook diep in de structuur, niet alleen op het eerste niveau', () => {
    const uit = redacteer({ dossier: { regels: [{ tendertekst: 'geheim' }] } }, 0, ['tendertekst']) as any;
    expect(uit.dossier.regels[0].tendertekst).toBe(GEREDACTEERD);
  });

  it('een lege of blanco sleutel redigeert niet alles', () => {
    // Zonder de lengtecontrole zou een lege string in elke sleutelnaam
    // voorkomen, en dan is er van het event niets meer over.
    const uit = redacteer({ titel: 'Tender 2026' }, 0, ['', '   ']) as Record<string, unknown>;
    expect(uit.titel).toBe('Tender 2026');
  });

  it('schoonEvent geeft de extra sleutels door aan extra en contexts', () => {
    const event = {
      extra: { tendertekst: 'geheim', gewoon: 'zichtbaar' },
      contexts: { dossier: { tendertekst: 'ook geheim' } },
    };
    const uit = schoonEvent(event as any, ['tendertekst']) as any;
    expect(uit.extra.tendertekst).toBe(GEREDACTEERD);
    expect(uit.extra.gewoon).toBe('zichtbaar');
    expect(uit.contexts.dossier.tendertekst).toBe(GEREDACTEERD);
  });
});

describe('redacteerTekst — vrije tekst heeft geen sleutels (PLAT-140)', () => {
  it('maskeert het wachtwoord in een verbindingssnoer en laat host en gebruiker staan', () => {
    const uit = redacteerTekst(
      'Command failed: pg_dump postgres://tender:Zx9%Geheim@monorail.proxy.rlwy.net:41234/railway'
    );
    expect(uit).not.toContain('Zx9%Geheim');
    expect(uit).toContain('monorail.proxy.rlwy.net');
    expect(uit).toContain('tender');
  });

  it('vangt het geval van TEN-86: execFile zet de volledige opdrachtregel in de fout', () => {
    const uit = redacteerTekst(
      'Error: spawn pg_dump ENOENT (args: --dbname=postgres://u:Str0ngP@ss@db.internal/prod)'
    );
    expect(uit).not.toContain('Str0ngP');
  });

  it('maskeert een gevoelige sleutel=waarde, ongeacht schrijfwijze', () => {
    expect(redacteerTekst('PGPASSWORD=hunter2 pg_dump')).not.toContain('hunter2');
    expect(redacteerTekst('{"token": "abc123def456"}')).not.toContain('abc123def456');
    expect(redacteerTekst('Authorization: abcdef123456')).not.toContain('abcdef123456');
  });

  it('maskeert een gevoelige sleutel als losse vlag', () => {
    expect(redacteerTekst('psql --password hunter2 -h db')).not.toContain('hunter2');
  });

  it('maskeert Bearer-tokens', () => {
    expect(redacteerTekst('kreeg 401 met Bearer eyJhbGciOiJIUzI1NiJ9abc')).not.toContain('eyJhbG');
  });

  it('maskeert sleutels aan hun vorm, ook zonder sleutelwoord ernaast', () => {
    expect(redacteerTekst('mislukt voor sk_live_51Hx9AbCdEfGhIjK')).not.toContain('sk_live_51Hx9');
    expect(redacteerTekst('key re_HXX4Q2mN_8vBcDeFgHiJkLmNoPq geweigerd')).not.toContain('HXX4Q2mN');
    expect(redacteerTekst('AKIAIOSFODNN7EXAMPLE afgewezen')).not.toContain('AKIAIOSFODNN7EXAMPLE');
  });

  it('laat gewone tekst met rust — anders wordt elke fout onleesbaar', () => {
    const gewoon = 'TypeError: Cannot read properties of undefined (reading "naam") at line 42';
    expect(redacteerTekst(gewoon)).toBe(gewoon);
  });

  it('laat een publiceerbare Stripe-sleutel staan: die hoort publiek te zijn', () => {
    const tekst = 'init met pk_live_51Hx9AbCdEfGhIjK';
    expect(redacteerTekst(tekst)).toBe(tekst);
  });

  it('gaat om met undefined en met een lege tekst', () => {
    expect(redacteerTekst(undefined)).toBeUndefined();
    expect(redacteerTekst('')).toBe('');
  });
});

describe('schoonEvent schoont nu ook de foutmelding (PLAT-140)', () => {
  it('schoont exception.values[].value', () => {
    const uit = schoonEvent({
      exception: {
        values: [{ type: 'Error', value: 'connect failed: postgres://u:Geheim123@host/db' }],
      },
    });
    expect(uit.exception?.values?.[0]?.value).not.toContain('Geheim123');
  });

  it('schoont de lokale variabelen van een stackframe op sleutelnaam', () => {
    const uit = schoonEvent({
      exception: {
        values: [
          {
            value: 'boem',
            stacktrace: { frames: [{ vars: { wachtwoord: 'hunter2', pad: '/tmp/x' } }] },
          },
        ],
      },
    });
    const vars = uit.exception?.values?.[0]?.stacktrace?.frames?.[0]?.vars;
    expect(vars?.['wachtwoord']).toBe(GEREDACTEERD);
    expect(vars?.['pad']).toBe('/tmp/x');
  });

  it('schoont event.message en de breadcrumb-message', () => {
    const uit = schoonEvent({
      message: 'faalde met token=abc123def456',
      breadcrumbs: [{ message: 'GET met Bearer eyJhbGciOiJIUzI1NiJ9abc' }],
    });
    expect(uit.message).not.toContain('abc123def456');
    expect(uit.breadcrumbs?.[0]?.message).not.toContain('eyJhbG');
  });

  it('laat een event zonder exception ongemoeid', () => {
    expect(schoonEvent({ tags: { product: 'tenderdesk' } }).tags).toEqual({ product: 'tenderdesk' });
  });
});
