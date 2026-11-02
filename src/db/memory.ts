/**
 * Stockage mémoire utilisé quand DATABASE_URL n'est pas configuré.
 * Volontairement minimal : il ne sert qu'au développement et aux démos.
 * Les données disparaissent au redémarrage du serveur.
 */

import type { SaveRow } from "@/lib/saves";

const saves = new Map<string, SaveRow>();

export const memorySaves = {
  list(deviceId: string): SaveRow[] {
    return [...saves.values()]
      .filter((s) => s.deviceId === deviceId)
      .sort((a, b) => a.slot - b.slot);
  },
  get(id: string): SaveRow | undefined {
    return saves.get(id);
  },
  findBySlot(deviceId: string, slot: number): SaveRow | undefined {
    return [...saves.values()].find(
      (s) => s.deviceId === deviceId && s.slot === slot,
    );
  },
  upsert(row: SaveRow): SaveRow {
    saves.set(row.id, row);
    return row;
  },
  delete(id: string): boolean {
    return saves.delete(id);
  },
  clear(): void {
    saves.clear();
  },
  size(): number {
    return saves.size;
  },
};
