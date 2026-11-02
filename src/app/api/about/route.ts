import { NextResponse } from "next/server";
import { PACKAGES, deviceMatrix } from "@/lib/distribution";
import { APP_NAME, APP_VERSION, BUILD_ID, CHANNEL, GAME_URL, GAME_VERSION, SUPPORT_EMAIL } from "@/lib/version";
import { CHARACTERS } from "@/game/characters";
import { ZONES } from "@/game/levels";
import { SPECIES } from "@/game/fauna";
import { PLANS } from "@/lib/payments";

export const dynamic = "force-dynamic";

/** Métadonnées publiques du build : consommées par /, /admin et les clients. */
export async function GET() {
  return NextResponse.json(
    {
      app: APP_NAME,
      version: APP_VERSION,
      gameVersion: GAME_VERSION,
      build: BUILD_ID,
      channel: CHANNEL,
      gameUrl: GAME_URL,
      support: SUPPORT_EMAIL,
      stack: {
        framework: "Next.js 16",
        ui: "React 19 + Tailwind CSS 4",
        render: "Three.js (WebGL 2)",
        database: "PostgreSQL 14+ (Drizzle ORM)",
        runtime: process.version,
      },
      content: {
        zones: ZONES.length,
        species: SPECIES.length,
        characters: CHARACTERS.map((c) => ({ id: c.id, name: c.name, role: c.role })),
      },
      packages: PACKAGES.map((p) => ({
        id: p.id,
        label: p.label,
        format: p.format,
        version: p.version,
        kind: p.kind,
      })),
      plans: PLANS.map((p) => ({ id: p.id, label: p.label, amountCents: p.amountCents, currency: p.currency })),
      devices: deviceMatrix(),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
