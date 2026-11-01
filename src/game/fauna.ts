/**
 * Faune de Minkébé. Chaque espèce décrit son comportement, sa rareté et les
 * conditions d'observation (heure, météo, zone).
 */

export type Activity = "diurne" | "nocturne" | "crépusculaire";
export type Rarity = "commun" | "peu commun" | "rare" | "emblématique";
export type FaunaBehavior = "paisible" | "méfiant" | "curieux" | "agressif";

export interface Species {
  id: string;
  name: string;
  scientific: string;
  emoji: string;
  rarity: Rarity;
  activity: Activity;
  behavior: FaunaBehavior;
  /** Zones (voir levels.ts) où l'espèce apparaît. */
  habitats: string[];
  /** Rayon de détection du joueur, en unités. */
  detectionRadius: number;
  /** Vitesse de fuite / approche. */
  speed: number;
  /** Points d'observation (carnet de terrain). */
  points: number;
  /** Probabilité de présence par zone visitée (0-1). */
  spawnChance: number;
  note: string;
}

export const SPECIES: Species[] = [
  {
    id: "elephant",
    name: "Éléphant de forêt",
    scientific: "Loxodonta cyclotis",
    emoji: "🐘",
    rarity: "emblématique",
    activity: "diurne",
    behavior: "méfiant",
    habitats: ["clairiere", "riviere", "foret-profonde"],
    detectionRadius: 34,
    speed: 3.2,
    points: 120,
    spawnChance: 0.22,
    note: "Les clairières de Minkébé (« bais ») sont des points de rencontre essentiels pour les éléphants.",
  },
  {
    id: "gorille",
    name: "Gorille des plaines de l'Ouest",
    scientific: "Gorilla gorilla gorilla",
    emoji: "🦍",
    rarity: "emblématique",
    activity: "diurne",
    behavior: "méfiant",
    habitats: ["foret-profonde", "colline"],
    detectionRadius: 26,
    speed: 2.4,
    points: 140,
    spawnChance: 0.15,
    note: "Ne jamais s'approcher d'un dos argenté : reculez lentement, sans regard direct.",
  },
  {
    id: "chimpanze",
    name: "Chimpanzé",
    scientific: "Pan troglodytes",
    emoji: "🐒",
    rarity: "rare",
    activity: "diurne",
    behavior: "curieux",
    habitats: ["foret-profonde", "canopee"],
    detectionRadius: 30,
    speed: 3.6,
    points: 100,
    spawnChance: 0.18,
    note: "Les cris de chimpanzés portent à plus d'un kilomètre dans la forêt.",
  },
  {
    id: "panthere",
    name: "Panthère",
    scientific: "Panthera pardus",
    emoji: "🐆",
    rarity: "rare",
    activity: "nocturne",
    behavior: "agressif",
    habitats: ["foret-profonde", "colline", "riviere"],
    detectionRadius: 24,
    speed: 5.4,
    points: 180,
    spawnChance: 0.07,
    note: "Discrète et nocturne : la caméra thermique aide, la lampe frontale suffit rarement.",
  },
  {
    id: "bongo",
    name: "Bongo",
    scientific: "Tragelaphus eurycerus",
    emoji: "🦌",
    rarity: "rare",
    activity: "crépusculaire",
    behavior: "méfiant",
    habitats: ["colline", "foret-profonde"],
    detectionRadius: 22,
    speed: 4.8,
    points: 90,
    spawnChance: 0.12,
    note: "Antilope rayée de rouge : le bongo est un indicateur de forêt intacte.",
  },
  {
    id: "sitatunga",
    name: "Sitatunga",
    scientific: "Tragelaphus spekii",
    emoji: "🦌",
    rarity: "peu commun",
    activity: "crépusculaire",
    behavior: "méfiant",
    habitats: ["marais", "riviere"],
    detectionRadius: 18,
    speed: 3.1,
    points: 70,
    spawnChance: 0.25,
    note: "Ses sabots écartés lui permettent de marcher sur la végétation flottante.",
  },
  {
    id: "perroquet-gris",
    name: "Perroquet jaco",
    scientific: "Psittacus erithacus",
    emoji: "🦜",
    rarity: "peu commun",
    activity: "diurne",
    behavior: "curieux",
    habitats: ["canopee", "clairiere"],
    detectionRadius: 20,
    speed: 2.0,
    points: 45,
    spawnChance: 0.4,
    note: "Espèce menacée par le trafic : chaque observation est une donnée précieuse.",
  },
  {
    id: "hingebe",
    name: "Céphalophe bleu",
    scientific: "Philantomba monticola",
    emoji: "🦌",
    rarity: "commun",
    activity: "diurne",
    behavior: "méfiant",
    habitats: ["foret-profonde", "sentier", "colline"],
    detectionRadius: 14,
    speed: 4.2,
    points: 20,
    spawnChance: 0.55,
    note: "Le « hingebe » est le mammifère le plus abondant de la réserve.",
  },
  {
    id: "potamochere",
    name: "Potamochère",
    scientific: "Potamochoerus porcus",
    emoji: "🐗",
    rarity: "peu commun",
    activity: "crépusculaire",
    behavior: "agressif",
    habitats: ["foret-profonde", "marais", "sentier", "riviere"],
    detectionRadius: 22,
    speed: 5.6,
    points: 55,
    spawnChance: 0.18,
    note: "Le « sanglier rouge » charge sans sommation quand on coupe sa ligne de fuite. Deux coups de défenses suffisent à vider un homme.",
  },
  {
    id: "crocodile",
    name: "Crocodile nain",
    scientific: "Osteolaemus tetraspis",
    emoji: "🐊",
    rarity: "peu commun",
    activity: "nocturne",
    behavior: "agressif",
    habitats: ["marais", "riviere"],
    detectionRadius: 16,
    speed: 2.6,
    points: 60,
    spawnChance: 0.2,
    note: "Restez sur la berge : l'eau trouble du Ivindo cache parfaitement les crocodiles.",
  },
  {
    id: "calao",
    name: "Calao à casque noir",
    scientific: "Ceratogymna atrata",
    emoji: "🦅",
    rarity: "commun",
    activity: "diurne",
    behavior: "paisible",
    habitats: ["canopee", "clairiere", "sentier"],
    detectionRadius: 12,
    speed: 3.0,
    points: 15,
    spawnChance: 0.6,
    note: "Grand disperseur de graines : il replante la forêt qu'il traverse.",
  },
  {
    id: "papillon",
    name: "Papillon charaxes",
    scientific: "Charaxes sp.",
    emoji: "🦋",
    rarity: "commun",
    activity: "diurne",
    behavior: "paisible",
    habitats: ["clairiere", "sentier", "marais"],
    detectionRadius: 6,
    speed: 2.2,
    points: 10,
    spawnChance: 0.75,
    note: "Plus de 400 espèces de papillons sont recensées dans le bassin du Congo.",
  },
  {
    id: "poisson-electrique",
    name: "Poisson-couteau",
    scientific: "Gymnarchus niloticus",
    emoji: "🐟",
    rarity: "peu commun",
    activity: "nocturne",
    behavior: "paisible",
    habitats: ["riviere"],
    detectionRadius: 8,
    speed: 1.8,
    points: 35,
    spawnChance: 0.3,
    note: "Il produit un champ électrique faible pour s'orienter dans l'eau noire.",
  },
];

