"use client";

import { useEffect, useState } from "react";

const STEPS = [
  "Déploiement de la canopée…",
  "Semis des fougères…",
  "Réveil de la faune…",
  "Calage des boussoles…",
  "Allumage du camp de base…",
];

export default function LoadingScreen({
  progress,
  label,
  done,
}: {
  progress: number;
  label?: string;
  done?: boolean;
}) {
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (done) return;
    const id = window.setInterval(() => {
      setStep((s) => (s + 1) % STEPS.length);
    }, 2200);
    return () => window.clearInterval(id);
  }, [done]);

  const value = Math.max(0, Math.min(100, Math.round(progress)));

  return (
    <div
      className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-6 bg-canopy-950/92 px-6 text-center backdrop-blur-sm"
      role="status"
      aria-live="polite"
      aria-label={done ? "Forêt prête" : "Chargement de la forêt"}
    >
      <div className="relative">
        <div className="h-20 w-20 rounded-full border border-moss-400/40" />
        <div
          className="absolute inset-0 rounded-full border-2 border-transparent border-t-amber-glow animate-spin"
          style={{ animationDuration: "1.4s" }}
        />
        <span className="absolute inset-0 grid place-items-center text-2xl">🌿</span>
      </div>

      <div className="space-y-2">
        <p className="display text-2xl text-ink">
          {done ? "La forêt est prête." : "Entrée dans la réserve"}
        </p>
        <p className="text-sm text-ink-soft">{label ?? STEPS[step]}</p>
      </div>

      <div className="w-full max-w-sm">
        <div
          className="h-1.5 w-full overflow-hidden rounded-full bg-canopy-700"
          role="progressbar"
          aria-valuenow={value}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            className="h-full rounded-full bg-gradient-to-r from-moss-400 via-amber-glow to-laterite-400 transition-[width] duration-500"
            style={{ width: `${value}%` }}
          />
        </div>
        <p className="mt-2 text-xs tabular-nums text-ink-muted">{value} %</p>
      </div>

      <p className="max-w-md text-xs leading-relaxed text-ink-muted">
        Astuce : casque recommandé. La forêt se découvre aussi à l&apos;oreille — les cris
        d&apos;éléphants portent à plus d&apos;un kilomètre.
      </p>
    </div>
  );
}
