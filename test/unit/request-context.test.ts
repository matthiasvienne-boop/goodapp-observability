// PLAT-208: de gedeelde requestContext-middleware voor Express.
//
// Zeven van acht producten hadden de request-context wel beschikbaar (het
// pakket exporteert `requestContext`) maar nergens bedraad, waardoor
// requestId, userId en organizationId in de logregels ontbraken. Deze tests
// starten een echte Express-app en kijken naar wat er daadwerkelijk in de
// logregels en de response-headers terechtkomt.
import { afterEach, describe, expect, it, vi } from "vitest";

// De logger leest LOG_LEVEL bij het laden; zonder dit schrijft hij in een testomgeving geen info-regels.
vi.hoisted(() => {
  process.env.LOG_LEVEL = "debug";
});
import express from "express";
import type { AddressInfo } from "net";
import { requestContextMiddleware, verrijkRequestContext } from "../../src/server/request-context";
import { createLogger } from "../../src/server/logger";

const log = createLogger("app");

type Regel = Record<string, unknown>;

async function metServer(
  opties: Parameters<typeof requestContextMiddleware>[0],
  routes: (app: express.Express) => void
): Promise<{ url: string; sluit: () => Promise<void> }> {
  const app = express();
  app.use(requestContextMiddleware(opties));
  routes(app);
  const server = app.listen(0);
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}`, sluit: () => new Promise((r) => server.close(() => r())) };
}

function vangRegels(): { regels: () => Regel[]; herstel: () => void } {
  const uit: string[] = [];
  const schrijf = (chunk: unknown): boolean => {
    uit.push(String(chunk));
    return true;
  };
  const a = vi.spyOn(process.stdout, "write").mockImplementation(schrijf as never);
  const b = vi.spyOn(process.stderr, "write").mockImplementation(schrijf as never);
  return {
    regels: () => uit.flatMap((s) => s.split("\n")).filter((s) => s.startsWith("{")).map((s) => JSON.parse(s) as Regel),
    herstel: () => {
      a.mockRestore();
      b.mockRestore();
    },
  };
}

afterEach(() => vi.restoreAllMocks());

describe("requestContextMiddleware", () => {
  it("zet een requestId op elke logregel binnen het verzoek en geeft het terug in de response-header", async () => {
    const vang = vangRegels();
    const s = await metServer({}, (app) => app.get("/hallo", (_req, res) => { log.info("binnen de handler"); res.send("ok"); }));
    try {
      const res = await fetch(`${s.url}/hallo`);
      await res.text();
      const id = res.headers.get("x-request-id");
      expect(id).toMatch(/^[0-9a-f-]{36}$/);
      const binnen = vang.regels().find((r) => r.msg === "binnen de handler");
      expect(binnen?.requestId).toBe(id);
    } finally {
      vang.herstel();
      await s.sluit();
    }
  });

  it("neemt een veilig meegegeven x-request-id over en weigert een gevaarlijk of te lang id", async () => {
    const vang = vangRegels();
    const s = await metServer({}, (app) => app.get("/x", (_req, res) => res.send("ok")));
    try {
      const goed = await fetch(`${s.url}/x`, { headers: { "x-request-id": "gateway-123.abc" } });
      expect(goed.headers.get("x-request-id")).toBe("gateway-123.abc");
      const teLang = await fetch(`${s.url}/x`, { headers: { "x-request-id": "a".repeat(200) } });
      expect(teLang.headers.get("x-request-id")).not.toBe("a".repeat(200));
      const vreemd = await fetch(`${s.url}/x`, { headers: { "x-request-id": 'abc"}{' } });
      expect(vreemd.headers.get("x-request-id")).not.toContain('"');
    } finally {
      vang.herstel();
      await s.sluit();
    }
  });

  it("logt het afgeronde verzoek met status en duur, op het juiste niveau", async () => {
    const vang = vangRegels();
    const s = await metServer({}, (app) => {
      app.get("/goed", (_req, res) => res.send("ok"));
      app.get("/weg", (_req, res) => res.status(404).send("nee"));
      app.get("/stuk", (_req, res) => res.status(500).send("kapot"));
    });
    try {
      for (const p of ["/goed", "/weg", "/stuk"]) await (await fetch(`${s.url}${p}`)).text();
      await new Promise((r) => setTimeout(r, 30));
      const r = vang.regels().filter((x) => x.msg === "request");
      expect(r.find((x) => x.path === "/goed")).toMatchObject({ level: "info", status: 200, method: "GET" });
      expect(r.find((x) => x.path === "/weg")).toMatchObject({ level: "warn", status: 404 });
      expect(r.find((x) => x.path === "/stuk")).toMatchObject({ level: "error", status: 500 });
      expect(typeof r[0]?.durationMs).toBe("number");
    } finally {
      vang.herstel();
      await s.sluit();
    }
  });

  it("logt de querystring nooit mee (kan tokens bevatten)", async () => {
    const vang = vangRegels();
    const s = await metServer({}, (app) => app.get("/zoek", (_req, res) => res.send("ok")));
    try {
      await (await fetch(`${s.url}/zoek?token=geheim123&q=x`)).text();
      await new Promise((r) => setTimeout(r, 30));
      const regel = vang.regels().find((x) => x.msg === "request");
      expect(JSON.stringify(regel)).not.toContain("geheim123");
      expect(regel?.path).toBe("/zoek");
    } finally {
      vang.herstel();
      await s.sluit();
    }
  });

  it("logt paden in stilPaden niet, maar zet er wel een requestId op", async () => {
    const vang = vangRegels();
    const s = await metServer({ stilPaden: ["/api/health"] }, (app) => app.get("/api/health", (_req, res) => res.send("ok")));
    try {
      const res = await fetch(`${s.url}/api/health`);
      await res.text();
      await new Promise((r) => setTimeout(r, 30));
      expect(res.headers.get("x-request-id")).toBeTruthy();
      expect(vang.regels().filter((x) => x.msg === "request")).toHaveLength(0);
    } finally {
      vang.herstel();
      await s.sluit();
    }
  });

  it("verrijkRequestContext zet userId en organizationId op latere logregels, en doet niets buiten een verzoek", async () => {
    expect(() => verrijkRequestContext({ userId: "u1" })).not.toThrow();
    const vang = vangRegels();
    const s = await metServer({}, (app) =>
      app.get("/mij", (_req, res) => {
        verrijkRequestContext({ userId: "u-7", organizationId: "o-3" });
        log.info("na authenticatie");
        res.send("ok");
      })
    );
    try {
      await (await fetch(`${s.url}/mij`)).text();
      const regel = vang.regels().find((x) => x.msg === "na authenticatie");
      expect(regel).toMatchObject({ userId: "u-7", organizationId: "o-3" });
    } finally {
      vang.herstel();
      await s.sluit();
    }
  });

  it("twee gelijktijdige verzoeken krijgen elk hun eigen requestId", async () => {
    const vang = vangRegels();
    const s = await metServer({}, (app) =>
      app.get("/traag/:naam", async (req, res) => {
        await new Promise((r) => setTimeout(r, req.params.naam === "a" ? 40 : 5));
        log.info("klaar " + req.params.naam);
        res.send("ok");
      })
    );
    try {
      const [a, b] = await Promise.all([fetch(`${s.url}/traag/a`), fetch(`${s.url}/traag/b`)]);
      await Promise.all([a.text(), b.text()]);
      const regels = vang.regels();
      expect(regels.find((x) => x.msg === "klaar a")?.requestId).toBe(a.headers.get("x-request-id"));
      expect(regels.find((x) => x.msg === "klaar b")?.requestId).toBe(b.headers.get("x-request-id"));
      expect(a.headers.get("x-request-id")).not.toBe(b.headers.get("x-request-id"));
    } finally {
      vang.herstel();
      await s.sluit();
    }
  });

  it("roept een optionele naVerzoek-hook aan met status en duur, en laat een fout daarin het verzoek niet breken", async () => {
    const gezien: { status: number; path: string }[] = [];
    const s = await metServer(
      { naVerzoek: (info) => { gezien.push({ status: info.status, path: info.path }); throw new Error("hook stuk"); } },
      (app) => app.get("/h", (_req, res) => res.send("ok"))
    );
    const vang = vangRegels();
    try {
      const res = await fetch(`${s.url}/h`);
      expect(await res.text()).toBe("ok");
      await new Promise((r) => setTimeout(r, 30));
      expect(gezien).toEqual([{ status: 200, path: "/h" }]);
    } finally {
      vang.herstel();
      await s.sluit();
    }
  });
});
