#!/usr/bin/env node
/**
 * Le marcheur traverse-t-il le bois ?
 *
 *   node scripts/check-collision.mjs
 *
 * Deux défauts signalés : « l'explorateur transperce le tronc d'arbre au lieu
 * de passer dessus », et il paraissait transparent. Les deux viennent du même
 * endroit — le décor est dessiné, mais le corps du personnage peut s'y trouver.
 * Quand une surface de bois traverse un torse, on voit le bois à la place du
 * corps : le personnage a l'air coupé, ou translucide.
 *
 * Le contrôle ne teste donc **pas** les colliders contre eux-mêmes (ce serait
 * circulaire). Il reconstruit le bois tel qu'il est **dessiné** — les mêmes
 * segments que le rendu, avec la même formule de rayon — et mesure la
 * pénétration du corps dedans :
 *
 *   1. foncer sur un arbre : le corps n'entre jamais dans le fût ni dans ses
 *      contreforts ;
 *   2. se promener au hasard dans la futaie : aucune image dans le bois ;
 *   3. les troncs tombés ne bloquent pas : ils se franchissent, et le corps
 *      passe au-dessus, pas au travers ;
 *   4. la caméra à l'épaule ne se laisse jamais séparer du personnage par un
 *      fût — sinon on voit à travers le tronc et le corps paraît transparent ;
 *   5. la forêt reste praticable : on avance vraiment.
 */

import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const dir = await mkdtemp(path.join(tmpdir(), "minkebe-collision-"));
const bundle = path.join(dir, "world.mjs");
await build({
  stdin: {
    contents: `export * from "./src/game/engine.ts";
      export * from "./src/game/collision.ts";
      export * from "./src/game/forest.ts";
      export * from "./src/game/levels.ts";`,
    resolveDir: process.cwd(),
    loader: "ts",
  },
  bundle: true,
  format: "esm",
  platform: "node",
  tsconfig: path.join(process.cwd(), "tsconfig.json"),
  outfile: bundle,
  logLevel: "error",
});
const world = await import(`${bundle}?t=${Date.now()}`);
await rm(dir, { recursive: true, force: true });

const {
  newGame,
  step,
  configureCollision,
  isClear,
  moveWalker,
  stepOverAt,
  cameraClearance,
  WALKER_RADIUS,
  buildTile,
  tileOf,
  SPAWN_CLEARING,
} = world;

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
};
const round = (v) => Math.round(v * 100) / 100;

// Mêmes densités que le rendu de bureau : le bois mesuré est celui qu'on voit.
const OPTIONS = {
  treeDensity: 0.058,
  understoryDensity: 0.46,
  logDensity: 0.0025,
  clearing: { ...SPAWN_CLEARING },
};
configureCollision(OPTIONS);

/* -------------------------------------------------------------------------- */
/* Le bois, tel qu'il est dessiné                                             */
/* -------------------------------------------------------------------------- */

/**
 * Empreinte au sol des segments de bois, calculée **comme le rendu**.
 *
 * Le rendu instancie un cylindre unitaire (rayon 1 en bas, 0,62 en haut) dont
 * l'échelle vaut la moyenne des deux rayons du segment. On reprend donc cette
 * moyenne : c'est le rayon réellement visible à la base du segment.
 *
 * Seule la tranche de hauteur qui compte pour un corps debout est retenue —
 * de 0 à 1,8 m au-dessus du sol de l'arbre. Un contrefort qui plonge sous
 * terre ne bloque rien ; sa partie haute, elle, est à hauteur de torse.
 */
const BODY_HEIGHT = 1.8;
/**
 * Hauteur du genou.
 *
 * En dessous, un marcheur enjambe : les racines affleurent la litière sur
 * leurs derniers mètres et l'on pose le pied dessus. Au-dessus, le bois
 * traverse vraiment le corps — c'est ça qu'on mesure.
 */
const KNEE = 0.45;

