/**
 * Génération de la forêt — module pur.
 *
 * Le placement est déterministe (graine fixe) : la même forêt repousse à
 * chaque chargement, ce qui évite les « pop » entre deux visites et permet de
 * mettre en cache des repères de navigation.
 *
 * Trois strates sont produites :
 *   1. canopée  — grands arbres, houppiers hauts, cartes de feuillage ;
 *   2. sous-bois — balisiers, buissons, jeunes plants ;
 *   3. sol       — fougères, litière, troncs tombés.
 *
 * La densité suit les zones (levels.ts) : les bais et les marais sont ouverts,
 * la forêt profonde est un mur de vert.
 */

import { ZONES } from "./levels";
import { terrainHeight, slopeAt, shoreDistance, WORLD_LIMIT } from "./terrain";

/**
 * Strates : émergents (au-dessus de la canopée), arbres moyens, jeunes arbres
 * sous la canopée, et arbustes de sous-bois qui bouchent la vue à hauteur
 * d'homme — sans eux, on voit le ciel entre les troncs.
 */
export type TreeKind = "emergent" | "mid" | "understory" | "sapling";

export interface Tree {
  x: number;
  z: number;
  y: number;
  /** Hauteur du fût, en unités. */
  trunkHeight: number;
  /** Rayon du fût à la base. */
  trunkRadius: number;
  kind: TreeKind;
  /** Échelle des cartes de feuillage. */
  crownScale: number;
  rotation: number;
  /** Teinte : index dans FOLIAGE_TINTS. */
  tint: number;
  /** Légère inclinaison (arbres penchés vers la lumière). */
  lean: [number, number];
  /** Charpentières : sans elles, le houppier flotte au-dessus d'un mât nu. */
  branches?: Branch[];
}

export interface Branch {
  /** Hauteur d'insertion sur le fût, en unités. */
  y: number;
  /** Azimut, en radians. */
  angle: number;
  /** Longueur de la branche. */
  length: number;
  /** Inclinaison vers le haut (0 = horizontale). */
  rise: number;
  /** Rayon à la base. */
  radius: number;
}

export interface UnderstoryPlant {
  x: number;
  z: number;
  y: number;
  scale: number;
  rotation: number;
  /** 0 = fougère, 1 = balisier, 2 = buisson, 3 = couvre-sol, 4 = herbe. */
  variant: 0 | 1 | 2 | 3 | 4;
}

