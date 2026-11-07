"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "@/i18n/LocaleProvider";
import type { DictionaryKey } from "@/i18n/dictionary";

/**
 * Bande-annonce.
 *
 * Le fichier est un vrai MP4 (rendu par `scripts/game-trailer.mjs`) : il ne se
 * télécharge qu'au premier clic, et seulement alors. Tant qu'on ne l'a pas
 * lancé, l'affiche et les chapitres suffisent.
 *
 * Ce qui rend la lecture « dynamique » : la barre de progression est aussi le
 * sommaire du film. Six chapitres, chacun avec son temps, et celui qu'on est en
 * train de regarder s'allume. On peut sauter de l'un à l'autre sans attendre.
 */

const CHAPTERS: { key: DictionaryKey; at: number }[] = [
  { key: "trailer.chapter.forest", at: 0 },
  { key: "trailer.chapter.hunter", at: 9 },
  { key: "trailer.chapter.wildlife", at: 16 },
  { key: "trailer.chapter.aim", at: 24 },
  { key: "trailer.chapter.night", at: 29 },
  { key: "trailer.chapter.title", at: 37 },
];

function formatTime(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

export default function GameTrailer({
  poster = "/images/trailer-poster.jpg",
  src = "/video/minkebe-trailer.mp4",
  className = "",
}: {
  poster?: string;
  src?: string;
  className?: string;
}) {
  const { t } = useI18n();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [started, setStarted] = useState(false);
  const [failed, setFailed] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(42);

  const play = useCallback(() => {
    setStarted(true);
    const video = videoRef.current;
    if (!video) return;
    void video.play().catch(() => setFailed(true));
  }, []);

  const toggle = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      setStarted(true);
      void video.play().catch(() => setFailed(true));
    } else {
      video.pause();
    }
  }, []);

  const seekChapter = (index: number) => {
    const video = videoRef.current;
    const target = CHAPTERS[index];
    if (!video || !target) return;
    video.currentTime = target.at + 0.05;
    setStarted(true);
    void video.play().catch(() => setFailed(true));
  };

  useEffect(() => {
    if (!started) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.code === "Space" || event.key === "k") {
        const video = videoRef.current;
        if (!video) return;
        // Ne pas voler la barre d'espace au jeu : on n'agit que si la vidéo a
        // déjà été lancée et que le focus est dans la section.
        event.preventDefault();
        toggle();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [started, toggle]);

  const progress = Math.min(1, time / Math.max(1, duration));
  const current = CHAPTERS.reduce((acc, entry, index) => (time >= entry.at ? index : acc), 0);

  return (
    <figure className={`panel overflow-hidden ${className}`}>
      <div className="relative aspect-video w-full bg-canopy-950">
        <video
          ref={videoRef}
          className="h-full w-full object-cover"
          poster={poster}
          preload="none"
          playsInline
          aria-label={t("trailer.title")}
          onLoadedMetadata={(event) => {
            const value = event.currentTarget.duration;
            if (Number.isFinite(value) && value > 0) setDuration(value);
          }}
          onTimeUpdate={(event) => setTime(event.currentTarget.currentTime)}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => setPlaying(false)}
          onError={() => setFailed(true)}
        >
          <source src={src} type="video/mp4" />
          {t("trailer.unavailable")}
        </video>

        {/* Affiche et bouton de lancement : c'est aussi l'affiche du film. */}
        {!started && !failed && (
          <button
            type="button"
            onClick={play}
            className="group absolute inset-0 grid place-items-center bg-gradient-to-t from-canopy-950/85 via-canopy-950/25 to-canopy-950/40 transition hover:from-canopy-950/70"
            aria-label={t("trailer.play")}
          >
            <span className="grid h-20 w-20 place-items-center rounded-full border border-parchment/40 bg-canopy-950/60 text-2xl text-ink backdrop-blur transition group-hover:scale-105 group-hover:border-amber-glow group-hover:text-amber-glow">
              ▶
            </span>
            <span className="absolute bottom-5 left-5 right-5 text-left">
              <span className="eyebrow block">{t("trailer.kicker")}</span>
              <span className="display block text-xl text-ink sm:text-2xl">
                {t("trailer.title")}
              </span>
            </span>
          </button>
        )}

        {failed && (
          <div
            className="absolute inset-0 bg-cover bg-center"
            style={{ backgroundImage: `url(${poster})` }}
            role="img"
            aria-label={t("trailer.unavailable")}
          >
            <p className="absolute inset-x-0 bottom-4 px-4 text-center text-caption text-laterite-400">
              {t("trailer.unavailable")}
            </p>
          </div>
        )}

        {/* Contrôles : lecture, temps, plein écran. */}
        {started && !failed && (
          <div className="absolute inset-x-0 bottom-0 space-y-2 bg-gradient-to-t from-canopy-950/90 to-transparent px-3 pb-3 pt-8">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={toggle}
                className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-mist/25 bg-canopy-950/70 text-sm text-ink"
                aria-label={playing ? t("trailer.pause") : t("trailer.play")}
              >
                {playing ? "❙❙" : "▶"}
              </button>
              <span className="font-mono text-caption text-ink-soft">
                {formatTime(time)} / {formatTime(duration)}
              </span>
              <label className="flex flex-1 items-center">
                <span className="sr-only">{t("trailer.play")}</span>
                <input
                  type="range"
                  min={0}
                  max={Math.max(1, duration)}
                  step={0.1}
                  value={time}
                  onChange={(event) => {
                    const video = videoRef.current;
                    if (!video) return;
                    const value = Number(event.target.value);
                    video.currentTime = value;
                    setTime(value);
                  }}
                  className="h-1 w-full cursor-pointer appearance-none rounded-full bg-mist/25 accent-amber-glow"
                  style={{
                    background: `linear-gradient(to right, #d9a860 ${progress * 100}%, rgba(255,255,255,0.16) ${progress * 100}%)`,
                  }}
                />
              </label>
              <button
                type="button"
                onClick={() => {
                  const video = videoRef.current;
                  if (!video) return;
                  if (video.requestFullscreen) void video.requestFullscreen();
                }}
                className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-mist/25 bg-canopy-950/70 text-xs text-ink"
                aria-label="Plein écran"
              >
                ⛶
              </button>
            </div>

            {/* Sommaire : six chapitres, cliquables, celui en cours allumé. */}
            <ol className="flex flex-wrap gap-1">
              {CHAPTERS.map((entry, index) => (
                <li key={entry.key}>
                  <button
                    type="button"
                    onClick={() => seekChapter(index)}
                    aria-current={index === current ? "true" : undefined}
                    className={`rounded-full border px-2 py-0.5 text-micro transition ${
                      index === current
                        ? "border-amber-glow/60 bg-amber-glow/15 text-amber-glow"
                        : "border-mist/15 text-ink-muted hover:border-moss-300 hover:text-ink"
                    }`}
                  >
                    <span className="font-mono opacity-60">{formatTime(entry.at)}</span>{" "}
                    {t(entry.key)}
                  </button>
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>

      <figcaption className="sr-only">{t("trailer.note")}</figcaption>
      <p className="border-t border-mist/10 px-4 py-2 text-caption text-ink-muted">
        {t("trailer.note")}
      </p>
      <p className="sr-only" aria-live="polite">
        {t(CHAPTERS[current].key)}
      </p>
    </figure>
  );
}
