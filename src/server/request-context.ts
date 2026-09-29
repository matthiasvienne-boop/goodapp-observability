// PLAT-208 — een kant-en-klare request-context-middleware voor Express.
//
// WAAROM DIT BESTAAT
//
// Dit pakket exporteert al `requestContext` (AsyncLocalStorage) en de logger
// leest eruit: staat er een request-id in, dan draagt elke logregel het mee.
// Alleen Veynoris had de middleware ook echt geschreven en bedraad. Bij
// Brickstory, TijdReg, TenderDesk, Kroost, Newbuild en BeleggersApp bleef de
// context leeg (het eigen commentaar van Brickstory erkent het), en bij
// Energie Adviseur staat alleen een correlatie-id in het foutantwoord, niet in
// de logregels. Zonder request-id is een fout in de logs niet terug te leiden
// naar het verzoek dat hem veroorzaakte (audit 07, PLAT-REL-004).
//
// Dit is Veynoris' middleware, gegeneraliseerd: zonder productspecifieke
// bezoekteller, met een haak voor wie iets na het verzoek wil doen.
//
// WAT DE MIDDLEWARE DOET
//
// - Neemt een meegegeven `x-request-id` over (voor tracing over een gateway
//   heen), maar alleen als het kort is en uit veilige tekens bestaat; anders
//   een nieuw UUID. Het id gaat ook terug als response-header.
// - Zet het verzoek in `requestContext`, zodat élke logregel binnen het
//   verzoek automatisch requestId (en straks userId en organizationId) draagt.
// - Logt het afgeronde verzoek: methode, pad, status en duur. 5xx als error
//   (dat gaat naar Sentry), 4xx als warn, de rest als info.
//
// WAT HET BEWUST NIET DOET
//
// - De querystring wordt nooit gelogd: die kan tokens bevatten (reset- en
//   uitnodigingslinks). Alleen `req.path`.
// - Geen bodies, geen headers.
// - Een fout in de `naVerzoek`-haak breekt het verzoek nooit: het antwoord is
//   dan al verstuurd.
import type { Request, Response, NextFunction } from "express";
import { randomUUID } from "crypto";
import { requestContext, createLogger } from "./logger.js";

const httpLog = createLogger("http");

/** Een meegegeven id is alleen bruikbaar als het kort is en geen tekens bevat die een logregel of header kunnen breken. */
const VEILIG_REQUEST_ID = /^[A-Za-z0-9._:-]{1,128}$/;

export interface VerzoekInfo {
  method: string;
  path: string;
  status: number;
  durationMs: number;
  requestId: string;
}

export interface RequestContextOpties {
  /** Paden die niet worden gelogd (bijvoorbeeld health checks van een load balancer). Ze krijgen wel een requestId. */
  stilPaden?: readonly string[];
  /** Naam van de header voor het id. Standaard `x-request-id`. */
  headerNaam?: string;
  /** Haak na het verzoek, bijvoorbeeld voor een bezoekteller. Een fout hierin wordt genegeerd. */
  naVerzoek?: (info: VerzoekInfo, req: Request) => void;
}

function bepaalRequestId(req: Request, headerNaam: string): string {
  const header = req.headers[headerNaam];
  const waarde = Array.isArray(header) ? header[0] : header;
  if (typeof waarde === "string" && VEILIG_REQUEST_ID.test(waarde)) return waarde;
  return randomUUID();
}

export function requestContextMiddleware(opties: RequestContextOpties = {}) {
  const stil = new Set(opties.stilPaden ?? []);
  const headerNaam = (opties.headerNaam ?? "x-request-id").toLowerCase();

  return function requestContextHandler(req: Request, res: Response, next: NextFunction): void {
    const requestId = bepaalRequestId(req, headerNaam);
    res.setHeader(headerNaam, requestId);

    requestContext.run({ requestId, method: req.method, path: req.path }, () => {
      const start = process.hrtime.bigint();

      res.on("finish", () => {
        const durationMs = Math.round((Number(process.hrtime.bigint() - start) / 1e6) * 10) / 10;
        const info: VerzoekInfo = { method: req.method, path: req.path, status: res.statusCode, durationMs, requestId };

        if (!stil.has(req.path)) {
          const meta = { method: info.method, path: info.path, status: info.status, durationMs: info.durationMs };
          if (info.status >= 500) httpLog.error("request", meta);
          else if (info.status >= 400) httpLog.warn("request", meta);
          else httpLog.info("request", meta);
        }

        if (opties.naVerzoek) {
          try {
            opties.naVerzoek(info, req);
          } catch {
            // Het antwoord is al verstuurd; een fout in een haak mag niets breken.
          }
        }
      });

      next();
    });
  };
}

/**
 * Voegt de geauthenticeerde gebruiker of organisatie toe aan de context van het
 * lopende verzoek. Aanroepen nadat de auth-middleware het token heeft
 * geverifieerd, zodat de logregels daarna `userId` en `organizationId`
 * dragen. Doet niets buiten een verzoek.
 */
export function verrijkRequestContext(velden: { userId?: string; organizationId?: string }): void {
  const store = requestContext.getStore();
  if (!store) return;
  if (velden.userId) store.userId = velden.userId;
  if (velden.organizationId) store.organizationId = velden.organizationId;
}
