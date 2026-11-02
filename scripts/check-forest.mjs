#!/usr/bin/env node
/**
 * Contrôle de densité de la forêt.
 *
 *   node scripts/check-forest.mjs
 *
 * Compile les modules purs du jeu (esbuild) puis lance un lancer de rayons
 * depuis la hauteur d'œil : on mesure la fraction de ciel visible. Une forêt de
 * terre ferme du bassin du Congo doit masquer l'essentiel du ciel depuis le
 * sentier (on ne voit le ciel que dans les baïs).
 */

import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const entry = `
  export { buildTile, crownCards, densityAt, forestStats, mulberry32, tilesAround, tileSeed } from "./src/game/forest.ts";
  export { terrainHeight } from "./src/game/terrain.ts";
`;

async function load() {
  const dir = await mkdtemp(path.join(tmpdir(), "minkebe-forest-"));
  const outFile = path.join(dir, "bundle.mjs");
  await build({
    stdin: { contents: entry, resolveDir: process.cwd(), loader: "ts" },
    bundle: true,
    format: "esm",
    platform: "node",
    outfile: outFile,
    logLevel: "silent",
  });
  const mod = await import(outFile);
  await rm(dir, { recursive: true, force: true });
  return mod;
}

const { buildTile, crownCards, densityAt, terrainHeight, forestStats, mulberry32, tilesAround } =
  await load();

const START = [0, 6];
const CLEARING = { x: START[0], z: START[1], radius: 7 };

// On mesure exactement ce que le jeu charge : les tuiles autour du joueur.
// Les couronnes sont mises en cache par tuile, comme le fait le jeu.
const crownCache = new Map();
function treesAround(x, z, radius = 2) {
  const out = [];
  for (const [tileX, tileZ] of tilesAround(x, z, radius)) {
    const key = `${tileX}:${tileZ}`;
    if (!crownCache.has(key)) {
      crownCache.set(key, buildTile(tileX, tileZ, { clearing: CLEARING }));
    }
    out.push(...crownCache.get(key).trees);
  }
  return out;
}

const startedAt = performance.now();
const trees = treesAround(START[0], START[1]);
const generationMs = performance.now() - startedAt;
const stats = forestStats(trees);

/* ------------------------------------------------------------------ */
/* Occultation du ciel : lancer de rayons sur une demi-sphère          */
/* ------------------------------------------------------------------ */

const EYE = 1.62;
const origin = [START[0], terrainHeight(START[0], START[1]) + EYE, START[1]];

// Volumes de couronne approchés par des sphères (une par carte de feuillage).
function crownsOf(treeList, seed) {
  const random = mulberry32(seed);
  const out = [];
  for (const tree of treeList) {
    for (const card of crownCards(tree, random)) {
      out.push({
        x: tree.x + card.offset[0],
        y: tree.y + card.offset[1],
        z: tree.z + card.offset[2],
        r: Math.max(card.width, card.height) * 0.42,
      });
    }
  }
  return out;
}

const crowns = crownsOf(trees, 4242);

function rayHitsSphere(o, d, s, maxDist) {
  const ox = s.x - o[0];
  const oy = s.y - o[1];
  const oz = s.z - o[2];
  const tca = ox * d[0] + oy * d[1] + oz * d[2];
  if (tca < 0) return false;
  const d2 = ox * ox + oy * oy + oz * oz - tca * tca;
  if (d2 > s.r * s.r) return false;
  const thc = Math.sqrt(s.r * s.r - d2);
  const t0 = tca - thc;
  return t0 > 0.5 && t0 < maxDist;
}

function skyVisibility(origin, maxDist = 90) {
  let blocked = 0;
  let total = 0;
  const rings = 14;
  for (let ring = 0; ring < rings; ring++) {
    // Élévation de 2° à 88°, pondérée par le cosinus (plus de rayons au zénith).
    const elevation = ((ring + 0.5) / rings) * (Math.PI / 2) * 0.98 + 0.03;
    const samples = Math.max(8, Math.round(28 * Math.cos(elevation)));
    for (let a = 0; a < samples; a++) {
      const azimuth = (a / samples) * Math.PI * 2 + ring * 0.37;
      const d = [
        Math.cos(elevation) * Math.cos(azimuth),
        Math.sin(elevation),
        Math.cos(elevation) * Math.sin(azimuth),
      ];
      total += 1;
      for (const crown of crowns) {
        if (rayHitsSphere(origin, d, crown, maxDist)) {
          blocked += 1;
          break;
        }
      }
    }
  }
  return 1 - blocked / total;
}

const visibility = skyVisibility(origin);

// Occultation à différentes distances de la caméra : la forêt doit rester
// dense partout, pas seulement au point de départ.
const probes = [
  ["camp", 0, 6],
  ["sentier", 60, 30],
  ["forêt profonde", 130, 90],
  ["baï (clairière)", 45, 160],
  ["rivière", -90, 110],
  ["colline (coin)", 180, 200],
  ["canopée", 110, -80],
];

console.log(`Génération          : ${generationMs.toFixed(0)} ms`);
console.log(`Arbres générés      : ${stats.total} (émergents ${stats.emergent}, moyens ${stats.mid}, taillis ${stats.understory})`);
console.log(`Couverture couronne : ${(stats.coverage * 100).toFixed(1)} % de la surface`);
console.log(`Ciel visible (œil)  : ${(visibility * 100).toFixed(1)} %\n`);

console.log("Sonde                densité   ciel visible");
for (const [label, x, z] of probes) {
  const o = [x, terrainHeight(x, z) + EYE, z];
  const probeCrowns = crownsOf(treesAround(x, z), x * 31 + z);
  let blocked = 0;
  let total = 0;
  const rings = 14;
  for (let ring = 0; ring < rings; ring++) {
    const elevation = ((ring + 0.5) / rings) * (Math.PI / 2) * 0.98 + 0.03;
    const samples = Math.max(8, Math.round(28 * Math.cos(elevation)));
    for (let a = 0; a < samples; a++) {
      const azimuth = (a / samples) * Math.PI * 2 + ring * 0.37;
      const d = [
        Math.cos(elevation) * Math.cos(azimuth),
        Math.sin(elevation),
        Math.cos(elevation) * Math.sin(azimuth),
      ];
      total += 1;
      for (const crown of probeCrowns) {
        if (rayHitsSphere(o, d, crown, 80)) {
          blocked += 1;
          break;
        }
      }
    }
  }
  const v = 1 - blocked / total;
  console.log(`${label.padEnd(20)} ${densityAt(x, z).toFixed(2)}      ${(v * 100).toFixed(1)} %`);
}

/* ------------------------------------------------------------------ */
/* Sanity checks                                                       */
/* ------------------------------------------------------------------ */

const problems = [];
if (stats.total < 600) problems.push(`seulement ${stats.total} arbres chargés autour du joueur`);

const tooClose = trees.filter((tree) => Math.hypot(tree.x, tree.z) < 7);
if (tooClose.length > 0) problems.push(`${tooClose.length} arbre(s) dans la trouée de départ`);

const underground = trees.filter((tree) => tree.y > terrainHeight(tree.x, tree.z) + 0.5);
if (underground.length > 0) problems.push(`${underground.length} arbre(s) flottant au-dessus du sol`);

if (visibility > 0.4) problems.push(`ciel trop visible au départ (${(visibility * 100).toFixed(0)} %)`);

console.log("");
if (problems.length > 0) {
  console.log("⚠ Problèmes détectés :");
  for (const p of problems) console.log(`  · ${p}`);
  process.exitCode = 1;
} else {
  console.log("✓ Densité et placement conformes.");
}
