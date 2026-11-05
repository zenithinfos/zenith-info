/**
 * Ce qui arrête le marcheur.
 *
 * La forêt est dessinée par tuiles (`forest.ts`) : les arbres n'existent pas
 * dans un maillage statique, ils sont reconstruits à l'identique à chaque
 * chargement, à partir d'une graine. Rien n'empêchait donc le personnage de
 * traverser les fûts — il n'y avait tout simplement aucune notion de solide.
 *
 * Ce module referme la boucle : il reconstruit les mêmes tuiles, en retient les
 * fûts, et repousse le marcheur hors de leur rayon. Il vit à part du rendu
 * parce que c'est le moteur (`engine.step`) qui décide du déplacement : une
 * collision résolue dans le rendu arriverait une image trop tard, et les
 * commandes de vérification — qui n'ont pas de rendu — ne pourraient pas la
 * tester.
 *
 * Deux règles :
 *   - on ne bloque que ce qui se voit : un fût plus fin qu'un doigt ne mérite
 *     pas un mur invisible ;
 *   - on pousse, on ne stoppe pas : le long d'un tronc on glisse, on ne colle
 *     pas. Un mur qui arrête net donne l'impression d'un bug.
 */

import { buildTile, tileOf, type TileOptions } from "./forest";
import { SPAWN_CLEARING } from "./levels";
import { WORLD_LIMIT } from "./terrain";

export interface Collider {
  x: number;
  z: number;
  /** Rayon du fût au sol, contreforts compris. */
  r: number;
}

/** Rayon du corps du marcheur, épaules comprises. */
export const WALKER_RADIUS = 0.32;

/**
 * En dessous de ce rayon, on laisse passer. Un semis de tiges de six
 * centimètres ne doit pas transformer la forêt en champ de mines.
 */
const MIN_TRUNK = 0.1;
/** Les contreforts débordent du fût : on élargit un peu la zone solide. */
const FOOT_FLARE = 1.25;

let options: TileOptions = {
  treeDensity: 0.058,
  understoryDensity: 0.46,
  logDensity: 0.0025,
  clearing: { ...SPAWN_CLEARING },
};

const tiles = new Map<string, Collider[]>();
/** Ordre d'ancienneté, pour jeter les tuiles qu'on ne voit plus. */
const order: string[] = [];
const MAX_TILES = 40;

/**
 * Les densités changent avec l'appareil : le rendu et la collision doivent
 * lire **la même** tuile. Le rendu appelle donc ceci au montage.
 */
export function configureCollision(next: TileOptions): void {
  options = { ...next };
  tiles.clear();
  order.length = 0;
}

function collidersFor(tileX: number, tileZ: number): Collider[] {
  const key = `${tileX}:${tileZ}`;
  const known = tiles.get(key);
  if (known) return known;

  let built: Collider[] = [];
  try {
    const tile = buildTile(tileX, tileZ, options);
    built = [];
    for (const tree of tile.trees) {
      const r = Math.max(MIN_TRUNK, tree.trunkRadius * FOOT_FLARE);
      if (r < MIN_TRUNK) continue;
      built.push({ x: tree.x, z: tree.z, r });
    }
  } catch {
    // Une tuile qui ne se construit pas ne doit pas figer le jeu : on la
    // déclare vide, le joueur traversera un arbre plutôt que de rester coincé.
    built = [];
  }

  tiles.set(key, built);
  order.push(key);
  while (order.length > MAX_TILES) {
    const old = order.shift();
    if (old) tiles.delete(old);
  }
  return built;
}

/**
 * Fûts dans un rayon autour d'un point.
 *
 * Le filtre est serré : on ne teste pas les quatre-vingts arbres d'une tuile
 * pour savoir si l'on frôle un tronc, seulement ceux qui sont à portée. C'est
 * appelé à chaque image.
 */
export function collidersNear(x: number, z: number, reach = 2.5): Collider[] {
  const [tx, tz] = tileOf(x, z);
  const out: Collider[] = [];
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      const list = collidersFor(tx + dx, tz + dz);
      for (const c of list) {
        if (Math.abs(c.x - x) > reach + c.r) continue;
        if (Math.abs(c.z - z) > reach + c.r) continue;
        if ((c.x - x) ** 2 + (c.z - z) ** 2 > (reach + c.r) ** 2) continue;
        out.push(c);
      }
    }
  }
  return out;
}

/**
 * Un point est-il libre ?
 *
 * Sert aussi aux contrôles : « aucune position visitée n'est dans un fût ».
 */
export function isClear(x: number, z: number, radius = WALKER_RADIUS): boolean {
  for (const c of collidersNear(x, z)) {
    const reach = radius + c.r;
    if ((x - c.x) ** 2 + (z - c.z) ** 2 < reach * reach - 1e-6) return false;
  }
  return true;
}

/**
 * Écarte un point des fûts qu'il pénètre.
 *
 * La correction se fait le long de la normale, donc la composante tangentielle
 * du déplacement survit : on glisse le long du tronc.
 */
export function pushOut(x: number, z: number, radius = WALKER_RADIUS): [number, number] {
  let px = x;
  let pz = z;
  const near = collidersNear(px, pz);
  // Trois passes : dans un fourré, sortir d'un fût peut en faire entrer dans
  // un autre. Deux suffisent presque toujours, la troisième est une ceinture.
  for (let pass = 0; pass < 3; pass++) {
    let moved = false;
    for (const c of near) {
      const reach = radius + c.r;
      const dx = px - c.x;
      const dz = pz - c.z;
      const d2 = dx * dx + dz * dz;
      if (d2 >= reach * reach) continue;
      const d = Math.sqrt(d2);
      if (d < 1e-5) {
        // Centre confondu avec le fût : on sort vers le nord, faute de mieux.
        px = c.x;
        pz = c.z + reach;
        moved = true;
        continue;
      }
      const push = (reach - d) / d;
      px += dx * push;
      pz += dz * push;
      moved = true;
    }
    if (!moved) break;
  }
  return [px, pz];
}

/**
 * Déplace le marcheur de `from` à `to` en respectant les fûts.
 *
 * Le trajet est découpé : à 4,6 m/s et 60 images par seconde, un pas fait
 * 0,08 m, mais une image en retard peut en faire 0,28 — assez pour traverser
 * un tronc de part en part si on ne teste que l'arrivée.
 */
export function moveWalker(
  fromX: number,
  fromZ: number,
  toX: number,
  toZ: number,
  radius = WALKER_RADIUS,
): [number, number] {
  const dx = toX - fromX;
  const dz = toZ - fromZ;
  const distance = Math.hypot(dx, dz);
  const steps = Math.max(1, Math.ceil(distance / 0.12));
  let px = fromX;
  let pz = fromZ;
  for (let step = 1; step <= steps; step++) {
    const t = step / steps;
    px = fromX + dx * t;
    pz = fromZ + dz * t;
    [px, pz] = pushOut(px, pz, radius);
  }
  const limit = WORLD_LIMIT;
  return [Math.max(-limit, Math.min(limit, px)), Math.max(-limit, Math.min(limit, pz))];
}
