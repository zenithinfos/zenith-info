import { NextResponse } from "next/server";
import { z } from "zod";
import { joinRoom, roomSummary } from "@/lib/rooms";

export const dynamic = "force-dynamic";

const BodySchema = z.object({
  playerId: z.string().min(1).max(64),
  name: z.string().min(1).max(24),
  outfit: z.string().max(32).optional(),
  position: z.tuple([z.number(), z.number(), z.number()]).optional(),
});

/** Rejoint un salon existant. */
export async function POST(
  request: Request,
  context: { params: Promise<{ code: string }> },
) {
  const { code } = await context.params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Corps JSON invalide" }, { status: 400 });
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Données invalides", details: parsed.error.issues },
      { status: 400 },
    );
  }

  const result = joinRoom(code, parsed.data);
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error === "complet" ? "Salon complet" : "Salon introuvable" },
      { status: result.status },
    );
  }

  return NextResponse.json(
    {
      room: roomSummary(result.room),
      player: result.player,
      players: [...result.room.players.values()],
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
