#!/usr/bin/env node
/**
 * Les arbres sont-ils solides ?
 *
 *   node scripts/check-collision.mjs
 *
 * On traversait les fûts de part en part : la forêt était une image, pas un
 * obstacle. Le contrôle ne se contente pas de vérifier qu'une fonction existe,
 * il fait marcher le moteur contre un arbre et regarde où il s'arrête.
 *
 *   1. dans un fût, on n'est pas « libre » ;
 *   2. foncer droit dessus ne traverse pas — même à 60 images par seconde
 *      avec des pas de 28 cm ;
 *   3. on glisse le long du fût au lieu de s'arrêter net : la composante
 *      tangentielle du déplacement survit ;
 *   4. une marche au hasard dans la futaie ne finit jamais dans un tronc ;
 *   5. la trouée du camp reste vide — sinon le joueur démarre coincé.
 */

import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const dir = await mkdtemp(path.join(tmpdir(), "minkebe-collision-"));
const bundle = path.join(dir, "world.mjs");
await build({
  stdin: {
    contents: `export * from "./src/game/engine.ts"; export * from "./src/game/collision.ts"; export * from "./src/game/forest.ts"; export * from "./src/game/levels.ts";`,
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

const { newGame, step, configureCollision, collidersNear, isClear, moveWalker, WALKER_RADIUS, SPAWN_CLEARING } =
  world;

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
};
const round = (v) => Math.round(v * 100) / 100;

// Mêmes densités que le rendu de bureau : les fûts testés sont ceux qu'on voit.
configureCollision({
  treeDensity: 0.058,
  understoryDensity: 0.46,
  logDensity: 0.0025,
  clearing: { ...SPAWN_CLEARING },
});

/** Position de départ du jeu, sans eau ni pente. */
const spawn = () => {
  const base = newGame();
  return { ...base, player: { ...base.player, position: [40, 0, 40] } };
};

/** Le fût le plus proche d'un point, dans un rayon donné. */
function nearestTrunk(x, z, radius = 30) {
  let best = null;
  for (const c of collidersNear(x, z, radius)) {
    const d = Math.hypot(c.x - x, c.z - z);
    if (!best || d < best.d) best = { ...c, d };
  }
  return best;
}

console.log("\nUn fût est un solide");
let target;
{
  target = nearestTrunk(40, 40);
  check("il y a un arbre dans le secteur", Boolean(target), target ? `r ${round(target.r)} m à ${round(target.d)} m` : "");
  check(
    "le centre du fût n'est pas libre",
    target ? !isClear(target.x, target.z) : false,
  );
  check(
    "juste à côté du fût, on est libre",
    target ? isClear(target.x + target.r + WALKER_RADIUS + 0.15, target.z) : false,
  );
}

console.log("\nFoncer dessus ne le traverse pas");
{
  // Départ à 2 m, cap droit sur le tronc, cinq secondes de course : de quoi
  // le traverser dix fois s'il n'était qu'une image.
  const state = spawn();
  const from = [target.x, target.z + target.r + 2];
  state.player.position = [from[0], 0, from[1]];
  const heading = Math.atan2(-(target.x - from[0]), -(target.z - from[1]));
  let current = state;
  let closest = Infinity;
  let travelled = 0;
  let previous = [from[0], from[1]];
  for (let i = 0; i < 120; i += 1) {
    current = step(current, { forward: true, run: true, cameraYaw: heading }, 0.05).state;
    const [px, , pz] = current.player.position;
    closest = Math.min(closest, Math.hypot(px - target.x, pz - target.z));
    travelled += Math.hypot(px - previous[0], pz - previous[1]);
    previous = [px, pz];
  }
  const reach = target.r + WALKER_RADIUS;
  check(
    "le marcheur ne pénètre jamais dans le fût",
    closest >= reach - 0.02,
    `plus proche ${round(closest)} m pour un contact à ${round(reach)} m`,
  );
  check("il a bien avancé avant de buter", travelled > 1.2, `${round(travelled)} m parcourus`);
  const [, , pz] = current.player.position;
  check("il est resté du bon côté", pz > target.z, `z ${round(pz)} contre ${round(target.z)}`);
}

console.log("\nOn glisse le long du tronc, on ne colle pas");
{
  // Arrivée en biais : la part de déplacement parallèle au fût doit survivre.
  const state = spawn();
  const side = 2.4;
  const from = [target.x + side * 0.72, target.z + target.r + side * 0.72];
  state.player.position = [from[0], 0, from[1]];
  const heading = Math.atan2(-(target.x - from[0]), -(target.z - from[1]));
  let current = state;
  for (let i = 0; i < 80; i += 1) {
    current = step(current, { forward: true, cameraYaw: heading }, 0.05).state;
  }
  const [px, , pz] = current.player.position;
  const lateral = Math.abs(px - from[0]);
  check("le marcheur a contourné le fût", lateral > 0.35, `${round(lateral)} m gagnés sur le côté`);
  check("sans y entrer", Math.hypot(px - target.x, pz - target.z) >= target.r + WALKER_RADIUS - 0.02);
}

console.log("\nUn pas maladroit ne laisse pas dans le tronc");
{
  // Image en retard, télédéplacement, chute de réseau : le trajet est découpé,
  // donc un grand pas ne peut pas ressortir de l'autre côté sans avoir été
  // testé au passage.
  const from = [target.x, target.z + target.r + 0.55];
  const to = [target.x, target.z - target.r - 0.55];
  const [x, z] = moveWalker(from[0], from[1], to[0], to[1]);
  check("après un pas de 2,5 m, on n'est pas dans le fût", isClear(x, z, WALKER_RADIUS), `(${round(x)}, ${round(z)})`);

  let trapped = 0;
  let seed = 91;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  let px = 34;
  let pz = 46;
  for (let i = 0; i < 400; i += 1) {
    const angle = rand() * Math.PI * 2;
    const distance = 0.2 + rand() * 1.3;
    [px, pz] = moveWalker(px, pz, px + Math.cos(angle) * distance, pz + Math.sin(angle) * distance);
    if (!isClear(px, pz)) trapped += 1;
  }
  check("quatre cents pas tirés au hasard, aucun dans un fût", trapped === 0, `${trapped} fin(s) dans un arbre`);
}

console.log("\nSe promener dans la futaie");
{
  let state = spawn();
  let inside = 0;
  let samples = 0;
  // Marche au hasard : on tourne régulièrement et on avance. Trois cents
  // images, soit une bonne quinzaine de mètres dans les arbres.
  let yaw = 0;
  let seed = 7;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  for (let i = 0; i < 300; i += 1) {
    if (i % 25 === 0) yaw += (rand() - 0.5) * 2.4;
    state = step(state, { forward: true, cameraYaw: yaw, run: i % 3 === 0 }, 0.05).state;
    const [px, , pz] = state.player.position;
    samples += 1;
    if (!isClear(px, pz)) inside += 1;
  }
  const [px, , pz] = state.player.position;
  check("aucune image passée dans un tronc", inside === 0, `${inside} sur ${samples} · arrivée (${round(px)}, ${round(pz)})`);
  check("le marcheur a réellement parcouru la forêt", Math.hypot(px - 40, pz - 40) > 4, `${round(Math.hypot(px - 40, pz - 40))} m`);
}

console.log("\nLa trouée du camp");
{
  let own = 0;
  for (const c of collidersNear(SPAWN_CLEARING.x, SPAWN_CLEARING.z, SPAWN_CLEARING.radius + 6)) {
    if (Math.hypot(c.x - SPAWN_CLEARING.x, c.z - SPAWN_CLEARING.z) < SPAWN_CLEARING.radius) own += 1;
  }
  check("aucun fût dans la trouée de départ", own === 0, `${own} arbre(s)`);
  check(
    "le point de départ est libre",
    isClear(0, 6) && isClear(0, 4) && isClear(0, 8) && isClear(1.5, 6),
  );
}

console.log(failures === 0 ? "\nOn ne traverse plus les arbres.\n" : `\n${failures} vérification(s) en échec.\n`);
process.exit(failures === 0 ? 0 : 1);
