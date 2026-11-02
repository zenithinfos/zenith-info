import { NextResponse } from "next/server";
import { z } from "zod";
import { MAX_SAVE_BYTES, MAX_SLOTS, listSaves, putSave } from "@/lib/saves";
import { GAME_VERSION } from "@/lib/version";

export const dynamic = "force-dynamic";

const QuerySchema = z.object({
  deviceId: z.string().min(4).max(64),
});

/** Liste les sauvegardes d'un appareil. */
export async function GET(request: Request) {
  const parsed = QuerySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams.entries()),
  );
  if (!parsed.success) {
    return NextResponse.json({ error: "deviceId requis" }, { status: 400 });
  }

  const saves = await listSaves(parsed.data.deviceId);
  return NextResponse.json(
    {
      saves: saves.map((save) => ({
        id: save.id,
        slot: save.slot,
        label: save.label,
        gameVersion: save.gameVersion,
        playtimeSeconds: save.playtimeSeconds,
        updatedAt: save.updatedAt,
        state: save.state,
      })),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

const SaveSchema = z.object({
  deviceId: z.string().min(4).max(64),
  playerId: z.string().min(1).max(64).default("local"),
  slot: z.number().int().min(0).max(MAX_SLOTS - 1).default(0),
  label: z.string().max(64).default("Expédition"),
  gameVersion: z.string().max(24).default(GAME_VERSION),
  playtimeSeconds: z.number().int().min(0).max(10_000_000).default(0),
  state: z.record(z.string(), z.unknown()),
});

/** Crée ou remplace la sauvegarde d'un emplacement. */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Corps JSON invalide" }, { status: 400 });
  }

  const parsed = SaveSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Sauvegarde invalide", details: parsed.error.issues },
      { status: 400 },
    );
  }

  const size = Buffer.byteLength(JSON.stringify(parsed.data.state), "utf8");
  if (size > MAX_SAVE_BYTES) {
    return NextResponse.json(
      { error: `État trop volumineux (${size} octets, maximum ${MAX_SAVE_BYTES})` },
      { status: 413 },
    );
  }

  const save = await putSave(parsed.data);
  return NextResponse.json(
    {
      id: save.id,
      slot: save.slot,
      updatedAt: save.updatedAt,
      sizeBytes: size,
    },
    { status: 201, headers: { "Cache-Control": "no-store" } },
  );
}
