/**
 * Langues du jeu.
 *
 * Deux langues pour l'instant. Le choix est mémorisé dans le navigateur et
 * poussé sur `<html lang>`, ce qui compte autant pour les lecteurs d'écran que
 * pour la césure automatique des textes.
 *
 * Ce module est volontairement sans dépendance : il est importé par le
 * serveur (métadonnées, `hreflang`) et par le client (sélecteur).
 */

export const LOCALES = ["fr", "en"] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "fr";

export const LOCALE_LABELS: Record<Locale, string> = {
  fr: "Français",
  en: "English",
};

/** Nom de la langue dans cette langue, pour le sélecteur. */
export const LOCALE_SHORT: Record<Locale, string> = {
  fr: "FR",
  en: "EN",
};

/** Équivalent BCP-47, pour `<html lang>` et les métadonnées. */
export const LOCALE_TAGS: Record<Locale, string> = {
  fr: "fr-FR",
  en: "en-GB",
};

export const STORAGE_KEY = "minkebe.langue";

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

/**
 * Devine la langue : choix mémorisé, puis liste `Accept-Language` du
 * navigateur, puis français par défaut. Le serveur ne peut pas lire le
 * stockage local ; c'est donc le client qui corrige après hydratation.
 */
export function detectLocale(acceptLanguage?: string | null, stored?: string | null): Locale {
  if (isLocale(stored)) return stored;
  if (acceptLanguage) {
    const first = acceptLanguage
      .split(",")
      .map((part) => part.trim().slice(0, 2).toLowerCase())
      .find(isLocale);
    if (first) return first;
  }
  return DEFAULT_LOCALE;
}
