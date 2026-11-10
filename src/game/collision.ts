/**
 * Ce qui arrête le marcheur, et ce qu'il enjambe.
 *
 * La forêt est dessinée par tuiles (`forest.ts`) : les arbres n'existent pas
 * dans un maillage statique, ils sont reconstruits à l'identique à chaque
 * chargement, à partir d'une graine. Rien n'empêchait donc le personnage de
 * traverser les fûts — il n'y avait tout simplement aucune notion de solide.
 *
 * Ce module referme la boucle : il reconstruit les mêmes tuiles, en retient
 * les volumes qui se voient, et répond deux questions distinctes.
 *
 *   - **Est-ce que ça bloque ?** Les fûts, et les contreforts tant qu'ils sont
 *     hauts. On pousse, on ne stoppe pas : le long d'un tronc on glisse.
 *   - **Est-ce qu'on passe dessus ?** Les troncs tombés. Ils gisent au sol, à
 *     quarante ou quatre-vingts centimètres ; un marcheur les enjambe. Les
 *     traiter comme des murs aurait été faux, les ignorer donnait un homme qui
 *     traverse le bois — c'est le défaut signalé.
 *
 * Il vit à part du rendu parce que c'est le moteur (`engine.step`) qui décide
 * du déplacement : une collision résolue dans le rendu arriverait une image
 * trop tard, et les commandes de vérification — qui n'ont pas de rendu — ne
 * pourraient pas la tester.
 */

import { buildTile, tileOf, type TileOptions } from "./forest";
import { SPAWN_CLEARING } from "./levels";
import { WORLD_LIMIT } from "./terrain";

export interface Collider {
  x: number;
  z: number;
  /** Rayon du fût au sol. */
  r: number;
}

/** Un obstacle allongé au sol : contrefort ou tronc tombé. */
export interface Capsule {
  ax: number;
  az: number;
  bx: number;
  bz: number;
  r: number;
}

/** Tronc tombé : une capsule qu'on enjambe, avec la hauteur franchie. */
export interface LogStep extends Capsule {
  /** Hauteur du dessus du tronc au-dessus du sol. */
  top: number;
}

interface TileBodies {
  trunks: Collider[];
  roots: Capsule[];
  logs: LogStep[];
}

/** Rayon du corps du marcheur, épaules comprises. */
export const WALKER_RADIUS = 0.32;

/**
 * En dessous de ce rayon, on laisse passer. Un semis de tiges de six
 * centimètres ne doit pas transformer la forêt en champ de mines.
 */
const MIN_TRUNK = 0.1;

/**
 * Un contrefort ne bloque que là où il monte plus haut que ça au-dessus du
 * sol. Plus bas, on pose le pied dessus — comme dans une vraie forêt, où l'on
 * enjambe les racines au lieu de les contourner.
 */
const ROOT_OBSTACLE = 0.45;

/**
 * Plafond de rayon pour un contrefort.
 *
 * Un aileron mesure facilement soixante centimètres d'épaisseur au ras du
 * fût — au-delà, les six racines d'un émergent se touchent et le pied de
 * l'arbre devient un blockhaus sans passage. Le fût lui-même est bloqué par
 * son propre disque, plus large ; ce plafond ne concerne que l'aileron.
 */
const ROOT_MAX_RADIUS = 0.26;

let options: TileOptions = {
  treeDensity: 0.058,
  understoryDensity: 0.46,
  logDensity: 0.0025,
  clearing: { ...SPAWN_CLEARING },
};

const tiles = new Map<string, TileBodies>();
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

