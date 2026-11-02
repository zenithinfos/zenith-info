/**
 * Salons multijoueurs.
 *
 * Stockage en mémoire du processus : suffisant pour un serveur unique
 * (npm start derrière un reverse-proxy). Pour un déploiement multi-instances,
 * brancher Redis ou une table PostgreSQL sur la même interface.
 */

export interface PlayerState {
  id: string;
  name: string;
  /** Position [x, y, z] dans le monde. */
  position: [number, number, number];
  /** Rotation horizontale en radians. */
  heading: number;
  /** Animation en cours : idle | walk | run | swim | climb. */
  motion: string;
  outfit: string;
  joinedAt: number;
  updatedAt: number;
}

export interface Room {
  code: string;
  name: string;
  level: string;
  maxPlayers: number;
  players: Map<string, PlayerState>;
  createdAt: number;
  updatedAt: number;
  /** Version incrémentée à chaque mutation, utilisée pour le delta sync. */
  revision: number;
}

export const MAX_ROOM_PLAYERS = 8;
export const ROOM_TTL_MS = 1000 * 60 * 60 * 3; // 3 h sans activité
export const PLAYER_TTL_MS = 1000 * 45; // joueur considéré absent après 45 s

const rooms = new Map<string, Room>();

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function newRoomCode(length = 5): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  let code = "";
  for (const byte of bytes) code += ALPHABET[byte % ALPHABET.length];
  return rooms.has(code) ? newRoomCode(length + (Math.random() > 0.9 ? 1 : 0)) : code;
}

export function sweep(): void {
  const now = Date.now();
  for (const [code, room] of rooms) {
    for (const [playerId, player] of room.players) {
      if (now - player.updatedAt > PLAYER_TTL_MS * 4) room.players.delete(playerId);
    }
    if (now - room.updatedAt > ROOM_TTL_MS || room.players.size === 0 && now - room.updatedAt > 60_000) {
      rooms.delete(code);
    }
  }
}

export function createRoom(input: {
  name?: string;
  level?: string;
  hostName?: string;
  hostId?: string;
  maxPlayers?: number;
}): Room {
  sweep();
  const room: Room = {
    code: newRoomCode(),
    name: (input.name || "Expédition sans nom").slice(0, 48),
    level: input.level || "foret",
    maxPlayers: Math.min(Math.max(input.maxPlayers ?? MAX_ROOM_PLAYERS, 2), MAX_ROOM_PLAYERS),
    players: new Map(),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    revision: 1,
  };
  if (input.hostId) {
    room.players.set(input.hostId, {
      id: input.hostId,
      name: (input.hostName || "Hôte").slice(0, 24),
      position: [0, 0, 0],
      heading: 0,
      motion: "idle",
      outfit: "explorateur",
      joinedAt: Date.now(),
      updatedAt: Date.now(),
    });
  }
  rooms.set(room.code, room);
  return room;
}

export function getRoom(code: string): Room | undefined {
  return rooms.get(normalizeCode(code));
}

export function normalizeCode(code: string): string {
  return code.trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
}

export function roomSummary(room: Room) {
  return {
    code: room.code,
    name: room.name,
    level: room.level,
    players: room.players.size,
    maxPlayers: room.maxPlayers,
    createdAt: room.createdAt,
    updatedAt: room.updatedAt,
    revision: room.revision,
  };
}

export type JoinResult =
  | { ok: true; room: Room; player: PlayerState }
  | { ok: false; error: "introuvable" | "complet"; status: number };

export function joinRoom(
  code: string,
  input: {
    playerId: string;
    name: string;
    outfit?: string;
    position?: [number, number, number];
  },
): JoinResult {
  const room = getRoom(code);
  if (!room) return { ok: false, error: "introuvable", status: 404 };

  const existing = room.players.get(input.playerId);
  if (!existing && room.players.size >= room.maxPlayers) {
    return { ok: false, error: "complet", status: 409 };
  }

  const now = Date.now();
  const player: PlayerState = {
    id: input.playerId,
    name: input.name.slice(0, 24),
    position: input.position ?? existing?.position ?? [0, 0, 0],
    heading: existing?.heading ?? 0,
    motion: "idle",
    outfit: input.outfit ?? existing?.outfit ?? "explorateur",
    joinedAt: existing?.joinedAt ?? now,
    updatedAt: now,
  };
  room.players.set(input.playerId, player);
  room.updatedAt = now;
  room.revision += 1;
  return { ok: true, room, player };
}

export function leaveRoom(code: string, playerId: string): boolean {
  const room = getRoom(code);
  if (!room) return false;
  const removed = room.players.delete(playerId);
  if (removed) {
    room.updatedAt = Date.now();
    room.revision += 1;
  }
  return removed;
}

export interface PlayerPatch {
  id: string;
  position: [number, number, number];
  heading: number;
  motion?: string;
}

export function syncRoom(
  code: string,
  updates: PlayerPatch[],
  since = 0,
): { players: PlayerState[]; revision: number; changed: boolean } | null {
  const room = getRoom(code);
  if (!room) return null;
  const now = Date.now();

  for (const update of updates) {
    const player = room.players.get(update.id);
    if (!player) continue;
    player.position = update.position;
    player.heading = update.heading;
    if (update.motion) player.motion = update.motion;
    player.updatedAt = now;
  }

  const changed = updates.length > 0 || room.revision > since;
  if (changed) {
    room.updatedAt = now;
    room.revision += 1;
  }

  return {
    players: [...room.players.values()],
    revision: room.revision,
    changed,
  };
}

export function listRooms(): Room[] {
  sweep();
  return [...rooms.values()].sort((a, b) => b.updatedAt - a.updatedAt);
}

export function roomCount(): number {
  return rooms.size;
}

export function playerCount(): number {
  return [...rooms.values()].reduce((sum, r) => sum + r.players.size, 0);
}

/** Utile aux tests : vide tous les salons. */
export function resetRooms(): void {
  rooms.clear();
}
