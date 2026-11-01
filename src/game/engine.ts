/**
 * Moteur de jeu : état du monde, déplacement, interactions.
 *
 * Le rendu (Three.js) est confié à <Scene /> ; ce module ne dépend pas de
 * three et peut donc tourner côté serveur, dans les tests ou dans un Web
 * Worker. C'est aussi ce qui est sérialisé dans les sauvegardes.
 */

import { type Character, defaultCharacter, getCharacter, speedFor } from "./characters";
import { type Species, faunaScore, spawnFor } from "./fauna";
import { type GadgetState, consumeGadget, initialGadgets } from "./gadgets";
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
import { initialArsenalState, type ArsenalState } from "./hunting";
import { type MewaReward, type MewaState, mewasFound, spawnMewas, stepMewas } from "./mewas";
import { waterDepthAt } from "./water";
import {
  advanceProgress,
  initialProgress,
  type ExpeditionLevel,
  type ProgressState,
} from "./progression";
import { swimState } from "./water";

export interface PlayerState {
  position: [number, number, number];
  heading: number;
  motion: "idle" | "walk" | "run" | "sneak" | "swim";
  characterId: string;
  outfit: string;
}

/**
 * Chasse : arsenal, viande au sac et tableau de chasse. Sérialisé avec la
 * sauvegarde — perdre son fusil en rechargeant la page serait absurde.
 */
export interface HuntState {
  arsenal: ArsenalState;
  /** Viande rapportée au camp, en kg. */
  meat: number;
  /** Bêtes abattues, par espèce. */
  kills: Record<string, number>;
  /** Coups tirés (statistique de piste). */
  shots: number;
}

/** Fin d'expédition : on ne se relève pas d'une déshydratation. */
export interface DeathState {
  cause: "soif" | "faim" | "blessure";
  at: number;
  /** Score final, figé au moment de la mort. */
  score: number;
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
  /** Expédition en cours : objectifs, zones ouvertes. Sérialisé. */
  progress: ProgressState;
  /** Les dix esprits de la forêt. */
  mewas: MewaState[];
  /** Fils de Rêve : la monnaie des tenues tissées. */
  threads: number;
  /** Expérience et points de style gagnés en explorant. */
  xp: number;
  style: number;
  /** Fruits cueillis en marchant. */
  fruits: number;
  /** Avancement de la cueillette en cours (0-1). */
  forage: number;
  /** Tenues tissées avec des Fils de Rêve. */
  woven: string[];
  /** Non nul quand l'expédition est terminée. */
  death: DeathState | null;
  level: number;
  score: number;
  settings: RealismSettings;
  hunt: HuntState;
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

export const SAVE_VERSION = 6;

export function initialHunt(): HuntState {
  return { arsenal: initialArsenalState(), meat: 0, kills: {}, shots: 0 };
}

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
    progress: initialProgress(),
    mewas: spawnMewas(Math.floor(Math.random() * 2 ** 31), DEFAULT_START.position),
    threads: 0,
    xp: 0,
    style: 0,
    fruits: 2,
    forage: 0,
    woven: [],
    death: null,
    level: 1,
    score: 0,
    settings: DEFAULT_REALISM,
    hunt: initialHunt(),
  };
}

/**
 * Est-on au camp ? Pas « dans la zone camp » : `zoneAt` retombe sur le camp
 * quand on est entre deux zones, ce qui rendrait tout le hors-piste « abrité ».
 * Le camp, c'est le cercle de tentes autour du point de départ.
 */
export function atCamp(state: GameState, radius = 22): boolean {
  const [x, , z] = state.player.position;
  return Math.hypot(x - DEFAULT_START.position[0], z - DEFAULT_START.position[2]) < radius;
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
  /** Niveau qui vient d'être terminé à ce pas de temps, s'il y en a un. */
  completedLevel: ExpeditionLevel | null;
  /** Mewas ramassés pendant ce pas de temps. */
  mewas: MewaReward[];
  /** Fin d'expédition déclenchée pendant ce pas de temps. */
  death: DeathState | null;
}

