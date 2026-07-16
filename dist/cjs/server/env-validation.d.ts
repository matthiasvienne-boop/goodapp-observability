export type EnvLevel = "always" | "production" | "recommended";
export interface EnvRule {
    key: string;
    level: EnvLevel;
    description: string;
}
/**
 * Valideert de aanwezigheid van kritieke environment-variabelen tegen een door de
 * caller aangeleverde regel-lijst. Gooit een Error (fail-fast) wanneer verplichte
 * configuratie ontbreekt.
 */
export declare function validateEnv(rules: EnvRule[], env?: NodeJS.ProcessEnv): void;
