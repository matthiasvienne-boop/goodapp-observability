// PLAT-184: de logger redigeert geheimen. Voorheen deed alleen Sentry dat.
//
// Elke test kijkt naar de daadwerkelijk geschreven regel, niet naar een interne
// functie: het gaat erom wat in de Railway-logs terechtkomt.
import { afterEach, describe, expect, it, vi } from "vitest";
import { createLogger } from "../../src/server/logger";
import { GEREDACTEERD, redacteerVoorLog } from "../../src/shared/redactie";

type Regel = Record<string, unknown> & {
  msg: string;
  err?: { name: string; message: string; stack?: string };
};

function vangStderr(run: () => void): Regel {
  const regels: string[] = [];
  const spy = vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
    regels.push(String(chunk));
    return true;
  });
  try {
    run();
  } finally {
    spy.mockRestore();
  }
  expect(regels).toHaveLength(1);
  return JSON.parse(regels[0]!) as Regel;
}

const log = createLogger("test");

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.LOG_LEVEL;
});

describe("logger: boodschap en foutmelding", () => {
  it("haalt het wachtwoord uit een verbindingssnoer in de boodschap, en laat gebruiker en host staan", () => {
    const regel = vangStderr(() => log.error("verbinding mislukt met postgres://app:geheimwachtwoord@db.example/app"));
    expect(regel.msg).not.toContain("geheimwachtwoord");
    expect(regel.msg).toContain("postgres://app:" + GEREDACTEERD + "@db.example/app");
  });

  it("haalt een Bearer-token na een Authorization-sleutel uit de boodschap", () => {
    const regel = vangStderr(() => log.error("verzoek geweigerd, Authorization: Bearer abcdef123456ghijkl"));
    expect(regel.msg).not.toContain("abcdef123456ghijkl");
    expect(regel.msg).toContain("Bearer");
  });

  it("redigeert de melding en de stack van een Error", () => {
    const fout = new Error("pg_dump mislukt: postgres://app:geheimwachtwoord@db.example/app");
    const regel = vangStderr(() => log.error("back-up", fout));
    expect(regel.err?.message).not.toContain("geheimwachtwoord");
    expect(regel.err?.stack).not.toContain("geheimwachtwoord");
    expect(regel.err?.name).toBe("Error");
  });

  it("laat een commit-sha en een contenthash in de stack ongemoeid (PLAT-155)", () => {
    const sha = "3cf33ba0c1d2e3f4a5b6c7d8e9f00112233445566";
    const regel = vangStderr(() => log.error(`fout in bundel main.${sha}.js`));
    expect(regel.msg).toContain(sha);
  });
});

describe("logger: meta", () => {
  it("haalt waarden van geheime sleutels weg, ook genest", () => {
    const regel = vangStderr(() =>
      log.error("inlog", {
        gebruiker: "anna",
        password: "p1",
        token: "t1",
        verzoek: { headers: { authorization: "Bearer xyz" }, cookie: "sid=1" },
      }),
    );
    expect(regel.password).toBe(GEREDACTEERD);
    expect(regel.token).toBe(GEREDACTEERD);
    expect(regel.gebruiker).toBe("anna");
    expect(regel.verzoek).toEqual({ headers: { authorization: GEREDACTEERD }, cookie: GEREDACTEERD });
  });

  it("haalt een geheim uit een gewone tekstwaarde van een niet-geheime sleutel", () => {
    const regel = vangStderr(() => log.error("db", { url: "postgres://app:geheimwachtwoord@db.example/app" }));
    expect(String(regel.url)).not.toContain("geheimwachtwoord");
    expect(String(regel.url)).toContain("db.example/app");
  });

  it("laat bedrijfswoorden staan die alleen Sentry weghaalt: prijs, bedrag, email", () => {
    const regel = vangStderr(() => log.error("prijs bijgewerkt", { prijs: 12.5, bedrag: "45,00", email: "anna@voorbeeld.be" }));
    expect(regel.prijs).toBe(12.5);
    expect(regel.bedrag).toBe("45,00");
    expect(regel.email).toBe("anna@voorbeeld.be");
  });

  it("laat getallen en booleans staan bij een sleutel die op een geheim lijkt", () => {
    const regel = vangStderr(() => log.error("ai-gebruik", { inputTokens: 1200, sessionCount: 3, wachtwoordVergeten: false }));
    expect(regel.inputTokens).toBe(1200);
    expect(regel.sessionCount).toBe(3);
    expect(regel.wachtwoordVergeten).toBe(false);
  });

  it("laat een Date een datumtekst blijven en maakt er geen leeg object van", () => {
    const regel = vangStderr(() => log.error("tijdstip", { om: new Date("2026-09-29T12:00:00.000Z") }));
    expect(regel.om).toBe("2026-09-29T12:00:00.000Z");
  });

  it("loopt niet vast op een cyclische structuur en schrijft nog steeds één regel", () => {
    const cyclisch: Record<string, unknown> = { naam: "a" };
    cyclisch.zelf = cyclisch;
    const regel = vangStderr(() => log.error("cyclisch", cyclisch));
    expect(regel.msg).toBe("cyclisch");
  });
});

describe("logger: ook op info-niveau (stdout)", () => {
  it("redigeert een info-regel", async () => {
    vi.resetModules();
    process.env.LOG_LEVEL = "info";
    const { createLogger: maak } = await import("../../src/server/logger");
    const regels: string[] = [];
    const spy = vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
      regels.push(String(chunk));
      return true;
    });
    try {
      maak("test").info("start", { apiKey: "sleutel-123", poort: 3001 });
    } finally {
      spy.mockRestore();
    }
    expect(regels).toHaveLength(1);
    const regel = JSON.parse(regels[0]!) as Regel;
    expect(regel.apiKey).toBe(GEREDACTEERD);
    expect(regel.poort).toBe(3001);
  });
});

describe("redacteerVoorLog", () => {
  it("laat null, undefined en primitieven ongemoeid", () => {
    expect(redacteerVoorLog(null)).toBeNull();
    expect(redacteerVoorLog(undefined)).toBeUndefined();
    expect(redacteerVoorLog(42)).toBe(42);
    expect(redacteerVoorLog(true)).toBe(true);
  });

  it("gaat door arrays heen zonder ze in te korten", () => {
    const lijst = Array.from({ length: 30 }, (_, i) => ({ nr: i, token: "t" + i }));
    const uit = redacteerVoorLog(lijst) as Array<{ nr: number; token: string }>;
    expect(uit).toHaveLength(30);
    expect(uit[29]).toEqual({ nr: 29, token: GEREDACTEERD });
  });

  it("laat een geheime sleutel met een lege waarde leeg", () => {
    expect(redacteerVoorLog({ token: null, password: undefined })).toEqual({ token: null, password: undefined });
  });

  it("neemt extra sleutels van het product mee", () => {
    expect(redacteerVoorLog({ tendertekst: "vertrouwelijk", naam: "x" }, 0, ["tendertekst"])).toEqual({
      tendertekst: GEREDACTEERD,
      naam: "x",
    });
  });
});