function buildBodies(tileX: number, tileZ: number): TileBodies {
  const tile = buildTile(tileX, tileZ, options);
  const trunks: Collider[] = [];
  const roots: Capsule[] = [];
  const logs: LogStep[] = [];

  for (const tree of tile.trees) {
    // Le fût : le rayon dessiné vaut la moyenne des deux extrémités du
    // premier segment, et le cylindre instancié s'effile vers le haut. On
    // prend le rayon de base, plus une marge de sécurité.
    const r = Math.max(MIN_TRUNK, tree.trunkRadius * 1.1);
    if (tree.trunkRadius >= MIN_TRUNK) trunks.push({ x: tree.x, z: tree.z, r });

    // Les contreforts : ce sont des ailerons de bois qui partent du fût et
    // plongent dans la litière. Tant qu'ils dépassent la hauteur d'un genou,
    // ils bloquent. Le fût seul ne suffisait pas : à un mètre du tronc, on
    // était déjà dans la racine, et le torse passait au travers.
    for (const segment of tree.segments) {
      if (segment.kind !== 1) continue;
      const [fx, fy, fz] = segment.from;
      const [tx, ty, tz] = segment.to;
      const drop = fy - ty;
      if (drop <= 0.01) continue;
      // Fraction du contrefort encore au-dessus de la hauteur de genou.
      const solid = Math.max(0, Math.min(1, (fy - ROOT_OBSTACLE) / drop));
      if (solid <= 0.05) continue;
      const reachX = (tx - fx) * solid;
      const reachZ = (tz - fz) * solid;
      const length = Math.hypot(reachX, reachZ);
      if (length < 0.25) continue;

      // Trois tronçons plutôt qu'un : un contrefort s'effile, et une capsule
      // à rayon unique était trop mince au ras du tronc, trop épaisse à la
      // pointe. Trois morceaux suivent la forme sans murer le passage.
      const pieces = 3;
      for (let piece = 0; piece < pieces; piece++) {
        const t0 = piece / pieces;
        const t1 = (piece + 1) / pieces;
        const sampled = segment.radiusFrom + (segment.radiusTo - segment.radiusFrom) * ((t0 + t1) / 2);
        // Plafond : un aileron de soixante-dix centimètres transformait le
        // pied de l'arbre en blockhaus, sans ouverture entre les racines.
        const radius = Math.max(0.09, Math.min(ROOT_MAX_RADIUS, sampled));
        if (radius < 0.09) continue;
        roots.push({
          ax: tree.x + fx + reachX * t0,
          az: tree.z + fz + reachZ * t0,
          bx: tree.x + fx + reachX * t1,
          bz: tree.z + fz + reachZ * t1,
          r: radius,
        });
      }
    }
  }

  for (const log of tile.logs) {
    // Le tronc est posé à `y = sol + 0,25` et couché le long de sa rotation ;
    // seuls son rayon et sa longueur comptent pour l'enjambement.
    const half = log.length * 0.5;
    const dx = Math.cos(log.rotation) * half;
    const dz = Math.sin(log.rotation) * half;
    logs.push({
      ax: log.x - dx,
      az: log.z - dz,
      bx: log.x + dx,
      bz: log.z + dz,
      r: log.radius,
      top: 0.25 + log.radius,
    });
  }

  return { trunks, roots, logs };
}

function bodiesFor(tileX: number, tileZ: number): TileBodies {
  const key = `${tileX}:${tileZ}`;
  const known = tiles.get(key);
  if (known) return known;

  let built: TileBodies;
  try {
    built = buildBodies(tileX, tileZ);
  } catch {
    // Une tuile qui ne se construit pas ne doit pas figer le jeu : on la
    // déclare vide, le joueur traversera un arbre plutôt que de rester coincé.
    built = { trunks: [], roots: [], logs: [] };
  }

  tiles.set(key, built);
  order.push(key);
  while (order.length > MAX_TILES) {
    const old = order.shift();
    if (old) tiles.delete(old);
  }
  return built;
}

/** Neuf tuiles autour d'un point — la courante et ses huit voisines. */
function tilesNear<T>(x: number, z: number, pick: (bodies: TileBodies) => T[]): T[] {
  const [tx, tz] = tileOf(x, z);
  const out: T[] = [];
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      for (const item of pick(bodiesFor(tx + dx, tz + dz))) out.push(item);
    }
  }
  return out;
}

/** Distance d'un point au segment [a, b], dans le plan. */
function distanceToSegment(x: number, z: number, c: Capsule): number {
  const abx = c.bx - c.ax;
  const abz = c.bz - c.az;
  const lengthSq = abx * abx + abz * abz;
  if (lengthSq < 1e-9) return Math.hypot(x - c.ax, z - c.az);
  let t = ((x - c.ax) * abx + (z - c.az) * abz) / lengthSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(x - (c.ax + abx * t), z - (c.az + abz * t));
}

/**
 * Fûts et contreforts à portée d'un point.
 *
 * Le filtre est serré : on ne teste pas les quatre-vingts arbres d'une tuile
 * pour savoir si l'on frôle un tronc, seulement ceux qui sont à portée. C'est
 * appelé à chaque image.
 */