export interface FallenLog {
  x: number;
  z: number;
  y: number;
  length: number;
  radius: number;
  rotation: number;
  tilt: number;
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Densité de végétation en un point, 0-1.
 * Les clairières (baï) et les marais restent ouverts, la forêt de terre ferme
 * est saturée.
 */
export function densityAt(x: number, z: number): number {
  let density = 0.85;
  for (const zone of ZONES) {
    const distance = Math.hypot(x - zone.center[0], z - zone.center[1]);
    if (distance > zone.radius) continue;
    const influence = 1 - distance / zone.radius;
    const target =
      zone.biome === "clairiere"
        ? 0.14
        : zone.biome === "marais"
          ? 0.35
          : zone.biome === "camp"
            ? 0.3
            : zone.biome === "canopee"
              ? 0.25
              : zone.density;
    density = density * (1 - influence) + target * influence;
  }
  // Bords du monde : on referme la forêt pour masquer l'horizon.
  const edge = Math.max(Math.abs(x), Math.abs(z)) / WORLD_LIMIT;
  if (edge > 0.72) density = Math.min(1, density + (edge - 0.72) * 2.4);
  return Math.max(0, Math.min(1, density));
}

/** Bruit de valeur tuilable et déterministe (aucune allocation par appel). */
function hash2(ix: number, iz: number, seed: number): number {
  let h = seed ^ Math.imul(ix, 0x27d4eb2d) ^ Math.imul(iz, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function valueNoise2(x: number, z: number, scale: number, seed: number): number {
  const fx = x / scale;
  const fz = z / scale;
  const ix = Math.floor(fx);
  const iz = Math.floor(fz);
  const tx = fx - ix;
  const tz = fz - iz;
  const sx = tx * tx * (3 - 2 * tx);
  const sz = tz * tz * (3 - 2 * tz);
  const a = hash2(ix, iz, seed);
  const b = hash2(ix + 1, iz, seed);
  const c = hash2(ix, iz + 1, seed);
  const d = hash2(ix + 1, iz + 1, seed);
  return (a + (b - a) * sx) * (1 - sz) + (c + (d - c) * sx) * sz;
}

/**
 * Chablis : proportion de canopée arrachée par une chute d'arbre, 0-1.
 * Ces trouées sont ce qui donne son rythme à une vraie forêt : sans elles, la
 * futaie est un mur régulier et l'on ne voit jamais un rayon de soleil.
 */
export function gapAt(x: number, z: number): number {
  const n =
    valueNoise2(x, z, 46, 7717) * 0.6 +
    valueNoise2(x, z, 19, 1313) * 0.3 +
    valueNoise2(x, z, 7, 505) * 0.1;
  // Seules les valeurs hautes ouvrent une trouée : elles sont assez rares.
  return Math.max(0, Math.min(1, (n - 0.58) * 3.6));
}

function acceptPoint(
  x: number,
  z: number,
  rand: () => number,
  options: { minShore: number; maxSlope: number },
): boolean {
  if (Math.abs(x) > WORLD_LIMIT || Math.abs(z) > WORLD_LIMIT) return false;
  if (shoreDistance(x, z) < options.minShore) return false;
  if (slopeAt(x, z) > options.maxSlope) return false;
  return rand() < densityAt(x, z);
}

/** Grille d'occupation pour éviter que deux arbres partagent le même point. */
class Occupancy {
  private cells = new Map<string, number[]>();

  constructor(private cell = 6) {}

  private key(x: number, z: number): string {
    return `${Math.floor(x / this.cell)}:${Math.floor(z / this.cell)}`;
  }

  tryAdd(x: number, z: number, radius: number): boolean {
    const cx = Math.floor(x / this.cell);
    const cz = Math.floor(z / this.cell);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const bucket = this.cells.get(`${cx + dx}:${cz + dz}`);
        if (!bucket) continue;
        for (let i = 0; i < bucket.length; i += 3) {
          const ox = bucket[i];
          const oz = bucket[i + 1];
          const or = bucket[i + 2];
          if (Math.hypot(x - ox, z - oz) < radius + or) return false;
        }
      }
    }
    const key = this.key(x, z);
    const bucket = this.cells.get(key) ?? [];
    bucket.push(x, z, radius);
    this.cells.set(key, bucket);
    return true;
  }
}

export interface CrownCard {
  offset: [number, number, number];
  /** Échelle horizontale de la carte. */
  width: number;
  /** Échelle verticale de la carte. */
  height: number;
  /** Carte couchée à l'horizontale (vue du dessous). */
  horizontal: boolean;
  /** Rotation autour de l'axe vertical. */
  angle: number;
  /** Inclinaison aléatoire pour casser la régularité. */
  tilt: number;
  /**
   * Carte éparse (feuilles détachées). Les cartes de bord du houppier restent
   * trouées, sinon la couronne se lit comme une boule pleine.
   */
  sparse?: boolean;
}

export function crownCards(tree: Tree, random: () => number): CrownCard[] {
  const { crownScale, trunkHeight, kind, rotation } = tree;
  const cards: CrownCard[] = [];

  if (kind === "sapling") {
    // Arbuste de sous-bois : houppier large et bas, du sol jusqu'à la cime.
    // C'est cette strate qui masque l'horizon à hauteur d'homme.
    const height = trunkHeight + crownScale * 0.6;
    for (let i = 0; i < 3; i++) {
      const a = rotation + i * 2.09;
      cards.push({
        offset: [
          Math.cos(a) * crownScale * 0.18,
          height * (0.4 + i * 0.2),
          Math.sin(a) * crownScale * 0.18,
        ],
        width: crownScale * 2.1,
        height: crownScale * 1.7,
        horizontal: false,
        angle: a,
        tilt: 0.26,
      });
    }
    cards.push({
      offset: [0, height * 0.9, 0],
      width: crownScale * 2.6,
      height: crownScale * 2.6,
      horizontal: true,
      angle: rotation + random() * Math.PI,
      tilt: 0.24,
    });
    return cards;
  }

  if (kind === "understory") {
    // Jeunes arbres : houppier bas mais étalé, en quatre bouquets.
    const base = trunkHeight * 0.68;
    for (let i = 0; i < 4; i++) {
      const a = rotation + (i * Math.PI) / 2 + random() * 0.5;
      const r = crownScale * (0.18 + random() * 0.3);
      cards.push({
        offset: [Math.cos(a) * r, base + crownScale * (0.2 + random() * 0.9), Math.sin(a) * r],
        width: crownScale * (1.7 + random() * 0.7),
        height: crownScale * (1.4 + random() * 0.6),
        horizontal: false,
        angle: a,
        tilt: 0.3,
      });
    }
    cards.push({
      offset: [0, trunkHeight + crownScale * 0.45, 0],
      width: crownScale * 2.7,
      height: crownScale * 2.7,
      horizontal: true,
      angle: rotation + random() * Math.PI,
      tilt: 0.14,
    });
    return cards;
  }

  // --- arbres de canopée : nuage de bouquets dans un ellipsoïde
  // Peu de grandes cartes donnent des « autocollants » ; beaucoup de petites
  // cartes réparties en volume se lisent comme une masse de feuilles.
  const clumps = kind === "emergent" ? 11 : 9;
  const crownBase = trunkHeight * 0.55;
  const crownHeight = trunkHeight * 0.55 + crownScale * 0.55;
  const spread = crownScale * 0.62;

  for (let i = 0; i < clumps; i++) {
    const a = rotation + i * 2.39996 + random() * 0.7; // angle d'or : pas d'alignement
    // Répartition en anneaux : les bouquets du centre sont plus haut.
    const radius = spread * Math.sqrt(random()) * (0.35 + 0.65 * (i / clumps));
    const y = crownBase + crownHeight * (0.12 + 0.88 * Math.pow(random(), 0.75));
    const size = crownScale * (0.85 + random() * 0.75);
    cards.push({
      offset: [Math.cos(a) * radius, y, Math.sin(a) * radius],
      width: size * 1.55,
      height: size * 1.15,
      horizontal: false,
      angle: a + (random() - 0.5) * 0.8,
      tilt: 0.42,
      // Les bouquets extérieurs sont épars : le ciel passe entre les feuilles.
      sparse: radius > spread * 0.42 && random() < 0.7,
    });
  }

  // Toit : deux nappes couchées au sommet, elles bouchent la vue du ciel.
  for (let i = 0; i < (kind === "emergent" ? 2 : 1); i++) {
    cards.push({
      offset: [
        (random() - 0.5) * spread * 0.6,
        trunkHeight + crownScale * (0.35 + random() * 0.3),
        (random() - 0.5) * spread * 0.6,
      ],
      width: crownScale * (2.2 + random() * 0.6),
      height: crownScale * (2.2 + random() * 0.6),
      horizontal: true,
      angle: rotation + random() * Math.PI,
      tilt: 0.12,
    });
  }

  return cards;
}

/** Statistiques utiles au HUD et aux tests. */
export function forestStats(trees: Tree[]): {
  total: number;
  emergent: number;
  mid: number;
  understory: number;
  coverage: number;
} {
  const emergent = trees.filter((t) => t.kind === "emergent").length;
  const mid = trees.filter((t) => t.kind === "mid").length;
  const understory = trees.filter((t) => t.kind === "understory").length;
  const area = Math.PI * WORLD_LIMIT * WORLD_LIMIT;
  const canopyArea = trees.reduce(
    (sum, t) => sum + Math.PI * (t.crownScale * 0.75) ** 2,
    0,
  );

  return {
    total: trees.length,
    emergent,
    mid,
    understory,
    coverage: Math.min(9.9, canopyArea / area),
  };
}

/* ------------------------------------------------------------------ */
/* Découpage en tuiles                                                 */
/* ------------------------------------------------------------------ */

/**
 * La forêt est générée tuile par tuile autour du joueur.
 *
 * Une génération unique couvrant toute la carte diluait la végétation : à
 * 4 200 arbres sur 520 × 520 unités, l'espacement moyen atteignait 8 unités
 * et l'on voyait le sol nu partout. En ne générant que les tuiles proches
 * (rayon utile avant le brouillard), on peut viser une vraie densité de forêt
 * de terre ferme pour un coût de rendu constant.
 */
export const TILE_SIZE = 48;

export function tileSeed(tileX: number, tileZ: number, seed = 20261101): number {
  // Mélange des coordonnées : deux tuiles voisines ne partagent pas leur graine.
  let h = seed ^ Math.imul(tileX, 0x27d4eb2d) ^ Math.imul(tileZ, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

export function tileKey(tileX: number, tileZ: number): string {
  return `${tileX}:${tileZ}`;
}

/** Coordonnée de tuile contenant un point du monde. */
export function tileOf(x: number, z: number): [number, number] {
  return [Math.floor(x / TILE_SIZE), Math.floor(z / TILE_SIZE)];
}

/** Tuiles à charger pour couvrir un rayon autour du joueur. */
export function tilesAround(x: number, z: number, radius: number): [number, number][] {
  const [cx, cz] = tileOf(x, z);
  const out: [number, number][] = [];
  for (let dz = -radius; dz <= radius; dz++) {
    for (let dx = -radius; dx <= radius; dx++) {
      // On découpe le disque : les coins lointains sont hors du brouillard.
      if (Math.hypot(dx, dz) > radius + 0.35) continue;
      out.push([cx + dx, cz + dz]);
    }
  }
  return out;
}

export interface TileOptions {
  /** Densité d'arbres par unité carrée. */
  treeDensity?: number;
  /** Densité de plants de sous-bois par unité carrée. */
  understoryDensity?: number;
  /** Densité de troncs tombés par unité carrée. */
  logDensity?: number;
  /** Graine globale (monde). */
  seed?: number;
  /** Trouée de camp : aucun arbre ni plant dedans (le joueur doit pouvoir bouger). */
  clearing?: { x: number; z: number; radius: number };
}

export interface LitterPatch {
  x: number;
  y: number;
  z: number;
  scale: number;
  rotation: number;
  /** Teinte : 0 brun clair, 1 brun sombre, 2 olive. */
  tone: 0 | 1 | 2;
}

export interface Tile {
  trees: Tree[];
  understory: UnderstoryPlant[];
  logs: FallenLog[];
  /** Feuilles mortes à plat : le premier plan du sol. */
  litter: LitterPatch[];
}

/** Hauteur (en unités) d'un plant de sous-bois, à l'échelle 1. */
const PLANT_HEIGHT = [1.0, 1.7, 1.5, 0.4, 0.95] as const;
/** Largeur d'un plant par rapport à sa hauteur. */
const PLANT_WIDTH = [1.45, 1.2, 1.35, 1.4, 1.5] as const;

export interface PlantCard {
  x: number;
  y: number;
  z: number;
  width: number;
  height: number;
  angle: number;
  /** Vrai pour une carte couchée au sol (couvre-sol, litière). */
  flat: boolean;
  /** Pente du terrain sous la carte (dérivées en X et Z), pour la coucher. */
  slope?: [number, number];
}

/**
 * Cartes de feuillage d'un plant, posées au sol. Deux plans croisés pour les
 * plants en volume ; une seule grande carte à plat pour le couvre-sol, qui
 * tapisse alors la litière. Partagé par le jeu et le rendu d'aperçu.
 */
export function plantCards(plant: UnderstoryPlant): PlantCard[] {
  if (plant.variant === 3) {
    // Couvre-sol : dalle de feuillage posée sur la terre, très légèrement
    // inclinée pour éviter l'effet « autocollant » parfaitement plat.
    const size = 1.4 + plant.scale * 1.3;
    return [
      {
        x: plant.x,
        y: plant.y + 0.07 + plant.scale * 0.05,
        z: plant.z,
        width: size,
        height: size,
        angle: plant.rotation,
        flat: true,
        // Sans cette pente, une dalle de 3 m déborde ou s'enfonce sur les versants.
        slope: [
          (terrainHeight(plant.x + 0.7, plant.z) - terrainHeight(plant.x - 0.7, plant.z)) / 1.4,
          (terrainHeight(plant.x, plant.z + 0.7) - terrainHeight(plant.x, plant.z - 0.7)) / 1.4,
        ],
      },
    ];
  }

  const height = PLANT_HEIGHT[plant.variant] * plant.scale;
  const width = PLANT_WIDTH[plant.variant] * height;
  // L'herbe est plus haute que large : les deux plans croisés suffisent à la
  // lire comme une touffe, sans coûter une troisième carte.
  return [0, 1].map((k) => ({
    x: plant.x,
    // Le bas de la carte repose sur le terrain, avec un léger enfoncement.
    y: plant.y + height * 0.46,
    z: plant.z,
    width,
    height,
    angle: plant.rotation + k * (Math.PI / 2),
    flat: false,
  }));
}

export interface TileOptions {
  /** Densité d'arbres par unité carrée. */
  treeDensity?: number;
  /** Densité de plants de sous-bois par unité carrée. */
  understoryDensity?: number;
  /** Densité de troncs tombés par unité carrée. */
  logDensity?: number;
  /** Graine globale (monde). */
  seed?: number;
  /** Trouée de camp : aucun arbre ni plant dedans (le joueur doit pouvoir bouger). */
  clearing?: { x: number; z: number; radius: number };
}

/** Construit une tuile : arbres, sous-bois et troncs tombés. */
export function buildTile(tileX: number, tileZ: number, options: TileOptions = {}): Tile {
  const {
    treeDensity = 0.055,
    understoryDensity = 0.42,
    logDensity = 0.0025,
    seed = 20261101,
    clearing,
  } = options;

  const inClearing = (x: number, z: number, margin = 0) =>
    clearing ? Math.hypot(x - clearing.x, z - clearing.z) < clearing.radius + margin : false;

  const rand = mulberry32(tileSeed(tileX, tileZ, seed));
  const originX = tileX * TILE_SIZE;
  const originZ = tileZ * TILE_SIZE;
  const area = TILE_SIZE * TILE_SIZE;

  const trees: Tree[] = [];
  const occupancy = new Occupancy(6);

  // --- arbres : on tire plus de candidats que nécessaire, la densité de zone
  // filtre ensuite (baïs et marais restent ouverts).
  const treeAttempts = Math.round(area * treeDensity * 2.6);
  for (let i = 0; i < treeAttempts; i++) {
    const x = originX + rand() * TILE_SIZE;
    const z = originZ + rand() * TILE_SIZE;
    if (inClearing(x, z, 4)) continue;
    // Un chablis éclaircit la futaie : arbres abattus, lumière au sol.
    if (rand() < gapAt(x, z) * 1.15) continue;
    if (!acceptPoint(x, z, rand, { minShore: 3, maxSlope: 0.6 })) continue;

    const roll = rand();
    const kind: TreeKind =
      roll < 0.08 ? "emergent" : roll < 0.34 ? "mid" : roll < 0.7 ? "understory" : "sapling";
    const trunkRadius =
      kind === "emergent"
        ? 0.6 + rand() * 0.5
        : kind === "mid"
          ? 0.3 + rand() * 0.28
          : kind === "understory"
            ? 0.12 + rand() * 0.16
            : 0.06 + rand() * 0.08;
    const footprint = trunkRadius * 2.6 + 1.1;
    if (!occupancy.tryAdd(x, z, footprint)) continue;

    const y = terrainHeight(x, z);
    const trunkHeight =
      kind === "emergent"
        ? 22 + rand() * 10
        : kind === "mid"
          ? 11 + rand() * 8
          : kind === "understory"
            ? 6 + rand() * 6
            : 2.2 + rand() * 3.2;
    const crownScale =
      kind === "emergent"
        ? 8 + rand() * 4
        : kind === "mid"
          ? 6 + rand() * 3
          : kind === "understory"
            ? 2.6 + rand() * 1.6
            : 0.85 + rand() * 0.75;

    // Charpentières : deux à quatre, insérées dans la moitié haute du fût.
    const branches: Branch[] = [];
    if (kind === "emergent" || kind === "mid") {
      const count = kind === "emergent" ? 4 : 3;
      for (let b = 0; b < count; b++) {
        branches.push({
          y: trunkHeight * (0.55 + (b / count) * 0.4) + rand() * 1.5,
          angle: rand() * Math.PI * 2,
          length: crownScale * (0.6 + rand() * 0.55),
          rise: 0.25 + rand() * 0.5,
          radius: trunkRadius * (0.28 + rand() * 0.26),
        });
      }
    } else if (kind === "understory") {
      for (let b = 0; b < 2; b++) {
        branches.push({
          y: trunkHeight * (0.5 + b * 0.25) + rand(),
          angle: rand() * Math.PI * 2,
          length: crownScale * (0.7 + rand() * 0.5),
          rise: 0.3 + rand() * 0.5,
          radius: trunkRadius * (0.35 + rand() * 0.2),
        });
      }
    }

    trees.push({
      x,
      z,
      y,
      trunkHeight,
      trunkRadius,
      kind,
      crownScale,
      branches,
      rotation: rand() * Math.PI * 2,
      tint: Math.floor(rand() * 6),
      lean: [(rand() - 0.5) * 0.1, (rand() - 0.5) * 0.1],
    });
  }

  // --- sous-bois
  const understory: UnderstoryPlant[] = [];
  const plantAttempts = Math.round(area * understoryDensity * 1.8);
  for (let i = 0; i < plantAttempts; i++) {
    const x = originX + rand() * TILE_SIZE;
    const z = originZ + rand() * TILE_SIZE;
    if (shoreDistance(x, z) < 0.8) continue;
    if (slopeAt(x, z) > 0.95) continue;
    if (rand() > densityAt(x, z) * 1.15) continue;

    // Dans la trouée du camp, seules les herbes basses poussent : le sol reste
    // praticable, mais il n'est jamais nu.
    const roll = rand();
    // Milieu ouvert (baï, berge, trouée) : herbe et couvre-sol. Sous couvert
    // fermé : fougères, balisiers, buissons.
    const gap = gapAt(x, z);
    const density = densityAt(x, z);
    // Herbe : seulement les milieux vraiment ouverts (baï, berges). Dans la
    // trouée du camp on garde des fougères basses, pas une savane.
    const open = density < 0.24 || gap > 0.72;
    const variant: 0 | 1 | 2 | 3 | 4 = open
      ? roll < 0.7
        ? 4
        : roll < 0.92
          ? 3
          : 0
      : roll < 0.6
        ? 3
        : roll < 0.84
          ? 0
          : roll < 0.95
            ? 1
            : 2;
    understory.push({
      x,
      z,
      y: terrainHeight(x, z),
      scale:
        variant === 3
          ? 0.35 + rand() * 0.85
          : variant === 4
            ? 0.5 + rand() * 0.55
            : variant === 1
              ? 0.7 + rand() * 0.5
              : variant === 2
                ? 0.7 + rand() * 0.6
                : 0.6 + rand() * 1.0,
      rotation: rand() * Math.PI * 2,
      variant,
    });
  }

  // --- litière : feuilles mortes posées à plat, ce que la texture de sol ne
  // peut pas donner (relief, accroche de lumière au premier plan).
  const litter: LitterPatch[] = [];
  const litterCount = Math.round(area * 0.11);
  for (let i = 0; i < litterCount; i++) {
    const x = originX + rand() * TILE_SIZE;
    const z = originZ + rand() * TILE_SIZE;
    const roll = rand();
    litter.push({
      x,
      z,
      y: terrainHeight(x, z) + 0.045 + rand() * 0.03,
      scale: 0.35 + Math.pow(rand(), 1.6) * 1.15,
      rotation: rand() * Math.PI * 2,
      tone: roll < 0.42 ? 0 : roll < 0.78 ? 1 : 2,
    });
  }

  // --- troncs tombés
  const logs: FallenLog[] = [];
  const logAttempts = Math.max(1, Math.round(area * logDensity * 3));
  for (let i = 0; i < logAttempts; i++) {
    const x = originX + rand() * TILE_SIZE;
    const z = originZ + rand() * TILE_SIZE;
    if (inClearing(x, z)) continue;
    if (shoreDistance(x, z) < 2) continue;
    if (rand() > densityAt(x, z)) continue;
    logs.push({
      x,
      z,
      y: terrainHeight(x, z) + 0.25,
      length: 3 + rand() * 9,
      radius: 0.18 + rand() * 0.4,
      rotation: rand() * Math.PI * 2,
      tilt: (rand() - 0.5) * 0.25,
    });
  }

  return { trees, understory, logs, litter };
}