/** Fait avancer le monde d'un pas de temps (dt en secondes). */
export function step(state: GameState, input: InputState, dt: number): StepResult {
  // Expédition terminée : le monde s'arrête. On ne simule pas un cadavre.
  if (state.death) {
    return {
      state,
      zone: zoneAt(state.player.position[0], state.player.position[2]),
      enteredZone: false,
      observations: [],
      warnings: [],
      completedLevel: null,
      mewas: [],
      death: null,
    };
  }

  // La santé peut avoir été vidée par une charge entre deux pas : le combat
  // se joue dans le rendu, la mort se constate ici.
  if (state.vitals.health <= 0) {
    const cause: DeathState["cause"] =
      state.vitals.hydration < 15 ? "soif" : state.vitals.hunger < 12 ? "faim" : "blessure";
    const dead: GameState = {
      ...state,
      vitals: { ...state.vitals, health: 0 },
      death: { cause, at: state.elapsed, score: state.score },
    };
    return {
      state: dead,
      zone: zoneAt(dead.player.position[0], dead.player.position[2]),
      enteredZone: false,
      observations: [],
      warnings: [],
      completedLevel: null,
      mewas: [],
      death: dead.death,
    };
  }

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
    sheltered: atCamp(next),
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

  // --- Mewas : les esprits vivent même quand le joueur regarde ailleurs.
  const mewaStep = stepMewas(
    next.mewas,
    { x: next.player.position[0], z: next.player.position[2] },
    dt,
    next.elapsed,
  );
  next.mewas = mewaStep.mewas;
  for (const reward of mewaStep.collected) {
    next.threads += reward.threads;
    next.xp += reward.xp;
    next.style += reward.style;
  }
  if (mewaStep.collected.length) next.mewas = [...next.mewas];

  // --- Cueillette : les fruits se ramassent en marchant.
  if (next.player.motion !== "idle" && !atCamp(next) && next.fruits < 8) {
    next.forage = Math.min(1, next.forage + dt / 16);
    if (next.forage >= 1) {
      next.forage = 0;
      next.fruits += 1;
    }
  }

  next.score = faunaScore(next.observedSpecies) + next.style + mewasFound(next.mewas) * 60;

  // Progression : si tous les objectifs de l'expédition en cours sont remplis,
  // on passe au niveau suivant et on ouvre les zones qu'il débloque.
  const advanced = advanceProgress(next);
  const finalState = advanced.state;
  finalState.level = Math.min(finalState.progress.levelIndex + 1, 5);

  const warnings: string[] = [];
  if (next.vitals.health < 30) warnings.push("Santé critique");
  if (next.vitals.hydration < 20) warnings.push("Déshydratation");
  if (next.vitals.hunger < 20) warnings.push("Famine");
  if (swimState(next.player.position[0], next.player.position[2], next.elapsed, clock.hour).risk > 0.6) {
    warnings.push("Crocodiles à proximité");
  }

  // --- Fin d'expédition : la santé à zéro ferme la partie.
  let death: DeathState | null = null;
  if (finalState.vitals.health <= 0) {
    const cause: DeathState["cause"] =
      finalState.vitals.hydration < 15 ? "soif" : finalState.vitals.hunger < 12 ? "faim" : "blessure";
    finalState.vitals.health = 0;
    death = { cause, at: finalState.elapsed, score: finalState.score };
    finalState.death = death;
  }

  return {
    state: finalState,
    zone,
    enteredZone,
    observations,
    warnings,
    completedLevel: advanced.completed,
    mewas: mewaStep.collected,
    death,
  };
}

function distanceToZoneCenter(species: Species, zone: Zone): number {
  // Espèces observables dans un rayon de 40 unités autour du centre de zone.
  return species.habitats.includes(zone.id) ? zone.radius * 0.4 : Infinity;
}

function clampWorld(value: number): number {
  const limit = 260;
  return Math.min(limit, Math.max(-limit, value));
}

/**
 * Utilise un gadget et renvoie l'état mis à jour.
 * `applyGadget` plutôt que `useItem` pour la même raison : pas de faux hook.
 */
export function applyGadget(state: GameState, gadgetId: string, seconds: number): GameState {
  const gadgets = state.gadgets.map((g) => {
    if (g.id !== gadgetId) return g;
    return consumeGadget(g, seconds) ?? g;
  });
  return { ...state, gadgets };
}

// ------------------------------------------------------------------
// Gestes de survie
// ------------------------------------------------------------------

export interface ActionResult {
  state: GameState;
  /** Code stable, traduit par l'interface. */
  code:
    | "drink.ok"
    | "drink.none"
    | "eat.ok"
    | "eat.none"
    | "grill.ok"
    | "grill.none"
    | "grill.far"
    | "weave.ok"
    | "weave.threads"
    | "weave.owned";
  amount?: number;
}

