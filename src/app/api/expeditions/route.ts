import { NextResponse } from "next/server";
import { z } from "zod";
import { ZONES, getZone, levelSummary } from "@/game/levels";
import { SPECIES } from "@/game/fauna";
import { CHARACTERS } from "@/game/characters";
import { OUTFITS } from "@/game/outfits";
import { GADGETS } from "@/game/gadgets";

export const dynamic = "force-dynamic";

/**
 * Référentiel de contenu du jeu : zones, espèces, personnages, tenues et
 * gadgets. Le client s'en sert pour rester synchronisé avec le serveur.
 */

const QuerySchema = z.object({
  zone: z.string().optional(),
  difficulty: z.coerce.number().min(1).max(5).optional(),
  include: z
    .string()
    .optional()
    .transform((value) => (value ? value.split(",").map((v) => v.trim()) : undefined)),
});

export async function GET(request: Request) {
  const parsed = QuerySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams.entries()),
  );
  if (!parsed.success) {
    return NextResponse.json({ error: "Paramètres invalides", details: parsed.error.issues }, { status: 400 });
  }

  const { zone, difficulty, include } = parsed.data;
  const wanted = include ?? ["zones", "species", "characters", "outfits", "gadgets"];
  const payload: Record<string, unknown> = {};

  if (wanted.includes("zones")) {
    payload.zones = ZONES.filter(
      (item) => (!zone || item.id === zone) && (!difficulty || item.difficulty <= difficulty),
    );
    payload.levels = levelSummary();
  }
  if (wanted.includes("species")) {
    payload.species = SPECIES.filter((item) => !zone || item.habitats.includes(zone));
  }
  if (wanted.includes("characters")) payload.characters = CHARACTERS;
  if (wanted.includes("outfits")) payload.outfits = OUTFITS;
  if (wanted.includes("gadgets")) payload.gadgets = GADGETS;

  return NextResponse.json(
    { count: Object.keys(payload).length, ...payload },
    { headers: { "Cache-Control": "public, max-age=300" } },
  );
}

/** Crée une expédition (identifiant + point de départ) sans persistance. */
const CreateSchema = z.object({
  zoneId: z.string().default("camp"),
  characterId: z.string().default("mbadinga"),
});

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Corps JSON invalide" }, { status: 400 });
  }

  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Données invalides", details: parsed.error.issues }, { status: 400 });
  }

  const zone = getZone(parsed.data.zoneId);
  if (!zone) {
    return NextResponse.json(
      { error: "Zone inconnue", available: ZONES.map((z) => z.id) },
      { status: 404 },
    );
  }

  return NextResponse.json(
    {
      expeditionId: crypto.randomUUID(),
      zone,
      characterId: parsed.data.characterId,
      start: {
        position: [zone.center[0], 0.1, zone.center[1]] as const,
        heading: 0,
      },
      objective: "Documenter la faune sans la déranger",
      createdAt: new Date().toISOString(),
    },
    { status: 201 },
  );
}