/**
 * En dessous de ce rayon, c'est du brin, pas du bois.
 *
 * Les semis portent des rameaux de un à cinq centimètres à hauteur de
 * poitrine. Un corps qui les frôle n'est pas un corps qui traverse un arbre :
 * on les écarte de la mesure, sinon le contrôle reproche au jeu ce qu'une
 * vraie forêt fait à un vrai marcheur.
 */
const MIN_VISIBLE_WOOD = 0.1;

function drawnWood(centerX, centerZ, ring = 1) {
  const [cx, cz] = tileOf(centerX, centerZ);
  const blocks = [];
  const logs = [];
  for (let dz = -ring; dz <= ring; dz++) {
    for (let dx = -ring; dx <= ring; dx++) {
      const tile = buildTile(cx + dx, cz + dz, OPTIONS);
      for (const tree of tile.trees) {
        for (const segment of tree.segments) {
          const [fx, fy, fz] = segment.from;
          const [tx, ty, tz] = segment.to;
          // Le rendu étend le cylindre de `from` vers `to` ; on garde la
          // portion comprise entre le sol et la hauteur d'un corps.
          const lo = Math.max(KNEE, Math.min(fy, ty));
          const hi = Math.min(BODY_HEIGHT, Math.max(fy, ty));
          if (hi <= lo) continue;
          const span = Math.abs(ty - fy) < 1e-6 ? 1 : (ty - fy);
          const tA = Math.max(0, Math.min(1, (lo - fy) / span));
          const tB = Math.max(0, Math.min(1, (hi - fy) / span));
          if (tB - tA <= 0.001) continue;
          const mean = (segment.radiusFrom + segment.radiusTo) * 0.5;
          if (mean < MIN_VISIBLE_WOOD) continue;
          blocks.push({
            ax: tree.x + fx + (tx - fx) * tA,
            az: tree.z + fz + (tz - fz) * tA,
            bx: tree.x + fx + (tx - fx) * tB,
            bz: tree.z + fz + (tz - fz) * tB,
            // L'échelle du cylindre instancié : la moyenne des deux rayons.
            r: mean,
          });
        }
      }
      for (const log of tile.logs) {
        const half = log.length * 0.5;
        logs.push({
          ax: log.x - Math.cos(log.rotation) * half,
          az: log.z - Math.sin(log.rotation) * half,
          bx: log.x + Math.cos(log.rotation) * half,
          bz: log.z + Math.sin(log.rotation) * half,
          r: log.radius,
          top: 0.25 + log.radius,
          x: log.x,
          z: log.z,
        });
      }
    }
  }
  return { blocks, logs };
}

function distanceToSegment(x, z, block) {
  const abx = block.bx - block.ax;
  const abz = block.bz - block.az;
  const lengthSq = abx * abx + abz * abz;
  if (lengthSq < 1e-9) return Math.hypot(x - block.ax, z - block.az);
  let t = ((x - block.ax) * abx + (z - block.az) * abz) / lengthSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(x - (block.ax + abx * t), z - (block.az + abz * t));
}

/** Profondeur maximale à laquelle le corps entre dans le bois dessiné. */
function penetration(x, z, wood, radius = WALKER_RADIUS) {
  let worst = 0;
  for (const block of wood.blocks) {
    const gap = distanceToSegment(x, z, block) - block.r - radius;
    if (gap < 0) worst = Math.max(worst, -gap);
  }
  return worst;
}

/** Position de départ du jeu, sans eau ni pente. */
const spawn = () => {
  const base = newGame();
  return { ...base, player: { ...base.player, position: [40, 0, 40] } };
};

const wood = drawnWood(40, 40, 1);
const nearest = wood.blocks
  .map((block) => ({ block, d: distanceToSegment(40, 40, block) }))
  .sort((a, b) => a.d - b.d)[0];

console.log("\nLe bois mesuré");
{
  check("des segments de bois sont dessinés dans le secteur", wood.blocks.length > 200, `${wood.blocks.length} segments`);
  check("le plus proche est à portée de marche", Boolean(nearest) && nearest.d < 12, nearest ? `${round(nearest.d)} m` : "");
}

