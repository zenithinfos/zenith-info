/**
 * Relief de la réserve — module pur (aucune dépendance à Three.js).
 *
 * Le même calcul sert à déformer le sol, à poser la végétation, à placer la
 * caméra et, côté moteur, à savoir si le joueur a de l'eau à la taille.
 */

import { WATER_BODIES } from "./water";

export const WORLD_LIMIT = 260;

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** Collines de fond, sans les cuvettes. */
function baseHeight(x: number, z: number): number {
  return (
    Math.sin(x * 0.031) * Math.cos(z * 0.027) * 0.85 +
    Math.sin((x + z) * 0.011) * 1.15 +
    Math.sin(x * 0.008 - z * 0.006) * 2.2 -
    0.15
  );
}

/** Cuvette d'un plan d'eau : 0 au centre, 1 sur la rive. */
function waterInfluence(x: number, z: number): { body: (typeof WATER_BODIES)[number]; d: number } | null {
  let best: { body: (typeof WATER_BODIES)[number]; d: number } | null = null;
  for (const body of WATER_BODIES) {
    const nx = Math.abs(x - body.center[0]) / (body.width / 2);
    const nz = Math.abs(z - body.center[1]) / (body.depth / 2);
    const d = Math.max(nx, nz);
    if (d > 1.4) continue;
    if (!best || d < best.d) best = { body, d };
  }
  return best;
}

/** Hauteur du sol en (x, z). */
export function terrainHeight(x: number, z: number): number {
  const height = baseHeight(x, z);
  const influence = waterInfluence(x, z);
  if (!influence) return height;

  const { body, d } = influence;
  const shore = 1 - smoothstep(1.0, 1.4, d);
  // Le lit descend jusqu'à ~2 m sous la surface au centre.
  const bed = body.level - 2.1 * (1 - Math.min(1, d));
  return height * (1 - shore) + bed * shore;
}

/** Pente locale (0 = plat), utile pour éviter de poser des objets à pic. */
export function slopeAt(x: number, z: number, step = 1.5): number {
  const dx = terrainHeight(x + step, z) - terrainHeight(x - step, z);
  const dz = terrainHeight(x, z + step) - terrainHeight(x, z - step);
  return Math.hypot(dx, dz) / (2 * step);
}

/** Un point est-il sous l'eau (lit immergé) ? */
export function isSubmerged(x: number, z: number): boolean {
  const influence = waterInfluence(x, z);
  if (!influence || influence.d > 1) return false;
  return terrainHeight(x, z) < influence.body.level;
}

/** Distance minimale aux rives : négative dans l'eau. */
export function shoreDistance(x: number, z: number): number {
  const influence = waterInfluence(x, z);
  if (!influence) return 999;
  const { body, d } = influence;
  const halfExtent = Math.min(body.width, body.depth) / 2;
  return (d - 1) * halfExtent;
}
