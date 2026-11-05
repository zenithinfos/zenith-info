#!/usr/bin/env node
/**
 * Planche de couleurs de la forêt.
 *
 *   node scripts/check-palette.mjs
 *
 * Les couleurs d'une forêt ne se choisissent pas sur une palette : elles
 * sortent du produit « albédo de la texture × teinte de la matière × lumière ×
 * courbe d'affichage ». Ce script fait ce calcul pour chaque matière et imprime
 * les pastilles obtenues, à côté des couleurs actuelles — de quoi juger une
 * dérive (trop saturé, trop froid) sans lancer le jeu.
 *
 * Ce n'est pas un rendu : pas de relief, pas d'ombre, pas de texture. C'est la
 * couleur que la matière aura à l'écran, en plein jour, sous la canopée.
 */

import { build } from "esbuild";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";

const dir = await mkdtemp(path.join(tmpdir(), "minkebe-palette-"));
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
const { lightForDaylight } = await import(`${bundle}?t=${Date.now()}`);
await rm(dir, { recursive: true, force: true });

const budget = lightForDaylight(1);

/* ---------------- couleur : mêmes maths que le moteur ---------------- */

const lin = (hex) => {
  const f = (v) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
  return [f(((hex >> 16) & 255) / 255), f(((hex >> 8) & 255) / 255), f((hex & 255) / 255)];
};
const srgb = (v) => (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);
const aces = (x) => {
  const a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
  return Math.min(1, Math.max(0, (x * (a * x + b)) / (x * (c * x + d) + e)));
};
const SKY = lin(0x9fc4d8);
const GROUND = lin(0x2c3a24);
const ENV = lin(0x9ab8a0);

/** Moyenne mesurée des cartes (sharp, canal par canal). */
const TEXTURES = {
  foliage: [77, 111, 83],
  foliageDeep: [61, 85, 80],
  foliagePale: [97, 118, 96],
  bark: [74, 63, 48],
  ground: [47, 38, 24],
  fern: [97, 127, 99],
  bigleaf: [71, 107, 84],
};

/**
 * Étalonnage de fin de chaîne, identique au shader `gradePass` de Scene.tsx.
 *
 * Deux réglages, dans cet ordre : la courbe en S, puis la désaturation
 * pondérée. Le contraste ajoute de la saturation perçue ; c'est pour cela que
 * la désaturation vient après lui, jamais avant.
 */
// `OLD_GRADE=1 node scripts/check-palette.mjs` rejoue l'étalonnage précédent
// (86 %, courbe 1,06) : c'est ainsi qu'on chiffre un avant/après au lieu de
// discuter d'une impression.
const LEGACY = process.env.OLD_GRADE === "1";

function grade(rgb, { sat = LEGACY ? 0.86 : 0.68, contrast = LEGACY ? 1.06 : 1.04 } = {}) {
  const out = rgb.map((v) => Math.min(1, Math.max(0, (v - 0.5) * contrast + 0.5)));
  const luma = 0.2126 * out[0] + 0.7152 * out[1] + 0.0722 * out[2];
  const mx = Math.max(...out);
  const mn = Math.min(...out);
  const vivid = LEGACY ? 0 : smoothstep(0.02, 0.3, mx - mn);
  const keep = Math.max(0, sat - (1 - sat) * 0.45 * vivid);
  return out.map((v) => luma + (v - luma) * keep);
}