function obstaclesNear(x: number, z: number, reach: number) {
  const trunks: Collider[] = [];
  const roots: Capsule[] = [];
  for (const c of tilesNear(x, z, (b) => b.trunks)) {
    if (Math.abs(c.x - x) > reach + c.r || Math.abs(c.z - z) > reach + c.r) continue;
    if ((c.x - x) ** 2 + (c.z - z) ** 2 > (reach + c.r) ** 2) continue;
    trunks.push(c);
  }
  for (const c of tilesNear(x, z, (b) => b.roots)) {
    // Cercle englobant de la capsule, pour un rejet bon marché.
    const mx = (c.ax + c.bx) * 0.5;
    const mz = (c.az + c.bz) * 0.5;
    const half = Math.hypot(c.bx - c.ax, c.bz - c.az) * 0.5;
    if ((mx - x) ** 2 + (mz - z) ** 2 > (reach + c.r + half) ** 2) continue;
    roots.push(c);
  }
  return { trunks, roots };
}

/** Fûts proches d'un point (diagnostic et contrôles). */
export function collidersNear(x: number, z: number, reach = 2.5): Collider[] {
  return obstaclesNear(x, z, reach).trunks;
}

/**
 * Un point est-il libre ?
 *
 * Sert aussi aux contrôles : « aucune position visitée n'est dans un fût ».
 */
export function isClear(x: number, z: number, radius = WALKER_RADIUS): boolean {
  const { trunks, roots } = obstaclesNear(x, z, radius);
  for (const c of trunks) {
    const reach = radius + c.r;
    if ((x - c.x) ** 2 + (z - c.z) ** 2 < reach * reach - 1e-6) return false;
  }
  for (const c of roots) {
    if (distanceToSegment(x, z, c) < radius + c.r - 1e-6) return false;
  }
  return true;
}

/**
 * Écarte un point des fûts et des contreforts qu'il pénètre.
 *
 * La correction se fait le long de la normale, donc la composante tangentielle
 * du déplacement survit : on glisse le long du tronc.
 */
