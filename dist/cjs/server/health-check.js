"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createHealthCheckHandler = createHealthCheckHandler;
function createHealthCheckHandler(options = {}) {
    const checks = options.checks ?? {};
    return async function healthCheckHandler(_req, res) {
        const results = {};
        for (const [name, check] of Object.entries(checks)) {
            const t0 = Date.now();
            try {
                const ok = await check();
                results[name] = { status: ok ? "ok" : "error", latencyMs: Date.now() - t0 };
            }
            catch {
                results[name] = { status: "error", latencyMs: Date.now() - t0 };
            }
        }
        const hasChecks = Object.keys(results).length > 0;
        const allOk = Object.values(results).every(r => r.status === "ok");
        const overallOk = !hasChecks || allOk;
        res.status(overallOk ? 200 : 503).json({
            status: overallOk ? "ok" : "degraded",
            version: options.version ?? process.env.npm_package_version ?? "unknown",
            environment: process.env.NODE_ENV ?? "unknown",
            ts: new Date().toISOString(),
            checks: results,
        });
    };
}
