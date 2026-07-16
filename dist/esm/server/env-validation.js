// Gecentraliseerde validatie-ENGINE voor kritieke environment-variabelen.
// Geëxtraheerd uit Veynoris (apps/api/src/lib/env-validation.ts) — enkel de generieke
// motor, niet de productspecifieke regel-lijst (die blijft per consumer lokaal,
// zowel om herbruikbaarheid als om geen interne var-namen in een publiek repo te
// laten belanden).
//
// Doel: een consumer laat zijn app fail-fast falen bij het opstarten wanneer
// verplichte configuratie ontbreekt, i.p.v. in een half-geconfigureerde of onveilige
// toestand verkeer te bedienen.
//
// Gedrag ongewijzigd t.o.v. het origineel: bij een harde fout wordt een Error
// GEGOOID (niet process.exit() aangeroepen) — de caller is verantwoordelijk voor
// wat daarna gebeurt (zie het package-README voor waarom dit als expliciete
// try/catch + process.exit(1) bij de caller hoort, niet impliciet in deze functie).
import { createLogger } from "./logger.js";
const log = createLogger("env-validation");
// "always"      → vereist in elke omgeving; validatie gooit ook in dev/test.
// "production"  → vereist wanneer NODE_ENV=production; gooit enkel in productie,
//                 waarschuwing in development, stil in test.
// "recommended" → optioneel (graceful fallback aanwezig); enkel een waarschuwing.
function isMissing(env, key) {
    return !env[key] || env[key].trim() === "";
}
/**
 * Valideert de aanwezigheid van kritieke environment-variabelen tegen een door de
 * caller aangeleverde regel-lijst. Gooit een Error (fail-fast) wanneer verplichte
 * configuratie ontbreekt.
 */
export function validateEnv(rules, env = process.env) {
    const nodeEnv = env.NODE_ENV ?? "development";
    const isProduction = nodeEnv === "production";
    const isTest = nodeEnv === "test";
    const alwaysMissing = rules.filter(r => r.level === "always" && isMissing(env, r.key));
    const productionMissing = rules.filter(r => r.level === "production" && isMissing(env, r.key));
    const recommendedMissing = rules.filter(r => r.level === "recommended" && isMissing(env, r.key));
    // Harde fouten: altijd-verplicht (elke omgeving) + productie-verplicht (enkel in productie).
    const hardFailures = [...alwaysMissing, ...(isProduction ? productionMissing : [])];
    if (hardFailures.length > 0) {
        const details = hardFailures.map(r => `  - ${r.key}: ${r.description}`).join("\n");
        throw new Error(`Opstarten geweigerd — ontbrekende verplichte environment-variabelen:\n${details}`);
    }
    // Waarschuwingen (niet-fataal). In test onderdrukt om de suite-output schoon te houden.
    if (!isTest) {
        const warnings = [...(isProduction ? [] : productionMissing), ...recommendedMissing];
        for (const r of warnings) {
            log.warn(`[env] ontbrekend (aanbevolen): ${r.key} — ${r.description}`);
        }
    }
}
