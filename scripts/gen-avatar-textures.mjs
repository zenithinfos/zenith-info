#!/usr/bin/env node
/**
 * Textures du personnage : peau, toile, cuir, sangle.
 *
 *   node scripts/gen-avatar-textures.mjs [--force]
 *
 * Un personnage fait de couleurs unies reste une figurine, quelle que soit la
 * finesse du maillage : ce qui accroche l'œil, ce sont les variations — pores,
 * grain du tissu, coutures, cuir qui se patine aux plis. Aucune de ces images
 * n'existe ici et aucune ne se télécharge (les banques d'images libres pèsent
 * des gigaoctets) : on les fabrique.
 *
 * Chaque matière produit trois cartes :
 *   - l'albédo (`.jpg`), la couleur ;
 *   - la normale (`.jpg`), le relief, déduit d'une carte de hauteur ;
 *   - la rugosité (`.png` en niveaux de gris), pour que le cuir brille aux
 *     plis et que la toile reste mate.
 *
 * Elles bouclent : bruit périodique, coutures alignées sur les bords.
 */

import { mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";

const argv = process.argv.slice(2);
const force = argv.includes("--force");
const OUT_DIR = path.join("public", "textures", "avatar");
await mkdir(OUT_DIR, { recursive: true });

/* ------------------------------------------------------------------ */
/* Bruit périodique                                                    */
/* ------------------------------------------------------------------ */

/** Hachage déterministe, sans état global. */
function hash(x, y, seed) {
  let h = x * 374761393 + y * 668265263 + seed * 2147483647;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

const smooth = (t) => t * t * (3 - 2 * t);

/**
 * Bruit de valeur qui boucle exactement sur `period` cellules : la texture
 * doit se répéter sans couture sur un corps entier.
 */
function valueNoise(x, y, period, seed) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const wrap = (n) => ((n % period) + period) % period;
  const x0 = wrap(xi);
  const y0 = wrap(yi);
  const x1 = wrap(xi + 1);
  const y1 = wrap(yi + 1);
  const a = hash(x0, y0, seed);
  const b = hash(x1, y0, seed);
  const c = hash(x0, y1, seed);
  const d = hash(x1, y1, seed);
  const u = smooth(xf);
  const v = smooth(yf);
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}

/** Somme d'octaves ; chaque octave boucle sur son propre motif. */
function fbm(x, y, period, octaves, seed, gain = 0.5) {
  let total = 0;
  let amplitude = 1;
  let norm = 0;
  let p = period;
  for (let o = 0; o < octaves; o++) {
    total += valueNoise(x * p, y * p, p, seed + o * 17) * amplitude;
    norm += amplitude;
    amplitude *= gain;
    p *= 2;
  }
  return total / norm;
}

/* ------------------------------------------------------------------ */
/* Carte de hauteur → normale                                          */
/* ------------------------------------------------------------------ */

function normalFromHeight(height, size, strength) {
  const out = Buffer.alloc(size * size * 3);
  const at = (x, y) => height[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      const nx = -dx;
      const ny = -dy;
      const nz = 1;
      const len = Math.hypot(nx, ny, nz);
      const i = (y * size + x) * 3;
      out[i] = Math.round((nx / len * 0.5 + 0.5) * 255);
      out[i + 1] = Math.round((ny / len * 0.5 + 0.5) * 255);
      out[i + 2] = Math.round((nz / len * 0.5 + 0.5) * 255);
    }
  }
  return out;
}

const clamp255 = (v) => Math.max(0, Math.min(255, Math.round(v)));

async function writeMaps(name, size, albedo, roughness, normal) {
  const albedoPath = path.join(OUT_DIR, `${name}.jpg`);
  const normalPath = path.join(OUT_DIR, `${name}-normal.jpg`);
  const roughnessPath = path.join(OUT_DIR, `${name}-roughness.png`);

  if (force || !existsSync(albedoPath)) {
    await sharp(albedo, { raw: { width: size, height: size, channels: 3 } })
      .jpeg({ quality: 92, chromaSubsampling: "4:4:4" })
      .toFile(albedoPath);
  }
  if (force || !existsSync(normalPath)) {
    await sharp(normal, { raw: { width: size, height: size, channels: 3 } })
      .jpeg({ quality: 94, chromaSubsampling: "4:4:4" })
      .toFile(normalPath);
  }
  if (force || !existsSync(roughnessPath)) {
    await sharp(roughness, { raw: { width: size, height: size, channels: 1 } })
      .png({ compressionLevel: 9 })
      .toFile(roughnessPath);
  }
  console.log(`  ${name} ${size}²`);
}

/* ------------------------------------------------------------------ */
/* Peau                                                                */
/* ------------------------------------------------------------------ */

function skinMaps(size = 512) {
  const albedo = Buffer.alloc(size * size * 3);
  const height = new Float32Array(size * size);
  const roughness = Buffer.alloc(size * size);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      const i = y * size + x;

      // Teint : base brun profond, deux larges nappes qui font la carnation.
      const blotch = fbm(u, v, 3, 5, 11);
      const pores = fbm(u, v, 48, 3, 29);
      const fine = fbm(u, v, 140, 2, 47);
      const creases = fbm(u, v, 8, 4, 73);

      const tone = 0.82 + blotch * 0.34;
      const warm = 1 + (blotch - 0.5) * 0.16;
      // Une peau sombre n'est pas « marron » : elle tire vers le rouge dans
      // les creux et vers l'ocre sur les reliefs.
      const r = 118 * tone * warm * (0.94 + pores * 0.12);
      const g = 74 * tone * (0.92 + pores * 0.14);
      const b = 54 * tone * (0.9 + creases * 0.16);

      const o = i * 3;
      albedo[o] = clamp255(r);
      albedo[o + 1] = clamp255(g);
      albedo[o + 2] = clamp255(b);

      height[i] = pores * 0.6 + fine * 0.4 + creases * 0.3;
      roughness[i] = clamp255((0.62 + pores * 0.16 - blotch * 0.06) * 255);
    }
  }

  const normal = normalFromHeight(height, size, 1.6);
  return { albedo, height, roughness, normal };
}

