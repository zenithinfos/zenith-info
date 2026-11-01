/**
 * Moteur de jeu : état du monde, déplacement, interactions.
 *
 * Le rendu (Three.js) est confié à <Scene /> ; ce module ne dépend pas de
 * three et peut donc tourner côté serveur, dans les tests ou dans un Web
 * Worker. C'est aussi ce qui est sérialisé dans les sauvegardes.
 */

import { type Character, defaultCharacter, getCharacter, speedFor } from "./characters";
import { type Species, faunaScore, spawnFor } from "./fauna";
import { type GadgetState, initialGadgets, useGadget } from "./gadgets";
import { DEFAULT_START, type Zone, zoneAt } from "./levels";
import { type Outfit, getOutfit } from "./outfits";
import {
  DEFAULT_REALISM,
  type PlayerVitals,
  type RealismSettings,
  type Weather,
  type WeatherState,
  initialVitals,
  initialWeather,
  nextWeather,
  tickVitals,
  worldClock,
} from "./realism";
import { swimState } from "./water";

export interface PlayerState {
  position: [number, number, number];
  heading: number;
  motion: "idle" | "walk" | "run" | "sneak" | "swim";
  characterId: string;
  outfit: string;
}

export interface GameState {
  version: number;
  seed: number;
  elapsed: number;
  player: PlayerState;
  vitals: PlayerVitals;
  weather: WeatherState;
  zoneId: string;
  visitedZones: string[];
  observedSpecies: string[];
  gadgets: GadgetState[];
  level: number;
  score: number;
  settings: RealismSettings;
}

export interface InputState {
  forward: boolean;
  backward: boolean;
  left: boolean;
  right: boolean;
  run: boolean;
  sneak: boolean;
  /** Direction de déplacement (radians) si piloté au joystick tactile. */
  joystick?: { x: number; y: number } | null;
}

export const SAVE_VERSION = 3;

export function newGame(characterId = "michelle"): GameState {
  const character = getCharacter(characterId as Character["id"]);
  return {
    version: SAVE_VERSION,
    seed: Math.floor(Math.random() * 2 ** 31),
    elapsed: 0,
    player: {
      position: [...DEFAULT_START.position] as [number, number, number],
      heading: DEFAULT_START.heading,
      motion: "idle",
      characterId: character.id,
      outfit: "explorateur",
    },
    vitals: initialVitals(),
    weather: initialWeather(),
    zoneId: DEFAULT_START.zone,
    visitedZones: [DEFAULT_START.zone],
    observedSpecies: [],
    gadgets: initialGadgets([]),
    level: 1,
    score: 0,
    settings: DEFAULT_REALISM,
  };
}

/** Vitesse effective : personnage × tenue × état (nage, discrétion). */
export function effectiveSpeed(
  state: GameState,
  mode: "walk" | "run" | "sneak",
  swimFactor = 1,
): number {
  const character = getCharacter(state.player.characterId as Character["id"]);
  const outfit: Outfit = getOutfit(state.player.outfit);
  const base = speedFor(character, mode);
  const fatigue = state.vitals.stamina < 15 ? 0.65 : 1;
  return base * outfit.modifiers.speed * fatigue * swimFactor;
}

export interface StepResult {
  state: GameState;
  zone: Zone;
  enteredZone: boolean;
  observations: Species[];
  warnings: string[];
}

