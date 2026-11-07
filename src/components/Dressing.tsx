"use client";

import { useMemo, useState } from "react";
import { CHARACTERS } from "@/game/characters";
import { OUTFITS, canWeave, getOutfit, outfitAvailable } from "@/game/outfits";
import { characterCopy, outfitCopy } from "@/i18n/catalogue";
import { useI18n } from "@/i18n/LocaleProvider";

/**
 * Vestiaire : choix du personnage et de la tenue.
 * Chaque tenue modifie discrétion, endurance, résistance et vitesse.
 */

const BASE = {
  stealth: 0.72,
  stamina: 34,
  resilience: 0.6,
  speed: 1.6,
};

export default function Dressing({
  level = 1,
  threads = 0,
  woven = [],
  characterId = "mbadinga",
  outfitId = "explorateur",
  onChange,
  onWeave,
}: {
  level?: number;
  /** Fils de Rêve en réserve. */
  threads?: number;
  /** Tenues déjà tissées. */
  woven?: string[];
  characterId?: string;
  outfitId?: string;
  onChange?: (selection: { characterId: string; outfitId: string }) => void;
  onWeave?: (outfitId: string) => void;
}) {
  const { locale, t } = useI18n();
  const [character, setCharacter] = useState(characterId);
  const [outfit, setOutfit] = useState(outfitId);

  const available = useMemo(
    () => OUTFITS.filter((entry) => outfitAvailable(entry, level, woven)),
    [level, woven],
  );
  const current = outfitCopy(getOutfit(outfit), locale);

  const stats = useMemo(
    () => [
      { key: t("dressing.stealth"), value: BASE.stealth * current.modifiers.stealth, max: 1.3 },
      { key: t("dressing.stamina"), value: (BASE.stamina / 34) * current.modifiers.stamina, max: 1.4 },
      { key: t("dressing.resilience"), value: BASE.resilience * current.modifiers.resilience, max: 1 },
      { key: t("dressing.speed"), value: (BASE.speed / 1.6) * current.modifiers.speed, max: 1.15 },
    ],
    [current, t],
  );

  const select = (nextCharacter: string, nextOutfit: string) => {
    setCharacter(nextCharacter);
    setOutfit(nextOutfit);
    onChange?.({ characterId: nextCharacter, outfitId: nextOutfit });
  };

  return (
    <section className="panel space-y-4 p-5 md:p-6" aria-labelledby="vestiaire-titre">
      <header className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="eyebrow">{t("dressing.kicker")}</p>
          <h2 id="vestiaire-titre" className="display text-2xl">
            {t("dressing.title")}
          </h2>
        </div>
        <div className="flex items-center gap-2">
          <span className="chip">🧵 {threads}</span>
          <span className="chip">
            {t("dressing.level")} {level}
          </span>
        </div>
      </header>

      <div className="flex flex-wrap gap-2">
        {CHARACTERS.map((candidate) => {
          return (
          <button
            key={candidate.id}
            type="button"
            onClick={() => select(candidate.id, outfit)}
            className={`rounded-xl border px-3 py-2 text-left text-xs transition ${
              character === candidate.id
                ? "border-amber-glow/60 bg-amber-glow/10"
                : "border-mist/15 hover:border-moss-300/60"
            }`}
            aria-pressed={character === candidate.id}
          >
            <span className="block font-semibold text-ink">{candidate.name}</span>
            <span className="text-caption text-ink-muted">
              {characterCopy(candidate, locale).role}
            </span>
          </button>
          );
        })}
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-2">
          {OUTFITS.map((base) => {
            const item = outfitCopy(base, locale);
            const unlocked = outfitAvailable(item, level, woven);
            const weavable = canWeave(item, threads, woven);
            const magic = item.threads > 0;
            const wovenAlready = woven.includes(item.id);
            return (
              <div
                key={item.id}
                className={`rounded-xl border transition ${
                  outfit === item.id
                    ? "border-moss-300/70 bg-moss-400/10"
                    : "border-mist/12 hover:border-moss-300/40"
                }`}
              >
                <button
                  type="button"
                  disabled={!unlocked}
                  onClick={() => select(character, item.id)}
                  className="flex w-full items-center gap-3 px-3 py-2 text-left disabled:cursor-not-allowed disabled:opacity-40"
                  aria-pressed={outfit === item.id}
                >
                  <span
                    className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-lg"
                    style={{ backgroundColor: `${item.accent}22`, border: `1px solid ${item.accent}55` }}
                  >
                    {item.emoji}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-ink">{item.name}</span>
                    <span className="block truncate text-caption text-ink-muted">
                      {unlocked
                        ? item.description
                        : magic
                          ? `${item.threads} 🧵 · ${t("game.dressNeed")}`
                          : `${t("dressing.locked")} ${item.unlockLevel}`}
                    </span>
                  </span>
                  {magic && (
                    <span className="shrink-0 text-micro tabular-nums text-sky-300">
                      {wovenAlready ? `✓ ${t("game.dressWoven")}` : `${item.threads} 🧵`}
                    </span>
                  )}
                </button>
                {magic && !wovenAlready && (
                  <div className="border-t border-mist/10 px-3 py-1.5">
                    <button
                      type="button"
                      disabled={!weavable}
                      onClick={() => onWeave?.(item.id)}
                      className="text-caption font-semibold uppercase tracking-wider text-sky-300 transition disabled:cursor-not-allowed disabled:text-ink-muted"
                    >
                      🪡 {t("game.dressThreads")} · {item.threads} 🧵
                    </button>
                  </div>
                )}
              </div>
            );
          })}
          {available.length < OUTFITS.length && (
            <p className="text-caption text-ink-muted">
              {OUTFITS.length - available.length} {t("dressing.lockedNote")}
            </p>
          )}
          {woven.length === 0 && (
            <p className="text-caption text-sky-300">🐾 {t("game.dressNone")}</p>
          )}
        </div>

        <div className="rounded-xl border border-mist/12 bg-canopy-950/50 p-4">
          <p className="eyebrow mb-2">{t("dressing.effect")}</p>
          <p className="mb-3 text-sm font-semibold text-ink">{current.name}</p>
          <div className="space-y-2">
            {stats.map((stat) => {
              const percent = Math.min(100, (stat.value / stat.max) * 100);
              return (
                <div key={stat.key}>
                  <div className="flex justify-between text-caption text-ink-muted">
                    <span>{stat.key}</span>
                    <span className="tabular-nums">{Math.round(percent)} %</span>
                  </div>
                  <div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-canopy-700">
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${percent}%`, backgroundColor: current.accent }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
          <p className="mt-3 text-caption leading-relaxed text-ink-muted">{current.description}</p>
        </div>
      </div>
    </section>
  );
}