/* ------------------------------------------------------------------ */
/* Toile de coton (chemise, pantalon)                                  */
/* ------------------------------------------------------------------ */

function clothMaps(size, base, seed, weaveScale = 96) {
  const albedo = Buffer.alloc(size * size * 3);
  const height = new Float32Array(size * size);
  const roughness = Buffer.alloc(size * size);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      const i = y * size + x;

      // Armure : fils de chaîne et de trame, décalés une ligne sur deux.
      const warp = Math.sin(u * Math.PI * 2 * weaveScale) * 0.5 + 0.5;
      const weft = Math.sin(v * Math.PI * 2 * weaveScale + (Math.floor(u * weaveScale * 2) % 2) * Math.PI) * 0.5 + 0.5;
      const weave = Math.pow(warp, 3) * 0.55 + Math.pow(weft, 3) * 0.45;

      // Usure : zones plus claires, fibres tirées, salissures au bas des pièces.
      const wear = fbm(u, v, 4, 5, seed);
      const grime = fbm(u, v, 2, 4, seed + 91);
      const dirt = Math.pow(fbm(u, v, 3, 3, seed + 51), 2.4);

      const shade = 0.72 + weave * 0.42 + wear * 0.18 - dirt * 0.24;
      const o = i * 3;
      albedo[o] = clamp255(base[0] * shade * (1.02 + grime * 0.06));
      albedo[o + 1] = clamp255(base[1] * shade);
      albedo[o + 2] = clamp255(base[2] * shade * (0.96 + grime * 0.04));

      height[i] = weave * 0.75 + wear * 0.35;
      roughness[i] = clamp255((0.9 + weave * 0.06 - dirt * 0.05) * 255);
    }
  }

  const normal = normalFromHeight(height, size, 1.1);
  return { albedo, height, roughness, normal };
}

/* ------------------------------------------------------------------ */
/* Cuir (rangers, étui)                                                */
/* ------------------------------------------------------------------ */

function leatherMaps(size = 256) {
  const albedo = Buffer.alloc(size * size * 3);
  const height = new Float32Array(size * size);
  const roughness = Buffer.alloc(size * size);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      const i = y * size + x;

      // Grain : grosses rides (le cuir plié) + grain serré (la fleur du cuir).
      const wrinkle = Math.pow(fbm(u, v, 6, 4, 5), 2);
      const grain = fbm(u, v, 90, 2, 13);
      const scuff = Math.pow(fbm(u, v, 3, 3, 31), 3);

      const shade = 0.66 + wrinkle * 0.5 + grain * 0.2 + scuff * 0.35;
      const o = i * 3;
      albedo[o] = clamp255(48 * shade);
      albedo[o + 1] = clamp255(36 * shade);
      albedo[o + 2] = clamp255(27 * shade);

      height[i] = wrinkle * 0.9 + grain * 0.45;
      roughness[i] = clamp255((0.44 + grain * 0.18 - scuff * 0.12) * 255);
    }
  }

  const normal = normalFromHeight(height, size, 1.9);
  return { albedo, height, roughness, normal };
}

/* ------------------------------------------------------------------ */
/* Sangle / toile de sac                                               */
/* ------------------------------------------------------------------ */

function webbingMaps(size = 256) {
  const albedo = Buffer.alloc(size * size * 3);
  const height = new Float32Array(size * size);
  const roughness = Buffer.alloc(size * size);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      const i = y * size + x;

      // Sangle : nervures longitudinales très marquées.
      const rib = Math.pow(Math.sin(u * Math.PI * 2 * 34) * 0.5 + 0.5, 2);
      const wear = fbm(u, v, 4, 4, 61);
      const dirt = Math.pow(fbm(u, v, 2, 3, 17), 2);

      const shade = 0.68 + rib * 0.3 + wear * 0.2 - dirt * 0.2;
      const o = i * 3;
      albedo[o] = clamp255(92 * shade);
      albedo[o + 1] = clamp255(94 * shade);
      albedo[o + 2] = clamp255(70 * shade);

      height[i] = rib * 0.8 + wear * 0.3;
      roughness[i] = clamp255(0.88 * 255);
    }
  }

  const normal = normalFromHeight(height, size, 1.4);
  return { albedo, height, roughness, normal };
}

/* ------------------------------------------------------------------ */

console.log("Textures du personnage →", OUT_DIR);

const skin = skinMaps(512);
await writeMaps("skin", 512, skin.albedo, skin.roughness, skin.normal);

const shirt = clothMaps(512, [86, 94, 62], 7, 110);
await writeMaps("shirt", 512, shirt.albedo, shirt.roughness, shirt.normal);

const trousers = clothMaps(512, [74, 79, 58], 23, 84);
await writeMaps("trousers", 512, trousers.albedo, trousers.roughness, trousers.normal);

const leather = leatherMaps(256);
await writeMaps("leather", 256, leather.albedo, leather.roughness, leather.normal);

const webbing = webbingMaps(256);
await writeMaps("webbing", 256, webbing.albedo, webbing.roughness, webbing.normal);

console.log("terminé");
