import { NextResponse } from "next/server";
import { deleteSave, getSave } from "@/lib/saves";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Récupère une sauvegarde précise. */
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  if (!UUID.test(id)) {
    return NextResponse.json({ error: "Identifiant invalide" }, { status: 400 });
  }

  const save = await getSave(id);
  if (!save) return NextResponse.json({ error: "Sauvegarde introuvable" }, { status: 404 });

  return NextResponse.json(
    {
      id: save.id,
      slot: save.slot,
      label: save.label,
      gameVersion: save.gameVersion,
      playtimeSeconds: save.playtimeSeconds,
      createdAt: save.createdAt,
      updatedAt: save.updatedAt,
      state: save.state,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

/** Supprime une sauvegarde. */
export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  if (!UUID.test(id)) {
    return NextResponse.json({ error: "Identifiant invalide" }, { status: 400 });
  }

  const deleted = await deleteSave(id);
  if (!deleted) return NextResponse.json({ error: "Sauvegarde introuvable" }, { status: 404 });

  return NextResponse.json({ deleted: true, id });
}
