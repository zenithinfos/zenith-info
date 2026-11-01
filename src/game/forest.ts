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

export type TreeKind = "emergent" | "mid" | "understory";

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
  /** Nombre de cartes de feuillage (3 = croix + plan horizontal). */
  crownCards: number;
  rotation: number;
  /** Teinte : index dans FOLIAGE_TINTS. */
  tint: number;
  /** Légère inclinaison (arbres penchés vers la lumière). */
  lean: [number, number];
}

export interface UnderstoryPlant {
  x: number;
  z: number;
  y: number;
  scale: number;
  rotation: number;
  /** 0 = fougère, 1 = balisier (grandes feuilles), 2 = buisson. */
  variant: 0 | 1 | 2;
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

export interface ForestOptions {
  treeCount: number;
  seed?: number;
  /** Rayon autour du joueur où l'on garde une trouée (spawn, camp). */
  clearingRadius?: number;
  /**
   * Rayon effectif de la forêt. Au-delà du brouillard (≈ 90 unités) la forêt
   * n'a plus besoin d'être détaillée : on concentre les arbres dans ce rayon.
   */
  radius?: number;
}

export function generateForest({
  treeCount,
  seed = 20261101,
  clearingRadius = 0,
  radius = WORLD_LIMIT,
}: ForestOptions): Tree[] {
  const rand = mulberry32(seed);
  const occupancy = new Occupancy(7);
  const trees: Tree[] = [];

  let attempts = 0;
  const maxAttempts = treeCount * 14;

  while (trees.length < treeCount && attempts < maxAttempts) {
    attempts++;
    // Tirage uniforme dans un carré couvrant toute la carte. Un tirage
    // circulaire laissait les quatre coins nus alors que la carte est carrée
    // (et la zone « colline » tombait hors du disque).
    const x = (rand() * 2 - 1) * radius;
    const z = (rand() * 2 - 1) * radius;

    const clearance = clearingRadius + 4;
    if (Math.hypot(x, z) < clearance) continue;
    if (!acceptPoint(x, z, rand, { minShore: 3.5, maxSlope: 0.55 })) continue;

    // Répartition des strates : émergents rares, arbres moyens, taillis.
    const roll = rand();
    const kind: TreeKind = roll < 0.14 ? "emergent" : roll < 0.62 ? "mid" : "understory";

    const trunkRadius = kind === "emergent" ? 0.55 + rand() * 0.5 : kind === "mid" ? 0.28 + rand() * 0.26 : 0.12 + rand() * 0.14;
    const footprint = trunkRadius * 3 + 1.4;
    if (!occupancy.tryAdd(x, z, footprint)) continue;

    const y = terrainHeight(x, z);
    const trunkHeight =
      kind === "emergent" ? 20 + rand() * 9 : kind === "mid" ? 10 + rand() * 7 : 5 + rand() * 5;

    const crownScale =
      kind === "emergent" ? 8.5 + rand() * 3.5 : kind === "mid" ? 5.6 + rand() * 2.8 : 2.4 + rand() * 1.4;

    trees.push({
      x,
      z,
      y,
      trunkHeight,
      trunkRadius,
      kind,
      crownScale,
      crownCards: kind === "understory" ? 2 : 3,
      rotation: rand() * Math.PI * 2,
      tint: Math.floor(rand() * 6),
      lean: [(rand() - 0.5) * 0.12, (rand() - 0.5) * 0.12],
    });
  }

  return trees;
}

export function generateUnderstory({
  count,
  seed = 4242,
  clearingRadius = 0,
  radius = WORLD_LIMIT,
}: {
  count: number;
  seed?: number;
  clearingRadius?: number;
  radius?: number;
}): UnderstoryPlant[] {
  const rand = mulberry32(seed);
  const plants: UnderstoryPlant[] = [];
  let attempts = 0;

  while (plants.length < count && attempts < count * 8) {
    attempts++;
    // Sous-bois : tirage resserré autour du joueur (c'est là qu'on le voit).
    const angle = rand() * Math.PI * 2;
    const distance = 1.5 + Math.pow(rand(), 0.7) * radius;
    const x = Math.cos(angle) * distance;
    const z = Math.sin(angle) * distance;
    if (Math.hypot(x, z) < clearingRadius) continue;
    if (!acceptPoint(x, z, rand, { minShore: 0.8, maxSlope: 0.8 })) continue;

    const roll = rand();
    plants.push({
      x,
      z,
      y: terrainHeight(x, z),
      scale: 0.45 + rand() * 1.15,
      rotation: rand() * Math.PI * 2,
      variant: roll < 0.45 ? 0 : roll < 0.78 ? 1 : 2,
    });
  }

  return plants;
}

export function generateLogs({
  count,
  seed = 909,
}: {
  count: number;
  seed?: number;
}): FallenLog[] {
  const rand = mulberry32(seed);
  const logs: FallenLog[] = [];
  let attempts = 0;

  while (logs.length < count && attempts < count * 10) {
    attempts++;
    const angle = rand() * Math.PI * 2;
    const distance = 5 + Math.sqrt(rand()) * 120;
    const x = Math.cos(angle) * distance;
    const z = Math.sin(angle) * distance;
    if (shoreDistance(x, z) < 2) continue;
    if (rand() > densityAt(x, z)) continue;

    const length = 3 + rand() * 9;
    logs.push({
      x,
      z,
      y: terrainHeight(x, z) + 0.25,
      length,
      radius: 0.18 + rand() * 0.4,
      rotation: rand() * Math.PI * 2,
      tilt: (rand() - 0.5) * 0.25,
    });
  }

  return logs;
}

/**
 * Cartes de feuillage d'une couronne.
 *
 * Une couronne est un *volume*, pas un disque posé sur un mât : les cartes sont
 * réparties du haut du fût jusqu'au sommet, avec un rayon qui varie, et l'une
 * d'elles est horizontale (le « toit » que l'on voit en levant la tête).
 * C'est ce qui distingue une canopée d'une série de parasols.
 */
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
}

