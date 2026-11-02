/**
 * Progression d'expérience : cinquante niveaux, un Prix de Survie.
 *
 * Chaque action utile — abattre, dépecer, observer, trouver un Mewa, bâtir un
 * abri — rapporte de l'XP. La courbe est volontairement rapide au début et
 * longue à la fin : on sent qu'on progresse dès la première battue, et les
 * derniers niveaux se méritent.
 *
 * Tout est calculé, jamais stocké : le niveau se déduit de l'XP. Une sauvegarde
 * ne peut donc pas mentir sur son niveau, et une modification de la courbe
 * s'applique rétroactivement.
 */

export const MAX_LEVEL = 50;
/** XP nécessaire pour décrocher le Prix de Survie (niveau 50). */
export const SURVIVAL_PRIZE_XP = 2500;

/** XP cumulée nécessaire pour atteindre `level` (niveau 1 = 0 XP). */
export function xpForLevel(level: number): number {
  const n = Math.max(1, Math.min(MAX_LEVEL, Math.floor(level)));
  const t = (n - 1) / (MAX_LEVEL - 1);
  return Math.round(SURVIVAL_PRIZE_XP * Math.pow(t, 1.55));
}

/** Niveau atteint pour une XP donnée. */
export function levelForXp(xp: number): number {
  const value = Math.max(0, xp);
  if (value >= SURVIVAL_PRIZE_XP) return MAX_LEVEL;
  let level = 1;
  // Cinquante paliers : une recherche linéaire est plus lisible qu'une
  // bissection et coûte moins qu'un arrondi approximatif.
  for (let n = 2; n <= MAX_LEVEL; n += 1) {
    if (value < xpForLevel(n)) break;
    level = n;
  }
  return level;
}

export interface LevelProgress {
  level: number;
  /** XP accumulée depuis le début du niveau. */
  into: number;
  /** XP nécessaire pour passer au niveau suivant. */
  span: number;
  /** 0-1, pour la barre du HUD. */
  ratio: number;
  /** XP totale du prochain niveau (absolue). */
  nextAt: number;
  /** Le Prix de Survie est-il décroché ? */
  prize: boolean;
}

export function levelProgress(xp: number): LevelProgress {
  const value = Math.max(0, xp);
  const level = levelForXp(value);
  if (level >= MAX_LEVEL) {
    return {
      level: MAX_LEVEL,
      into: value - SURVIVAL_PRIZE_XP,
      span: 0,
      ratio: 1,
      nextAt: SURVIVAL_PRIZE_XP,
      prize: true,
    };
  }
  const start = xpForLevel(level);
  const nextAt = xpForLevel(level + 1);
  const span = Math.max(1, nextAt - start);
  const into = value - start;
  return {
    level,
    into,
    span,
    ratio: Math.max(0, Math.min(1, into / span)),
    nextAt,
    prize: false,
  };
}

/**
 * XP gagnée par action.
 *
 * Les valeurs sont volontairement modestes : il faut mériter le niveau 50 en
 * jouant, pas en ramassant des fruits.
 */
export const XP_REWARDS = {
  /** Abattre : la moitié des points de rareté de l'espèce, au minimum 5. */
  kill: (speciesPoints: number) => Math.max(5, Math.round(speciesPoints / 2)),
  /** Dépecer : un point par kilo, plafonné à 60 pour un éléphant. */
  harvest: (kg: number) => Math.max(2, Math.min(60, Math.round(kg))),
  /** Première observation d'une espèce. */
  observe: 15,
  /** Première visite d'une zone. */
  zone: 25,
  /** Un Mewa ramassé. */
  mewa: 40,
  /** Bâtir un abri. */
  shelter: 60,
  /** Dormir une nuit. */
  sleep: 15,
} as const;
