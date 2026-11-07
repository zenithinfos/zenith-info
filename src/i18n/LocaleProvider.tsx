"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  DEFAULT_LOCALE,
  LOCALES,
  LOCALE_LABELS,
  LOCALE_SHORT,
  LOCALE_TAGS,
  STORAGE_KEY,
  detectLocale,
  isLocale,
  type Locale,
} from "./locales";
import { translate, type DictionaryKey } from "./dictionary";

interface LocaleContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  /** Traduit une clé du dictionnaire. */
  t: (key: DictionaryKey) => string;
}

const LocaleContext = createContext<LocaleContextValue | null>(null);

/** Événement maison : `storage` ne se déclenche pas dans l'onglet émetteur. */
const LOCALE_EVENT = "minkebe:locale";

function subscribe(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener(LOCALE_EVENT, callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(LOCALE_EVENT, callback);
  };
}

/**
 * Langue côté client : préférence mémorisée, sinon langue du navigateur.
 * `useSyncExternalStore` évite le rendu en cascade d'un `setState` dans un
 * effet, et fait suivre la langue entre onglets.
 */
function getSnapshot(): Locale {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (isLocale(stored)) return stored;
  } catch {
    // Navigation privée : on retombe sur la langue du navigateur.
  }
  return detectLocale(typeof navigator === "undefined" ? null : navigator.language, null);
}

function getServerSnapshot(): Locale {
  return DEFAULT_LOCALE;
}

/**
 * Fournit la langue à tout l'arbre.
 *
 * Le premier rendu est toujours en français — c'est ce que le serveur a
 * envoyé, et changer la langue pendant l'hydratation provoquerait une
 * discordance. La préférence mémorisée est appliquée juste après, dans un
 * effet : l'utilisateur voit au pire un dixième de seconde de français.
 */
export function LocaleProvider({ children }: { children: ReactNode }) {
  const locale = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  useEffect(() => {
    document.documentElement.lang = LOCALE_TAGS[locale];
  }, [locale]);

  const setLocale = useCallback((next: Locale) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Navigation privée : la langue vaudra pour la session seulement.
    }
    window.dispatchEvent(new Event(LOCALE_EVENT));
  }, []);

  const value = useMemo<LocaleContextValue>(
    () => ({
      locale,
      setLocale,
      t: (key) => translate(locale, key),
    }),
    [locale, setLocale],
  );

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useI18n(): LocaleContextValue {
  const context = useContext(LocaleContext);
  if (!context) {
    // Hors fournisseur (un composant monté seul dans un test) : on répond en
    // français plutôt que de lever.
    return { locale: DEFAULT_LOCALE, setLocale: () => {}, t: (key) => translate(DEFAULT_LOCALE, key) };
  }
  return context;
}

/** Sélecteur de langue : deux pastilles, l'une active. */
export function LanguageSwitcher({ className = "" }: { className?: string }) {
  const { locale, setLocale, t } = useI18n();
  return (
    <div
      className={`flex items-center gap-1 rounded-full border border-mist/15 bg-canopy-950/60 p-0.5 ${className}`}
      role="group"
      aria-label={t("lang.switch")}
    >
      {LOCALES.map((code) => {
        const active = code === locale;
        return (
          <button
            key={code}
            type="button"
            onClick={() => setLocale(code)}
            aria-pressed={active}
            lang={LOCALE_TAGS[code]}
            title={LOCALE_LABELS[code]}
            className={`rounded-full px-2 py-1 text-caption font-semibold tracking-[0.14em] transition ${
              active
                ? "bg-amber-glow/20 text-amber-glow"
                : "text-ink-muted hover:text-ink"
            }`}
          >
            {LOCALE_SHORT[code]}
          </button>
        );
      })}
    </div>
  );
}

/** Lit la langue mémorisée sans passer par React (utile en dehors de l'arbre). */
export function readStoredLocale(): Locale {
  if (typeof window === "undefined") return DEFAULT_LOCALE;
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return isLocale(value) ? value : DEFAULT_LOCALE;
  } catch {
    return DEFAULT_LOCALE;
  }
}
