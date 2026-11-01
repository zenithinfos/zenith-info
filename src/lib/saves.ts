import { and, eq } from "drizzle-orm";
import { db, hasDatabase } from "@/db";
import { memorySaves } from "@/db/memory";
import { saves } from "@/db/schema";

/** Représentation d'une sauvegarde, commune PostgreSQL / mémoire. */
export interface SaveRow {
  id: string;
  playerId: string;
  deviceId: string;
  slot: number;
  label: string;
  gameVersion: string;
  playtimeSeconds: number;
  state: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface SaveInput {
  id?: string;
  playerId: string;
  deviceId: string;
  slot: number;
  label: string;
  gameVersion: string;
  playtimeSeconds: number;
  state: Record<string, unknown>;
}

export const MAX_SAVE_BYTES = 256 * 1024;
export const MAX_SLOTS = 3;

function fromDb(row: typeof saves.$inferSelect): SaveRow {
  return {
    ...row,
    state: (row.state ?? {}) as Record<string, unknown>,
  };
}

export async function listSaves(deviceId: string): Promise<SaveRow[]> {
  if (!db || !hasDatabase()) return memorySaves.list(deviceId);
  const rows = await db
    .select()
    .from(saves)
    .where(eq(saves.deviceId, deviceId))
    .orderBy(saves.slot);
  return rows.map(fromDb);
}

export async function getSave(id: string): Promise<SaveRow | null> {
  if (!db || !hasDatabase()) return memorySaves.get(id) ?? null;
  const rows = await db.select().from(saves).where(eq(saves.id, id)).limit(1);
  return rows[0] ? fromDb(rows[0]) : null;
}

export async function putSave(input: SaveInput): Promise<SaveRow> {
  const now = new Date();

  if (!db || !hasDatabase()) {
    const existing =
      (input.id ? memorySaves.get(input.id) : undefined) ??
      memorySaves.findBySlot(input.deviceId, input.slot);
    const row: SaveRow = {
      id: existing?.id ?? input.id ?? crypto.randomUUID(),
      playerId: input.playerId,
      deviceId: input.deviceId,
      slot: input.slot,
      label: input.label,
      gameVersion: input.gameVersion,
      playtimeSeconds: input.playtimeSeconds,
      state: input.state,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    return memorySaves.upsert(row);
  }

  const existing = await db
    .select()
    .from(saves)
    .where(and(eq(saves.deviceId, input.deviceId), eq(saves.slot, input.slot)))
    .limit(1);

  if (existing[0]) {
    const [updated] = await db
      .update(saves)
      .set({
        playerId: input.playerId,
        label: input.label,
        gameVersion: input.gameVersion,
        playtimeSeconds: input.playtimeSeconds,
        state: input.state,
        updatedAt: now,
      })
      .where(eq(saves.id, existing[0].id))
      .returning();
    return fromDb(updated);
  }

  const [created] = await db
    .insert(saves)
    .values({
      playerId: input.playerId,
      deviceId: input.deviceId,
      slot: input.slot,
      label: input.label,
      gameVersion: input.gameVersion,
      playtimeSeconds: input.playtimeSeconds,
      state: input.state,
    })
    .returning();
  return fromDb(created);
}

export async function deleteSave(id: string): Promise<boolean> {
  if (!db || !hasDatabase()) return memorySaves.delete(id);
  const deleted = await db.delete(saves).where(eq(saves.id, id)).returning();
  return deleted.length > 0;
}

export async function countSaves(): Promise<number> {
  if (!db || !hasDatabase()) return memorySaves.size();
  const rows = await db.select({ id: saves.id }).from(saves);
  return rows.length;
}
