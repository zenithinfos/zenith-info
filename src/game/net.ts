/**
 * Client réseau du multijoueur.
 *
 * Le serveur expose /api/rooms (création / liste) et
 * /api/rooms/[code]/{join,leave,sync}. On utilise du polling adaptatif plutôt
 * que des WebSockets pour rester compatible avec un déploiement Next.js
 * classique derrière un reverse-proxy.
 */

export interface RemotePlayer {
  id: string;
  name: string;
  position: [number, number, number];
  heading: number;
  motion: string;
  outfit: string;
  joinedAt: number;
  updatedAt: number;
}

export interface RoomInfo {
  code: string;
  name: string;
  level: string;
  players: number;
  maxPlayers: number;
  revision: number;
  createdAt: number;
  updatedAt: number;
}

export interface NetOptions {
  /** Intervalle minimal de synchronisation (ms). */
  intervalMs?: number;
  /** Appelé à chaque état reçu. */
  onPlayers?: (players: RemotePlayer[]) => void;
  onError?: (error: Error) => void;
  onClose?: () => void;
}

export type NetStatus = "idle" | "connecting" | "connected" | "error";

function deviceId(): string {
  if (typeof window === "undefined") return "serveur";
  const key = "minkebe.device";
  let id = window.localStorage.getItem(key);
  if (!id) {
    id = crypto.randomUUID();
    window.localStorage.setItem(key, id);
  }
  return id;
}

export class MinkebeNet {
  status: NetStatus = "idle";
  roomCode: string | null = null;
  playerId: string;
  name: string;
  outfit: string;

  private timer: ReturnType<typeof setInterval> | null = null;
  private revision = 0;
  private lastSent = 0;
  private pending: { position: [number, number, number]; heading: number; motion: string } | null =
    null;
  private failures = 0;

  constructor(private options: NetOptions = {}) {
    this.playerId = deviceId();
    this.name = "Explorateur";
    this.outfit = "explorateur";
  }

  get intervalMs(): number {
    return this.options.intervalMs ?? 120;
  }

  async listRooms(): Promise<RoomInfo[]> {
    const response = await fetch("/api/rooms", { cache: "no-store" });
    if (!response.ok) throw new Error(`Salons indisponibles (${response.status})`);
    const data = (await response.json()) as { rooms: RoomInfo[] };
    return data.rooms ?? [];
  }

  async createRoom(input: { name: string; level: string }): Promise<RoomInfo> {
    const response = await fetch("/api/rooms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...input, playerId: this.playerId, playerName: this.name }),
    });
    if (!response.ok) throw new Error(`Création impossible (${response.status})`);
    const data = (await response.json()) as { room: RoomInfo };
    this.roomCode = data.room.code;
    return data.room;
  }

  async join(code: string): Promise<RoomInfo> {
    this.status = "connecting";
    const response = await fetch(`/api/rooms/${encodeURIComponent(code)}/join`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ playerId: this.playerId, name: this.name, outfit: this.outfit }),
    });
    if (!response.ok) {
      this.status = "error";
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? `Connexion refusée (${response.status})`);
    }
    const data = (await response.json()) as { room: RoomInfo; players: RemotePlayer[] };
    this.roomCode = data.room.code;
    this.revision = data.room.revision;
    this.status = "connected";
    this.failures = 0;
    this.options.onPlayers?.(data.players ?? []);
    this.start();
    return data.room;
  }

  /** File d'attente : seule la dernière position compte. */
  send(position: [number, number, number], heading: number, motion: string): void {
    this.pending = { position, heading, motion };
  }

  private start(): void {
    this.stop();
    this.timer = setInterval(() => void this.tick(), this.intervalMs);
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", this.onVisibility);
    }
  }

  private onVisibility = (): void => {
    if (document.visibilityState === "visible") void this.tick();
  };

  private async tick(): Promise<void> {
    if (!this.roomCode) return;
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
    const now = Date.now();
    if (now - this.lastSent < this.intervalMs) return;

    const update = this.pending;
    this.pending = null;
    this.lastSent = now;

    try {
      const response = await fetch(`/api/rooms/${encodeURIComponent(this.roomCode)}/sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          playerId: this.playerId,
          since: this.revision,
          updates: update
            ? [{ id: this.playerId, position: update.position, heading: update.heading, motion: update.motion }]
            : [],
        }),
      });

      if (response.status === 404) {
        this.status = "error";
        this.stop();
        this.options.onError?.(new Error("Salon fermé ou expiré."));
        this.options.onClose?.();
        return;
      }
      if (!response.ok) throw new Error(`sync ${response.status}`);

      const data = (await response.json()) as {
        players: RemotePlayer[];
        revision: number;
      };
      this.revision = data.revision;
      this.failures = 0;
      this.status = "connected";
      this.options.onPlayers?.(data.players);
    } catch (error) {
      this.failures += 1;
      if (this.failures >= 5) {
        this.status = "error";
        this.stop();
        this.options.onError?.(error instanceof Error ? error : new Error(String(error)));
        this.options.onClose?.();
      }
    }
  }

  async leave(): Promise<void> {
    const code = this.roomCode;
    this.stop();
    this.roomCode = null;
    this.status = "idle";
    if (!code) return;
    try {
      await fetch(`/api/rooms/${encodeURIComponent(code)}/leave`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playerId: this.playerId }),
      });
    } catch {
      // Le serveur nettoiera le joueur via son TTL.
    }
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", this.onVisibility);
    }
  }
}

/** Distance à laquelle un joueur distant est rendu/interpolé. */
export const NET_RENDER_DISTANCE = 140;

export function shouldRender(player: RemotePlayer, self: [number, number, number]): boolean {
  const dx = player.position[0] - self[0];
  const dz = player.position[2] - self[2];
  return Math.hypot(dx, dz) < NET_RENDER_DISTANCE;
}