export function crownCards(tree: Tree, random: () => number): CrownCard[] {
  const { crownScale, trunkHeight, kind, rotation } = tree;
  const cards: CrownCard[] = [];

  if (kind === "understory") {
    // Jeunes arbres : houppier bas mais étalé. Sans eux, la coupe verticale
    // montre un trou entre le sol et les premières branches (on verrait le
    // ciel sous la canopée, ce qui n'arrive jamais en forêt de terre ferme).
    for (let i = 0; i < 2; i++) {
      cards.push({
        offset: [0, trunkHeight * 0.72 + crownScale * 0.9, 0],
        width: crownScale * 3.4,
        height: crownScale * 2.9,
        horizontal: false,
        angle: rotation + i * (Math.PI / 2),
        tilt: 0.16,
      });
    }
    // Une carte à plat pour fermer la vue du dessus.
    cards.push({
      offset: [0, trunkHeight + crownScale * 0.5, 0],
      width: crownScale * 3.2,
      height: crownScale * 3.2,
      horizontal: true,
      angle: rotation + random() * Math.PI,
      tilt: 0.12,
    });
    return cards;
  }

  // Toit : une grande carte à plat au sommet.
  cards.push({
    offset: [0, trunkHeight + crownScale * 0.55, 0],
    width: crownScale * 2.5,
    height: crownScale * 2.5,
    horizontal: true,
    angle: rotation + random() * Math.PI,
    tilt: 0.1,
  });

  // Volume : cartes verticales empilées sur les deux tiers supérieurs du fût,
  // avec un rayon qui diminue vers le haut (silhouette en dôme).
  const verticalCards = kind === "emergent" ? 5 : 4;
  for (let i = 0; i < verticalCards; i++) {
    const t = i / (verticalCards - 1);
    const radius = crownScale * (0.85 - t * 0.45);
    const angle = rotation + (i * Math.PI) / Math.max(1, verticalCards - 1);
    cards.push({
      offset: [
        Math.cos(angle) * radius * 0.35,
        trunkHeight + crownScale * (0.1 + t * 0.55),
        Math.sin(angle) * radius * 0.35,
      ],
      width: crownScale * (2.1 - t * 0.5) * (0.9 + random() * 0.25),
      height: crownScale * (1.5 - t * 0.3) * (0.9 + random() * 0.3),
      horizontal: false,
      angle,
      tilt: 0.3,
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
