import { NextResponse } from "next/server";
import { z } from "zod";
import { createRoom, listRooms, roomSummary } from "@/lib/rooms";
import { getZone } from "@/game/levels";

export const dynamic = "force-dynamic";

/** Liste des salons ouverts. */
export async function GET() {
  return NextResponse.json(
    { rooms: listRooms().map(roomSummary) },
    { headers: { "Cache-Control": "no-store" } },
  );
}

const CreateSchema = z.object({
  name: z.string().min(1).max(48).optional(),
  level: z.string().optional(),
  playerId: z.string().min(1).max(64).optional(),
  playerName: z.string().min(1).max(24).optional(),
  maxPlayers: z.number().int().min(2).max(8).optional(),
});

/** Création d'un salon ; le créateur y est automatiquement inscrit. */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Corps JSON invalide" }, { status: 400 });
  }

  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Données invalides", details: parsed.error.issues },
      { status: 400 },
    );
  }

  const { name, level, playerId, playerName, maxPlayers } = parsed.data;
  if (level && !getZone(level)) {
    return NextResponse.json({ error: "Zone inconnue", zone: level }, { status: 404 });
  }

  const room = createRoom({ name, level, hostId: playerId, hostName: playerName, maxPlayers });

  return NextResponse.json(
    {
      room: roomSummary(room),
      players: [...room.players.values()],
    },
    { status: 201, headers: { "Cache-Control": "no-store" } },
  );
}