function clampVitals(vitals: PlayerVitals): PlayerVitals {
  const clamp = (n: number) => Math.min(100, Math.max(0, n));
  return {
    ...vitals,
    stamina: clamp(vitals.stamina),
    hydration: clamp(vitals.hydration),
    hunger: clamp(vitals.hunger),
    health: clamp(vitals.health),
  };
}

/** Y a-t-il de l'eau à portée de main (berge, haut-fond) ? */
export function waterWithin(x: number, z: number, radius = 2.6): boolean {
  if (waterDepthAt(x, z) > 0.12) return true;
  for (let i = 0; i < 8; i += 1) {
    const angle = (i * Math.PI) / 4;
    if (waterDepthAt(x + Math.cos(angle) * radius, z + Math.sin(angle) * radius) > 0.12) {
      return true;
    }
  }
  return false;
}

/** Boire à la rivière (E). */
export function drinkWater(state: GameState): ActionResult {
  if (state.death) return { state, code: "drink.none" };
  const [x, , z] = state.player.position;
  if (!waterWithin(x, z)) return { state, code: "drink.none" };
  const vitals = clampVitals({
    ...state.vitals,
    hydration: state.vitals.hydration + 32,
    // L'eau du bassin n'est pas potable : elle étanche la soif, elle ne
    // répare pas. Le filtre à eau, lui, en fait une ressource sûre.
    health: state.vitals.health + (state.gadgets.some((g) => g.id === "filtre-eau") ? 4 : 0),
  });
  return { state: { ...state, vitals }, code: "drink.ok", amount: Math.round(vitals.hydration) };
}

/** Manger un fruit cueilli (F). */
export function eatFruit(state: GameState): ActionResult {
  if (state.death || state.fruits <= 0) return { state, code: "eat.none" };
  const vitals = clampVitals({
    ...state.vitals,
    hunger: state.vitals.hunger + 22,
    hydration: state.vitals.hydration + 7,
  });
  return {
    state: { ...state, vitals, fruits: state.fruits - 1 },
    code: "eat.ok",
    amount: state.fruits - 1,
  };
}

/** Griller de la viande au feu du camp (G). */
export function grillMeat(state: GameState): ActionResult {
  if (state.death) return { state, code: "grill.none" };
  if (!atCamp(state)) return { state, code: "grill.far" };
  if (state.hunt.meat < 1) return { state, code: "grill.none" };
  const vitals = clampVitals({
    ...state.vitals,
    hunger: state.vitals.hunger + 46,
    health: state.vitals.health + 8,
  });
  return {
    state: {
      ...state,
      vitals,
      hunt: { ...state.hunt, meat: state.hunt.meat - 1 },
    },
    code: "grill.ok",
    amount: Math.round(state.hunt.meat - 1),
  };
}

/** Tisser une tenue avec des Fils de Rêve (dans le vestiaire). */
export function weaveOutfit(state: GameState, outfitId: string): ActionResult {
  const outfit = getOutfit(outfitId);
  if (outfit.threads <= 0 || state.woven.includes(outfit.id)) {
    return { state, code: "weave.owned" };
  }
  if (state.death || state.threads < outfit.threads) {
    return { state, code: "weave.threads" };
  }
  return {
    state: {
      ...state,
      threads: state.threads - outfit.threads,
      woven: [...state.woven, outfit.id],
    },
    code: "weave.ok",
    amount: state.threads - outfit.threads,
  };
}

