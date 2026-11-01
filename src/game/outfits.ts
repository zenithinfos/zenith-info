/**
 * Tenues. Chaque tenue modifie la discrétion, la résistance à la pluie et
 * l'endurance : le vestiaire (composant Dressing) s'appuie sur ces données.
 */

export interface Outfit {
  id: string;
  name: string;
  emoji: string;
  description: string;
  /** Multiplicateurs appliqués aux statistiques du personnage. */
  modifiers: {
    stealth: number;
    resilience: number;
    stamina: number;
    speed: number;
  };
  /** Couleur d'accent utilisée par l'interface. */
  accent: string;
  unlockLevel: number;
  /**
   * Fils de Rêve nécessaires pour tisser la tenue.
   * 0 = tenue de terrain, portée d'emblée.
   */
  threads: number;
}

export const OUTFITS: Outfit[] = [
  {
    id: "explorateur",
    name: "Tenue d'explorateur",
    emoji: "👕",
    description: "Coton léger, poches partout. La tenue par défaut, polyvalente.",
    modifiers: { stealth: 1, resilience: 1, stamina: 1, speed: 1 },
    accent: "#c8a06a",
    unlockLevel: 1,
    threads: 0,
  },
  {
    id: "ecogarde",
    name: "Uniforme d'écogarde",
    emoji: "🪖",
    description: "Vert olive renforcé, radio à l'épaule. Inspecte les zones protégées plus vite.",
    modifiers: { stealth: 0.95, resilience: 1.2, stamina: 1.1, speed: 0.98 },
    accent: "#5d7a3f",
    unlockLevel: 2,
    threads: 0,
  },
  {
    id: "pisteur",
    name: "Tenue de pisteur",
    emoji: "🍃",
    description: "Fibres naturelles teintées à la boue : la meilleure discrétion de la réserve.",
    modifiers: { stealth: 1.35, resilience: 0.9, stamina: 1.05, speed: 0.96 },
    accent: "#4b5c34",
    unlockLevel: 3,
    threads: 0,
  },
  {
    id: "pluie",
    name: "Cape de pluie",
    emoji: "🧥",
    description: "Imperméable intégral. Indispensable pendant la saison des pluies.",
    modifiers: { stealth: 0.9, resilience: 1.4, stamina: 0.95, speed: 0.94 },
    accent: "#2f5d6b",
    unlockLevel: 3,
    threads: 0,
  },
  {
    id: "canicule",
    name: "Tenue tropicale",
    emoji: "🩳",
    description: "Séchage rapide, respiration maximale : parfaite en plein soleil.",
    modifiers: { stealth: 0.85, resilience: 0.85, stamina: 1.3, speed: 1.08 },
    accent: "#d08a4a",
    unlockLevel: 4,
    threads: 0,
  },
  {
    id: "nuit",
    name: "Tenue de nuit",
    emoji: "🌑",
    description: "Tissu mat anti-reflet, coutures invisibles. Pour observer sans être vu.",
    modifiers: { stealth: 1.5, resilience: 0.95, stamina: 0.9, speed: 1 },
    accent: "#3a3f5c",
    unlockLevel: 5,
    threads: 0,
  },
  {
    id: "reve",
    name: "Tenue de rêve",
    emoji: "🪡",
    description:
      "Tissée dans les Fils de Rêve des Mewas. Le tissu capte la lumière bleue de la forêt et la rend au pas suivant.",
    modifiers: { stealth: 1.25, resilience: 1.15, stamina: 1.2, speed: 1.04 },
    accent: "#7fd4ff",
    unlockLevel: 1,
    threads: 6,
  },
  {
    id: "lumiere",
    name: "Manteau de lumière",
    emoji: "✨",
    description:
      "Des fils assez nombreux pour couvrir les épaules. La pluie glisse, la nuit s'éclaircit autour de vous.",
    modifiers: { stealth: 1.35, resilience: 1.4, stamina: 1.25, speed: 1.02 },
    accent: "#a9e7ff",
    unlockLevel: 1,
    threads: 14,
  },
  {
    id: "peau-mewa",
    name: "Peau de Mewa",
    emoji: "🌙",
    description:
      "Vingt-quatre fils, le prix d'une meute entière d'esprits. On ne vous entend plus venir.",
    modifiers: { stealth: 1.6, resilience: 1.2, stamina: 1.35, speed: 1.08 },
    accent: "#d8f2ff",
    unlockLevel: 1,
    threads: 24,
  },
];

export const MAGIC_OUTFITS = ["reve", "lumiere", "peau-mewa"];

export function getOutfit(id: string): Outfit {
  return OUTFITS.find((o) => o.id === id) ?? OUTFITS[0];
}

export function unlockedOutfits(level: number): Outfit[] {
  return OUTFITS.filter((o) => o.unlockLevel <= level);
}

export function canWear(outfitId: string, level: number): boolean {
  const outfit = OUTFITS.find((o) => o.id === outfitId);
  return Boolean(outfit && outfit.unlockLevel <= level);
}

/** Une tenue tissée doit d'abord être payée en Fils de Rêve. */
export function isWoven(outfit: Outfit, woven: string[]): boolean {
  return outfit.threads === 0 || woven.includes(outfit.id);
}

/** Peut-on porter cette tenue maintenant ? */
export function outfitAvailable(
  outfit: Outfit,
  level: number,
  woven: string[] = [],
): boolean {
  return outfit.unlockLevel <= level && isWoven(outfit, woven);
}

/** Peut-on la tisser maintenant ? */
export function canWeave(outfit: Outfit, threads: number, woven: string[] = []): boolean {
  return outfit.threads > 0 && !woven.includes(outfit.id) && threads >= outfit.threads;
}