export function pushOut(x: number, z: number, radius = WALKER_RADIUS): [number, number] {
  let px = x;
  let pz = z;
  const { trunks, roots } = obstaclesNear(px, pz, radius + 0.35);
  // Quatre passes : dans un fourré, sortir d'un fût peut en faire entrer dans
  // un autre, et les contreforts se croisent en étoile autour du tronc.
  for (let pass = 0; pass < 4; pass++) {
    let moved = false;
    for (const c of trunks) {
      const reach = radius + c.r;
      const dx = px - c.x;
      const dz = pz - c.z;
      const d2 = dx * dx + dz * dz;
      if (d2 >= reach * reach) continue;
      const d = Math.sqrt(d2);
      if (d < 1e-5) {
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

    for (const c of roots) {
      const reach = radius + c.r;
      const abx = c.bx - c.ax;
      const abz = c.bz - c.az;
      const lengthSq = abx * abx + abz * abz;
      let t = lengthSq < 1e-9 ? 0 : ((px - c.ax) * abx + (pz - c.az) * abz) / lengthSq;
      t = Math.max(0, Math.min(1, t));
      const nx = c.ax + abx * t;
      const nz = c.az + abz * t;
      const dx = px - nx;
      const dz = pz - nz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= reach * reach) continue;
      const d = Math.sqrt(d2);
      if (d < 1e-5) {
        // Pile sur l'axe de l'aileron : on sort perpendiculairement.
        const len = Math.sqrt(lengthSq) || 1;
        px = nx - (abz / len) * reach;
        pz = nz + (abx / len) * reach;
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
 * Déplace le marcheur de `from` à `to` en respectant fûts et contreforts.
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
  let depth = penetrationAt(px, pz, radius);
  for (let step = 1; step <= steps; step++) {
    const t = step / steps;
    const wantedX = fromX + dx * t;
    const wantedZ = fromZ + dz * t;
    const [pushedX, pushedZ] = pushOut(wantedX, wantedZ, radius);
    // Progression monotone : on n'accepte une position que si elle est moins
    // enfoncée que la précédente. Entre deux contreforts en étoile, la
    // poussée itérative peut osciller ; refuser sèchement tout déplacement
    // non libre enfermait le marcheur dans le bois à la première image.
    const next = penetrationAt(pushedX, pushedZ, radius);
    if (next <= depth + 1e-4) {
      px = pushedX;
      pz = pushedZ;
      depth = next;
    }
  }
  const limit = WORLD_LIMIT;
  return [Math.max(-limit, Math.min(limit, px)), Math.max(-limit, Math.min(limit, pz))];
}

/**
 * Profondeur à laquelle le corps entre dans un solide, en mètres.
 *
 * Zéro quand il est libre. Sert au déplacement (n'accepter qu'une position
 * moins enfoncée) et aux contrôles.
 */
export function penetrationAt(x: number, z: number, radius = WALKER_RADIUS): number {
  let worst = 0;
  const { trunks, roots } = obstaclesNear(x, z, radius + 0.4);
  for (const c of trunks) {
    const overlap = radius + c.r - Math.hypot(x - c.x, z - c.z);
    if (overlap > worst) worst = overlap;
  }
  for (const c of roots) {
    const overlap = radius + c.r - distanceToSegment(x, z, c);
    if (overlap > worst) worst = overlap;
  }
  return worst;
}

/**
 * Hauteur à laquelle le marcheur franchit un tronc tombé, à cet endroit.
 *
 * Zéro quand il n'y a pas de tronc sous les pieds. La montée est progressive
 * sur les derniers centimètres qui précèdent le bois, pour que l'enjambement
 * se voie comme une enjambée et non comme une téléportation verticale.
 */
export function stepOverAt(x: number, z: number, radius = WALKER_RADIUS): number {
  let lift = 0;
  for (const log of tilesNear(x, z, (b) => b.logs)) {
    // Rejet bon marché avant le calcul de distance au segment.
    const mx = (log.ax + log.bx) * 0.5;
    const mz = (log.az + log.bz) * 0.5;
    const half = Math.hypot(log.bx - log.ax, log.bz - log.az) * 0.5;
    const span = radius + log.r + 0.45;
    if ((mx - x) ** 2 + (mz - z) ** 2 > (span + half) ** 2) continue;

    const d = distanceToSegment(x, z, log);
    // Rampes d'approche et de sortie : on monte sur les 45 cm qui précèdent
    // le bois, on redescend de même de l'autre côté.
    const ramp = 0.45;
    const overlap = radius + log.r + ramp - d;
    if (overlap <= 0) continue;
    const blend = Math.min(1, overlap / ramp);
    lift = Math.max(lift, log.top * blend * blend * (3 - 2 * blend));
  }
  return lift;
}

/**
 * Distance libre entre deux points, avant de heurter un fût.
 *
 * Renvoie la fraction du trajet qui reste libre, entre 0 et 1.
 */
export function cameraClearance(
  fromX: number,
  fromZ: number,
  toX: number,
  toZ: number,
  radius = 0.28,
): number {
  const dx = toX - fromX;
  const dz = toZ - fromZ;
  const distance = Math.hypot(dx, dz);
  if (distance < 0.05) return 1;
  const steps = Math.ceil(distance / 0.12);
  for (let step = 1; step <= steps; step++) {
    const t = step / steps;
    const px = fromX + dx * t;
    const pz = fromZ + dz * t;
    for (const c of obstaclesNear(px, pz, radius + 0.05).trunks) {
      const reach = radius + c.r;
      if ((px - c.x) ** 2 + (pz - c.z) ** 2 < reach * reach) {
        // On recule d'un pas : la caméra s'arrête juste avant le bois, pas
        // dedans.
        return Math.max(0.12, (step - 1) / steps);
      }
    }
  }
  return 1;
}

/**
 * En deçà de cette distance, la caméra est dans le personnage.
 *
 * Le bras de la caméra à l'épaule mesurait trois mètres dix, et il pouvait se
 * raccourcir jusqu'à **37 cm** pour éviter un tronc. À cette distance l'œil est
 * dans les épaules du personnage : le plan de découpe rappe le corps et, comme
 * les matières sont dessinées en faces avant, on voit l'intérieur — le corps
 * paraît transparent, coupé. Un mètre quinze garde la silhouette entière
 * devant l'œil, arme comprise.
 */
export const BOOM_MIN_DISTANCE = 1.15;

/**
 * Angles essayés, par passes successives.
 *
 * Le bras de la caméra ne décide pas de la direction du regard : celle-ci
 * appartient au joueur. Pivoter le bras déplace donc le personnage dans le
 * cadre. En deçà de 25° il reste largement visible et le mouvement se lit comme
 * un ajustement ; au-delà, il sortirait par le bord.
 *
 * On commence donc par des angles discrets, et on ne les dépasse que s'il n'y a
 * vraiment pas d'autre issue. Mesuré sur la forêt générée : quand un fût barre
 * le passage, 78 % des cas se règlent sous 25°.
 */
const BOOM_TURNS = [0, 0.14, -0.14, 0.28, -0.28, 0.42, -0.42, 0.58, -0.58, 0.78, -0.78];

/** Rotation maximale du bras, si l'appelant n'en donne pas. */
export const BOOM_MAX_TURN = 0.78;

/**
 * Rotation maximale compatible avec le cadre.
 *
 * Le personnage doit rester visible : un bras qui pivote de θ le décale de θ
 * sur l'écran, et au-delà d'une fraction du demi-champ il sort par le bord.
 * Le champ horizontal dépend de l'écran — un téléphone en portrait voit trois
 * fois moins large qu'un écran d'ordinateur — donc la borne se calcule à
 * l'exécution, pas en dur.
 */
export function boomTurnLimit(fovDegrees: number, aspect: number): number {
  const halfVertical = (fovDegrees * Math.PI) / 360;
  const halfHorizontal = Math.atan(Math.tan(halfVertical) * Math.max(0.3, aspect));
  // Deux tiers du demi-champ : le personnage reste dans le cadre, décalé vers
  // le bord, et le regard du joueur n'est pas modifié.
  return Math.max(0.12, Math.min(BOOM_MAX_TURN, halfHorizontal * 0.66));
}

export interface BoomShot {
  /** Position finale de la caméra, au sol. */
  x: number;
  z: number;
  /** Fraction du bras utilisée : 1 = pleine longueur. */
  reach: number;
  /** Rotation appliquée au bras, en radians. */
  turn: number;
}

/**
 * Place le bras de la caméra.
 *
 * L'ancienne logique faisait une seule chose : rapprocher la caméra du
 * personnage jusqu'à ce que la ligne soit libre. Deux défauts, tous les deux
 * visibles à l'écran :
 *
 *   · le bras tombait à 37 cm — la caméra entrait dans le corps, qui
 *     disparaissait par sa face arrière ;
 *   · dans 0,6 % des positions, la caméra finissait **dans** un tronc, et
 *     comme le bois est dessiné en faces avant, on voyait la forêt à travers
 *     l'arbre.
 *
 * On fait donc l'inverse : d'abord **pivoter** le bras pour trouver une ligne
 * dégagée, en gardant toute sa longueur ; ne raccourcir qu'en dernier recours,
 * et jamais sous `BOOM_MIN_DISTANCE`.
 */
export function solveBoom(
  playerX: number,
  playerZ: number,
  desiredX: number,
  desiredZ: number,
  minDistance = BOOM_MIN_DISTANCE,
  radius = 0.28,
  maxTurn = BOOM_MAX_TURN,
): BoomShot {
  const dx = desiredX - playerX;
  const dz = desiredZ - playerZ;
  const length = Math.hypot(dx, dz);
  if (length < 1e-3) return { x: desiredX, z: desiredZ, reach: 1, turn: 0 };

  const floor = Math.min(1, minDistance / length);
  let best = { free: -1, turn: 0 };

  // Deux passes. La première reste dans le cadre. La seconde n'est jouée que
  // si la première a échoué : mieux vaut un personnage poussé vers le bord de
  // l'écran qu'une caméra dans l'écorce, où l'on ne voit plus rien du tout.
  for (const escape of [false, true]) {
    for (const turn of BOOM_TURNS) {
      const magnitude = Math.abs(turn);
      if (magnitude > BOOM_MAX_TURN) break;
      if (escape ? magnitude <= maxTurn : magnitude > maxTurn) continue;
      const cos = Math.cos(turn);
      const sin = Math.sin(turn);
      const rx = playerX + dx * cos - dz * sin;
      const rz = playerZ + dx * sin + dz * cos;
      const free = cameraClearance(playerX, playerZ, rx, rz, radius);
      // Ligne entièrement dégagée : on s'arrête au plus petit angle qui la donne.
      if (free >= 1) return { x: rx, z: rz, reach: 1, turn };
      if (free > best.free) best = { free, turn };
    }
  }

  // Aucune ligne dégagée : on garde la meilleure et on recule dessus, mais
  // jamais au point d'entrer dans le personnage.
  const reach = Math.max(floor, best.free);
  const cos = Math.cos(best.turn);
  const sin = Math.sin(best.turn);
  const rx = dx * cos - dz * sin;
  const rz = dx * sin + dz * cos;
  return {
    x: playerX + rx * reach,
    z: playerZ + rz * reach,
    reach,
    turn: best.turn,
  };
}
