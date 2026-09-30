import type { Request, Response, NextFunction } from "express";
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
export declare function requestContextMiddleware(opties?: RequestContextOpties): (req: Request, res: Response, next: NextFunction) => void;
/**
 * Voegt de geauthenticeerde gebruiker of organisatie toe aan de context van het
 * lopende verzoek. Aanroepen nadat de auth-middleware het token heeft
 * geverifieerd, zodat de logregels daarna `userId` en `organizationId`
 * dragen. Doet niets buiten een verzoek.
 */
export declare function verrijkRequestContext(velden: {
    userId?: string;
    organizationId?: string;
}): void;
