import { NextResponse } from "next/server";
import { z } from "zod";
import { rankOf, submitEntry, topEntries } from "@/lib/leaderboard";

export const dynamic = "force-dynamic";

/**
 * Classement des expéditions.
 *
 * GET  /api/leaderboard           → les vingt meilleures vies
 * POST /api/leaderboard           → enregistre la fin d'une expédition
 */

const SubmitSchema = z.object({
  deviceId: z.string().min(4).max(80),
  name: z.string().max(18).optional(),
  score: z.number().finite().min(0).max(999_999),
  cause: z.enum(["soif", "faim", "blessure"]),
  mewas: z.number().int().min(0).max(10).optional(),
  level: z.number().int().min(1).max(5).optional(),
  seconds: z.number().min(0).max(60 * 60 * 12).optional(),
});

export async function GET(request: Request) {
  const limit = Number(new URL(request.url).searchParams.get("limit") ?? 20);
  return NextResponse.json(
    { entries: topEntries(Number.isFinite(limit) ? limit : 20) },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: Request) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON invalide" }, { status: 400 });
  }

  const parsed = SubmitSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ error: "Expédition invalide", details: parsed.error.issues }, { status: 400 });
  }

  const entry = submitEntry(parsed.data);
  return NextResponse.json(
    { entry, rank: rankOf(entry.id), entries: topEntries(10) },
    { headers: { "Cache-Control": "no-store" } },
  );
}