function smoothstep(edge0, edge1, x) {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** Saturation HSV d'une couleur sRGB 0-255, en %. */
function saturation(rgb) {
  const max = Math.max(...rgb) / 255;
  const min = Math.min(...rgb) / 255;
  return max <= 0 ? 0 : Math.round(((max - min) / max) * 100);
}

/**
 * Couleur physique : albédo × lumière × ACES → sRGB, sans étalonnage.
 *
 * C'est cette chaîne-là que `solveTint` inverse. Les teintes sont une
 * correction de texture ; l'étalonnage est un parti pris d'image appliqué
 * par-dessus. Résoudre une teinte *à travers* l'étalonnage obligerait à
 * pousser les verts jusqu'au néon pour compenser la désaturation — et une
 * texture néon reste néon dans les coins d'ombre.
 */
function raw(texture, tint, up = 1, gain = 1) {
  const t = [(texture[0] * ((tint >> 16) & 255)) / 255, (texture[1] * ((tint >> 8) & 255)) / 255, (texture[2] * (tint & 255)) / 255];
  const albedo = lin((Math.min(255, Math.round(t[0] * gain)) << 16) | (Math.min(255, Math.round(t[1] * gain)) << 8) | Math.min(255, Math.round(t[2] * gain)));
  const out = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    const hemi = GROUND[i] + (SKY[i] - GROUND[i]) * (0.5 + 0.5 * up);
    const irradiance = budget.ambient + budget.hemisphere * hemi + budget.environment * ENV[i] + budget.sun * 0.25;
    out[i] = aces((albedo[i] / Math.PI) * irradiance * budget.exposure);
  }
  return out.map((v) => srgb(v));
}

/** Couleur telle qu'elle arrive à l'œil, étalonnage compris. */
function shown(texture, tint, up = 1, gain = 1) {
  return grade(raw(texture, tint, up, gain)).map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255));
}

/**
 * Trouve la teinte qui donne une couleur cible à l'écran.
 *
 * La chaîne albédo → lumière → ACES → sRGB est monotone et indépendante par
 * canal : une bissection par canal donne la teinte exacte. C'est ce qui permet
 * de partir de la couleur qu'on veut voir — celle d'une vraie forêt — au lieu
 * de tâtonner sur des valeurs hexadécimales.
 */
function solveTint(texture, target) {
  const out = [0, 0, 0];
  for (let c = 0; c < 3; c++) {
    const packed = (value) => {
      const t = [255, 255, 255];
      t[c] = value;
      return (t[0] << 16) | (t[1] << 8) | t[2];
    };
    let lo = 0;
    let hi = 255;
    for (let i = 0; i < 18; i++) {
      const mid = Math.round((lo + hi) / 2);
      if (raw(texture, packed(mid))[c] * 255 < target[c]) lo = mid;
      else hi = mid;
    }
    out[c] = Math.round((lo + hi) / 2);
  }
  return out;
}

/* ---------------- les matières, avant / après ---------------- */

/**
 * Cibles : des couleurs relevées sur des photos de sous-bois du bassin du
 * Congo, pas sur une palette graphique. Un vert de feuille y est toujours
 * jaune-olive — beaucoup de rouge, peu de bleu — alors que nos cartes viraient
 * au vert d'eau (bleu aussi fort que rouge).
 */
const MATIERES = [
  // Teintes réellement posées dans Scene.tsx : c'est la seule façon que ce
  // contrôle mesure quelque chose. (Elles ont été résolues à l'envers, à partir
  // des cibles photo ci-dessous, par la bissection de `solveTint`.)
  { label: "feuillage clair", texture: "foliage", now: 0xfbb092, target: 0x5d6b34 },
  { label: "feuillage profond", texture: "foliageDeep", now: 0xdca788, target: 0x33422a },
  { label: "feuillage pâle", texture: "foliagePale", now: 0xf1c0b4, target: 0x79825a },
  { label: "fougère", texture: "fern", now: 0xd9aa92, target: 0x6a7a45 },
  { label: "grande feuille", texture: "bigleaf", now: 0xfab29a, target: 0x51683a },
  { label: "litière", texture: "foliagePale", now: 0xbc8174, target: 0x554a2c },
  { label: "écorce", texture: "bark", now: 0xc9c2b2, target: 0x453b2c },
  { label: "sol", texture: "ground", now: 0xffffff, target: 0x6b5330, gainNow: 1.8, gainNext: 1.8 },
];

const rows = [];
for (const m of MATIERES) {
  const solved = solveTint(TEXTURES[m.texture], [
    ((m.target >> 16) & 255),
    ((m.target >> 8) & 255),
    (m.target & 255),
  ]);
  const tint = (solved[0] << 16) | (solved[1] << 8) | solved[2];
  rows.push({
    label: m.label,
    now: shown(TEXTURES[m.texture], m.now, 1, m.gainNow ?? 1),
    next: shown(TEXTURES[m.texture], tint, 1, m.gainNext ?? 1),
    tint,
    target: m.target,
  });
}

