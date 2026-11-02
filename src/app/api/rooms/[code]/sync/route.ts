import { NextResponse } from "next/server";
import { z } from "zod";
import { syncRoom } from "@/lib/rooms";

export const dynamic = "force-dynamic";

const BodySchema = z.object({
  playerId: z.string().min(1).max(64),
  since: z.number().int().min(0).default(0),
  updates: z
    .array(
      z.object({
        id: z.string().min(1).max(64),
        position: z.tuple([z.number(), z.number(), z.number()]),
        heading: z.number(),
        motion: z.string().max(16).optional(),
      }),
    )
    .max(16)
    .default([]),
});

/**
 * Synchronisation : le client envoie sa position et reçoit celle des autres.
 * `since` permet de savoir si un changement a eu lieu depuis la dernière
 * réponse (le client peut alors éviter de repeindre).
 */
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

  const { playerId, updates, since } = parsed.data;
  if (updates.some((update) => update.id !== playerId)) {
    return NextResponse.json(
      { error: "Vous ne pouvez mettre à jour que votre propre position" },
      { status: 403 },
    );
  }

  const result = syncRoom(code, updates, since);
  if (!result) {
    return NextResponse.json({ error: "Salon introuvable ou expiré" }, { status: 404 });
  }

  return NextResponse.json(
    {
      players: result.players,
      revision: result.revision,
      changed: result.changed,
      serverTime: Date.now(),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
