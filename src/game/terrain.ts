/**
 * Relief de la réserve — module pur (aucune dépendance à Three.js).
 *
 * Le même calcul sert à déformer le sol, à poser la végétation, à placer la
 * caméra et, côté moteur, à savoir si le joueur a de l'eau à la taille.
 *
 * Les plans d'eau ne sont plus des rectangles : le lit est creusé à partir de
 * la distance signée à la ligne d'eau (voir water.ts). La berge remonte
 * progressivement sur cinq mètres, ce qui donne des rives en pente douce —
 * on peut entrer dans l'eau, et surtout on ne voit plus un plan d'eau découpé
 * au couteau dans la forêt.
 */

import { smoothstep, waterField } from "./water";

export const WORLD_LIMIT = 260;

/** Largeur de la frange où le relief est encore influencé par la berge. */
const BANK_WIDTH = 6.5;

/** Collines de fond, sans les cuvettes. */
function baseHeight(x: number, z: number): number {
  return (
    Math.sin(x * 0.031) * Math.cos(z * 0.027) * 0.85 +
    Math.sin((x + z) * 0.011) * 1.15 +
    Math.sin(x * 0.008 - z * 0.006) * 2.2 -
    0.15
  );
}

/** Hauteur du sol en (x, z). */
export function terrainHeight(x: number, z: number): number {
  const height = baseHeight(x, z);
  const field = waterField(x, z);
  if (!field || field.edge > BANK_WIDTH) return height;

  // Dans l'eau : le lit. Sur la berge : un bourrelet de vase à la ligne d'eau,
  // puis remontée vers le relief général.
  const target = field.edge < 0 ? field.body.level - field.depth : field.body.level + 0.12;
  const weight =
    field.edge < 0 ? 1 : 1 - smoothstep(0.1, BANK_WIDTH, field.edge);
  return target * weight + height * (1 - weight);
}

/** Pente locale (0 = plat), utile pour éviter de poser des objets à pic. */
export function slopeAt(x: number, z: number, step = 1.5): number {
  const dx = terrainHeight(x + step, z) - terrainHeight(x - step, z);
  const dz = terrainHeight(x, z + step) - terrainHeight(x, z - step);
  return Math.hypot(dx, dz) / (2 * step);
}

/** Un point est-il sous l'eau (lit immergé) ? */
export function isSubmerged(x: number, z: number): boolean {
  const field = waterField(x, z);
  if (!field || field.edge > 0) return false;
  return terrainHeight(x, z) < field.body.level;
}

/** Distance minimale aux rives : négative dans l'eau. */
export function shoreDistance(x: number, z: number): number {
  return waterField(x, z)?.edge ?? 999;
}