/* ---------------- saturation ---------------- */

/**
 * La saturation, en pourcentage HSV, de ce qui arrive à l'œil.
 *
 * C'est le chiffre qui manquait : la luminescence disait « la forêt est
 * lisible », pas « la forêt est criarde ». Une feuille de sous-bois
 * photographiée tient entre 20 et 32 % ; au-delà de 38 %, un plein écran de
 * feuillage vire à l'affiche. Ce contrôle échoue si une matière dépasse.
 */
const SAT_CAP = 38;
const saturations = rows.map((r) => ({ label: r.label, before: saturation(r.now), after: saturation(r.next) }));
let oversaturated = 0;
for (const row of saturations) {
  const flag = row.before > SAT_CAP ? `  ← au-dessus de ${SAT_CAP} %` : "";
  if (row.before > SAT_CAP) oversaturated += 1;
  console.log(`  ${row.label.padEnd(18)} saturation ${String(row.before).padStart(3)} %  →  ${String(row.after).padStart(3)} %${flag}`);
}
const meanSat = Math.round(saturations.reduce((sum, row) => sum + row.before, 0) / saturations.length);
const meanAfter = Math.round(saturations.reduce((sum, row) => sum + row.after, 0) / saturations.length);

/* ---------------- planche ---------------- */

const W = 900;
const ROW = 74;
const H = 92 + rows.length * ROW + 60;
const hex = (rgb) => `#${rgb.map((v) => v.toString(16).padStart(2, "0")).join("")}`;

const svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <rect width="100%" height="100%" fill="#14170f"/>
  <text x="28" y="46" fill="#d7dcc2" font-family="Helvetica,Arial" font-size="26" font-weight="600">Couleurs de la forêt — couleur affichée, plein jour sous canopée</text>
  <text x="28" y="74" fill="#7d8568" font-family="Helvetica,Arial" font-size="16">à gauche l'ancienne teinte, à droite la couleur visée ; albédo × lumière × ACES, sans relief ni ombre</text>
  ${rows
    .map(
      (r, i) => `<g>
    <text x="28" y="${112 + i * ROW + 30}" fill="#aab08f" font-family="Helvetica,Arial" font-size="18">${r.label}</text>
    <rect x="230" y="${104 + i * ROW}" width="240" height="54" rx="6" fill="${hex(r.now)}"/>
    <rect x="500" y="${104 + i * ROW}" width="240" height="54" rx="6" fill="${hex(r.next)}"/>
    <text x="790" y="${112 + i * ROW + 22}" fill="#7d8568" font-family="Helvetica,Arial" font-size="14">${hex(r.now)}</text>
    <text x="790" y="${112 + i * ROW + 42}" fill="#c3c9a6" font-family="Helvetica,Arial" font-size="14">${hex(r.next)}</text>
  </g>`,
    )
    .join("")}
  <text x="28" y="${H - 24}" fill="#5d6450" font-family="Helvetica,Arial" font-size="14">ambiance : ciel ${"#9fc4d8"} → ${"#a6bcc2"} · brouillard ${"#5f7d64"} → ${"#6e7c72"} · canopée ${"#1f3d24"} → ${"#2a3520"}</text>
</svg>`;

await mkdir("preview", { recursive: true });
await sharp(Buffer.from(svg)).png().toFile("preview/palette-foret.png");

for (const r of rows) {
  console.log(`${r.label.padEnd(18)} avant  ${hex(r.now)}   couleur ${hex(r.next)}   teinte ${hex([(r.tint >> 16) & 255, (r.tint >> 8) & 255, r.tint & 255])}`);
}
const mean = (rgb) => Math.round((rgb[0] + rgb[1] + rgb[2]) / 3);
console.log("\nmoyenne actuelle", Math.round(rows.reduce((s, r) => s + mean(r.now), 0) / rows.length), "% · proposée", Math.round(rows.reduce((s, r) => s + mean(r.next), 0) / rows.length), "%");
console.log(`saturation moyenne ${meanSat} % → ${meanAfter} % (plafond ${SAT_CAP} %)`);
if (oversaturated > 0) {
  console.log(`\n${oversaturated} matière(s) trop saturée(s).`);
  process.exitCode = 1;
}
void readFile;
