import { NextResponse } from "next/server";
import { databaseStatus, pingDatabase } from "@/db";
import { APP_VERSION, BUILD_ID, CHANNEL, GAME_VERSION, uptimeSeconds } from "@/lib/version";
import { roomCount, playerCount } from "@/lib/rooms";

export const dynamic = "force-dynamic";

/**
 * Sonde de disponibilité : utilisée par le reverse-proxy, les tests de
 * déploiement et la page /admin.
 */
export async function GET() {
  const dbReachable = await pingDatabase();
  const db = databaseStatus();
  const healthy = db.mode === "memoire" || dbReachable;

  return NextResponse.json(
    {
      status: healthy ? "ok" : "degraded",
      app: "minkebe",
      version: APP_VERSION,
      gameVersion: GAME_VERSION,
      build: BUILD_ID,
      channel: CHANNEL,
      uptimeSeconds: uptimeSeconds(),
      timestamp: new Date().toISOString(),
      database: {
        mode: db.mode,
        configured: db.configured,
        reachable: dbReachable || db.mode === "memoire" ? (db.mode === "memoire" ? null : true) : false,
      },
      multiplayer: { rooms: roomCount(), players: playerCount() },
    },
    {
      status: healthy ? 200 : 503,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
