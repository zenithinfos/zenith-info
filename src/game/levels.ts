/**
 * Zones de la réserve de Minkébé. Chaque zone décrit son biome, son ambiance
 * sonore, la météo dominante et les espèces qu'on peut y croiser.
 */

export type Biome =
  | "foret-dense"
  | "clairiere"
  | "marais"
  | "riviere"
  | "colline"
  | "canopee"
  | "sentier"
  | "camp";

export interface Zone {
  id: string;
  name: string;
  biome: Biome;
  /** Description affichée dans le carnet de terrain. */
  description: string;
  /** Coordonnées du centre de la zone dans le monde. */
  center: [number, number];
  radius: number;
  /** Ambiance sonore dominante. */
  ambience: "foret" | "eau" | "vent" | "camp" | "pluie";
  difficulty: 1 | 2 | 3 | 4 | 5;
  /** Densité de végétation instanciée (0-1). */
  density: number;
  /** Brouillard : plus la valeur est haute, plus on voit loin. */
  visibility: number;
  species: string[];
  unlockedByDefault: boolean;
}

export const ZONES: Zone[] = [
  {
    id: "camp",
    name: "Camp de base",
    biome: "camp",
    description:
      "Quelques tentes, une table de tri et un groupe électrogène. Le point de départ de toute expédition.",
    center: [0, 0],
    radius: 28,
    ambience: "camp",
    difficulty: 1,
    density: 0.08,
    visibility: 90,
    species: ["calao", "papillon"],
    unlockedByDefault: true,
  },
  {
    id: "sentier",
    name: "Sentier des pisteurs",
    biome: "sentier",
    description:
      "Une piste de latérite rouge ouverte par les communautés. Les traces d'éléphants y sont fréquentes.",
    center: [60, 30],
    radius: 45,
    ambience: "foret",
    difficulty: 1,
    density: 0.35,
    visibility: 70,
    species: ["hingebe", "calao", "papillon", "chimpanze"],
    unlockedByDefault: true,
  },
  {
    id: "foret-profonde",
    name: "Forêt profonde",
    biome: "foret-dense",
    description:
      "Sous-bois sombre, racines hautes, silence épais. On y entend surtout ses propres pas.",
    center: [130, 90],
    radius: 90,
    ambience: "foret",
    difficulty: 3,
    density: 0.92,
    visibility: 32,
    species: ["gorille", "chimpanze", "bongo", "panthere", "hingebe", "elephant"],
    unlockedByDefault: false,
  },
  {
    id: "clairiere",
    name: "Baï de la clairière",
    biome: "clairiere",
    description:
      "Une trouée marécageuse où la forêt s'ouvre. Au crépuscule, les éléphants viennent y boire.",
    center: [45, 160],
    radius: 60,
    ambience: "eau",
    difficulty: 2,
    density: 0.2,
    visibility: 120,
    species: ["elephant", "sitatunga", "perroquet-gris", "papillon", "calao"],
    unlockedByDefault: false,
  },
  {
    id: "riviere",
    name: "Rivière Ivindo",
    biome: "riviere",
    description:
      "Eau noire et lente, galets glissants. Le courant porte les sons à des kilomètres.",
    center: [-90, 110],
    radius: 70,
    ambience: "eau",
    difficulty: 3,
    density: 0.3,
    visibility: 80,
    species: ["poisson-electrique", "crocodile", "elephant", "sitatunga", "panthere"],
    unlockedByDefault: false,
  },
  {
    id: "marais",
    name: "Marais aux papyrus",
    biome: "marais",
    description:
      "Une tourbière à perte de vue. Chaque pas peut être le dernier : testez le sol avant de poser le pied.",
    center: [-40, 210],
    radius: 50,
    ambience: "eau",
    difficulty: 4,
    density: 0.45,
    visibility: 55,
    species: ["sitatunga", "crocodile", "poisson-electrique", "papillon"],
    unlockedByDefault: false,
  },
  {
    id: "colline",
    name: "Colline aux inselbergs",
    biome: "colline",
    description:
      "Des dômes de granit émergent de la canopée. Le seul endroit d'où l'on voit la forêt jusqu'à l'horizon.",
    center: [180, 200],
    radius: 55,
    ambience: "vent",
    difficulty: 2,
    density: 0.4,
    visibility: 150,
    species: ["bongo", "gorille", "panthere", "hingebe", "calao"],
    unlockedByDefault: false,
  },
  {
    id: "canopee",
    name: "Passerelle de canopée",
    biome: "canopee",
    description:
      "Ponts de corde suspendus à quarante mètres. Le domaine des perroquets et des calaos.",
    center: [110, -80],
    radius: 40,
    ambience: "vent",
    difficulty: 5,
    density: 0.15,
    visibility: 140,
    species: ["perroquet-gris", "calao", "chimpanze", "papillon"],
    unlockedByDefault: false,
  },
];

export function getZone(id: string): Zone | undefined {
  return ZONES.find((z) => z.id === id);
}

/** Zone contenant un point du monde (le camp sert de repli). */
export function zoneAt(x: number, z: number): Zone {
  let best: Zone | undefined;
  let bestDistance = Infinity;
  for (const zone of ZONES) {
    const dx = x - zone.center[0];
    const dz = z - zone.center[1];
    const distance = Math.hypot(dx, dz);
    if (distance <= zone.radius && distance < bestDistance) {
      best = zone;
      bestDistance = distance;
    }
  }
  return best ?? ZONES[0];
}

export function unlockedZones(progress: string[]): Zone[] {
  return ZONES.filter((z) => z.unlockedByDefault || progress.includes(z.id));
}

export const DEFAULT_START = {
  position: [0, 0.1, 6] as [number, number, number],
  heading: Math.PI,
  zone: "camp",
};

export function levelSummary(): { id: string; name: string; difficulty: number }[] {
  return ZONES.map((z) => ({ id: z.id, name: z.name, difficulty: z.difficulty }));
}
