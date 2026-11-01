#!/usr/bin/env node
/**
 * Planche de proportions de la faune.
 *
 *   node scripts/preview-animals.mjs [--out /tmp/faune.png]
 *
 * Il n'y a pas de WebGL hors navigateur : ce script dessine donc chaque animal
 * **de profil**, à partir des mêmes chiffres que le modèle 3D (game/animals.ts)
 * et des mêmes formules de placement que AnimalModel.ts. Ce n'est pas une image
 * du jeu — c'est un contrôle de proportions : est-ce que le céphalophe a bien
 * des pattes fines et un dos rond, est-ce que l'éléphant a bien sa trompe, ses
 * défenses et ses grandes oreilles, est-ce que le gorille n'a pas des pattes de
 * girafe ?
 */

import { build } from "esbuild";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";

const argv = process.argv.slice(2);
const getArg = (name, fallback) => {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 ? argv[index + 1] : fallback;
};

const OUT = getArg("out", "/tmp/faune.png");
await mkdir(path.dirname(OUT), { recursive: true });

async function loadGame() {
  const dir = await mkdtemp(path.join(tmpdir(), "minkebe-faune-"));
  const outFile = path.join(dir, "bundle.mjs");
  await build({
    stdin: {
      contents: `export { ANIMAL_BUILDS, bodyCenterY, headCenterY } from "./src/game/animals.ts";`,
      resolveDir: process.cwd(),
      loader: "ts",
    },
    bundle: true,
    format: "esm",
    platform: "node",
    outfile: outFile,
    logLevel: "error",
  });
  const gameModule = await import(`${outFile}?t=${Date.now()}`);
  await rm(dir, { recursive: true, force: true });
  return gameModule;
}

const game = await loadGame();

const PANEL = 300;
const COLS = 5;
const ROWS = 2;
const species = Object.keys(game.ANIMAL_BUILDS);
const WIDTH = PANEL * COLS;
const HEIGHT = PANEL * ROWS;

function hex(colour) {
  return `#${colour.toString(16).padStart(6, "0")}`;
}

