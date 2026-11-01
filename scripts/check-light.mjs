#!/usr/bin/env node
/**
 * Combien éclaire la forêt ?
 *
 *   node scripts/check-light.mjs
 *
 * Il n'y a pas de GPU ici, mais l'éclairage n'est pas une question de goût : la
 * luminance d'une surface se calcule. Ce script reprend le budget lumineux du
 * jeu (`lightForDaylight`) et estime ce qu'une feuille, un tronc ou le sol
 * renvoient à l'écran — ambiance + ciel + environnement + soleil, puis
 * exposition et courbe ACES, exactement comme le fait le moteur.
 *
 * Le repère qui compte : une feuille à l'ombre doit encore lire sa couleur,
 * c'est-à-dire rester au-dessus de ~30 % de gris. En dessous, la forêt est un
 * trou noir et le joueur ne voit plus où il marche.
 */

import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const dir = await mkdtemp(path.join(tmpdir(), "minkebe-light-"));
const bundle = path.join(dir, "config.mjs");
await build({
  stdin: {
    contents: `export * from "./src/game/sceneConfig.ts"; export * from "./src/game/realism.ts";`,
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
const { lightForDaylight, worldClock } = await import(`${bundle}?t=${Date.now()}`);
await rm(dir, { recursive: true, force: true });

/** sRGB → linéaire (les couleurs three sont stockées en linéaire). */
const linear = (value) => {
  const hex = Array.isArray(value) ? (value[0] << 16) | (value[1] << 8) | value[2] : value;
  const r = ((hex >> 16) & 255) / 255;
  const g = ((hex >> 8) & 255) / 255;
  const b = (hex & 255) / 255;
  const f = (v) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
  return [f(r), f(g), f(b)];
};
const toSrgb = (v) => (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);
/** ACES filmique, la courbe de three.js. */
const aces = (x) => {
  const a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
  return Math.min(1, Math.max(0, (x * (a * x + b)) / (x * (c * x + d) + e)));
};

const SKY = linear(0x9fc4d8); // ciel de l'hémisphère
const GROUND = linear(0x2c3a24); // sol de l'hémisphère
const SUN = linear(0xffe9c4);
const ENV = linear(0x9ab8a0); // moyenne de la sphère d'ambiance
const FOG = linear(0x5f7d64);

/**
 * Luminance estimée d'une surface, en sRGB 0-1.
 *
 * `up` va de 0 (surface verticale) à 1 (surface tournée vers le ciel) ;
 * `sun` est la part de soleil direct qui l'atteint (0 sous la canopée).
 */
function shade(budget, albedoHex, up, sunShare) {
  const albedo = linear(albedoHex);
  const hemi = SKY.map((s, i) => GROUND[i] + (s - GROUND[i]) * (0.5 + 0.5 * up));
  const out = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    const irradiance =
      budget.ambient +
      budget.hemisphere * hemi[i] +
      budget.environment * ENV[i] +
      budget.sun * sunShare * SUN[i];
    // BRDF diffuse de three : albedo / π.
    out[i] = aces((albedo[i] / Math.PI) * irradiance * budget.exposure);
  }
  // Étalonnage de fin de chaîne : il s'applique maintenant en espace
  // d'affichage (courbe en S + vignettage), pas sur des valeurs linéaires.
  return out.map(toSrgb).map((v) => Math.min(1, Math.max(0, (v - 0.5) * 1.06 + 0.5)));
}

const pct = (rgb) => rgb.map((v) => Math.round(v * 100));
const row = (label, rgb, min = 30) => {
  const p = pct(rgb);
  const flag = Math.max(...p) < min ? `  ← sous ${min} %` : "";
  console.log(`  ${label.padEnd(34)} ${String(p[0]).padStart(3)} ${String(p[1]).padStart(3)} ${String(p[2]).padStart(3)} %${flag}`);
};

/**
 * Albedo réel des surfaces : moyenne mesurée de la carte, multipliée par la
 * teinte de la matière. Une texture sombre rend tout éclairage inutile — c'est
 * pourquoi ces valeurs sont mesurées et non supposées.
 *
 *   foliage.png  77 111  83   × teinte 0xf2f6ee
 *   bark.jpg     74  63  48   × teinte 0x8c7a5e (grisée)
 *   ground.jpg   47  38  24
 */
const mix = (rgb, hex) => {
  const t = [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
  return (rgb[0] << 16) | (Math.round((rgb[1] * t[1]) / 255) << 8) | Math.round((rgb[2] * t[2]) / 255);
};
const LEAF = mix([77, 111, 83], 0xf2f6ee);
const BARK = mix([74, 63, 48], 0xc9c2b2);
// ground.jpg (47/38/24) × gain 1,65 × couleur de sommet moyenne 0,9
const SOIL = [Math.round(47 * 1.8 * 0.9), Math.round(38 * 1.7 * 0.9), Math.round(24 * 1.55 * 0.9)];

for (const hour of [8.2, 12, 17.5, 19, 22]) {
  const clock = worldClock(0, undefined, hour);
  const budget = lightForDaylight(clock.daylight);
  console.log(`\n${hour.toFixed(1)} h · ${clock.phase} · daylight ${clock.daylight.toFixed(2)} · exposition ${budget.exposure.toFixed(2)}`);
  row("feuille à l'ombre, vers le ciel", shade(budget, LEAF, 1, 0));
  row("feuille à l'ombre, de profil", shade(budget, LEAF, 0, 0), 28);
  row("feuille dans une trouée", shade(budget, LEAF, 1, 0.55));
  // L'écorce est sombre par nature : on ne lui demande pas d'être claire,
  // seulement d'exister. Le sol, lui, doit rester lisible sous les pas.
  row("tronc à l'ombre", shade(budget, BARK, 0, 0), 22);
  row("sol du sentier, à l'ombre", shade(budget, SOIL, 1, 0));
  row("brume au loin", FOG.map((v) => aces(v * 0.55 * (0.9 + budget.exposure * 0.1))).map(toSrgb));
}
