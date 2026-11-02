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
  /**
   * Pouvoir d'une tenue tissée. Absent = tenue de terrain.
   *   glide — planer en maintenant la touche de saut
   *   water — marcher sur l'eau
   *   tame  — les bêtes vous suivent
   *   calm  — les prédateurs ne chargent plus
   */
  power?: "glide" | "water" | "tame" | "calm";
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
    unlockLevel: 4,
    threads: 0,
  },
  {
    id: "pisteur",
    name: "Tenue de pisteur",
    emoji: "🍃",
    description: "Fibres naturelles teintées à la boue : la meilleure discrétion de la réserve.",
    modifiers: { stealth: 1.35, resilience: 0.9, stamina: 1.05, speed: 0.96 },
    accent: "#4b5c34",
    unlockLevel: 9,
    threads: 0,
  },
  {
    id: "pluie",
    name: "Cape de pluie",
    emoji: "🧥",
    description: "Imperméable intégral. Indispensable pendant la saison des pluies.",
    modifiers: { stealth: 0.9, resilience: 1.4, stamina: 0.95, speed: 0.94 },
    accent: "#2f5d6b",
    unlockLevel: 14,
    threads: 0,
  },
  {
    id: "canicule",
    name: "Tenue tropicale",
    emoji: "🩳",
    description: "Séchage rapide, respiration maximale : parfaite en plein soleil.",
    modifiers: { stealth: 0.85, resilience: 0.85, stamina: 1.3, speed: 1.08 },
    accent: "#d08a4a",
    unlockLevel: 21,
    threads: 0,
  },
  {
    id: "nuit",
    name: "Tenue de nuit",
    emoji: "🌑",
    description: "Tissu mat anti-reflet, coutures invisibles. Pour observer sans être vu.",
    modifiers: { stealth: 1.5, resilience: 0.95, stamina: 0.9, speed: 1 },
    accent: "#3a3f5c",
    unlockLevel: 30,
    threads: 0,
  },
  {
    id: "fee-etoiles",
    name: "Fée des étoiles",
    emoji: "🌟",
    description:
      "Tissée de huit fils. Le tissu retient l'air : maintenez ESPACE pour planer par-dessus les charges.",
    modifiers: { stealth: 1.15, resilience: 1.1, stamina: 1.35, speed: 1.05 },
    accent: "#9fdcff",
    unlockLevel: 1,
    threads: 8,
    power: "glide",
  },
  {
    id: "nenuphar",
    name: "Nénuphar",
    emoji: "🪷",
    description:
      "Douze fils, et l'eau devient une surface. On traverse l'Ivindo sans nager, sans bruit.",
    modifiers: { stealth: 1.2, resilience: 1.25, stamina: 1.15, speed: 1.02 },
    accent: "#7fe0c6",
    unlockLevel: 1,
    threads: 12,
    power: "water",
  },
  {
    id: "murmure",
    name: "Murmure des bêtes",
    emoji: "🐾",
    description:
      "Seize fils. Les bêtes cessent de fuir : elles vous suivent à distance, comme un troupeau qui vous adopte.",
    modifiers: { stealth: 1.45, resilience: 1.1, stamina: 1.1, speed: 1.04 },
    accent: "#d8c58f",
    unlockLevel: 1,
    threads: 16,
    power: "tame",
  },
  {
    id: "purificatrice",
    name: "Purificatrice",
    emoji: "🕊️",
    description:
      "Vingt fils. Les prédateurs sentent autre chose que de la peur : ils renoncent à la charge.",
    modifiers: { stealth: 1.3, resilience: 1.3, stamina: 1.2, speed: 1 },
    accent: "#f0e7d0",
    unlockLevel: 1,
    threads: 20,
    power: "calm",
  },
];

export const MAGIC_OUTFITS = ["fee-etoiles", "nenuphar", "murmure", "purificatrice"];

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
