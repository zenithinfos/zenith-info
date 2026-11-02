/**
 * Les niveaux du jeu — cinq chapitres, chacun avec ses objectifs.
 *
 * Un jeu qui ne propose rien à faire est une promenade. Ici, chaque chapitre
 * donne une raison précise d'aller plus loin : rejoindre le sentier, abattre
 * deux céphalophes, descendre au baï, tuer un crocodile, puis entrer dans la
 * forêt profonde. Les objectifs se comptent sur l'état du jeu — jamais sur un
 * drapeau qu'on pourrait oublier de mettre à jour.
 *
 * Choix de conception : les objectifs sont **cumulatifs**. Un chapitre demande
 * « deux hingebe et dix kilos de viande », pas « deux hingebe de plus ». La
 * première version comptait depuis le début du chapitre — et créait des culs de
 * sac : un joueur qui abattait un crocodile au chapitre 3 ne pouvait plus jamais
 * valider l'objectif « un crocodile » du chapitre 4. Un jeu de chasse doit être
 * généreux sur ce qu'il demande, jamais bloquant.
 *
 * Module pur : aucune dépendance à Three.js, donc testable sans navigateur
 * (voir `scripts/check-progression.mjs`).
 */

import type { GameState } from "./engine";
import type { WeaponId } from "./hunting";
import { mewasFound } from "./mewas";
import { levelForXp } from "./xp";

export type ObjectiveKind = "hunt" | "harvest" | "observe" | "zone" | "mewa" | "shelter";

export interface Objective {
  /** Identifiant stable, sert de clé de traduction `level.<n>.obj.<id>`. */
  id: string;
  kind: ObjectiveKind;
  /** Espèce visée (hunt) ou zone visée (zone). */
  target?: string;
  count: number;
}

export interface GameLevel {
  id: string;
  /** Clé du dictionnaire : le titre, dans la langue du joueur. */
  title: string;
  /** Clé du dictionnaire : le brief du chapitre. */
  brief: string;
  /** Zones ouvertes quand le chapitre est terminé. */
  unlocks: string[];
  rewards: {
    xp: number;
    /** Arme débloquée à la fin du chapitre. */
    weapon?: WeaponId;
  };
  objectives: Objective[];
}

export const LEVELS: GameLevel[] = [
  {
    id: "reconnaissance",
    title: "level.1.title",
    brief: "level.1.brief",
    unlocks: ["sentier"],
    rewards: { xp: 50, weapon: "pistolet" },
    objectives: [
      { id: "route", kind: "zone", target: "sentier", count: 1 },
      { id: "observe", kind: "observe", count: 2 },
    ],
  },
  {
    id: "premiere-battue",
    title: "level.2.title",
    brief: "level.2.brief",
    unlocks: ["clairiere"],
    rewards: { xp: 120, weapon: "m16" },
    objectives: [
      { id: "hingebe", kind: "hunt", target: "hingebe", count: 2 },
      { id: "meat", kind: "harvest", count: 10 },
    ],
  },
  {
    id: "bai",
    title: "level.3.title",
    brief: "level.3.brief",
    unlocks: ["riviere"],
    rewards: { xp: 200 },
    objectives: [
      { id: "bai", kind: "zone", target: "clairiere", count: 1 },
      { id: "sitatunga", kind: "hunt", target: "sitatunga", count: 1 },
      { id: "observe", kind: "observe", count: 5 },
    ],
  },
  {
    id: "riviere",
    title: "level.4.title",
    brief: "level.4.brief",
    unlocks: ["foret-profonde"],
    rewards: { xp: 300, weapon: "fusil" },
    objectives: [
      { id: "riviere", kind: "zone", target: "riviere", count: 1 },
      { id: "crocodile", kind: "hunt", target: "crocodile", count: 1 },
      { id: "meat", kind: "harvest", count: 45 },
    ],
  },
  {
    id: "grande-traque",
    title: "level.5.title",
    brief: "level.5.brief",
    unlocks: ["colline", "canopee"],
    rewards: { xp: 500 },
    objectives: [
      { id: "bongo", kind: "hunt", target: "bongo", count: 1 },
      { id: "mewas", kind: "mewa", count: 5 },
      { id: "abri", kind: "shelter", count: 1 },
    ],
  },
];

