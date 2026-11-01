/**
 * Expéditions : la progression du jeu.
 *
 * Un jeu de chasse ne se joue pas dans un bac à sable : on part du camp avec une
 * machette, on rapporte de quoi nourrir la mission, et la forêt s'ouvre un peu
 * plus loin à chaque fois. Ce module décrit cette chaîne — les objectifs, les
 * zones qu'ils débloquent — et l'évalue à partir de l'état du monde (tableau de
 * chasse, viande, zones visitées, espèces observées).
 *
 * Il est pur : ni three, ni DOM, ni réseau. On peut donc dérouler une expédition
 * entière dans un script, ce que fait `scripts/check-progression.mjs`.
 *
 * Choix de conception : les objectifs sont **cumulatifs**. Un niveau demande
 * « deux hingebe et huit kilos de viande », pas « deux hingebe de plus ». La
 * première version comptait depuis le début du niveau — et elle créait des culs
 * de sac : un joueur qui abattait un crocodile pendant le niveau 3 ne pouvait
 * plus jamais valider l'objectif « un crocodile » du niveau 4. Un jeu de chasse
 * doit être généreux sur ce qu'il demande, jamais bloquant.
 */

import type { GameState } from "./engine";

export type ObjectiveKind = "kills" | "meat" | "visit" | "observe";

export interface Objective {
  kind: ObjectiveKind;
  /** Espèce (kills) ou zone (visit). Vide pour « viande » et « observer ». */
  target: string;
  count: number;
  /** Clé du dictionnaire : le libellé complet, dans la langue du joueur. */
  label: string;
}

export interface ExpeditionLevel {
  id: string;
  title: string;
  brief: string;
  objectives: Objective[];
  /** Zones ouvertes en terminant ce niveau. */
  unlocks: string[];
}

export interface ProgressState {
  /** Index du niveau en cours ; `LEVELS.length` quand tout est terminé. */
  levelIndex: number;
  /** Zones ouvertes par la progression (en plus de celles ouvertes d'office). */
  unlocks: string[];
  /** Identifiants des niveaux terminés, dans l'ordre. */
  completed: string[];
}

/** Une expédition en cinq étapes, du camp à la canopée. */
export const LEVELS: ExpeditionLevel[] = [
  {
    id: "reconnaissance",
    title: "level.1.title",
    brief: "level.1.brief",
    objectives: [
      { kind: "visit", target: "sentier", count: 1, label: "level.1.obj.route" },
      { kind: "observe", target: "", count: 3, label: "level.1.obj.observe" },
    ],
    unlocks: ["clairiere"],
  },
  {
    id: "premiere-battue",
    title: "level.2.title",
    brief: "level.2.brief",
    objectives: [
      { kind: "kills", target: "hingebe", count: 2, label: "level.2.obj.hingebe" },
      { kind: "meat", target: "", count: 8, label: "level.2.obj.meat" },
    ],
    unlocks: ["riviere", "foret-profonde"],
  },
  {
    id: "bai",
    title: "level.3.title",
    brief: "level.3.brief",
    objectives: [
      { kind: "visit", target: "clairiere", count: 1, label: "level.3.obj.bai" },
      { kind: "kills", target: "sitatunga", count: 1, label: "level.3.obj.sitatunga" },
      { kind: "meat", target: "", count: 25, label: "level.3.obj.meat" },
    ],
    unlocks: ["marais"],
  },
  {
    id: "riviere",
    title: "level.4.title",
    brief: "level.4.brief",
    objectives: [
      { kind: "visit", target: "riviere", count: 1, label: "level.4.obj.riviere" },
      { kind: "kills", target: "crocodile", count: 1, label: "level.4.obj.crocodile" },
    ],
    unlocks: ["colline"],
  },
  {
    id: "grande-traque",
    title: "level.5.title",
    brief: "level.5.brief",
    objectives: [
      { kind: "kills", target: "bongo", count: 1, label: "level.5.obj.bongo" },
      { kind: "kills", target: "gorille", count: 1, label: "level.5.obj.gorille" },
    ],
    unlocks: ["canopee"],
  },
];

export function initialProgress(): ProgressState {
  return {
    levelIndex: 0,
    unlocks: [],
    completed: [],
  };
}

/** L'expédition en cours, ou `null` quand la campagne est finie. */
export function currentLevel(progress: ProgressState): ExpeditionLevel | null {
  return LEVELS[progress.levelIndex] ?? null;
}

/** Avancement d'un objectif, sur les totaux de l'expédition. */
export function objectiveProgress(
  state: GameState,
  objective: Objective,
): { current: number; target: number; done: boolean } {
  let current = 0;
  switch (objective.kind) {
    case "kills":
      current = state.hunt.kills[objective.target] ?? 0;
      break;
    case "meat":
      current = state.hunt.meat;
      break;
    case "visit":
      current = state.visitedZones.includes(objective.target) ? 1 : 0;
      break;
    case "observe":
      current = state.observedSpecies.length;
      break;
  }
  const clamped = Math.max(0, Math.min(objective.count, Math.floor(current)));
  return { current: clamped, target: objective.count, done: clamped >= objective.count };
}

export interface LevelStatus {
  level: ExpeditionLevel | null;
  objectives: { objective: Objective; current: number; target: number; done: boolean }[];
  complete: boolean;
}

/** État de l'expédition en cours, prêt à afficher. */
export function levelStatus(state: GameState): LevelStatus {
  const level = currentLevel(state.progress);
  if (!level) return { level: null, objectives: [], complete: true };
  const objectives = level.objectives.map((objective) => {
    const progress = objectiveProgress(state, objective);
    return { objective, ...progress };
  });
  return { level, objectives, complete: objectives.every((entry) => entry.done) };
}

/**
 * Passe au niveau suivant si tous les objectifs sont remplis.
 *
 * Renvoie l'état et le niveau terminé (pour l'annoncer), ou `null` si rien ne
 * change. Fonction pure : elle ne modifie pas l'état reçu.
 */
export function advanceProgress(state: GameState): { state: GameState; completed: ExpeditionLevel | null } {
  const status = levelStatus(state);
  if (!status.level || !status.complete) return { state, completed: null };

  const level = status.level;
  const nextIndex = state.progress.levelIndex + 1;
  const progress: ProgressState = {
    levelIndex: nextIndex,
    unlocks: [...new Set([...state.progress.unlocks, ...level.unlocks])],
    completed: [...state.progress.completed, level.id],
  };

  const next: GameState = {
    ...state,
    progress,
    level: nextIndex + 1,
  };
  return { state: next, completed: level };
}

/** Les zones ouvertes à ce stade de l'expédition. */
export function openedZones(state: GameState): string[] {
  return state.progress.unlocks;
}

/** Résumé lisible de la campagne, pour le carnet. */
export function expeditionSummary(state: GameState): { id: string; title: string; done: boolean }[] {
  return LEVELS.map((level, index) => ({
    id: level.id,
    title: level.title,
    done: index < state.progress.levelIndex,
  }));
}
