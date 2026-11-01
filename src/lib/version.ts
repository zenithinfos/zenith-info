/**
 * Version unique de l'application, exposée par /api/health, /api/about
 * et les paquets de distribution.
 */

export const APP_NAME = "Minkébé";
export const APP_VERSION = "0.1.0";
export const GAME_VERSION = "1.4.0";
export const CHANNEL: "dev" | "beta" | "stable" =
  (process.env.NEXT_PUBLIC_CHANNEL as "dev" | "beta" | "stable" | undefined) ??
  "dev";

/** Identifiant de build : surchargeable en CI, sinon date de démarrage. */
export const BUILD_ID =
  process.env.NEXT_PUBLIC_BUILD_ID?.trim() || `local-${APP_VERSION}`;

export const SERVER_STARTED_AT = Date.now();

export function uptimeSeconds(): number {
  return Math.max(0, Math.round((Date.now() - SERVER_STARTED_AT) / 1000));
}

export const GAME_URL =
  process.env.NEXT_PUBLIC_GAME_URL?.replace(/\/$/, "") ||
  "http://localhost:3000";

export const SUPPORT_EMAIL = "support@zenith-info.example";