function panel(speciesId, index) {
  const buildData = game.ANIMAL_BUILDS[speciesId];
  const col = index % COLS;
  const row = Math.floor(index / COLS);
  const originX = col * PANEL;
  const originY = row * PANEL;

  const bodyY = game.bodyCenterY(buildData);
  const headY = game.headCenterY(buildData);
  const headZ = buildData.length * 0.42 + buildData.neck * 0.5;
  const hipY = bodyY - buildData.girth * 0.32;
  const legLength = hipY;

  const totalHeight = Math.max(headY + buildData.head * 0.8, bodyY + buildData.girth);
  const span = Math.max(buildData.length + buildData.neck, totalHeight * 1.2) * 1.35;
  const scale = Math.min(PANEL * 0.72, 200) / Math.max(0.5, span);

  // Repère : sol en bas, animal tourné vers la droite.
  const groundY = originY + PANEL - 46;
  const midX = originX + PANEL / 2 - (buildData.length * 0.25) * scale;
  const X = (z) => midX + z * scale;
  const Y = (y) => groundY - y * scale;

  const coat = hex(buildData.coat);
  const belly = hex(buildData.belly);
  const accent = hex(buildData.accent);

  let shapes = "";

  // Corps
  shapes += `<rect x="${X(-buildData.length / 2)}" y="${Y(bodyY + buildData.girth)}" width="${buildData.length * scale}" height="${buildData.girth * 2 * scale}" rx="${buildData.girth * scale}" fill="${coat}"/>`;
  shapes += `<ellipse cx="${X(buildData.length * 0.24)}" cy="${Y(bodyY + buildData.girth * 0.08)}" rx="${buildData.girth * 1.02 * scale}" ry="${buildData.girth * 0.95 * scale}" fill="${coat}"/>`;
  shapes += `<ellipse cx="${X(-buildData.length * 0.26)}" cy="${Y(bodyY + buildData.girth * 0.12)}" rx="${buildData.girth * 1.08 * scale}" ry="${buildData.girth * 1.05 * scale}" fill="${coat}"/>`;

  // Pattes : hanche → genou → pied, deux segments comme dans le modèle.
  for (const front of [true, false]) {
    const z = front ? buildData.length * 0.3 : -buildData.length * 0.3;
    const upper = legLength * 0.55;
    const lower = legLength * 0.45;
    const strokeWidth = Math.max(2, buildData.girth * 0.46 * scale);
    shapes += `<line x1="${X(z)}" y1="${Y(hipY)}" x2="${X(z)}" y2="${Y(hipY - upper)}" stroke="${coat}" stroke-width="${strokeWidth}" stroke-linecap="round"/>`;
    shapes += `<line x1="${X(z)}" y1="${Y(hipY - upper)}" x2="${X(z + (front ? 0.04 : -0.04))}" y2="${Y(Math.max(0, hipY - upper - lower))}" stroke="${coat}" stroke-width="${strokeWidth * 0.7}" stroke-linecap="round"/>`;
  }

  // Cou
  shapes += `<line x1="${X(buildData.length * 0.28)}" y1="${Y(bodyY + buildData.girth * 0.35)}" x2="${X(headZ - buildData.head * 0.12)}" y2="${Y(headY - buildData.head * 0.18)}" stroke="${coat}" stroke-width="${Math.max(2, buildData.girth * 0.62 * scale)}" stroke-linecap="round"/>`;

  // Tête
  shapes += `<circle cx="${X(headZ)}" cy="${Y(headY)}" r="${buildData.head * 0.5 * scale}" fill="${coat}"/>`;
  // Museau
  if (buildData.muzzle > 0.02) {
    shapes += `<rect x="${X(headZ + buildData.head * 0.2)}" y="${Y(headY + buildData.head * 0.05)}" width="${buildData.muzzle * 1.1 * scale}" height="${buildData.head * 0.32 * scale}" rx="${buildData.head * 0.14 * scale}" fill="${belly}"/>`;
  }
  // Oreilles
  if (buildData.ears > 0.01) {
    shapes += `<ellipse cx="${X(headZ - buildData.head * 0.1)}" cy="${Y(headY + buildData.head * 0.42)}" rx="${buildData.ears * 0.55 * scale}" ry="${buildData.ears * 0.6 * scale}" fill="${coat}"/>`;
  }
  // Cornes
  if (buildData.horn === "lyre") {
    shapes += `<path d="M ${X(headZ - buildData.head * 0.05)} ${Y(headY + buildData.head * 0.35)} q ${-0.1 * scale} ${-buildData.hornLength * 0.6 * scale} ${buildData.head * 0.1 * scale} ${-buildData.hornLength * scale}" fill="none" stroke="${accent}" stroke-width="${Math.max(1.5, buildData.head * 0.11 * scale)}" stroke-linecap="round"/>`;
  } else if (buildData.horn === "droite") {
    shapes += `<line x1="${X(headZ - buildData.head * 0.1)}" y1="${Y(headY + buildData.head * 0.4)}" x2="${X(headZ - buildData.head * 0.02)}" y2="${Y(headY + buildData.head * 0.4 + buildData.hornLength)}" stroke="${accent}" stroke-width="${Math.max(1.5, buildData.head * 0.09 * scale)}" stroke-linecap="round"/>`;
  } else if (buildData.horn === "defense") {
    shapes += `<path d="M ${X(headZ + buildData.head * 0.3)} ${Y(headY - buildData.head * 0.1)} q ${buildData.head * 0.7 * scale} ${buildData.head * 0.2 * scale} ${buildData.head * 0.9 * scale} ${buildData.head * 0.9 * scale}" fill="none" stroke="${belly}" stroke-width="${Math.max(2, buildData.head * 0.16 * scale)}" stroke-linecap="round"/>`;
    // Trompe
    shapes += `<path d="M ${X(headZ + buildData.head * 0.3)} ${Y(headY - buildData.head * 0.12)} q ${buildData.head * 0.45 * scale} ${-buildData.head * 0.4 * scale} ${buildData.head * 0.6 * scale} ${-buildData.head * 1.0 * scale}" fill="none" stroke="${coat}" stroke-width="${Math.max(2, buildData.head * 0.34 * scale)}" stroke-linecap="round"/>`;
  }
  // Queue
  if (buildData.tail > 0.05) {
    shapes += `<line x1="${X(-buildData.length * 0.52)}" y1="${Y(bodyY + buildData.girth * 0.35)}" x2="${X(-buildData.length * 0.62)}" y2="${Y(bodyY + buildData.girth * 0.35 - buildData.tail)}" stroke="${coat}" stroke-width="${Math.max(1.5, buildData.girth * 0.1 * scale)}" stroke-linecap="round"/>`;
  }

  // Robe : rayures ou taches, mêmes formules que le modèle.
  if (buildData.pattern === "rayures") {
    for (let i = 0; i < 8; i++) {
      const z = buildData.length * 0.3 - (i / 8) * buildData.length * 0.6;
      shapes += `<line x1="${X(z)}" y1="${Y(bodyY + buildData.girth)}" x2="${X(z)}" y2="${Y(bodyY - buildData.girth * 0.8)}" stroke="${accent}" stroke-width="${Math.max(1.5, buildData.girth * 0.13 * scale)}"/>`;
    }
  }

  const label = speciesId.replace(/-/g, " ");
  return `${shapes}
    <line x1="${originX + 10}" y1="${groundY}" x2="${originX + PANEL - 10}" y2="${groundY}" stroke="#6f8f68" stroke-width="1" opacity="0.5"/>
    <text x="${originX + 12}" y="${originY + 20}" fill="#e8e4d2" font-family="sans-serif" font-size="13">${label}</text>
    <text x="${originX + 12}" y="${originY + 36}" fill="#9fb39b" font-family="sans-serif" font-size="10">${buildData.shoulder.toFixed(2)} m au garrot · ${buildData.health} PV · ${buildData.meat} kg</text>
    <line x1="${originX + PANEL - 60}" y1="${groundY}" x2="${originX + PANEL - 60 + scale}" y2="${groundY}" stroke="#e8e4d2" stroke-width="2"/>
    <text x="${originX + PANEL - 58}" y="${groundY - 6}" fill="#e8e4d2" font-family="sans-serif" font-size="9">1 m</text>`;
}

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
  <rect width="${WIDTH}" height="${HEIGHT}" fill="#1b241c"/>
  ${species.map(panel).join("\n")}
</svg>`;

await writeFile("/tmp/faune.svg", svg);
await sharp(Buffer.from(svg)).png().toFile(OUT);
console.log(`Planche de proportions : ${OUT}`);
console.log(`${species.length} espèces : ${species.join(", ")}`);