console.log("\nFoncer sur un arbre");
{
  const target = nearest.block;
  const midX = (target.ax + target.bx) / 2;
  const midZ = (target.az + target.bz) / 2;
  let state = spawn();
  const fromX = midX;
  const fromZ = midZ + 3.2;
  state.player.position = [fromX, 0, fromZ];
  const heading = Math.atan2(-(midX - fromX), -(midZ - fromZ));

  let worst = 0;
  let closest = Infinity;
  let travelled = 0;
  let previous = [fromX, fromZ];
  for (let i = 0; i < 140; i += 1) {
    state = step(state, { forward: true, run: true, cameraYaw: heading }, 0.05).state;
    const [px, , pz] = state.player.position;
    worst = Math.max(worst, penetration(px, pz, wood));
    closest = Math.min(closest, Math.hypot(px - midX, pz - midZ));
    travelled += Math.hypot(px - previous[0], pz - previous[1]);
    previous = [px, pz];
  }
  check("le corps n'entre jamais dans le bois", worst === 0, `pénétration max ${worst.toFixed(3)} m`);
  check("il a avancé avant de buter", travelled > 0.8, `${round(travelled)} m parcourus`);
  check("distance d'arrêt cohérente", closest > 0.35, `${round(closest)} m du fût`);
}

console.log("\nMarcher dans la futaie");
{
  let state = spawn();
  let worst = 0;
  let worstAt = null;
  let yaw = 0;
  let seed = 7;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  for (let i = 0; i < 400; i += 1) {
    if (i % 25 === 0) yaw += (rand() - 0.5) * 2.4;
    state = step(state, { forward: true, cameraYaw: yaw, run: i % 3 === 0 }, 0.05).state;
    const [px, , pz] = state.player.position;
    const depth = penetration(px, pz, wood);
    if (depth > worst) {
      worst = depth;
      worstAt = [px, pz];
    }
  }
  const [px, , pz] = state.player.position;
  check("aucune image dans le bois", worst === 0, worstAt ? `pire ${worst.toFixed(3)} m en (${round(worstAt[0])}, ${round(worstAt[1])})` : "");
  check("la forêt reste praticable", Math.hypot(px - 40, pz - 40) > 4, `${round(Math.hypot(px - 40, pz - 40))} m parcourus`);
}

console.log("\nLes troncs tombés se franchissent");
{
  // On cherche un tronc près du point de départ pour l'enjamber pour de vrai.
  const logs = drawnWood(40, 40, 2).logs;
  const log = logs.sort((a, b) => Math.hypot(a.x - 40, a.z - 40) - Math.hypot(b.x - 40, b.z - 40))[0];
  check("un tronc tombé est dans le secteur", Boolean(log), log ? `r ${round(log.r)} m, dessus à ${round(log.top)} m` : "");
  if (log) {
    const onTop = stepOverAt(log.x, log.z);
    check("sur le tronc, le corps est levé au-dessus du bois", onTop >= log.top * 0.95, `levée ${round(onTop)} m pour un dessus à ${round(log.top)} m`);
    const away = stepOverAt(log.x, log.z + 6);
    check("à six mètres, aucune levée", away === 0, `${round(away)} m`);
    // Le tronc ne bloque pas : on doit pouvoir le traverser de part en part,
    // mais *au-dessus*.
    const [ex, ez] = moveWalker(log.x, log.z + 2.2, log.x, log.z - 2.2);
    check("un tronc ne fait pas mur", Math.abs(ez - (log.z - 2.2)) < 0.6, `arrivée z ${round(ez)} pour visée ${round(log.z - 2.2)}`);
    check("on le retraverse sans être bloqué", isClear(ex, ez));
  }
}

