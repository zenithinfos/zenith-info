import { NextResponse } from "next/server";
import { z } from "zod";
import { getRoom, leaveRoom, roomSummary } from "@/lib/rooms";

export const dynamic = "force-dynamic";

const BodySchema = z.object({
  playerId: z.string().min(1).max(64),
});

/** Quitte un salon. */
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
    return NextResponse.json({ error: "playerId requis" }, { status: 400 });
  }

  const room = getRoom(code);
  if (!room) {
    return NextResponse.json({ error: "Salon introuvable" }, { status: 404 });
  }

  const removed = leaveRoom(code, parsed.data.playerId);
  const updated = getRoom(code);

  return NextResponse.json(
    {
      left: removed,
      room: updated ? roomSummary(updated) : null,
      closed: !updated || updated.players.size === 0,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
