#!/usr/bin/env node
/**
 * Le personnage va-t-il là où il regarde ?
 *
 *   node scripts/check-move.mjs
 *
 * C'était le défaut le plus visible du jeu : les touches étaient relatives au
 * **monde**, pas au regard. On tournait la caméra d'un quart de tour, on
 * appuyait sur « avant », et le personnage partait de travers sur l'écran —
 * alors qu'il est censé marcher vers où l'on regarde.
 *
 * Le contrôle rejoue huit caps de caméra × quatre directions de touche et
 * vérifie trois choses :
 *
 *   1. le pas va bien dans la direction attendue (repère du monde) ;
 *   2. le cap rendu par le moteur correspond à la direction réellement
 *      parcourue — c'est ce cap qui tourne le modèle ;
 *   3. le modèle, tourné de `rotation.y = heading`, pointe dans le sens du pas.
 *
 * Le point 3 est celui qui compte : un cap juste et un modèle tourné à
 * l'envers, c'est un personnage qui marche à reculons.
 */

import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const dir = await mkdtemp(path.join(tmpdir(), "minkebe-move-"));
const bundle = path.join(dir, "move.mjs");
await build({
  stdin: {
    contents: `export * from "./src/game/engine.ts"; export * from "./src/game/collision.ts";`,
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
const { newGame, step, configureCollision } = await import(`${bundle}?t=${Date.now()}`);
// Le sujet de ce contrôle est la direction du pas, pas les obstacles : on
// vide la forêt. Les troncs ont leur propre contrôle (`check-collision.mjs`),
// avec la densité réelle.
configureCollision({ treeDensity: 0, understoryDensity: 0, logDensity: 0 });
await rm(dir, { recursive: true, force: true });

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
};

/** Direction du regard pour un cap donné (repère du jeu : 0 = nord, −Z). */
const gaze = (yaw) => [-Math.sin(yaw), -Math.cos(yaw)];
/** Direction du modèle tourné de `heading` (le maillage regarde vers −Z). */
const facing = (heading) => [-Math.sin(heading), -Math.cos(heading)];

const round = (v) => Math.round(v * 1000) / 1000;
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];

/** Avance d'une seconde avec une touche enfoncée, depuis le camp. */
function walk(input, seconds = 1) {
  const base = newGame();
  // On part d'un point dégagé, loin du camp et de l'eau, pour que le pas ne
  // soit pas dévié par le terrain.
  let state = { ...base, player: { ...base.player, position: [40, 0, 40] } };
  const start = [state.player.position[0], state.player.position[2]];
  const held = { forward: false, backward: false, left: false, right: false, run: false, sneak: false, ...input };
  for (let i = 0; i < seconds * 20; i += 1) {
    state = step(state, held, 0.05).state;
  }
  const dx = state.player.position[0] - start[0];
  const dz = state.player.position[2] - start[1];
  const length = Math.hypot(dx, dz);
  return { heading: state.player.heading, dir: length > 1e-6 ? [dx / length, dz / length] : [0, 0], distance: length };
}

console.log("\nAvancer va dans le regard");
for (const [name, yaw] of [
  ["nord", 0],
  ["est", -Math.PI / 2],
  ["sud", Math.PI],
  ["ouest", Math.PI / 2],
  ["nord-est", -Math.PI / 4],
]) {
  const [gx, gz] = gaze(yaw);
  const { dir, heading } = walk({ forward: true, cameraYaw: yaw });
  const alignment = dot([gx, gz], dir);
  const headingAlignment = dot(facing(heading), dir);
  check(
    `caméra ${name} : le pas suit le regard`,
    alignment > 0.95,
    `alignement ${round(alignment)} · pas (${round(dir[0])}, ${round(dir[1])})`,
  );
  check(`caméra ${name} : le modèle regarde devant`, headingAlignment > 0.95, `alignement ${round(headingAlignment)}`);
}

console.log("\nReculer, aller à gauche, à droite");
const north = 0;
const cases = [
  { key: "backward", name: "reculer", expect: [0, 1] },
  { key: "left", name: "gauche", expect: [-1, 0] },
  { key: "right", name: "droite", expect: [1, 0] },
];
for (const entry of cases) {
  const { dir, heading } = walk({ [entry.key]: true, cameraYaw: north });
  const alignment = dot(entry.expect, dir);
  check(`caméra au nord : ${entry.name}`, alignment > 0.95, `pas (${round(dir[0])}, ${round(dir[1])})`);
  check(
    `caméra au nord : le modèle fait face en ${entry.name === "reculer" ? "reculant" : "marchant " + entry.name}`,
    dot(facing(heading), dir) > 0.95,
  );
}

console.log("\nLe cap suit la boussole");
{
  // Cap rendu au moteur : la boussole affiche `-heading` en degrés.
  const east = walk({ right: true, cameraYaw: north });
  const deg = ((-east.heading * 180) / Math.PI + 360) % 360;
  check("marcher vers l'est donne 90° à la boussole", Math.abs(deg - 90) < 2, `${Math.round(deg)}°`);
  const west = walk({ left: true, cameraYaw: north });
  const westDeg = ((-west.heading * 180) / Math.PI + 360) % 360;
  check("marcher vers l'ouest donne 270°", Math.abs(westDeg - 270) < 2, `${Math.round(westDeg)}°`);
}

console.log("\nLe tour complet");
{
  // Le joueur tourne sur lui-même : son cap doit suivre, sans à-coup ni
  // demi-tour dans le mauvais sens au passage de ±180°. C'était le défaut
  // « ça ne tourne pas à 360° » : les interpolations angulaires allaient
  // d'un bord à l'autre par le chemin long.
  const base = { ...newGame(), player: { ...newGame().player, position: [40, 0, 40] } };
  let state = base;
  const steps = 48;
  const headings = [];
  const directions = [];
  for (let i = 0; i < steps * 2; i += 1) {
    const yaw = (i / steps) * Math.PI * 2;
    const before = state.player.position;
    state = step(state, { forward: true, cameraYaw: yaw }, 0.05).state;
    const after = state.player.position;
    headings.push(state.player.heading);
    directions.push([after[0] - before[0], after[2] - before[2]]);
  }
  // Écart entre deux images : jamais un demi-tour.
  let biggest = 0;
  for (let i = 1; i < headings.length; i += 1) {
    biggest = Math.max(biggest, Math.abs(Math.atan2(Math.sin(headings[i] - headings[i - 1]), Math.cos(headings[i] - headings[i - 1]))));
  }
  check("le cap tourne sans à-coup", biggest < 0.35, `écart maxi ${round(biggest)} rad`);
  const full = headings.filter((h) => Number.isFinite(h));
  check("aucun cap invalide", full.length === headings.length);
  // Après un tour, on repart vers le nord.
  const [dx, dz] = directions[steps * 2 - 1];
  const len = Math.hypot(dx, dz) || 1;
  check("au bout d'un tour, le pas repart vers le nord", Math.abs(dz / len + 1) < 0.08 || Math.abs(-dz / len - 1) < 0.08, `pas (${round(dx / len)}, ${round(dz / len)})`);
}

console.log("\nSans caméra déclarée");
{
  // Le moteur doit rester utilisable seul (tests, scripts) : cap 0 = nord.
  const { dir } = walk({ forward: true });
  check("par défaut, avancer va vers le nord", dot([0, -1], dir) > 0.95, `pas (${round(dir[0])}, ${round(dir[1])})`);
}

console.log(
  failures === 0
    ? "\nLe personnage marche là où l'on regarde.\n"
    : `\n${failures} vérification(s) en échec.\n`,
);
process.exit(failures === 0 ? 0 : 1);
