/**
 * Les fruits de la forêt.
 *
 * Les fruits n'existaient pas. L'engine en donnait un toutes les seize secondes
 * de marche, sans rien à cueillir : le compteur montait et le joueur ne voyait
 * jamais un seul fruit. Voilà des plantes.
 *
 * Quatre espèces d'understory de la forêt du bassin du Congo, choisies parce
 * qu'elles portent à hauteur de main — c'est ce qui rend la cueillette
 * possible sans grimper :
 *
 *   · **odika** (Irvingia gabonensis), le faux-manguier : drupes jaune-orangé,
 *     sucrées, en grappes lourdes ;
 *   · **safou** (Dacryodes edulis) : fruits ovales bleu-violet, presque noirs
 *     à maturité, très contrastés sur le vert ;
 *   · **landolphia** : liane à latex, fruits orangés ronds, brillants ;
 *   · **atanga** (Plukenetia conophora) : capsules vert olive, teintées de
 *     jaune quand elles mûrissent.
 *
 * Les couleurs ne sont pas décoratives : ce sont celles des fruits réels, et
 * c'est aussi ce qui les rend visibles dans un sous-bois vert. Un fruit de la
 * couleur des feuilles ne se trouve pas.
 *
 * Module pur : ni three, ni DOM. `scripts/check-forage.mjs` le fait tourner
 * sans navigateur.
 */

import { terrainHeight } from "./terrain";

export type FruitSpecies = "odika" | "safou" | "landolphia" | "atanga";

export interface FruitKind {
  id: FruitSpecies;
  /** Nom courant, celui qu'on dit en forêt. */
  name: string;
  /** Nom scientifique, affiché dans le journal de bord. */
  latin: string;
  /** Couleur du fruit mûr. */
  colour: string;
  /** Couleur du fruit encore vert, quand il y en a. */
  unripe: string;
  /** Rayon d'un fruit, en mètres. */
  radius: number;
  /** Hauteur des fruits sur la plante, en mètres. */
  height: number;
  /** Fruits mûrs à la cueillette. */
  load: [number, number];
  /** Forme : sphère, ovoïde, gousse. */
  shape: "ovale" | "sphere" | "grappe";
}

export const FRUIT_KINDS: Record<FruitSpecies, FruitKind> = {
  odika: {
    id: "odika",
    name: "Odika",
    latin: "Irvingia gabonensis",
    colour: "#d99a2b",
    unripe: "#7f8a3a",
    radius: 0.036,
    height: 1.24,
    load: [2, 4],
    shape: "ovale",
  },
  safou: {
    id: "safou",
    name: "Safou",
    latin: "Dacryodes edulis",
    colour: "#3b3a63",
    unripe: "#5d6b46",
    radius: 0.033,
    height: 1.42,
    load: [2, 4],
    shape: "ovale",
  },
  landolphia: {
    id: "landolphia",
    name: "Landolphia",
    latin: "Landolphia owariensis",
    colour: "#d9662a",
    unripe: "#6f7a3c",
    radius: 0.031,
    height: 1.1,
    load: [2, 3],
    shape: "sphere",
  },
  atanga: {
    id: "atanga",
    name: "Atanga",
    latin: "Plukenetia conophora",
    colour: "#c8b23c",
    unripe: "#6d7f38",
    radius: 0.028,
    height: 1.58,
    load: [3, 4],
    shape: "grappe",
  },
};

export const FRUIT_SPECIES = Object.keys(FRUIT_KINDS) as FruitSpecies[];

export interface FruitPlant {
  id: number;
  species: FruitSpecies;
  x: number;
  z: number;
  /** Hauteur du sol à cet endroit : le plant n'est pas à plat sur la pente. */
  y: number;
  /** Fruits mûrs encore sur la plante. */
  ripe: number;
  /** Secondes de repousse restantes ; 0 quand la plante est en fruits. */
  regrow: number;
  /** Orientation du plant, pour ne pas les aligner comme une haie. */
  turn: number;
  /** Décalage d'animation du feuillage. */
  phase: number;
}

/** Distance à laquelle on peut cueillir. Une plante s'atteint au corps. */
export const FORAGE_CONTACT = 1.6;
/** Un fruit par contact, puis il faut laisser la main revenir. */
export const FORAGE_COOLDOWN = 1.4;
/** Une plante cueillie repousse en deux minutes de jeu. */
export const FORAGE_REGROW = 120;
/** On ne porte pas plus de huit fruits. */
export const FRUIT_CAPACITY = 8;
/** Aucun plant à moins de six mètres du camp : on ne cueille pas sous son lit. */
export const FORAGE_MIN_DISTANCE = 6;
/** Combien de plants dans la forêt. */
export const FORAGE_COUNT = 46;

