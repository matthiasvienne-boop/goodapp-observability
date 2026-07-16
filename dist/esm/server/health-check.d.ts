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
export declare function createHealthCheckHandler(options?: HealthCheckOptions): (_req: Request, res: Response) => Promise<void>;