/** Repartir pour une nouvelle expédition, en gardant les tenues tissées. */
export function restartExpedition(state: GameState, characterId = state.player.characterId): GameState {
  const fresh = newGame(characterId);
  return {
    ...fresh,
    mewas: spawnMewas(Math.floor(Math.random() * 2 ** 31), DEFAULT_START.position),
    woven: state.woven,
    player: { ...fresh.player, outfit: state.player.outfit },
  };
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
    progress: state.progress,
    mewas: state.mewas,
    threads: state.threads,
    xp: state.xp,
    style: state.style,
    fruits: state.fruits,
    forage: Math.round(state.forage * 100) / 100,
    woven: state.woven,
    death: state.death,
    hunt: {
      arsenal: state.hunt.arsenal,
      meat: Math.round(state.hunt.meat),
      kills: state.hunt.kills,
      shots: state.hunt.shots,
    },
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
    progress: deserializeProgress(raw.progress),
    gadgets: initialGadgets(Array.isArray(raw.visitedZones) ? (raw.visitedZones as string[]) : []),
    hunt: deserializeHunt(raw.hunt),
    mewas: deserializeMewas(raw.mewas, base),
    threads: typeof raw.threads === "number" ? raw.threads : 0,
    xp: typeof raw.xp === "number" ? raw.xp : 0,
    style: typeof raw.style === "number" ? raw.style : 0,
    fruits: typeof raw.fruits === "number" ? raw.fruits : base.fruits,
    forage: typeof raw.forage === "number" ? raw.forage : 0,
    woven: Array.isArray(raw.woven) ? (raw.woven as string[]) : [],
    death: deserializeDeath(raw.death),
  };
}

/** Les Mewas d'une sauvegarde, avec leurs positions ; sinon on les replace. */
function deserializeMewas(raw: unknown, base: GameState): MewaState[] {
  if (!Array.isArray(raw)) return base.mewas;
  const parsed = raw
    .filter((entry): entry is Partial<MewaState> => Boolean(entry) && typeof entry === "object")
    .map((entry, index) => ({
      id: typeof entry.id === "number" ? entry.id : index,
      x: Number(entry.x) || 0,
      z: Number(entry.z) || 0,
      homeX: Number(entry.homeX) || Number(entry.x) || 0,
      homeZ: Number(entry.homeZ) || Number(entry.z) || 0,
      collected: Boolean(entry.collected),
      phase: Number(entry.phase) || 0,
    }));
  return parsed.length ? parsed : base.mewas;
}

function deserializeDeath(raw: unknown): DeathState | null {
  if (!raw || typeof raw !== "object") return null;
  const source = raw as Partial<DeathState>;
  const cause = source.cause;
  if (cause !== "soif" && cause !== "faim" && cause !== "blessure") return null;
  return {
    cause,
    at: Number(source.at) || 0,
    score: Number(source.score) || 0,
  };
}

/**
 * Relit la progression d'une sauvegarde.
 *
 * Une sauvegarde d'avant les expéditions n'en a pas : on repart du début, mais
 * sans rien perdre du reste (tableau de chasse, viande, zones visitées).
 */
function deserializeProgress(raw: unknown): ProgressState {
  const base = initialProgress();
  if (!raw || typeof raw !== "object") return base;
  const source = raw as Partial<ProgressState>;
  return {
    levelIndex: typeof source.levelIndex === "number" ? Math.max(0, source.levelIndex) : 0,
    unlocks: Array.isArray(source.unlocks) ? source.unlocks : [],
    completed: Array.isArray(source.completed) ? source.completed : [],
  };
}

/** Relit l'état de chasse d'une sauvegarde, en tolérant les vieilles versions. */
function deserializeHunt(raw: unknown): HuntState {
  const base = initialHunt();
  if (!raw || typeof raw !== "object") return base;
  const source = raw as Partial<HuntState>;
  const arsenal = source.arsenal;
  const weapons =
    arsenal && Array.isArray(arsenal.weapons) && arsenal.weapons.length
      ? base.arsenal.weapons.map((weapon) => {
          const saved = arsenal.weapons.find((entry) => entry.id === weapon.id);
          if (!saved) return weapon;
          return {
            ...weapon,
            loaded: Number.isFinite(saved.loaded) ? Number(saved.loaded) : weapon.loaded,
            reserve: Number.isFinite(saved.reserve) ? Number(saved.reserve) : weapon.reserve,
          };
        })
      : base.arsenal.weapons;
  return {
    arsenal: {
      weapons,
      current: (arsenal?.current as HuntState["arsenal"]["current"]) ?? base.arsenal.current,
    },
    meat: typeof source.meat === "number" ? source.meat : 0,
    kills: source.kills && typeof source.kills === "object" ? source.kills : {},
    shots: typeof source.shots === "number" ? source.shots : 0,
  };
}

/** Le personnage par défaut, pratique pour l'interface de chargement. */
export function starterCharacter(): Character {
  return defaultCharacter();
}

export function weatherLabel(weather: Weather): string {
  return { sec: "Dégagé", pluie: "Pluie", orage: "Orage", brume: "Brume" }[weather];
}
