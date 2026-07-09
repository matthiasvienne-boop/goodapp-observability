// Herbruikbare health-check-handler. Generaliseert het patroon dat Veynoris al
// gebruikt in apps/api/src/index.ts (inline Postgres+Redis-check) naar een
// willekeurige naam->check-map, zodat elke consumer zijn eigen dependencies kan
// pluggen zonder deze package iets te laten weten over Prisma/Drizzle/Redis.
//
// Response-vorm is bewust identiek aan wat Veynoris vandaag al teruggeeft:
// { status, version, environment, ts, checks }, 200 bij alles ok, anders 503.
import type { Request, Response } from "express";

export interface HealthCheckResult {
  status: "ok" | "error";
  latencyMs?: number;
}

export type HealthCheck = () => Promise<boolean> | boolean;

export interface HealthCheckOptions {
  checks?: Record<string, HealthCheck>;
  version?: string;
}

export function createHealthCheckHandler(options: HealthCheckOptions = {}) {
  const checks = options.checks ?? {};

  return async function healthCheckHandler(_req: Request, res: Response): Promise<void> {
    const results: Record<string, HealthCheckResult> = {};

    for (const [name, check] of Object.entries(checks)) {
      const t0 = Date.now();
      try {
        const ok = await check();
        results[name] = { status: ok ? "ok" : "error", latencyMs: Date.now() - t0 };
      } catch {
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