export interface ProgressState {
  /** Index du chapitre en cours ; `LEVELS.length` quand tout est terminé. */
  levelIndex: number;
  /** Identifiants des chapitres terminés, dans l'ordre. */
  completed: string[];
  /** Zones ouvertes par les chapitres terminés. */
  unlocks: string[];
}

export function initialProgress(): ProgressState {
  return { levelIndex: 0, completed: [], unlocks: [] };
}

/** Le chapitre en cours, ou `null` quand la campagne est finie. */
export function currentLevel(progress: ProgressState): GameLevel | null {
  return LEVELS[progress.levelIndex] ?? null;
}

/** Valeur courante d'un objectif, lue sur l'état du jeu. */
export function objectiveValue(
  state: Pick<GameState, "hunt" | "observedSpecies" | "visitedZones" | "mewas" | "shelters">,
  objective: Objective,
): number {
  switch (objective.kind) {
    case "hunt":
      return state.hunt.kills[objective.target ?? ""] ?? 0;
    case "harvest":
      return state.hunt.harvested;
    case "observe":
      return state.observedSpecies.length;
    case "mewa":
      return mewasFound(state.mewas);
    case "shelter":
      return state.shelters.length;
    case "zone":
      return state.visitedZones.includes(objective.target ?? "") ? 1 : 0;
    default:
      return 0;
  }
}

/** Clé de dictionnaire du libellé d'un objectif. */
export function objectiveLabel(levelIndex: number, objective: Objective): string {
  return `level.${levelIndex + 1}.obj.${objective.id}`;
}

export interface ObjectiveStatus {
  objective: Objective;
  /** Clé de dictionnaire du libellé. */
  label: string;
  current: number;
  target: number;
  done: boolean;
}

export interface LevelStatus {
  level: GameLevel | null;
  objectives: ObjectiveStatus[];
  complete: boolean;
}

/** État détaillé du chapitre en cours : objectifs, avancement, complétion. */
export function levelStatus(state: GameState): LevelStatus {
  const index = state.progress.levelIndex;
  const level = currentLevel(state.progress);
  if (!level) return { level: null, objectives: [], complete: true };
  const objectives = level.objectives.map((objective) => {
    const current = Math.min(objective.count, objectiveValue(state, objective));
    return {
      objective,
      label: objectiveLabel(index, objective),
      current,
      target: objective.count,
      done: current >= objective.count,
    };
  });
  return { level, objectives, complete: objectives.every((entry) => entry.done) };
}

export interface AdvanceResult {
  state: GameState;
  /** Chapitre terminé par ce pas de temps, s'il y en a un. */
  completed: GameLevel | null;
}

/**
 * Termine le chapitre courant si ses objectifs sont remplis.
 *
 * Un seul chapitre par appel : le joueur doit voir la transition, pas la
 * traverser d'un coup parce qu'il avait déjà tout fait.
 */
export function advanceProgress(state: GameState): AdvanceResult {
  const status = levelStatus(state);
  const level = status.level;
  if (!level || !status.complete) return { state, completed: null };

  const next: GameState = {
    ...state,
    progress: {
      ...state.progress,
      levelIndex: state.progress.levelIndex + 1,
      completed: [...state.progress.completed, level.id],
      unlocks: [...new Set([...state.progress.unlocks, ...level.unlocks])],
    },
    xp: state.xp + level.rewards.xp,
    // Le niveau se déduit de l'XP : on le recalcule ici pour que l'affichage
    // et le HUD ne voient jamais un état à moitié mis à jour.
    level: levelForXp(state.xp + level.rewards.xp),
  };
  return { state: next, completed: level };
}

/** Zones ouvertes à ce stade : celles du camp, plus celles gagnées. */
export function unlockedZoneIds(state: GameState, defaultZones: string[]): string[] {
  return [...new Set([...defaultZones, ...state.progress.unlocks])];
}

/** Résumé lisible de la campagne, pour le carnet. */
export function expeditionSummary(state: GameState): { id: string; title: string; done: boolean }[] {
  return LEVELS.map((level, index) => ({
    id: level.id,
    title: level.title,
    done: index < state.progress.levelIndex,
  }));
}