/** Fait avancer le monde d'un pas de temps (dt en secondes). */
export function step(state: GameState, input: InputState, dt: number): StepResult {
  const next: GameState = {
    ...state,
    elapsed: state.elapsed + dt,
    player: { ...state.player },
    vitals: { ...state.vitals },
    visitedZones: [...state.visitedZones],
    observedSpecies: [...state.observedSpecies],
  };

  const mode: "walk" | "run" | "sneak" = input.run && next.vitals.stamina > 5
    ? "run"
    : input.sneak
      ? "sneak"
      : "walk";

  let dx = 0;
  let dz = 0;
  if (input.joystick && (input.joystick.x !== 0 || input.joystick.y !== 0)) {
    dx = input.joystick.x;
    dz = input.joystick.y;
  } else {
    if (input.forward) dz -= 1;
    if (input.backward) dz += 1;
    if (input.left) dx -= 1;
    if (input.right) dx += 1;
  }

  const magnitude = Math.hypot(dx, dz);
  if (magnitude > 0.01) {
    dx /= magnitude;
    dz /= magnitude;
    next.player.heading = Math.atan2(dx, -dz);

    const [px, , pz] = next.player.position;
    const swim = swimState(px, pz, next.elapsed, worldClock(next.elapsed, next.settings).hour);
    const speed = effectiveSpeed(next, mode, swim.speedFactor);
    const nx = px + dx * speed * dt + swim.drift[0] * dt;
    const nz = pz + dz * speed * dt + swim.drift[1] * dt;

    next.player.position = [clampWorld(nx), next.player.position[1], clampWorld(nz)];
    next.player.motion = swim.inWater ? "swim" : mode;
  } else {
    next.player.motion = "idle";
  }

  const clock = worldClock(next.elapsed, next.settings);
  next.weather = nextWeather(next.weather, dt, next.seed);
  next.vitals = tickVitals(next.vitals, {
    running: next.player.motion === "run",
    sheltered: next.zoneId === "camp",
    wetness: next.vitals.wetness,
    weather: next.weather,
    hour: clock.hour,
    deltaSeconds: dt,
  });

  const zone = zoneAt(next.player.position[0], next.player.position[2]);
  const enteredZone = zone.id !== next.zoneId;
  next.zoneId = zone.id;
  if (!next.visitedZones.includes(zone.id)) next.visitedZones.push(zone.id);

  const noise = next.player.motion === "run" ? 8 : next.player.motion === "sneak" ? 1 : 3;
  const present = spawnFor({
    zoneId: zone.id,
    hour: clock.hour,
    weather: next.weather.current,
    noise,
  });

  const observations: Species[] = [];
  for (const species of present) {
    if (next.observedSpecies.includes(species.id)) continue;
    // Observation : il faut être discret et à portée d'œil.
    if (noise <= 3 && distanceToZoneCenter(species, zone) < zone.radius) {
      next.observedSpecies.push(species.id);
      observations.push(species);
    }
  }

  next.score = faunaScore(next.observedSpecies);
  next.level = 1 + Math.floor(next.score / 160);

  const warnings: string[] = [];
  if (next.vitals.health < 30) warnings.push("Santé critique");
  if (next.vitals.hydration < 20) warnings.push("Déshydratation");
  if (swimState(next.player.position[0], next.player.position[2], next.elapsed, clock.hour).risk > 0.6) {
    warnings.push("Crocodiles à proximité");
  }

  return { state: next, zone, enteredZone, observations, warnings };
}

function distanceToZoneCenter(species: Species, zone: Zone): number {
  // Espèces observables dans un rayon de 40 unités autour du centre de zone.
  return species.habitats.includes(zone.id) ? zone.radius * 0.4 : Infinity;
}

function clampWorld(value: number): number {
  const limit = 260;
  return Math.min(limit, Math.max(-limit, value));
}

/** Utilise un gadget et renvoie l'état mis à jour. */
export function useItem(state: GameState, gadgetId: string, seconds: number): GameState {
  const gadgets = state.gadgets.map((g) => {
    if (g.id !== gadgetId) return g;
    return useGadget(g, seconds) ?? g;
  });
  return { ...state, gadgets };
}

/** Sérialise l'état pour l'API de sauvegarde. */
export function serialize(state: GameState): Record<string, unknown> {
  return {
    version: state.version,
    seed: state.seed,
    elapsed: Math.round(state.elapsed),
    player: {
      ...state.player,
      position: state.player.position.map((n) => Math.round(n * 100) / 100),
    },
    vitals: state.vitals,
    zoneId: state.zoneId,
    visitedZones: state.visitedZones,
    observedSpecies: state.observedSpecies,
    level: state.level,
    score: state.score,
  };
}

/** Reconstruit un état complet depuis une sauvegarde (tolérant aux versions). */
export function deserialize(raw: Record<string, unknown>): GameState {
  const base = newGame();
  if (!raw || typeof raw !== "object") return base;

  const player = (raw.player ?? {}) as Partial<PlayerState>;
  const vitals = (raw.vitals ?? {}) as Partial<PlayerVitals>;
  const position = Array.isArray(player.position) ? player.position : base.player.position;

  return {
    ...base,
    seed: typeof raw.seed === "number" ? raw.seed : base.seed,
    elapsed: typeof raw.elapsed === "number" ? raw.elapsed : 0,
    player: {
      position: [
        Number(position[0]) || 0,
        Number(position[1]) || 0,
        Number(position[2]) || 0,
      ],
      heading: Number(player.heading) || 0,
      motion: "idle",
      characterId: player.characterId ?? base.player.characterId,
      outfit: player.outfit ?? base.player.outfit,
    },
    vitals: { ...base.vitals, ...vitals },
    zoneId: typeof raw.zoneId === "string" ? raw.zoneId : base.zoneId,
    visitedZones: Array.isArray(raw.visitedZones) ? (raw.visitedZones as string[]) : base.visitedZones,
    observedSpecies: Array.isArray(raw.observedSpecies)
      ? (raw.observedSpecies as string[])
      : [],
    level: typeof raw.level === "number" ? raw.level : 1,
    score: typeof raw.score === "number" ? raw.score : 0,
    gadgets: initialGadgets(Array.isArray(raw.visitedZones) ? (raw.visitedZones as string[]) : []),
  };
}

/** Le personnage par défaut, pratique pour l'interface de chargement. */
export function starterCharacter(): Character {
  return defaultCharacter();
}

export function weatherLabel(weather: Weather): string {
  return { sec: "Dégagé", pluie: "Pluie", orage: "Orage", brume: "Brume" }[weather];
}
