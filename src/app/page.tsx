import MinkebeGame from "@/components/MinkebeGame";
import DownloadsPanel from "@/components/DownloadsPanel";
import Dressing from "@/components/Dressing";
import MusicPlayer from "@/components/MusicPlayer";
import GameTrailer from "@/components/GameTrailer";
import Pricing from "@/components/Pricing";
import { SPECIES } from "@/game/fauna";
import { ZONES } from "@/game/levels";
import { APP_NAME, APP_VERSION, GAME_VERSION, GAME_URL } from "@/lib/version";

export const metadata = {
  title: `${APP_NAME} — exploration de la forêt gabonaise`,
  description:
    "Explorez la réserve de Minkébé en 3D : documentez 12 espèces, cartographiez 8 zones et jouez jusqu'à 8 en multijoueur.",
};

const STATS = [
  { value: "8", label: "zones à cartographier" },
  { value: "12", label: "espèces à documenter" },
  { value: "8", label: "joueurs par salon" },
  { value: "0", label: "animal blessé" },
];

const HIGHLIGHTS = [
  {
    emoji: "🌳",
    title: "Forêt simulée, pas décor",
    text: "620 arbres instanciés, sol déformé, brume volumétrique et cycle jour/nuit de 24 minutes réelles.",
  },
  {
    emoji: "🦍",
    title: "Faune qui réagit",
    text: "Chaque espèce a ses horaires, son habitat et sa réaction : fuite, curiosité ou charge.",
  },
  {
    emoji: "🧭",
    title: "Navigation crédible",
    text: "Boussole, GPS qui perd le signal, carte papier : les outils ont des limites, comme sur le terrain.",
  },
  {
    emoji: "🤝",
    title: "Expédition partagée",
    text: "Salons à 8, positions synchronisées et sauvegardes PostgreSQL pour reprendre sur un autre appareil.",
  },
];