console.log("\nLa caméra ne perd pas le personnage");
{
  // On se place de l'autre côté d'un fût : le tronc est entre l'épaule et le
  // corps, exactement la situation où l'on voit à travers l'arbre.
  const target = nearest.block;
  const midX = (target.ax + target.bx) / 2;
  const midZ = (target.az + target.bz) / 2;
  const backX = midX;
  const backZ = midZ + 3.1;
  const free = cameraClearance(midX, midZ, backX, backZ);
  check("la caméra est rapprochée", free < 1, `fraction libre ${free.toFixed(2)}`);

  let state = spawn();
  state.player.position = [midX, 0, midZ - 1.4];
  let worstGap = 0;
  for (let i = 0; i < 60; i += 1) {
    state = step(state, { forward: false, cameraYaw: 0 }, 0.05).state;
    const [px, , pz] = state.player.position;
    // Position d'épaule théorique, puis rapprochée : on vérifie qu'aucun fût
    // ne se trouve entre le corps et l'œil.
    const distance = 3.1;
    const camX = px;
    const camZ = pz + distance;
    const clearance = cameraClearance(px, pz, camX, camZ);
    const finalX = px + (camX - px) * clearance;
    const finalZ = pz + (camZ - pz) * clearance;
    let blocked = false;
    for (const block of wood.blocks) {
      const steps = 14;
      for (let s = 1; s < steps; s += 1) {
        const t = s / steps;
        const sx = px + (finalX - px) * t;
        const sz = pz + (finalZ - pz) * t;
        if (distanceToSegment(sx, sz, block) < block.r * 0.9) blocked = true;
      }
    }
    if (blocked) worstGap += 1;
  }
  check("aucun fût entre l'œil et le corps", worstGap === 0, `${worstGap} image(s) gênée(s)`);
}

console.log("\nLe camp de départ");
{
  check("le point de départ est libre", isClear(0, 6) && isClear(0, 4) && isClear(1.5, 6));
  const campWood = drawnWood(0, 6, 0);
  const tooClose = campWood.blocks.filter(
    (block) => distanceToSegment(0, 6, block) < block.r + WALKER_RADIUS,
  ).length;
  check("aucune pièce de bois sur le point de départ", tooClose === 0, `${tooClose} segment(s)`);
}


