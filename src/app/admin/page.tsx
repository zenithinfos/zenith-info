import { countSaves } from "@/lib/saves";
import { paymentStats } from "@/lib/payments";
import { listRooms, playerCount, roomCount } from "@/lib/rooms";
import { databaseStatus } from "@/db";
import { APP_VERSION, BUILD_ID, GAME_VERSION, uptimeSeconds } from "@/lib/version";
import { PACKAGES } from "@/lib/distribution";
import { inspectAll } from "@/lib/downloads";

export const dynamic = "force-dynamic";

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d} j ${h} h`;
  if (h > 0) return `${h} h ${m} min`;
  return `${m} min`;
}

function formatEuro(cents: number): string {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(cents / 100);
}

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  const expected = process.env.ADMIN_TOKEN?.trim();

  const authorised = expected ? token === expected : process.env.NODE_ENV !== "production";

  if (!authorised) {
    return (
      <main className="mx-auto grid min-h-dvh max-w-md place-items-center px-5">
        <form className="panel w-full space-y-4 p-6" method="get">
          <div>
            <p className="eyebrow">Administration</p>
            <h1 className="display text-2xl">Accès restreint</h1>
            <p className="mt-1 text-xs text-mist/60">
              Renseignez le jeton <code className="rounded bg-canopy-900 px-1">ADMIN_TOKEN</code> défini
              sur le serveur.
            </p>
          </div>
          <input
            type="password"
            name="token"
            placeholder="Jeton administrateur"
            className="w-full rounded-lg border border-mist/20 bg-canopy-950/60 px-3 py-2 text-sm text-parchment placeholder:text-mist/30 focus:border-moss-300 focus:outline-none"
            aria-label="Jeton administrateur"
            required
          />
          <button type="submit" className="btn btn-primary w-full">
            Se connecter
          </button>
          <p className="text-[0.65rem] text-mist/40">
            {expected
              ? "Le jeton est comparé à la variable d'environnement ADMIN_TOKEN."
              : "ADMIN_TOKEN n'est pas défini : accès libre en développement uniquement."}
          </p>
        </form>
      </main>
    );
  }

  const [saves, payments, rooms, artifacts] = await Promise.all([
    countSaves(),
    paymentStats(),
    Promise.resolve(listRooms()),
    inspectAll(PACKAGES),
  ]);
  const db = databaseStatus();

  return (
    <main className="mx-auto max-w-6xl space-y-6 px-5 py-10">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow">Console d&apos;administration</p>
          <h1 className="display text-3xl">Minkébé · tableau de bord</h1>
          <p className="mt-1 text-xs text-mist/55">
            v{APP_VERSION} · jeu {GAME_VERSION} · build {BUILD_ID} · en ligne depuis{" "}
            {formatUptime(uptimeSeconds())}
          </p>
        </div>
        <a href="/" className="btn btn-ghost !px-4 !py-2 !text-xs">
          ← Retour au site
        </a>
      </header>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: "Sauvegardes", value: saves.toString(), hint: db.mode === "postgres" ? "PostgreSQL" : "mémoire" },
          { label: "Paiements", value: payments.total.toString(), hint: `${payments.paid} payés · ${payments.pending} en attente` },
          { label: "Recettes (EUR)", value: formatEuro(payments.revenueCents), hint: "paiements confirmés" },
          { label: "Salons", value: roomCount().toString(), hint: `${playerCount()} joueurs` },
        ].map((card) => (
          <div key={card.label} className="panel p-4">
            <p className="eyebrow">{card.label}</p>
            <p className="display mt-1 text-2xl text-parchment">{card.value}</p>
            <p className="text-[0.65rem] text-mist/45">{card.hint}</p>
          </div>
        ))}
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="panel p-5">
          <h2 className="display mb-3 text-lg">Base de données</h2>
          <dl className="space-y-1 text-xs text-mist/70">
            <div className="flex justify-between">
              <dt>Mode</dt>
              <dd className={db.mode === "postgres" ? "text-moss-300" : "text-amber-glow"}>{db.mode}</dd>
            </div>
            <div className="flex justify-between">
              <dt>DATABASE_URL</dt>
              <dd>{db.configured ? "défini" : "absent"}</dd>
            </div>
            <div className="flex justify-between">
              <dt>Connexion</dt>
              <dd>{db.reachable === null ? "non testée" : db.reachable ? "ok" : "échec"}</dd>
            </div>
          </dl>
          {db.error && <p className="mt-2 text-[0.65rem] text-laterite-400">{db.error}</p>}
        </div>

        <div className="panel p-5">
          <h2 className="display mb-3 text-lg">Paiements par prestataire</h2>
          {Object.keys(payments.byProvider).length === 0 ? (
            <p className="text-xs text-mist/50">Aucun paiement enregistré.</p>
          ) : (
            <ul className="space-y-1 text-xs text-mist/70">
              {Object.entries(payments.byProvider).map(([provider, count]) => (
                <li key={provider} className="flex justify-between">
                  <span className="capitalize">{provider}</span>
                  <span className="tabular-nums">{count}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section className="panel p-5">
        <h2 className="display mb-3 text-lg">Salons ouverts</h2>
        {rooms.length === 0 ? (
          <p className="text-xs text-mist/50">Aucun salon actif.</p>
        ) : (
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="text-[0.6rem] uppercase tracking-wider text-mist/40">
                <th className="py-1">Code</th>
                <th className="py-1">Nom</th>
                <th className="py-1">Joueurs</th>
                <th className="py-1">Dernière activité</th>
              </tr>
            </thead>
            <tbody>
              {rooms.map((room) => (
                <tr key={room.code} className="border-t border-mist/5">
                  <td className="py-1.5 font-mono text-parchment">{room.code}</td>
                  <td className="py-1.5 text-mist/70">{room.name}</td>
                  <td className="py-1.5 tabular-nums text-mist/70">
                    {room.players.size}/{room.maxPlayers}
                  </td>
                  <td className="py-1.5 text-mist/50">
                    {new Date(room.updatedAt).toLocaleTimeString("fr-FR")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="panel p-5">
        <h2 className="display mb-3 text-lg">Paquets de distribution</h2>
        <ul className="space-y-2 text-xs">
          {PACKAGES.map((pkg) => {
            const artifact = artifacts.find((a) => a.id === pkg.id);
            return (
              <li key={pkg.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-mist/5 py-2">
                <div>
                  <p className="font-semibold text-parchment">
                    {pkg.icon} {pkg.label}
                  </p>
                  <p className="text-[0.62rem] text-mist/45">
                    {pkg.filename} · {pkg.format} · v{pkg.version}
                  </p>
                </div>
                <div className="text-right text-[0.65rem] text-mist/55">
                  <p>
                    {artifact?.exists
                      ? `${((artifact.sizeBytes ?? 0) / 1024 / 1024).toFixed(1)} Mo`
                      : "archive non générée"}
                  </p>
                  <p className="font-mono text-[0.58rem] text-mist/35">
                    {artifact?.sha256 ? artifact.sha256.slice(0, 16) : "—"}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
        <p className="mt-3 text-[0.65rem] text-mist/40">
          Lancez <code className="rounded bg-canopy-900 px-1">npm run package</code> pour produire
          les archives dans public/downloads/.
        </p>
      </section>
    </main>
  );
}
