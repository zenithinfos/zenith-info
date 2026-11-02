import { NextResponse } from "next/server";
import { databaseStatus } from "@/db";
import { countSaves } from "@/lib/saves";
import { paymentStats } from "@/lib/payments";
import { listRooms, playerCount, roomCount } from "@/lib/rooms";
import { APP_VERSION, BUILD_ID, GAME_VERSION, uptimeSeconds } from "@/lib/version";
import { PACKAGES } from "@/lib/distribution";

export const dynamic = "force-dynamic";

/**
 * Tableau de bord administrateur. Protégé par le jeton ADMIN_TOKEN
 * (en-tête `x-admin-token`). Sans ADMIN_TOKEN configuré, l'accès est refusé
 * hors développement.
 */
function unauthorized() {
  return NextResponse.json({ error: "Jeton administrateur requis" }, { status: 401 });
}

export async function GET(request: Request) {
  const expected = process.env.ADMIN_TOKEN?.trim();
  if (!expected) {
    if (process.env.NODE_ENV === "production") {
      return NextResponse.json({ error: "ADMIN_TOKEN non configuré" }, { status: 503 });
    }
  } else {
    const provided =
      request.headers.get("x-admin-token") ??
      new URL(request.url).searchParams.get("token");
    if (provided !== expected) return unauthorized();
  }

  const [stats, saves, rooms] = await Promise.all([
    paymentStats(),
    countSaves(),
    Promise.resolve(listRooms()),
  ]);

  return NextResponse.json(
    {
      version: { app: APP_VERSION, game: GAME_VERSION, build: BUILD_ID },
      uptimeSeconds: uptimeSeconds(),
      database: databaseStatus(),
      saves,
      payments: stats,
      multiplayer: {
        rooms: roomCount(),
        players: playerCount(),
        list: rooms.slice(0, 20).map((room) => ({
          code: room.code,
          name: room.name,
          players: room.players.size,
          maxPlayers: room.maxPlayers,
          updatedAt: room.updatedAt,
        })),
      },
      packages: PACKAGES.map((p) => ({
        id: p.id,
        version: p.version,
        sizeBytes: p.sizeBytes,
        sha256: p.sha256,
      })),
      env: {
        paymentMode: process.env.PAYMENT_MODE ?? "simulation",
        node: process.version,
      },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
