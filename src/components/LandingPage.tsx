"use client";

import Image from "next/image";
import DownloadsPanel from "@/components/DownloadsPanel";
import Dressing from "@/components/Dressing";
import GameTrailer from "@/components/GameTrailer";
import MinkebeGame from "@/components/MinkebeGame";
import MusicPlayer from "@/components/MusicPlayer";
import Pricing from "@/components/Pricing";
import { SPECIES } from "@/game/fauna";
import { useI18n, LanguageSwitcher } from "@/i18n/LocaleProvider";
import { APP_NAME, APP_VERSION, GAME_VERSION, GAME_URL } from "@/lib/version";

/**
 * La page d'accueil du jeu.
 *
 * Elle a été resserrée : six sections au lieu de neuf, quatre entrées de menu
 * au lieu de six, et les outils annexes (vestiaire, musique, accessibilité)
 * repliés dans un bloc « extras ». Une page de jeu n'a pas à ressembler à un
 * catalogue.
 */

export default function LandingPage() {
  const { t } = useI18n();
  const emblematic = [...SPECIES].sort((a, b) => b.points - a.points).slice(0, 6);

  return (
    <main className="relative overflow-hidden">
      {/* ------------------------------------------------------------------ */}
      {/* En-tête et héros — une seule pleine page, une seule image          */}
      {/* ------------------------------------------------------------------ */}
      {/*
        L'image du héros est un **rendu du moteur** : le même sous-bois, les
        mêmes arbres, les mêmes textures que dans le jeu. Avant, cette place
        était tenue par un décor dessiné en SVG — des traits et des ellipses —
        et c'est ce qui donnait à l'accueil son air de maquette. Une seule
        image, plein cadre, vaut mieux que la même répétée plus bas dans la
        page : la section « forêt » est donc devenue typographique.
      */}
      <div className="relative isolate overflow-hidden">
        {/*
          `next/image` et non `<img>` : cette photo est le plus grand élément
          affiché au chargement. Sans optimisation elle bloque le rendu ; avec,
          elle est servie en WebP à la bonne taille et chargée en priorité.
        */}
        <Image
          src="/images/hero-forest.jpg"
          alt=""
          aria-hidden
          fill
          priority
          sizes="(max-width: 1600px) 100vw, 1600px"
          className="pointer-events-none -z-10 object-cover object-[center_42%]"
        />
        <div aria-hidden className="hero-scrim pointer-events-none absolute inset-0 -z-10" />

        <header className="relative z-20 mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-6">
          <a href="#" className="flex items-center gap-3">
            <span className="grid h-9 w-9 place-items-center rounded-xl border border-moss-300/40 bg-canopy-800/80 text-base backdrop-blur-sm">
              🌿
            </span>
            <span className="text-micro uppercase leading-tight tracking-[0.24em] text-ink-soft">
              {t("app.byline")}
            </span>
          </a>

          <nav className="hidden items-center gap-7 text-caption text-ink-muted md:flex" aria-label={t("nav.label")}>
            <a href="#jeu" className="transition hover:text-ink">{t("nav.play")}</a>
            <a href="#bande-annonce" className="transition hover:text-ink">{t("nav.trailer")}</a>
            <a href="#foret" className="transition hover:text-ink">{t("nav.forest")}</a>
            <a href="#soutenir" className="transition hover:text-ink">{t("nav.support")}</a>
          </nav>

          <div className="flex items-center gap-2">
            <LanguageSwitcher />
            <a href="#jeu" className="btn btn-primary hidden px-4 py-2 text-caption sm:inline-flex">
              {t("hero.cta")}
            </a>
          </div>
        </header>

        <section className="relative mx-auto max-w-6xl px-5 pb-20 pt-10 sm:pb-28 sm:pt-16">
          <div className="max-w-3xl space-y-7">
            <p className="eyebrow">{t("hero.kicker")}</p>
            <div className="space-y-5">
              {/*
                Le titre est un logotype : il change d'échelle avec l'écran et
                garde son interlettrage. `text-hero` (120 px) ne s'applique
                qu'au-delà de 1024 px — à 375 px de large, il débordait.
              */}
              <h1 className="display text-6xl leading-[0.88] tracking-[0.1em] text-ink sm:text-8xl lg:text-hero">
                {t("hero.title")}
              </h1>
              <span className="block h-px w-40 bg-gradient-to-r from-amber-glow via-laterite-400/70 to-transparent" />
            </div>
            <p className="max-w-xl text-lede text-ink-soft">{t("hero.lede")}</p>
            <div className="flex flex-wrap items-center gap-3">
              <a href="#jeu" className="btn btn-primary">▶ {t("hero.cta")}</a>
              <a href="#bande-annonce" className="btn btn-ghost">🎬 {t("hero.ctaAlt")}</a>
            </div>
            <p className="text-micro uppercase tracking-[0.24em] text-moss-300">
              {t("hero.place")}
            </p>
          </div>

          {/* Quatre chiffres, une ligne : pas une grille de statistiques. */}
          <dl className="mt-12 flex flex-wrap gap-x-10 gap-y-4 border-t border-ink-soft/15 pt-6">
            {[
              { value: "8", label: t("figures.zones") },
              { value: "10", label: t("figures.species") },
              { value: "5", label: t("figures.weapons") },
              { value: "8", label: t("figures.players") },
            ].map((stat) => (
              <div key={stat.label} className="flex items-baseline gap-2">
                <dt className="sr-only">{stat.label}</dt>
                <dd className="display text-3xl text-ink">{stat.value}</dd>
                <span className="text-caption text-ink-muted">{stat.label}</span>
              </div>
            ))}
          </dl>
        </section>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Bande-annonce                                                      */}
      {/* ------------------------------------------------------------------ */}
      <section id="bande-annonce" className="mx-auto max-w-6xl px-5 py-16">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="eyebrow">{t("trailer.kicker")}</p>
            <h2 className="display mt-1 text-2xl text-ink sm:text-3xl">{t("trailer.title")}</h2>
          </div>
          <p className="max-w-sm text-caption leading-relaxed text-ink-muted">{t("trailer.note")}</p>
        </div>
        <GameTrailer />
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* Le jeu                                                             */}
      {/* ------------------------------------------------------------------ */}
      <section id="jeu" className="mx-auto max-w-6xl px-5 py-16">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="eyebrow">{t("game.kicker")}</p>
            <h2 className="display mt-1 text-2xl text-ink sm:text-3xl">{t("game.title")}</h2>
          </div>
          <p className="max-w-md text-caption text-ink-muted">
            <kbd className="rounded bg-canopy-800 px-1 text-ink">H</kbd>{" "}
            {t("controls.open")} · {t("game.mobile")}
          </p>
        </div>
        <MinkebeGame />
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* La forêt                                                           */}
      {/* ------------------------------------------------------------------ */}
      <section id="foret" className="mx-auto max-w-6xl px-5 py-16 sm:py-24">
        <div className="grid gap-10 lg:grid-cols-[1fr_1fr] lg:items-start lg:gap-16">
          <div className="space-y-5">
            <p className="eyebrow">{t("place.kicker")}</p>
            <h2 className="display text-3xl text-ink sm:text-4xl">{t("place.title")}</h2>
            <p className="text-body text-ink-soft">{t("place.body")}</p>
          </div>
          {/*
            Les faits prennent la place qu'occupait une image de décor
            vectorielle. Une liste de trois lignes, avec sa règle de gauche,
            se lit mieux qu'un dessin qui ne représentait rien.
          */}
          {/*
            Trois faits, numérotés plutôt qu'illustrés. Les libellés viennent du
            dictionnaire — donc du français comme de l'anglais — et aucun
            chiffre n'est écrit en dur : une superficie recopiée à la main dans
            un composant finit toujours par contredire la fiche du lieu.
          */}
          <ol className="border-l border-laterite-400/40 pl-5 sm:pl-7">
            {["place.fact.area", "place.fact.province", "place.fact.baï"].map((key, index) => (
              <li
                key={key}
                className="flex gap-4 border-b border-ink-soft/10 py-4 last:border-b-0"
              >
                <span className="display shrink-0 text-caption tabular-nums text-laterite-400">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <span className="text-body text-ink-soft">{t(key as Parameters<typeof t>[0])}</span>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* Faune                                                              */}
      {/* ------------------------------------------------------------------ */}
      <section id="faune" className="mx-auto max-w-6xl px-5 py-16">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="eyebrow">{t("fauna.kicker")}</p>
            <h2 className="display mt-1 text-2xl text-ink sm:text-3xl">{t("fauna.title")}</h2>
          </div>
          <p className="max-w-md text-caption leading-relaxed text-ink-muted">{t("fauna.lede")}</p>
        </div>

        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {emblematic.map((species) => (
            <li key={species.id} className="panel flex items-start gap-3 p-4">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-canopy-800 text-lg">
                {species.emoji}
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-ink">{species.name}</p>
                <p className="truncate text-caption italic text-ink-muted">{species.scientific}</p>
                <p className="mt-1.5 line-clamp-2 text-caption leading-relaxed text-ink-muted">
                  {species.note}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* Les Mewas et la survie                                              */}
      {/* ------------------------------------------------------------------ */}
      <section id="mewas" className="mx-auto max-w-6xl px-5 py-16">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="eyebrow">{t("mewas.kicker")}</p>
            <h2 className="display mt-1 text-2xl text-ink sm:text-3xl">{t("mewas.title")}</h2>
          </div>
          <p className="max-w-md text-caption leading-relaxed text-ink-muted">{t("mewas.lede")}</p>
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          {(
            [
              { icon: "🐾", title: "mewas.find.title", desc: "mewas.find.desc" },
              { icon: "🪡", title: "mewas.weave.title", desc: "mewas.weave.desc" },
              { icon: "❤", title: "mewas.survive.title", desc: "mewas.survive.desc" },
            ] as const
          ).map((card) => (
            <article key={card.title} className="panel space-y-2 p-5">
              <span
                aria-hidden
                className="grid h-10 w-10 place-items-center rounded-lg border border-sky-300/30 bg-sky-400/10 text-lg"
              >
                {card.icon}
              </span>
              <h3 className="text-sm font-semibold text-ink">{t(card.title)}</h3>
              <p className="text-caption leading-relaxed text-ink-muted">{t(card.desc)}</p>
            </article>
          ))}
        </div>

        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {(
            [
              { icon: "❤", label: "game.health", note: "gauge.health", colour: "bg-laterite-400" },
              { icon: "🍈", label: "game.hunger", note: "gauge.hunger", colour: "bg-amber-glow" },
              { icon: "💧", label: "game.thirst", note: "gauge.thirst", colour: "bg-sky-400" },
              { icon: "⚡", label: "game.stamina", note: "gauge.stamina", colour: "bg-moss-300" },
            ] as const
          ).map((gauge) => (
            <div key={gauge.label} className="rounded-xl border border-mist/12 bg-canopy-950/50 p-3">
              <p className="flex items-center gap-1.5 text-caption uppercase tracking-[0.16em] text-ink-muted">
                <span aria-hidden>{gauge.icon}</span>
                {t(gauge.label)}
              </p>
              <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-canopy-700">
                <div className={`h-full w-2/3 rounded-full ${gauge.colour}`} />
              </div>
              <p className="mt-1.5 text-caption leading-snug text-ink-muted">{t(gauge.note)}</p>
            </div>
          ))}
        </div>

        <p className="mt-4 text-caption uppercase tracking-[0.22em] text-sky-300">
          {t("mewas.count")}
        </p>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* Comment on survit                                                  */}
      {/* ------------------------------------------------------------------ */}
      <section id="survie" className="mx-auto max-w-6xl px-5 py-16">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="eyebrow">{t("survival.kicker")}</p>
            <h2 className="display mt-1 text-2xl text-ink sm:text-3xl">{t("survival.title")}</h2>
          </div>
          <p className="max-w-md text-caption leading-relaxed text-ink-muted">{t("survival.lede")}</p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {(
            [
              { icon: "🪵", title: "survival.shelter.title", desc: "survival.shelter.desc", key: "B" },
              { icon: "🛡️", title: "survival.guard.title", desc: "survival.guard.desc", key: "Ctrl" },
              { icon: "🔫", title: "survival.weapons.title", desc: "survival.weapons.desc", key: "1-6" },
              { icon: "🏆", title: "survival.levels.title", desc: "survival.levels.desc", key: "XP" },
            ] as const
          ).map((card) => (
            <article key={card.title} className="panel space-y-2 p-5">
              <div className="flex items-start justify-between gap-2">
                <span
                  aria-hidden
                  className="grid h-10 w-10 place-items-center rounded-lg border border-amber-glow/25 bg-amber-glow/10 text-lg"
                >
                  {card.icon}
                </span>
                <kbd className="rounded bg-canopy-700 px-1.5 py-0.5 text-micro text-ink">
                  {card.key}
                </kbd>
              </div>
              <h3 className="text-sm font-semibold text-ink">{t(card.title)}</h3>
              <p className="text-caption leading-relaxed text-ink-muted">{t(card.desc)}</p>
            </article>
          ))}
        </div>

        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {(
            [
              { name: "outfit.fee-etoiles", icon: "✨" },
              { name: "outfit.nenuphar", icon: "🪷" },
              { name: "outfit.murmure", icon: "🐾" },
              { name: "outfit.purificatrice", icon: "🕊️" },
            ] as const
          ).map((outfit) => (
            <div
              key={outfit.name}
              className="flex items-center gap-2 rounded-xl border border-sky-300/20 bg-sky-400/[0.06] px-3 py-2"
            >
              <span aria-hidden>{outfit.icon}</span>
              <span className="text-caption text-ink">{t(outfit.name)}</span>
            </div>
          ))}
        </div>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* Installer / soutenir — une seule section, deux colonnes            */}
      {/* ------------------------------------------------------------------ */}
      <section id="soutenir" className="mx-auto max-w-6xl px-5 py-16">
        <div className="grid gap-8 lg:grid-cols-2">
          <div className="space-y-4">
            <p className="eyebrow">{t("download.kicker")}</p>
            <h2 className="display text-2xl text-ink">{t("download.title")}</h2>
            <p className="text-body text-ink-muted">{t("download.lede")}</p>
            <DownloadsPanel />
          </div>
          <div className="space-y-4">
            <p className="eyebrow">{t("support.kicker")}</p>
            <h2 className="display text-2xl text-ink">{t("support.title")}</h2>
            <Pricing />
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* Extras : repliés par défaut                                        */}
      {/* ------------------------------------------------------------------ */}
      <section className="mx-auto max-w-6xl px-5 pb-16">
        <details className="panel group">
          <summary className="cursor-pointer list-none px-5 py-4 text-sm text-ink-soft transition group-open:text-ink">
            <span className="mr-2 inline-block transition group-open:rotate-90">▸</span>
            {t("extras.summary")}
          </summary>
          <div className="grid gap-5 border-t border-mist/10 p-5 lg:grid-cols-[1.4fr_1fr]">
            <Dressing level={4} />
            <div className="space-y-5">
              <MusicPlayer />
              <div className="panel space-y-1 p-4">
                <p className="eyebrow">{t("a11y.kicker")}</p>
                <ul className="space-y-1 text-caption text-ink-muted">
                  <li>· {t("a11y.keyboard")}</li>
                  <li>· {t("a11y.motion")}</li>
                  <li>· {t("a11y.contrast")}</li>
                </ul>
              </div>
            </div>
          </div>
        </details>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* Pied de page                                                       */}
      {/* ------------------------------------------------------------------ */}
      <footer className="border-t border-mist/10 bg-canopy-950/60">
        <div className="mx-auto grid max-w-6xl gap-8 px-5 py-12 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-2">
            <p className="display text-base tracking-[0.22em] text-ink">{APP_NAME}</p>
            <p className="text-micro uppercase tracking-[0.22em] text-ink-muted">
              {t("app.byline")}
            </p>
            <p className="text-caption leading-relaxed text-ink-muted">{t("footer.credit")}</p>
            <LanguageSwitcher />
          </div>
          <div>
            <p className="eyebrow mb-2">{t("footer.play")}</p>
            <ul className="space-y-1 text-caption text-ink-muted">
              <li><a href="#jeu" className="hover:text-ink">{t("footer.browser")}</a></li>
              <li><a href="#soutenir" className="hover:text-ink">{t("footer.clients")}</a></li>
              <li><a href="/api/download/source" download className="hover:text-ink">{t("footer.server")}</a></li>
            </ul>
          </div>
          <div>
            <p className="eyebrow mb-2">{t("footer.about")}</p>
            <ul className="space-y-1 text-caption text-ink-muted">
              <li><a href="/api/health" className="hover:text-ink">{t("footer.health")}</a></li>
              <li><a href="/api/about" className="hover:text-ink">{t("footer.version")} {GAME_VERSION}</a></li>
              <li><a href="/admin" className="hover:text-ink">{t("footer.admin")}</a></li>
            </ul>
          </div>
          <div>
            <p className="eyebrow mb-2">{t("footer.contact")}</p>
            <ul className="space-y-1 text-caption text-ink-muted">
              <li>support@zenith-info.example</li>
              <li>Libreville, Gabon</li>
              <li className="truncate text-ink-muted">{GAME_URL}</li>
            </ul>
          </div>
        </div>
        <p className="border-t border-mist/10 px-5 py-4 text-center text-caption text-ink-muted">
          {t("footer.legal")} · v{APP_VERSION}
        </p>
      </footer>
    </main>
  );
}
