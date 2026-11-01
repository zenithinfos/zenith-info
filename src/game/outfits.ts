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
  },
  {
    id: "ecogarde",
    name: "Uniforme d'écogarde",
    emoji: "🪖",
    description: "Vert olive renforcé, radio à l'épaule. Inspecte les zones protégées plus vite.",
    modifiers: { stealth: 0.95, resilience: 1.2, stamina: 1.1, speed: 0.98 },
    accent: "#5d7a3f",
    unlockLevel: 2,
  },
  {
    id: "pisteur",
    name: "Tenue de pisteur",
    emoji: "🍃",
    description: "Fibres naturelles teintées à la boue : la meilleure discrétion de la réserve.",
    modifiers: { stealth: 1.35, resilience: 0.9, stamina: 1.05, speed: 0.96 },
    accent: "#4b5c34",
    unlockLevel: 3,
  },
  {
    id: "pluie",
    name: "Cape de pluie",
    emoji: "🧥",
    description: "Imperméable intégral. Indispensable pendant la saison des pluies.",
    modifiers: { stealth: 0.9, resilience: 1.4, stamina: 0.95, speed: 0.94 },
    accent: "#2f5d6b",
    unlockLevel: 3,
  },
  {
    id: "canicule",
    name: "Tenue tropicale",
    emoji: "🩳",
    description: "Séchage rapide, respiration maximale : parfaite en plein soleil.",
    modifiers: { stealth: 0.85, resilience: 0.85, stamina: 1.3, speed: 1.08 },
    accent: "#d08a4a",
    unlockLevel: 4,
  },
  {
    id: "nuit",
    name: "Tenue de nuit",
    emoji: "🌑",
    description: "Tissu mat anti-reflet, coutures invisibles. Pour observer sans être vu.",
    modifiers: { stealth: 1.5, resilience: 0.95, stamina: 0.9, speed: 1 },
    accent: "#3a3f5c",
    unlockLevel: 5,
  },
];

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
