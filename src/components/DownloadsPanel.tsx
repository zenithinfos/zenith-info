"use client";

import { useEffect, useMemo, useState } from "react";
import type { GamePackage, PackageId } from "@/lib/distribution";
import { packagesFor } from "@/i18n/catalogue";
import { useI18n } from "@/i18n/LocaleProvider";

/**
 * Panneau de téléchargement : clients Windows / macOS / Android et paquet
 * « Serveur » (code source à héberger). Les métadonnées (taille, empreinte)
 * viennent de /api/download ; en cas d'échec, on garde les valeurs statiques.
 */

interface PackageMeta {
  id: PackageId;
  sizeBytes: number | null;
  sha256: string | null;
  available: boolean;
}

const UNITS = {
  fr: ["o", "Ko", "Mo", "Go"],
  en: ["B", "KB", "MB", "GB"],
} as const;

function formatBytes(bytes: number | null, locale: "fr" | "en"): string {
  if (!bytes) return "—";
  const units = UNITS[locale];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

const PLATFORM_TONE: Record<PackageId, string> = {
  windows: "from-sky-500/15",
  macos: "from-zinc-300/10",
  android: "from-emerald-500/15",
  source: "from-amber-glow/15",
};

export default function DownloadsPanel({ compact = false }: { compact?: boolean }) {
  const { locale, t } = useI18n();
  const [meta, setMeta] = useState<Record<string, PackageMeta>>({});
  const [selected, setSelected] = useState<PackageId>("windows");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/download", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error("offline"))))
      .then((data: { packages: PackageMeta[] }) => {
        if (cancelled) return;
        setMeta(Object.fromEntries((data.packages ?? []).map((p) => [p.id, p])));
      })
      .catch(() => {
        /* API indisponible : les cartes restent cliquables */
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const packages = useMemo(
    () =>
      packagesFor(locale).map((pkg) => ({
        ...pkg,
        sizeBytes: meta[pkg.id]?.sizeBytes ?? pkg.sizeBytes,
        sha256: meta[pkg.id]?.sha256 ?? pkg.sha256,
        available: meta[pkg.id]?.available ?? true,
      })),
    [meta, locale],
  );

  const current: GamePackage = packages.find((p) => p.id === selected) ?? packages[0];

  return (
    <section className="panel space-y-5 p-5 md:p-6" aria-labelledby="telecharger-titre">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow">{t("download.kicker")}</p>
          <h2 id="telecharger-titre" className="display text-2xl">
            {t("dl.title")}
          </h2>
          <p className="mt-1 max-w-lg text-xs text-mist/60">
            {t("dl.version")} {current.version} · {current.format} ·{" "}
            {formatBytes(current.sizeBytes, locale)}
            {loading && <span className="ml-2 text-mist/35">({t("dl.updating")})</span>}
          </p>
        </div>
        <a
          href="/api/download"
          target="_blank"
          rel="noreferrer"
          className="text-[0.7rem] text-moss-300 underline-offset-4 hover:underline"
        >
          {t("dl.json")}
        </a>
      </header>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {packages.map((pkg) => (
          <button
            key={pkg.id}
            type="button"
            onClick={() => setSelected(pkg.id)}
            className={`group relative overflow-hidden rounded-xl border p-3 text-left transition ${
              selected === pkg.id
                ? "border-amber-glow/60 bg-canopy-800"
                : "border-mist/12 hover:border-moss-300/50"
            }`}
            aria-pressed={selected === pkg.id}
          >
            <div
              className={`pointer-events-none absolute inset-0 bg-gradient-to-br to-transparent opacity-70 ${PLATFORM_TONE[pkg.id]}`}
            />
            <div className="relative">
              <span className="text-xl">{pkg.icon}</span>
              <p className="mt-1 text-sm font-semibold text-parchment">{pkg.label}</p>
              <p className="text-[0.65rem] text-mist/55">
                {pkg.format} · {formatBytes(pkg.sizeBytes, locale)}
              </p>
              {pkg.kind === "server" && (
                <span className="mt-1 inline-block rounded-full bg-amber-glow/15 px-2 py-0.5 text-[0.58rem] uppercase tracking-wider text-amber-glow">
                  {t("dl.hostBadge")}
                </span>
              )}
            </div>
          </button>
        ))}
      </div>

      {!compact && (
        <div className="grid gap-4 md:grid-cols-[1.1fr_1fr]">
          <div className="rounded-xl border border-mist/12 bg-canopy-950/45 p-4">
            <p className="eyebrow mb-2">
              {current.kind === "server" ? t("dl.hosting") : t("dl.install")}
            </p>
            <ol className="space-y-1.5 text-xs text-mist/70">
              {current.instructions.map((instruction, index) => (
                <li key={instruction} className="flex gap-2">
                  <span className="mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full bg-moss-400/20 text-[0.55rem] text-moss-300">
                    {index + 1}
                  </span>
                  <span>{instruction}</span>
                </li>
              ))}
            </ol>

            <div className="mt-4 flex flex-wrap gap-2">
              <a href={`/api/download/${current.id}`} className="btn btn-primary !px-4 !py-2 !text-xs" download>
                {t("dl.download")} ({current.format})
              </a>
              <a href={`/api/download/${current.id}?format=txt`} className="btn btn-ghost !px-4 !py-2 !text-xs">
                {t("dl.readme")}
              </a>
            </div>
          </div>

          <div className="rounded-xl border border-mist/12 bg-canopy-950/45 p-4 text-xs text-mist/70">
            <p className="eyebrow mb-2">{t("dl.requirements")}</p>
            <p className="mb-3">{current.requirements}</p>

            <p className="eyebrow mb-2">{t("dl.integrity")}</p>
            {current.sha256 ? (
              <code className="block break-all rounded-lg bg-canopy-900/80 p-2 text-[0.62rem] text-mist/60">
                sha256:{current.sha256}
              </code>
            ) : (
              <p className="text-[0.65rem] text-mist/45">{t("dl.notBuilt")}</p>
            )}

            <p className="mt-3 text-[0.65rem] text-mist/45">
              {current.kind === "server" ? t("dl.noteServer") : t("dl.noteClient")}
            </p>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 border-t border-mist/10 pt-3 text-[0.65rem] text-mist/45">
        <span>{t("dl.ios")}</span>
        <span>·</span>
        <span>{t("dl.browsers")}</span>
        <span>·</span>
        <a href="/api/about" className="underline-offset-4 hover:underline">
          {t("dl.about")}
        </a>
      </div>
    </section>
  );
}
