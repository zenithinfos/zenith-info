/**
 * Personnages jouables et PNJ.
 * Modèles glTF chargés depuis /models (Michelle.glb, Soldier.glb).
 */

export type CharacterId = "michelle" | "soldier" | "guide" | "chercheuse";

export interface CharacterStats {
  /** Vitesse de marche (unités/s). */
  walkSpeed: number;
  /** Vitesse de course (unités/s). */
  runSpeed: number;
  /** Endurance : secondes de course avant épuisement. */
  stamina: number;
  /** Discrétion : réduit le rayon de détection de la faune (0-1). */
  stealth: number;
  /** Résistance à l'humidité : ralentit la perte de santé. */
  resilience: number;
  /** Charge maximale d'inventaire (emplacements). */
  carry: number;
}

export interface Character {
  id: CharacterId;
  name: string;
  role: string;
  model: string;
  scale: number;
  bio: string;
  stats: CharacterStats;
  /** Animations disponibles dans le glTF. */
  clips: string[];
  unlockedByDefault: boolean;
}

export const CHARACTERS: Character[] = [
  {
    id: "michelle",
    name: "Michelle",
    role: "Garde du parc",
    model: "/models/Michelle.glb",
    scale: 1,
    bio: "Écogarde formée à Makokou. Connaît chaque sentier de Minkébé et lit les traces mieux qu'un GPS.",
    stats: {
      walkSpeed: 1.6,
      runSpeed: 4.4,
      stamina: 34,
      stealth: 0.72,
      resilience: 0.6,
      carry: 8,
    },
    clips: ["Idle", "Walk", "Run", "Sneak", "Swim"],
    unlockedByDefault: true,
  },
  {
    id: "soldier",
    name: "Le Soldat",
    role: "Éclaireur",
    model: "/models/Soldier.glb",
    scale: 1,
    bio: "Ancien guide de brousse devenu éclaireur. Plus lourd, plus rapide dans les rivières, moins discret.",
    stats: {
      walkSpeed: 1.75,
      runSpeed: 5.1,
      stamina: 28,
      stealth: 0.45,
      resilience: 0.82,
      carry: 10,
    },
    clips: ["Idle", "Walk", "Run", "Run_Back", "Climb"],
    unlockedByDefault: true,
  },
  {
    id: "guide",
    name: "Nkoul",
    role: "Pisteur",
    model: "/models/Soldier.glb",
    scale: 0.97,
    bio: "Pisteur de la communauté de Minkébé. Repère les éléphants à trois cents pas et déjoue les ruses des braconniers.",
    stats: {
      walkSpeed: 1.55,
      runSpeed: 4.1,
      stamina: 32,
      stealth: 0.9,
      resilience: 0.55,
      carry: 7,
    },
    clips: ["Idle", "Walk", "Run", "Sneak"],
    unlockedByDefault: false,
  },
  {
    id: "chercheuse",
    name: "Dr. Owori",
    role: "Chercheuse",
    model: "/models/Michelle.glb",
    scale: 0.95,
    bio: "Éthologue. Ses pièges photographiques ont documenté 47 espèces de mammifères dans la réserve.",
    stats: {
      walkSpeed: 1.5,
      runSpeed: 3.9,
      stamina: 30,
      stealth: 0.68,
      resilience: 0.5,
      carry: 9,
    },
    clips: ["Idle", "Walk", "Run", "Sneak"],
    unlockedByDefault: false,
  },
];

export function getCharacter(id: CharacterId): Character {
  return CHARACTERS.find((c) => c.id === id) ?? CHARACTERS[0];
}

export function defaultCharacter(): Character {
  return CHARACTERS[0];
}

/** Vitesse courante selon le mode de déplacement. */
export function speedFor(character: Character, mode: "walk" | "run" | "sneak"): number {
  switch (mode) {
    case "run":
      return character.stats.runSpeed;
    case "sneak":
      return character.stats.walkSpeed * 0.55;
    default:
      return character.stats.walkSpeed;
  }
}