console.log("\nLa caméra ne passe plus dans le décor");
{
  // Signalé : « transparence lors de passage des obstacles ». Mesuré avant
  // correctif : le bras de la caméra se raccourcissait jusqu'à **37 cm**, donc
  // l'œil entrait dans les épaules du personnage — et dans 0,6 % des positions
  // il finissait carrément **dans** un tronc. Comme le bois est dessiné en
  // faces avant, la paroi visible devenait une face arrière, éliminée : on
  // voyait la forêt à travers l'arbre et le corps paraissait coupé.
  const NOMINAL = 3.1;
  const MIN = world.BOOM_MIN_DISTANCE;
  check("le bras a un plancher", MIN >= 1, `${MIN.toFixed(2)} m`);

  let samples = 0;
  let insideWood = 0;
  let shorter = 0;
  let tooClose = 0;
  let worstReach = 1;
  /** Le point est-il dans du bois dessiné ? */
  const inWood = (x, z) =>
    wood.blocks.some((block) => distanceToSegment(x, z, block) < block.r);

  for (let i = 0; i < 1600; i += 1) {
    // Positions pseudo-aléatoires mais reproductibles.
    const px = (((i * 2654435761) % 1000) / 1000 - 0.5) * 90;
    const pz = (((i * 40503 + 12345) % 1000) / 1000 - 0.5) * 90;
    if (!isClear(px, pz)) continue;
    samples += 1;

    const shot = world.solveBoom(px, pz, px, pz + NOMINAL);
    const distance = Math.hypot(shot.x - px, shot.z - pz);
    worstReach = Math.min(worstReach, shot.reach);
    if (distance < MIN - 1e-6) tooClose += 1;
    if (shot.reach < 1) shorter += 1;
    if (inWood(shot.x, shot.z)) insideWood += 1;
  }

  check("la caméra reste hors du personnage", tooClose === 0, `${tooClose}/${samples} position(s) trop proche(s)`);
  check("la caméra reste hors du bois", insideWood === 0, `${insideWood}/${samples} dans un tronc`);
  check(
    "le bras garde sa longueur",
    shorter / samples < 0.02,
    `raccourci dans ${((100 * shorter) / samples).toFixed(1)} % des cas · minimum ${(worstReach * NOMINAL).toFixed(2)} m`,
  );

  // Le cas construit : un fût juste derrière l'épaule. La caméra doit trouver
  // une ligne dépassant le tronc, pas entrer dedans.
  const target = nearest.block;
  const midX = (target.ax + target.bx) / 2;
  const midZ = (target.az + target.bz) / 2;
  const limit = world.boomTurnLimit(68, 16 / 9);
  const shot = world.solveBoom(midX, midZ - 1.2, midX, midZ - 1.2 + NOMINAL, undefined, undefined, limit);
  const gap = Math.hypot(shot.x - midX, shot.z - (midZ - 1.2));
  check("derrière un tronc, la caméra pivote", shot.turn !== 0, `angle ${(shot.turn * 57.3).toFixed(0)}° · ${gap.toFixed(2)} m`);
  check("et elle reste à distance du corps", gap >= MIN - 1e-6, `${gap.toFixed(2)} m`);
  check("la caméra n'entre pas dans ce tronc", !inWood(shot.x, shot.z));

  // Sur un téléphone en portrait, le champ est bien plus étroit : la borne de
  // rotation doit se resserrer d'elle-même, sinon le personnage sort du cadre.
  const phone = world.boomTurnLimit(68, 0.5);
  check("la borne suit le champ de l'écran", phone < limit, `portrait ${(phone * 57.3).toFixed(0)}° · bureau ${(limit * 57.3).toFixed(0)}°`);

  // L'échappée hors cadre existe, mais elle doit rester l'exception : sur la
  // forêt entière, combien de positions la déclenchent-elles ?
  let escapes = 0;
  let sweep = 0;
  for (let i = 0; i < 1200; i += 1) {
    const px = (((i * 2654435761) % 997) / 997 - 0.5) * 90;
    const pz = (((i * 40503 + 12345) % 991) / 991 - 0.5) * 90;
    if (!isClear(px, pz)) continue;
    sweep += 1;
    const shot = world.solveBoom(px, pz, px, pz + NOMINAL, undefined, undefined, limit);
    if (Math.abs(shot.turn) > limit + 1e-9) escapes += 1;
    if (Math.abs(shot.turn) > world.BOOM_MAX_TURN + 1e-9) {
      console.log(`    angle hors borne : ${(shot.turn * 57.3).toFixed(0)}°`);
    }
  }
  check(
    "l'échappée hors cadre reste exceptionnelle",
    escapes / sweep < 0.01,
    `${((100 * escapes) / sweep).toFixed(1)} % des positions`,
  );

  // Les matières du bois ne peuvent pas être traversées : une face arrière de
  // fût doit compter comme une face avant, sinon un arbre devient une fenêtre.
  const { readFileSync } = await import("node:fs");
  const scene = readFileSync("src/components/Scene.tsx", "utf8");
  const trunkBlock = scene.slice(scene.indexOf("const trunkMaterial"), scene.indexOf("const cardGeometry"));
  const logBlock = scene.slice(scene.indexOf("const logMaterial"), scene.indexOf("const logMaterial") + 700);
  check("les fûts sont dessinés double face", trunkBlock.includes("THREE.DoubleSide"));
  check("les troncs tombés aussi", logBlock.includes("THREE.DoubleSide"));
}

console.log(failures === 0 ? "\nOn traverse les troncs en passant dessus, jamais au travers.\n" : `\n${failures} vérification(s) en échec.\n`);
process.exit(failures === 0 ? 0 : 1);
