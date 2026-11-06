#!/usr/bin/env node
/**
 * Le ciel est-il bleu ?
 *
 *   node scripts/check-sky.mjs
 *
 * Un ciel ne se juge pas sur la valeur hexadécimale posée dans la palette : il
 * se juge sur la couleur qui arrive à l'œil, après l'exposition, la courbe ACES
 * de l'affichage et l'étalonnage de fin de chaîne. C'est exactement là que le
 * bleu se perdait : 0xa6bcc2 est déjà un gris-cyan (14 % de saturation), et
 * l'étalonnage qui sauve la forêt — 68 % de saturation — l'achevait.
 *
 * Ce script refait la chaîne du ciel, image par image :
 *
 *   couleur du dôme → exposition → ACES → sRGB → étalonnage → pixel
 *
 * puis mesure la teinte et la saturation du pixel à plusieurs hauteurs du dôme.
 * Il échoue si le ciel de jour n'est pas bleu, s'il est plus sombre que le
 * feuillage, ou si le ciel de nuit n'est pas sombre.
 */

import { build } from "esbuild";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";

const dir = await mkdtemp(path.join(tmpdir(), "minkebe-sky-"));
const bundle = path.join(dir, "config.mjs");
await build({
  stdin: {
    contents: `export * from "./src/game/sceneConfig.ts";`,
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
const { FOREST_PALETTE, SKY_GRADIENT_EXPONENT, lightForDaylight } = await import(`${bundle}?t=${Date.now()}`);
await rm(dir, { recursive: true, force: true });

/* ---------------- la chaîne d'affichage ---------------- */

const srgbToLinear = (v) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
const linearToSrgb = (v) => (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);
const channels = (hex) => [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
const linear = (hex) => channels(hex).map(srgbToLinear);

/** Courbe ACES d'approximation, celle du rendu. */
const aces = (x) => {
  const a = 2.51;
  const b = 0.03;
  const c = 2.43;
  const d = 0.59;
  const e = 0.14;
  return Math.min(1, Math.max(0, (x * (a * x + b)) / (x * (c * x + d) + e)));
};

const smoothstep = (edge0, edge1, x) => {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

/**
 * Étalonnement de fin de chaîne, identique au shader `gradePass`.
 *
 * La désaturation est pondérée par la vivacité *et* épargne le bleu : sans
 * cela, le ciel — la seule grande surface bleue de la scène — perdait sa
 * couleur au même titre que trois cents mètres carrés de feuillage.
 */
function grade(rgb) {
  const uSat = 0.68;
  const a = rgb.map((v) => Math.min(1, Math.max(0, (v - 0.5) * 1.04 + 0.5)));
  const luma = 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2];
  const chroma = Math.max(...a) - Math.min(...a);
  const vivid = smoothstep(0.02, 0.3, chroma);
  const blueness = Math.min(1, Math.max(0, (a[2] - Math.max(a[0], a[1])) * 8));
  let keep = uSat - (1 - uSat) * 0.45 * vivid;
  keep = keep + (1 - keep) * blueness;
  const saturated = a.map((v) => luma + (v - luma) * keep);
  // Réchauffement des lumières, refroidissement des ombres — le ciel n'est pas
  // réchauffé : c'est lui qui doit rester bleu.
  const warm = smoothstep(0.45, 1.0, luma) * (1 - blueness);
  const cool = 1 - smoothstep(0.0, 0.45, luma);
  return saturated.map((v, i) => v + [0.035, 0.018, -0.012][i] * warm + [-0.012, 0.0, 0.02][i] * cool);
}

/** Le dôme, tel que le shader le dessine : mélange horizon → zénith. */
function domeAt(zenithHex, hazeHex, elevation) {
  const h = Math.sin(elevation);
  // La pente vient de la configuration : le contrôle ne peut pas mesurer un
  // dégradé que le shader ne dessine pas.
  const mix = Math.pow(Math.min(1, Math.max(0, h)), SKY_GRADIENT_EXPONENT);
  const z = linear(zenithHex);
  const hz = linear(hazeHex);
  return [0, 1, 2].map((i) => hz[i] + (z[i] - hz[i]) * mix);
}

/** Ce que l'œil reçoit. */
function shown(linearColour, daylight) {
  const exposure = lightForDaylight(daylight).exposure;
  const mapped = linearColour.map((v) => linearToSrgb(aces(v * exposure)));
  return grade(mapped).map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255));
}

/* ---------------- mesures ---------------- */

const hex = (rgb) => `#${rgb.map((v) => v.toString(16).padStart(2, "0")).join("")}`;

function hsv(rgb) {
  const [r, g, b] = rgb.map((v) => v / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let hue = 0;
  if (d > 0) {
    if (max === r) hue = ((g - b) / d) % 6;
    else if (max === g) hue = (b - r) / d + 2;
    else hue = (r - g) / d + 4;
  }
  return { hue: (hue * 60 + 360) % 360, sat: max === 0 ? 0 : (d / max) * 100, value: max * 100 };
}

const ELEVATIONS = [
  [8, "au ras de la canopée"],
  [20, "entre deux ramures"],
  [40, "trouée"],
  [78, "zénith"],
];

let failures = 0;
function check(label, ok, detail) {
  if (!ok) failures += 1;
  console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
}

console.log("\nCiel de jour");
const dayZenith = FOREST_PALETTE.skyDay;
const dayHaze = FOREST_PALETTE.skyHaze;
for (const [elevation, name] of ELEVATIONS) {
  const rgb = shown(domeAt(dayZenith, dayHaze, (elevation * Math.PI) / 180), 1);
  const { hue, sat, value } = hsv(rgb);
  console.log(
    `    ${name.padEnd(22)} ${hex(rgb)}  teinte ${hue.toFixed(0)}°  saturation ${sat.toFixed(0)} %  clarté ${value.toFixed(0)} %`,
  );
}

const zenithDay = shown(domeAt(dayZenith, dayHaze, (78 * Math.PI) / 180), 1);
const hazeDay = shown(domeAt(dayZenith, dayHaze, (8 * Math.PI) / 180), 1);
const zenithHsv = hsv(zenithDay);
const hazeHsv = hsv(hazeDay);

check(
  "le zénith de jour est franchement bleu",
  zenithDay[2] - zenithDay[0] > 45 && zenithHsv.hue > 195 && zenithHsv.hue < 240,
  `${hex(zenithDay)}, bleu − rouge = ${zenithDay[2] - zenithDay[0]}`,
);
check(
  "le bleu garde de la saturation",
  zenithHsv.sat > 40,
  `${zenithHsv.sat.toFixed(0)} % (l'ancien ciel en donnait 9)`,
);
check(
  "l'horizon est un bleu pâle, pas un vert",
  hazeDay[2] > hazeDay[1] && hazeDay[2] > hazeDay[0],
  `${hex(hazeDay)}`,
);
check("le ciel est plus clair que le feuillage", zenithHsv.value > 65, `clarté ${zenithHsv.value.toFixed(0)} %`);

console.log("\nCiel de nuit");
const nightZenith = shown(domeAt(FOREST_PALETTE.skyNight, FOREST_PALETTE.skyHazeNight, (78 * Math.PI) / 180), 0);
const nightHsv = hsv(nightZenith);
console.log(`    zénith                 ${hex(nightZenith)}  clarté ${nightHsv.value.toFixed(0)} %`);
check("la nuit est sombre", nightHsv.value < 22, `clarté ${nightHsv.value.toFixed(0)} %`);
check("la nuit reste bleutée", nightZenith[2] >= nightZenith[0], `${hex(nightZenith)}`);

console.log("\nCrépuscule");
const duskHaze = shown(domeAt(FOREST_PALETTE.skyDusk, FOREST_PALETTE.skyHazeDusk, (6 * Math.PI) / 180), 0.4);
const duskTop = shown(domeAt(FOREST_PALETTE.skyDusk, FOREST_PALETTE.skyHazeDusk, (78 * Math.PI) / 180), 0.4);
console.log(`    horizon                    ${hex(duskHaze)}`);
console.log(`    zénith                     ${hex(duskTop)}`);
// Un couchant tropical : la lueur chaude est **au ras de l'horizon**, le
// zénith est déjà passé au bleu de nuit. Un zénith rose est un ciel de carte
// postale, pas un ciel d'Ogooué-Ivindo.
check("l'horizon du couchant est chaud", duskHaze[0] > duskHaze[2] + 10, hex(duskHaze));
check("le zénith du couchant est froid", duskTop[2] > duskTop[0], hex(duskTop));

/* ---------------- planche ---------------- */

/**
 * Le ciel, de l'horizon au zénith, tel qu'il arrive à l'œil.
 *
 * Ce n'est pas une capture du jeu : il n'y a pas de WebGL sans écran. C'est le
 * dôme seul, échantillonné par élévation et passé dans la chaîne complète
 * (exposition, ACES, sRGB, étalonnage). À côté, pour comparaison, la couleur
 * plate que donnait l'ancien ciel.
 */
const outline = process.argv.indexOf("--out");
if (outline > 0) {
  const file = process.argv[outline + 1];
  const W = 720;
  const H = 400;
  const raw = Buffer.alloc(W * H * 3);
  for (let y = 0; y < H; y += 1) {
    // Le haut de l'image est le zénith. L'échelle est linéaire en élévation
    // jusqu'à 30°, puis comprimée : c'est là que se joue la lecture du ciel.
    const t = y / (H - 1);
    const elevation = (1 - t) * 90;
    const rgb = shown(domeAt(dayZenith, dayHaze, (elevation * Math.PI) / 180), 1);
    for (let x = 0; x < W; x += 1) {
      const i = (y * W + x) * 3;
      raw[i] = rgb[0];
      raw[i + 1] = rgb[1];
      raw[i + 2] = rgb[2];
    }
  }
  const before = shown(domeAt(0xa6bcc2, 0x6e7c72, (78 * Math.PI) / 180), 1);
  const labels = `
    <svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
      <style>
        text { font-family: ui-monospace, monospace; fill: #ffffff; font-size: 15px; }
        .dim { fill: #ffffff; opacity: 0.62; font-size: 12px; }
        .rule { stroke: #ffffff; stroke-opacity: 0.28; stroke-width: 1; }
      </style>
      <line x1="0" y1="44" x2="${W}" y2="44" class="rule" />
      <text x="18" y="32">zénith — ${hex(zenithDay)} · teinte ${zenithHsv.hue.toFixed(0)}° · saturation ${zenithHsv.sat.toFixed(0)} %</text>
      <line x1="0" y1="${Math.round((1 - Math.sin((40 * Math.PI) / 180)) * H)}" x2="${W}" y2="${Math.round((1 - Math.sin((40 * Math.PI) / 180)) * H)}" class="rule" />
      <text x="18" y="${Math.round((1 - Math.sin((40 * Math.PI) / 180)) * H) - 10}" class="dim">40° — trouée</text>
      <line x1="0" y1="${Math.round((1 - Math.sin((20 * Math.PI) / 180)) * H)}" x2="${W}" y2="${Math.round((1 - Math.sin((20 * Math.PI) / 180)) * H)}" class="rule" />
      <text x="18" y="${Math.round((1 - Math.sin((20 * Math.PI) / 180)) * H) - 10}" class="dim">20° — entre deux ramures</text>
      <text x="18" y="${H - 18}">horizon — ${hex(hazeDay)} · teinte ${hazeHsv.hue.toFixed(0)}°</text>
      <rect x="${W - 210}" y="20" width="190" height="88" rx="6" fill="#000" fill-opacity="0.34" />
      <rect x="${W - 198}" y="34" width="54" height="30" rx="3" fill="${hex(before)}" />
      <text x="${W - 134}" y="46" class="dim">avant</text>
      <text x="${W - 134}" y="62" class="dim">${hex(before)}</text>
      <rect x="${W - 198}" y="70" width="54" height="30" rx="3" fill="${hex(zenithDay)}" />
      <text x="${W - 134}" y="82" class="dim">après</text>
      <text x="${W - 134}" y="98" class="dim">${hex(zenithDay)}</text>
    </svg>
  `;
  await mkdir(path.dirname(file), { recursive: true });
  await sharp(raw, { raw: { width: W, height: H, channels: 3 } })
    .composite([{ input: Buffer.from(labels) }])
    .png()
    .toFile(file);
  console.log(`  planche : ${file}`);
}

console.log(failures === 0 ? "\n✓ Le ciel est bleu.\n" : `\n✗ ${failures} contrôle(s) en échec.\n`);
process.exit(failures === 0 ? 0 : 1);