/** Générateur déterministe : la même graine donne la même forêt. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Répartit les plants en anneaux autour du camp.
 *
 * Les premiers sont **visibles depuis le sentier de départ** : un joueur qui
 * ne voit jamais un fruit conclut, à juste titre, qu'il n'y en a pas. Les
 * suivants s'espacent de plus en plus loin, jusqu'aux confins de la zone.
 */
export function spawnFruitPlants(
  seed: number,
  start: [number, number, number],
  count = FORAGE_COUNT,
): FruitPlant[] {
  const random = mulberry32(seed ^ 0x5f3759df);
  const plants: FruitPlant[] = [];
  let guard = 0;
  while (plants.length < count && guard < 6000) {
    guard += 1;
    // Trois plants sur quatre dans les quarante premiers mètres : c'est la
    // zone où l'on marche au début, celle où l'on apprend à cueillir.
    const near = plants.length < Math.ceil(count * 0.75);
    const distance = near ? 7 + random() * 34 : 45 + random() * 165;
    const angle = random() * Math.PI * 2;
    const x = Math.max(-240, Math.min(240, start[0] + Math.cos(angle) * distance));
    const z = Math.max(-240, Math.min(240, start[2] + Math.sin(angle) * distance));
    if (Math.hypot(x - start[0], z - start[2]) < FORAGE_MIN_DISTANCE) continue;
    // Deux plants ne se superposent pas.
    if (plants.some((other) => Math.hypot(other.x - x, other.z - z) < 9)) continue;

    const species = FRUIT_SPECIES[Math.floor(random() * FRUIT_SPECIES.length)];
    const kind = FRUIT_KINDS[species];
    const load = kind.load[0] + Math.floor(random() * (kind.load[1] - kind.load[0] + 1));
    plants.push({
      id: plants.length,
      species,
      x,
      z,
      y: terrainHeight(x, z),
      ripe: load,
      regrow: 0,
      turn: random() * Math.PI * 2,
      phase: random() * Math.PI * 2,
    });
  }
  return plants;
}

export interface ForagePick {
  plantId: number;
  species: FruitSpecies;
  /** Fruits restants sur la plante après la cueillette. */
  left: number;
}

export interface ForageStep {
  plants: FruitPlant[];
  picked: ForagePick[];
  /** Vrai si la poche est pleine : la plante reste chargée, on ne peut pas. */
  full: boolean;
}

/**
 * Fait vivre les plants une image.
 *
 * La cueillette se fait **au contact**, comme les Mewas : on s'approche d'une
 * branche chargée, la main part, le fruit est dans la poche. Pas de touche à
 * apprendre, pas de curseur à poser sur une baie de trois centimètres.
 *
 * Une plante vidée ne disparaît pas : elle reste là, nue, et repousse. Une
 * forêt où les plantes s'évaporent quand on les cueille est une forêt qui se
 * vide ; ici, la cueillette se renouvelle.
 */
export function stepForage(
  plants: FruitPlant[],
  player: { x: number; z: number },
  dt: number,
  carried: number,
  capacity = FRUIT_CAPACITY,
): ForageStep {
  const picked: ForagePick[] = [];
  let full = false;
  let changed = false;

  const next = plants.map((plant) => {
    let { ripe, regrow } = plant;

    // Repousse : la plante se recharge pendant qu'on s'éloigne.
    if (ripe <= 0 && regrow > 0) {
      regrow -= dt;
      if (regrow <= 0) {
        const kind = FRUIT_KINDS[plant.species];
        ripe = kind.load[0];
        regrow = 0;
      }
    }

    const distance = Math.hypot(player.x - plant.x, player.z - plant.z);
    if (distance < FORAGE_CONTACT && ripe > 0) {
      if (carried + picked.length >= capacity) {
        full = true;
      } else {
        ripe -= 1;
        picked.push({ plantId: plant.id, species: plant.species, left: ripe });
        if (ripe <= 0) regrow = FORAGE_REGROW;
      }
    }

    if (ripe === plant.ripe && regrow === plant.regrow) return plant;
    changed = true;
    return { ...plant, ripe, regrow };
  });

  // La forêt est immobile la plupart du temps : renvoyer le tableau d'origine
  // évite de recréer quarante-six objets soixante fois par seconde.
  return { plants: changed ? next : plants, picked, full };
}

/** Les plants qui portent encore des fruits, pour la carte et le rendu. */
export function ladenPlants(plants: FruitPlant[]): FruitPlant[] {
  return plants.filter((plant) => plant.ripe > 0);
}

/** Ce que la forêt offre, par espèce : pour le journal de bord. */
export function forageCensus(plants: FruitPlant[]): Record<FruitSpecies, number> {
  const census = { odika: 0, safou: 0, landolphia: 0, atanga: 0 };
  for (const plant of plants) census[plant.species] += plant.ripe;
  return census;
}