export function getSpecies(id: string): Species | undefined {
  return SPECIES.find((s) => s.id === id);
}

export function isActiveAt(species: Species, hour: number): boolean {
  const h = ((hour % 24) + 24) % 24;
  switch (species.activity) {
    case "diurne":
      return h >= 7 && h < 18;
    case "nocturne":
      return h >= 20 || h < 5;
    default:
      return (h >= 5 && h < 8) || (h >= 17 && h < 20);
  }
}

export interface SpawnContext {
  zoneId: string;
  hour: number;
  weather: "sec" | "pluie" | "orage" | "brume";
  /** Niveau de bruit du joueur (0 = immobile). */
  noise: number;
  /** Graine déterministe pour des tests reproductibles. */
  seed?: number;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Tire les espèces présentes dans une zone à un instant donné. */
export function spawnFor(ctx: SpawnContext): Species[] {
  const random = mulberry32(ctx.seed ?? Math.floor(Math.random() * 2 ** 31));
  const weatherFactor =
    ctx.weather === "pluie" ? 1.15 : ctx.weather === "brume" ? 0.9 : 1;
  const noiseFactor = 1 - Math.min(0.6, ctx.noise * 0.1);

  return SPECIES.filter((species) => {
    if (!species.habitats.includes(ctx.zoneId)) return false;
    if (!isActiveAt(species, ctx.hour)) return false;
    const chance = species.spawnChance * weatherFactor * noiseFactor;
    return random() < chance;
  });
}

/** Réaction de l'animal à l'approche du joueur, en unités de distance. */
export function reaction(
  species: Species,
  distance: number,
  playerNoise: number,
): "ignore" | "observe" | "fuite" | "charge" {
  if (distance > species.detectionRadius) return "ignore";
  const alerted = distance < species.detectionRadius * (0.45 + playerNoise * 0.05);

  switch (species.behavior) {
    case "paisible":
      return alerted ? "fuite" : "observe";
    case "curieux":
      return alerted ? "observe" : "ignore";
    case "méfiant":
      return alerted ? "fuite" : "observe";
    case "agressif":
      return alerted ? "charge" : "observe";
  }
}

export function faunaScore(observed: string[]): number {
  const unique = new Set(observed);
  return SPECIES.filter((s) => unique.has(s.id)).reduce(
    (sum, s) => sum + s.points,
    0,
  );
}

export const FAUNA_BY_HABITAT: Record<string, Species[]> = SPECIES.reduce(
  (acc, species) => {
    for (const habitat of species.habitats) {
      (acc[habitat] ??= []).push(species);
    }
    return acc;
  },
  {} as Record<string, Species[]>,
);
