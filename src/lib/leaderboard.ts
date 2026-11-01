/**
 * Classement des expéditions.
 *
 * Une expédition se termine par la mort : c'est le score de cette vie qui part
 * au classement. Stockage en mémoire du processus, comme les salons — pour un
 * déploiement multi-instances, brancher Redis ou une table PostgreSQL sur la
 * même interface.
 */

export interface LeaderboardEntry {
  id: string;
  /** Pseudo affiché ; on ne demande jamais de compte. */
  name: string;
  deviceId: string;
  score: number;
  cause: "soif" | "faim" | "blessure";
  /** Mewas trouvés avant la fin. */
  mewas: number;
  level: number;
  /** Durée de l'expédition, en secondes. */
  seconds: number;
  at: number;
}

export const MAX_ENTRIES = 200;

const entries: LeaderboardEntry[] = [];

const CAUSES = ["soif", "faim", "blessure"] as const;

export interface SubmitInput {
  deviceId: string;
  name?: string;
  score: number;
  cause: string;
  mewas?: number;
  level?: number;
  seconds?: number;
}

const clean = (value: string, max: number) => value.replace(/[<>]/g, "").trim().slice(0, max);

/** Enregistre une fin d'expédition ; seul le meilleur score d'un appareil reste. */
export function submitEntry(input: SubmitInput): LeaderboardEntry {
  const cause = (CAUSES as readonly string[]).includes(input.cause)
    ? (input.cause as LeaderboardEntry["cause"])
    : "blessure";

  const entry: LeaderboardEntry = {
    id: crypto.randomUUID(),
    name: clean(input.name || "Explorateur", 18) || "Explorateur",
    deviceId: input.deviceId,
    score: Math.max(0, Math.min(999_999, Math.round(input.score))),
    cause,
    mewas: Math.max(0, Math.min(10, Math.round(input.mewas ?? 0))),
    level: Math.max(1, Math.min(5, Math.round(input.level ?? 1))),
    seconds: Math.max(0, Math.min(60 * 60 * 12, Math.round(input.seconds ?? 0))),
    at: Date.now(),
  };

  const existing = entries.findIndex((row) => row.deviceId === entry.deviceId);
  if (existing >= 0) {
    if (entries[existing].score >= entry.score) return entries[existing];
    entries.splice(existing, 1);
  }
  entries.push(entry);
  entries.sort((a, b) => b.score - a.score);
  if (entries.length > MAX_ENTRIES) entries.length = MAX_ENTRIES;
  return entry;
}

/** Les meilleures expéditions, sans identifiant d'appareil (vie privée). */
export function topEntries(limit = 20): Omit<LeaderboardEntry, "deviceId">[] {
  return entries
    .slice(0, Math.max(1, Math.min(100, limit)))
    .map((row) => {
      const { deviceId, ...rest } = row;
      void deviceId;
      return rest;
    });
}

/** Rang d'une entrée (1 = première). */
export function rankOf(id: string): number {
  const index = entries.findIndex((row) => row.id === id);
  return index < 0 ? 0 : index + 1;
}
