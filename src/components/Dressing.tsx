"use client";

import { useMemo, useState } from "react";
import { CHARACTERS } from "@/game/characters";
import { OUTFITS, canWear, getOutfit, unlockedOutfits } from "@/game/outfits";
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
  characterId = "michelle",
  outfitId = "explorateur",
  onChange,
}: {
  level?: number;
  characterId?: string;
  outfitId?: string;
  onChange?: (selection: { characterId: string; outfitId: string }) => void;
}) {
  const { locale, t } = useI18n();
  const [character, setCharacter] = useState(characterId);
  const [outfit, setOutfit] = useState(outfitId);

  const available = useMemo(() => unlockedOutfits(level), [level]);
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
        <span className="chip">
          {t("dressing.level")} {level}
        </span>
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
            <span className="block font-semibold text-parchment">{candidate.name}</span>
            <span className="text-[0.65rem] text-mist/60">
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
            const unlocked = canWear(item.id, level);
            return (
              <button
                key={item.id}
                type="button"
                disabled={!unlocked}
                onClick={() => select(character, item.id)}
                className={`flex w-full items-center gap-3 rounded-xl border px-3 py-2 text-left transition disabled:cursor-not-allowed disabled:opacity-40 ${
                  outfit === item.id
                    ? "border-moss-300/70 bg-moss-400/10"
                    : "border-mist/12 hover:border-moss-300/40"
                }`}
                aria-pressed={outfit === item.id}
              >
                <span
                  className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-lg"
                  style={{ backgroundColor: `${item.accent}22`, border: `1px solid ${item.accent}55` }}
                >
                  {item.emoji}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm text-parchment">{item.name}</span>
                  <span className="block truncate text-[0.65rem] text-mist/55">
                    {unlocked
                      ? item.description
                      : `${t("dressing.locked")} ${item.unlockLevel}`}
                  </span>
                </span>
              </button>
            );
          })}
          {available.length < OUTFITS.length && (
            <p className="text-[0.65rem] text-mist/45">
              {OUTFITS.length - available.length} {t("dressing.lockedNote")}
            </p>
          )}
        </div>

        <div className="rounded-xl border border-mist/12 bg-canopy-950/50 p-4">
          <p className="eyebrow mb-2">{t("dressing.effect")}</p>
          <p className="mb-3 text-sm font-semibold text-parchment">{current.name}</p>
          <div className="space-y-2">
            {stats.map((stat) => {
              const percent = Math.min(100, (stat.value / stat.max) * 100);
              return (
                <div key={stat.key}>
                  <div className="flex justify-between text-[0.65rem] text-mist/65">
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
          <p className="mt-3 text-[0.65rem] leading-relaxed text-mist/50">{current.description}</p>
        </div>
      </div>
    </section>
  );
}