export default function HomePage() {
  const rarest = [...SPECIES].sort((a, b) => b.points - a.points).slice(0, 6);

  return (
    <main className="relative overflow-hidden">
      {/* ---------------------------------------------------------------- */}
      {/* En-tête                                                          */}
      {/* ---------------------------------------------------------------- */}
      <header className="relative z-20 mx-auto flex max-w-7xl items-center justify-between gap-4 px-5 py-5">
        <a href="#" className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl border border-moss-300/40 bg-canopy-800 text-lg">
            🌿
          </span>
          <span>
            <span className="display block text-lg leading-none text-parchment">Minkébé</span>
            <span className="block text-[0.6rem] uppercase tracking-[0.28em] text-moss-300">
              Zenith Info
            </span>
          </span>
        </a>

        <nav className="hidden items-center gap-6 text-sm text-mist/70 md:flex" aria-label="Navigation principale">
          <a href="#jeu" className="hover:text-parchment">Jouer</a>
          <a href="#trailer" className="hover:text-parchment">Bande-annonce</a>
          <a href="#faune" className="hover:text-parchment">Faune</a>
          <a href="#telecharger" className="hover:text-parchment">Télécharger</a>
          <a href="#soutenir" className="hover:text-parchment">Soutenir</a>
        </nav>

        <a href="#jeu" className="btn btn-primary !px-4 !py-2 !text-xs">
          ▶ Jouer maintenant
        </a>
      </header>

      {/* ---------------------------------------------------------------- */}
      {/* Héros                                                            */}
      {/* ---------------------------------------------------------------- */}
      <section className="relative mx-auto max-w-7xl px-5 pb-10 pt-6">
        <div className="grid items-center gap-8 lg:grid-cols-[1.05fr_1fr]">
          <div className="animate-float-up space-y-6">
            <p className="eyebrow">Réserve de Minkébé · Gabon · 0° 30′ N</p>
            <h1 className="display text-4xl leading-[1.02] text-parchment sm:text-5xl lg:text-6xl">
              La forêt avant
              <br />
              <span className="bg-gradient-to-r from-amber-glow via-laterite-400 to-moss-300 bg-clip-text text-transparent">
                le silence.
              </span>
            </h1>
            <p className="max-w-xl text-sm leading-relaxed text-mist/75 sm:text-base">
              Un jeu d&apos;exploration et de conservation dans l&apos;une des dernières grandes
              forêts intactes du bassin du Congo. Documentez la faune, cartographiez les bais,
              ramenez des données — pas des trophées.
            </p>

            <div className="flex flex-wrap items-center gap-3">
              <a href="#jeu" className="btn btn-primary">
                ▶ Lancer une expédition
              </a>
              <a href="#trailer" className="btn btn-ghost">
                🎬 Voir la bande-annonce
              </a>
            </div>

            <dl className="grid max-w-lg grid-cols-2 gap-3 pt-2 sm:grid-cols-4">
              {STATS.map((stat) => (
                <div key={stat.label} className="panel-tight px-3 py-2">
                  <dt className="text-[0.6rem] uppercase tracking-[0.16em] text-mist/45">
                    {stat.label}
                  </dt>
                  <dd className="display text-xl text-parchment">{stat.value}</dd>
                </div>
              ))}
            </dl>
          </div>

          <div className="relative">
            <div className="panel overflow-hidden">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/images/menu-forest.jpg"
                alt="Canopée de la réserve de Minkébé au lever du jour"
                className="aspect-[4/3] w-full object-cover"
                width={960}
                height={720}
              />
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-canopy-950 to-transparent p-4">
                <p className="text-[0.65rem] uppercase tracking-[0.24em] text-moss-300">
                  Version {GAME_VERSION} · {APP_VERSION}
                </p>
                <p className="display text-lg text-parchment">Le baï au lever du jour</p>
              </div>
            </div>
            <div className="panel-tight absolute -bottom-4 -left-4 hidden max-w-[13rem] px-3 py-2 text-[0.65rem] text-mist/70 sm:block">
              <p className="font-semibold text-parchment">👍 Conseil des pisteurs</p>
              Restez immobile 30 secondes : la faune revient toujours.
            </div>
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------------------- */}
      {/* Jeu                                                              */}
      {/* ---------------------------------------------------------------- */}
      <section className="mx-auto max-w-7xl px-5 py-8">
        <MinkebeGame />
      </section>

      {/* ---------------------------------------------------------------- */}
      {/* Bande-annonce + piliers                                          */}
      {/* ---------------------------------------------------------------- */}
      <section id="trailer" className="mx-auto max-w-7xl px-5 py-10">
        <div className="grid gap-6 lg:grid-cols-[1.15fr_1fr]">
          <GameTrailer />
          <div className="space-y-4">
            <div>
              <p className="eyebrow">Pourquoi Minkébé</p>
              <h2 className="display mt-1 text-3xl text-parchment">
                Trois mille éléphants, une forêt qui tient debout.
              </h2>
            </div>
            <p className="text-sm leading-relaxed text-mist/70">
              Située au nord-est du Gabon, la réserve de Minkébé couvre plus de 7 000 km² de
              forêt de terre ferme. C&apos;est l&apos;un des derniers refuges des éléphants de
              forêt et le cœur du « baï » — ces clairières marécageuses où les animaux viennent
              chercher les sels minéraux.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              {HIGHLIGHTS.map((item) => (
                <div key={item.title} className="panel-tight p-3">
                  <p className="text-lg">{item.emoji}</p>
                  <p className="mt-1 text-sm font-semibold text-parchment">{item.title}</p>
                  <p className="mt-0.5 text-[0.7rem] leading-relaxed text-mist/60">{item.text}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------------------- */}
      {/* Faune                                                            */}
      {/* ---------------------------------------------------------------- */}
      <section id="faune" className="mx-auto max-w-7xl px-5 py-12">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="eyebrow">Carnet de terrain</p>
            <h2 className="display mt-1 text-3xl text-parchment">Les espèces emblématiques</h2>
            <p className="mt-1 max-w-2xl text-sm text-mist/65">
              Chaque observation alimente votre carnet et votre score. Les animaux ne sont jamais
              blessés : la seule « arme » du jeu est un appareil photo.
            </p>
          </div>
          <span className="chip">12 espèces · 4 raretés</span>
        </div>

        <ul className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {rarest.map((species) => (
            <li key={species.id} className="panel group p-4">
              <div className="flex items-start gap-3">
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-canopy-800 text-xl">
                  {species.emoji}
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-parchment">{species.name}</p>
                  <p className="truncate text-[0.65rem] italic text-mist/50">{species.scientific}</p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    <span className="chip !py-0.5 !text-[0.58rem]">{species.rarity}</span>
                    <span className="chip !py-0.5 !text-[0.58rem]">{species.activity}</span>
                    <span className="chip !py-0.5 !text-[0.58rem]">+{species.points} pts</span>
                  </div>
                </div>
              </div>
              <p className="mt-2 line-clamp-3 text-[0.7rem] leading-relaxed text-mist/60">
                {species.note}
              </p>
            </li>
          ))}
        </ul>
      </section>

      {/* ---------------------------------------------------------------- */}
      {/* Zones                                                            */}
      {/* ---------------------------------------------------------------- */}
      <section className="mx-auto max-w-7xl px-5 py-12">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="eyebrow">Cartographie</p>
            <h2 className="display mt-1 text-3xl text-parchment">Huit zones, huit ambiances</h2>
          </div>
          <span className="chip">difficulté de 1 à 5</span>
        </div>

        <div className="mt-6 overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-left text-sm">
            <caption className="sr-only">Zones de la réserve et difficulté</caption>
            <thead>
              <tr className="text-[0.62rem] uppercase tracking-[0.18em] text-mist/40">
                <th className="border-b border-mist/10 py-2 pr-4 font-medium">Zone</th>
                <th className="border-b border-mist/10 py-2 pr-4 font-medium">Biome</th>
                <th className="border-b border-mist/10 py-2 pr-4 font-medium">Difficulté</th>
                <th className="border-b border-mist/10 py-2 font-medium">Description</th>
              </tr>
            </thead>
            <tbody>
              {ZONES.map((zone) => (
                <tr key={zone.id} className="group align-top">
                  <td className="border-b border-mist/5 py-3 pr-4 font-medium text-parchment">
                    {zone.name}
                  </td>
                  <td className="border-b border-mist/5 py-3 pr-4 text-[0.7rem] text-mist/55">
                    {zone.biome}
                  </td>
                  <td className="border-b border-mist/5 py-3 pr-4">
                    <span className="text-amber-glow" aria-label={`difficulté ${zone.difficulty} sur 5`}>
                      {"●".repeat(zone.difficulty)}
                      <span className="text-mist/20">{"●".repeat(5 - zone.difficulty)}</span>
                    </span>
                  </td>
                  <td className="border-b border-mist/5 py-3 text-[0.72rem] leading-relaxed text-mist/60">
                    {zone.description}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ---------------------------------------------------------------- */}
      {/* Vestiaire + musique                                              */}
      {/* ---------------------------------------------------------------- */}
      <section className="mx-auto grid max-w-7xl gap-5 px-5 py-12 lg:grid-cols-[1.4fr_1fr]">
        <Dressing level={4} />
        <div className="space-y-5">
          <MusicPlayer />
          <div className="panel space-y-2 p-5">
            <p className="eyebrow">Accessibilité</p>
            <h2 className="display text-xl">Jouable partout</h2>
            <ul className="space-y-1 text-[0.72rem] text-mist/65">
              <li>· Contrôles clavier, manette et tactile.</li>
              <li>· Mode « mouvement réduit » (moins d&apos;insectes, pas de secousses).</li>
              <li>· Interface contrastée, navigation clavier complète.</li>
              <li>· Aucun son obligatoire : sous-titres d&apos;ambiance en bas d&apos;écran.</li>
            </ul>
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------------------- */}
      {/* Téléchargements                                                  */}
      {/* ---------------------------------------------------------------- */}
      <section id="telecharger" className="mx-auto max-w-7xl px-5 py-12">
        <DownloadsPanel />
      </section>

      {/* ---------------------------------------------------------------- */}
      {/* Soutien / paiements                                              */}
      {/* ---------------------------------------------------------------- */}
      <section id="soutenir" className="mx-auto max-w-7xl px-5 py-12">
        <Pricing />
      </section>

      {/* ---------------------------------------------------------------- */}
      {/* Pied de page                                                     */}
      {/* ---------------------------------------------------------------- */}
      <footer className="mt-8 border-t border-mist/10 bg-canopy-950/60">
        <div className="mx-auto grid max-w-7xl gap-6 px-5 py-10 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <p className="display text-lg text-parchment">Minkébé</p>
            <p className="mt-1 text-[0.7rem] leading-relaxed text-mist/50">
              Un jeu de conservation développé par Zenith Info, inspiré de la réserve
              éponyme du Gabon.
            </p>
          </div>
          <div>
            <p className="eyebrow mb-2">Jouer</p>
            <ul className="space-y-1 text-[0.72rem] text-mist/60">
              <li><a href="#jeu" className="hover:text-parchment">Dans le navigateur</a></li>
              <li><a href="#telecharger" className="hover:text-parchment">Windows · macOS · Android</a></li>
              <li><a href="/api/download/source" className="hover:text-parchment">Héberger un serveur</a></li>
            </ul>
          </div>
          <div>
            <p className="eyebrow mb-2">Technique</p>
            <ul className="space-y-1 text-[0.72rem] text-mist/60">
              <li><a href="/api/health" className="hover:text-parchment">État du service</a></li>
              <li><a href="/api/about" className="hover:text-parchment">À propos / version</a></li>
              <li><a href="/admin" className="hover:text-parchment">Administration</a></li>
            </ul>
          </div>
          <div>
            <p className="eyebrow mb-2">Contact</p>
            <ul className="space-y-1 text-[0.72rem] text-mist/60">
              <li>support@zenith-info.example</li>
              <li>Libreville, Gabon</li>
              <li className="text-mist/35">Serveur : {GAME_URL}</li>
            </ul>
          </div>
        </div>
        <div className="border-t border-mist/10 px-5 py-4 text-center text-[0.65rem] text-mist/35">
          © 2026 Zenith Info · {APP_NAME} {APP_VERSION} · Licence propriétaire — données
          écologiques à visée pédagogique.
        </div>
      </footer>
    </main>
  );
}
