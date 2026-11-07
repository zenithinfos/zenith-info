#!/usr/bin/env node
/**
 * Le design tient-il debout ?
 *
 *   node scripts/check-design.mjs
 *
 * Une interface ne se juge pas au goût. Trois choses se mesurent, et ce sont
 * exactement celles qui faisaient défaut ici :
 *
 *   1. **la taille du texte.** Treize tailles différentes, dont huit sous
 *      douze pixels — et des étiquettes à 8,8 px dans le HUD. Ce n'est pas un
 *      choix typographique, c'est un accident de copier-coller ;
 *   2. **le contraste.** Dix-neuf opacités différentes pour le même gris, dont
 *      plusieurs à 20 ou 30 %. Le texte secondaire y perdait sa lisibilité :
 *      sous 60 % sur un panneau, on passe sous le seuil AA de la norme
 *      WCAG (4,5:1) ;
 *   3. **l'échelle.** Une interface a besoin de peu de pas : cinq tailles et
 *      trois tons de texte suffisent à hiérarchiser une page. Au-delà, chaque
 *      élément a « sa » valeur et plus rien ne ressemble à rien.
 *
 * Le contrôle lit les classes réellement écrites dans les composants. Il ne
 * juge pas l'esthétique ; il refuse l'illisible et l'incohérent.
 */

import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const SRC = path.join(ROOT, "src");

/* ---------------- collecte ---------------- */

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(full)));
    else if (/\.(tsx?|css)$/.test(entry.name)) files.push(full);
  }
  return files;
}

const files = await walk(SRC);
const sources = new Map();
for (const file of files) sources.set(path.relative(ROOT, file), await readFile(file, "utf8"));

/* ---------------- la palette, telle qu'elle est définie ---------------- */

const themeCss = sources.get("src/app/globals.css") ?? "";
const hexOf = (name) => {
  const match = themeCss.match(new RegExp(`--color-${name}:\\s*#([0-9a-fA-F]{6})`));
  return match ? parseInt(match[1], 16) : null;
};

const COLOURS = {
  parchment: hexOf("parchment"),
  mist: hexOf("mist"),
  "moss-300": hexOf("moss-300"),
  "sky-300": hexOf("sky-300"),
  "laterite-400": hexOf("laterite-400"),
  "amber-glow": hexOf("amber-glow"),
  "canopy-700": hexOf("canopy-700"),
};

/** Fonds sur lesquels le texte est posé : le plus clair est le pire cas. */
const BACKGROUNDS = {
  "canopy-950": hexOf("canopy-950"),
  "canopy-900": hexOf("canopy-900"),
  "canopy-800": hexOf("canopy-800"),
};

const toLinear = (value) => (value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4));
const channels = (hex) => [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
function luminance(hex) {
  const [r, g, b] = channels(hex).map((v) => toLinear(v / 255));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * Couleur composite : `colour` à `alpha` par-dessus `background`.
 *
 * La composition CSS se fait sur les octets affichés, pas en linéaire : c'est
 * cette valeur-là qu'il faut mesurer, sinon on se donne de faux airs.
 */
function composite(colour, background, alpha) {
  const c = channels(colour);
  const b = channels(background);
  const mix = c.map((value, i) => Math.round(value * alpha + b[i] * (1 - alpha)));
  return (mix[0] << 16) | (mix[1] << 8) | mix[2];
}

/* ---------------- 1. les tailles de texte ---------------- */

/** Toutes les tailles arbitraires écrites à la main, en pixels. */
const arbitrary = [];
const tooSmall = [];
for (const [file, text] of sources) {
  for (const match of text.matchAll(/text-\[([0-9.]+)rem\]/g)) {
    const rem = Number(match[1]);
    const px = rem * 16;
    arbitrary.push({ file, px });
    if (px < 11) tooSmall.push({ file, px });
  }
}

const scale = new Map();
for (const item of arbitrary) {
  const key = item.px.toFixed(1);
  scale.set(key, (scale.get(key) ?? 0) + 1);
}

/* ---------------- 2. les opacités de texte ---------------- */

/** `text-<couleur>/<alpha>` — le dégradé de gris utilisé pour la hiérarchie. */
const opacities = [];
for (const [file, text] of sources) {
  for (const match of text.matchAll(/text-([a-z-]+(?:-[0-9]{2,3})?)\/([0-9]{1,3})/g)) {
    const [, colour, alpha] = match;
    if (!COLOURS[colour]) continue;
    opacities.push({ file, colour, alpha: Number(alpha) / 100 });
  }
}

const ALPHA_FLOOR = 0.65;
const faint = opacities.filter((item) => item.alpha < ALPHA_FLOOR);

/* ---------------- 3. le contraste réel ---------------- */

/**
 * Seuil AA : 4,5:1 pour le texte courant, 3:1 au-delà de 24 px (18,66 px en
 * gras). On mesure sur le fond le plus clair, où le texte ressort le moins.
 */
const worstBackground = BACKGROUNDS["canopy-800"];
const failures = [];
for (const item of opacities) {
  const colour = COLOURS[item.colour];
  const shown = composite(colour, worstBackground, item.alpha);
  const ratio = contrast(shown, worstBackground);
  if (ratio < 4.5) failures.push({ ...item, ratio });
}

/* ---------------- rapport ---------------- */

let problems = 0;
function check(label, ok, detail) {
  if (!ok) problems += 1;
  console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
}

console.log("\nTaille du texte");
const sizes = [...scale.entries()].sort((a, b) => Number(a[0]) - Number(b[0]));
console.log(`    ${sizes.map(([px, count]) => `${px}px×${count}`).join("  ")}`);
check("aucun texte sous 11 px", tooSmall.length === 0, `${tooSmall.length} occurrence(s)`);
check("cinq tailles au plus", scale.size <= 5, `${scale.size} tailles arbitraires`);

console.log("\nContraste du texte");
const levels = new Map();
for (const item of opacities) levels.set(item.alpha, (levels.get(item.alpha) ?? 0) + 1);
console.log(
  `    ${[...levels.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([alpha, count]) => `${Math.round(alpha * 100)}%×${count}`)
    .join("  ")}`,
);
check("trois tons de gris au plus", levels.size <= 3, `${levels.size} opacités`);
check("aucun texte sous le seuil AA", failures.length === 0, `${failures.length} combinaison(s) sous 4,5:1`);
check("aucune opacité sous 65 %", faint.length === 0, `${faint.length} occurrence(s)`);

if (failures.length > 0) {
  const seen = new Set();
  for (const failure of failures.slice(0, 12)) {
    const key = `${failure.colour}/${Math.round(failure.alpha * 100)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    console.log(`      ${key.padEnd(18)} ${failure.ratio.toFixed(2)}:1  ${failure.file}`);
  }
}
if (tooSmall.length > 0) {
  const seen = new Set();
  for (const item of tooSmall) {
    if (seen.has(item.file)) continue;
    seen.add(item.file);
    const worst = Math.min(...tooSmall.filter((t) => t.file === item.file).map((t) => t.px));
    console.log(`      ${worst.toFixed(1)} px  ${item.file}`);
  }
}

console.log(problems === 0 ? "\n✓ Le design tient.\n" : `\n✗ ${problems} problème(s).\n`);
process.exit(problems === 0 ? 0 : 1);
