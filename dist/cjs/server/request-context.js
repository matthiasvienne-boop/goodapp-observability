"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requestContextMiddleware = requestContextMiddleware;
exports.verrijkRequestContext = verrijkRequestContext;
const crypto_1 = require("crypto");
const logger_js_1 = require("./logger.js");
const httpLog = (0, logger_js_1.createLogger)("http");
/** Een meegegeven id is alleen bruikbaar als het kort is en geen tekens bevat die een logregel of header kunnen breken. */
const VEILIG_REQUEST_ID = /^[A-Za-z0-9._:-]{1,128}$/;
function bepaalRequestId(req, headerNaam) {
    const header = req.headers[headerNaam];
    const waarde = Array.isArray(header) ? header[0] : header;
    if (typeof waarde === "string" && VEILIG_REQUEST_ID.test(waarde))
        return waarde;
    return (0, crypto_1.randomUUID)();
}
function requestContextMiddleware(opties = {}) {
    const stil = new Set(opties.stilPaden ?? []);
    const headerNaam = (opties.headerNaam ?? "x-request-id").toLowerCase();
    return function requestContextHandler(req, res, next) {
        const requestId = bepaalRequestId(req, headerNaam);
        res.setHeader(headerNaam, requestId);
        logger_js_1.requestContext.run({ requestId, method: req.method, path: req.path }, () => {
            const start = process.hrtime.bigint();
            res.on("finish", () => {
                const durationMs = Math.round((Number(process.hrtime.bigint() - start) / 1e6) * 10) / 10;
                const info = { method: req.method, path: req.path, status: res.statusCode, durationMs, requestId };
                if (!stil.has(req.path)) {
                    const meta = { method: info.method, path: info.path, status: info.status, durationMs: info.durationMs };
                    if (info.status >= 500)
                        httpLog.error("request", meta);
                    else if (info.status >= 400)
                        httpLog.warn("request", meta);
                    else
                        httpLog.info("request", meta);
                }
                if (opties.naVerzoek) {
                    try {
                        opties.naVerzoek(info, req);
                    }
                    catch {
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
function verrijkRequestContext(velden) {
    const store = logger_js_1.requestContext.getStore();
    if (!store)
        return;
    if (velden.userId)
        store.userId = velden.userId;
    if (velden.organizationId)
        store.organizationId = velden.organizationId;
}
