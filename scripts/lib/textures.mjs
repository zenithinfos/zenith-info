/**
 * Textures procédurales de la forêt.
 *
 * Tout est dessiné en JS puis rasterisé par sharp : feuillages à découpe alpha
 * (utilisés sur des plans croisés), écorce, litière du sol, canopée vue du sol,
 * brume et normal map d'eau. Aucun asset binaire n'est nécessaire dans le
 * dépôt : `npm run assets` régénère l'ensemble à l'identique.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { barkMaps, groundMaps } from "./materials.mjs";
import { fbm } from "./raster.mjs";

/* ------------------------------------------------------------------ */
/* Utilitaires                                                         */
/* ------------------------------------------------------------------ */

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const round = (n) => Math.round(n * 10) / 10;

/** Feuille simple : pointe en haut, base arrondie, légèrement asymétrique. */
function leafPath(w, h, bend = 0) {
  const bw = w * 0.46;
  return [
    `M${bend},${-h}`,
    `C${bw + bend},${-h * 0.7} ${w * 0.5 + bend},${-h * 0.1} ${w * 0.4 + bend},${h * 0.4}`,
    `C${w * 0.26 + bend},${h * 0.85} ${-w * 0.26 + bend},${h * 0.85} ${-w * 0.4 + bend},${h * 0.4}`,
    `C${-w * 0.5 + bend},${-h * 0.1} ${-bw + bend},${-h * 0.7} ${bend},${-h}`,
    "Z",
  ].join(" ");
}

/** Compteur d'identifiants pour les dégradés SVG (défs uniques). */
let gradientId = 0;


/**
 * Feuille peinte : dégradé base→pointe, nervure médiane, nervures latérales et
 * un reflet ténu. Une feuille en aplat suffit à faire « dessin animé » ; c'est
 * ce travail de surface qui donne l'épaisseur du feuillage.
 */
function leafMarkup({
  x,
  y,
  w,
  h,
  angle,
  hue,
  sat,
  light,
  bend = 0,
  opacity = 1,
  vein = true,
  dead = false,
}) {
  const id = `lg${gradientId++}`;
  const baseLight = Math.max(6, light - 13);
  const midLight = light;
  const tipLight = Math.min(72, light + 11);
  const fillHue = dead ? 34 : hue;
  const fillSat = dead ? 26 : sat;
  const parts = [
    `<defs><linearGradient id="${id}" x1="0" y1="1" x2="0.18" y2="0">`,
    `<stop offset="0" stop-color="hsl(${round(fillHue)} ${round(fillSat)}% ${round(baseLight)}%)"/>`,
    `<stop offset="0.55" stop-color="hsl(${round(fillHue + 2)} ${round(fillSat)}% ${round(midLight)}%)"/>`,
    `<stop offset="1" stop-color="hsl(${round(fillHue + 6)} ${round(fillSat + 6)}% ${round(tipLight)}%)"/>`,
    `</linearGradient></defs>`,
    `<g transform="translate(${round(x)} ${round(y)}) rotate(${round(angle)})" opacity="${round(opacity * 100) / 100}">`,
    `<path d="${leafPath(w, h, bend)}" fill="url(#${id})"/>`,
  ];

  if (vein) {
    const stroke = `hsl(${round(fillHue)} ${round(fillSat)}% ${round(Math.min(70, light + 16))}%)`;
    // Nervure médiane.
    parts.push(
      `<path d="M${bend},${round(-h * 0.92)} Q${round(bend + w * 0.06)},0 ${round(bend * 0.35)},${round(h * 0.74)}" stroke="${stroke}" stroke-width="${round(Math.max(0.7, w * 0.045))}" fill="none" opacity="0.5"/>`,
    );
    // Nervures latérales : elles suivent la courbure de la feuille.
    const pairs = 4;
    let laterals = "";
    for (let v = 0; v < pairs; v++) {
      const t = 0.18 + (v / pairs) * 0.62;
      const yy = -h + t * h * 1.5;
      const spread = w * (0.42 - t * 0.16);
      const droop = h * 0.1;
      laterals += `M${round(bend * 0.6)},${round(yy)} Q${round(bend + spread * 0.55)},${round(yy + droop * 0.5)} ${round(bend + spread)},${round(yy + droop)}`;
      laterals += `M${round(bend * 0.6)},${round(yy)} Q${round(bend - spread * 0.55)},${round(yy + droop * 0.5)} ${round(bend - spread)},${round(yy + droop)}`;
    }
    parts.push(
      `<path d="${laterals}" stroke="${stroke}" stroke-width="${round(Math.max(0.35, w * 0.018))}" fill="none" opacity="0.32"/>`,
    );
    // Reflet : une arête lumineuse près de la pointe.
    parts.push(
      `<path d="M${round(bend + w * 0.22)},${round(-h * 0.55)} Q${round(bend + w * 0.3)},${round(-h * 0.2)} ${round(bend + w * 0.16)},${round(h * 0.1)}" stroke="hsl(${round(fillHue + 18)} 60% ${round(Math.min(82, tipLight + 18))}%)" stroke-width="${round(Math.max(0.5, w * 0.05))}" fill="none" opacity="0.22"/>`,
    );
  }

  parts.push("</g>");
  return parts.join("");
}

/* ------------------------------------------------------------------ */
/* Feuillage : bouquets utilisés sur les plans croisés                 */
/* ------------------------------------------------------------------ */

/**
 * Bouquet de feuilles. `count` feuilles réparties en trois passes
 * (arrière-plan sombre, cœur, premiers plans plus clairs et plus nets).
 */
export function foliageSvg({ size = 512, count = 190, hue = 116, sat = 40, light = 27, seed = 11 } = {}) {
  const rand = rng(seed);
  const leaves = [];
  const cx = size / 2;
  const cy = size / 2;
  const wedge = size * 0.17; // marge intérieure : aucune feuille ne touche le bord

  const passes = [
    { n: Math.round(count * 0.36), lightMod: -13, scaleMod: 1.08 },
    { n: Math.round(count * 0.36), lightMod: 0, scaleMod: 1 },
    { n: Math.round(count * 0.28), lightMod: 13, scaleMod: 0.9 },
  ];

  for (const pass of passes) {
    for (let i = 0; i < pass.n; i++) {
      // Centre de la feuille contraint dans un disque de rayon R - diagonaleFeuille,
      // sinon la découpe carrée de la texture se voit sur les plans 3D.
      // Tailles très inégales : des petites feuilles cachées aux grandes du
      // dessus, c'est ce qui casse l'aspect « bouquet régulier ».
      const leafW = size * (0.032 + Math.pow(rand(), 1.7) * 0.085) * pass.scaleMod;
      const leafH = leafW * (1.45 + rand() * 0.6);
      const maxR = size / 2;
      const safeR = maxR - Math.max(leafW, leafH) * 0.95 - wedge;
      const angle = rand() * Math.PI * 2;
      const r = Math.pow(rand(), 0.72) * Math.max(8, safeR);
      const x = cx + Math.cos(angle) * r;
      const y = cy + Math.sin(angle) * r;

      // Profondeur dans la masse : plus la feuille est près du centre, plus
      // elle est enfouie et sombre. C'est ce qui donne du volume à la carte.
      const depth = 1 - Math.min(1, r / Math.max(8, safeR));
      const occlusion = -26 * Math.pow(depth, 1.4);

      leaves.push(
        leafMarkup({
          x,
          y,
          w: leafW,
          h: leafH,
          angle: (angle * 180) / Math.PI + 90 + (rand() - 0.5) * 62,
          hue: hue + (rand() - 0.5) * 30,
          sat: sat + (rand() - 0.5) * 18,
          light: Math.max(9, light + pass.lightMod + occlusion + (rand() - 0.5) * 16),
          bend: (rand() - 0.5) * leafW * 0.3,
          // Quelques feuilles rousses : une canopée 100 % verte sonne faux.
          dead: rand() < 0.06,
        }),
      );
    }
  }

  const stems = Array.from({ length: 7 }, () => {
    const angle = rand() * Math.PI * 2;
    const r = size * (0.1 + rand() * 0.2);
    return `<path d="M${round(cx)},${round(cy)} Q${round(cx + Math.cos(angle) * r * 0.5)},${round(cy + Math.sin(angle) * r * 0.5)} ${round(cx + Math.cos(angle) * r)},${round(cy + Math.sin(angle) * r)}" stroke="hsl(${round(hue - 10)} 34% ${round(light - 8)}%)" stroke-width="${round(size * 0.006)}" fill="none" opacity="0.7"/>`;
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">${stems.join("")}${leaves.join("")}</svg>`;
}

/** Grandes feuilles tropicales (balisier, philodendron) en éventail. */
export function bigleafSvg({ size = 512, count = 9, seed = 29 } = {}) {
  const rand = rng(seed);
  const cx = size * 0.5;
  const baseY = size * 0.98;
  const leaves = [];

  for (let i = 0; i < count; i++) {
    const spread = ((i - (count - 1) / 2) / ((count - 1) / 2)) * 62;
    const length = size * (0.44 + rand() * 0.2);
    const width = length * (0.34 + rand() * 0.12);
    const hue = 128 + (rand() - 0.5) * 28;
    const light = 18 + rand() * 16;
    const angle = spread;

    // Pétiole
    leaves.push(
      `<path d="M${round(cx)},${round(baseY)} Q${round(cx + Math.sin((angle * Math.PI) / 180) * length * 0.4)},${round(baseY - length * 0.55)} ${round(cx + Math.sin((angle * Math.PI) / 180) * length * 0.52)},${round(baseY - length * 0.82)}" stroke="hsl(${round(hue - 8)} 32% ${round(light - 4)}%)" stroke-width="${round(size * 0.008)}" fill="none"/>`,
    );

    const tx = cx + Math.sin((angle * Math.PI) / 180) * length * 0.52;
    const ty = baseY - length * 0.82;

    leaves.push(
      `<g transform="translate(${round(tx)} ${round(ty)}) rotate(${round(angle * 0.8)})">`,
      `<path d="${leafPath(width, length * 0.62, 0)}" fill="hsl(${round(hue)} ${round(44 + rand() * 12)}% ${round(light)}%)"/>`,
      `<path d="M0,${round(-length * 0.58)} L0,${round(length * 0.5)}" stroke="hsl(${round(hue)} 40% ${round(light + 14)}%)" stroke-width="${round(size * 0.005)}" opacity="0.75"/>`,
    );

    // Nervures latérales
    for (let k = 1; k <= 6; k++) {
      const t = k / 7;
      const y = round(-length * 0.55 + length * 1.0 * t);
      const reach = round(width * 0.44 * (1 - Math.abs(t - 0.45) * 1.1));
      leaves.push(
        `<path d="M0,${y} Q${round(reach * 0.6)},${round(y - length * 0.04)} ${reach},${round(y - length * 0.08)}" stroke="hsl(${round(hue)} 38% ${round(light + 10)}%)" stroke-width="${round(size * 0.003)}" fill="none" opacity="0.55"/>`,
        `<path d="M0,${y} Q${round(-reach * 0.6)},${round(y - length * 0.04)} ${-reach},${round(y - length * 0.08)}" stroke="hsl(${round(hue)} 38% ${round(light + 10)}%)" stroke-width="${round(size * 0.003)}" fill="none" opacity="0.55"/>`,
      );
    }
    leaves.push("</g>");
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">${leaves.join("")}</svg>`;
}

/**
 * Fougère : frondes pennées rayonnantes.
 * Les folioles sont des losanges pleins qui s'appuient sur le rachis (pas de
 * feuilles détachées), et tout reste dans le cadre.
 */
export function fernSvg({ size = 512, count = 16, seed = 5 } = {}) {
  const rand = rng(seed);
  const cx = size * 0.5;
  const baseY = size * 0.97;
  const fronds = [];

  for (let i = 0; i < count; i++) {
    const angle = -78 + (i / (count - 1)) * 156 + (rand() - 0.5) * 5;
    const rad = (angle * Math.PI) / 180;
    // Les frondes latérales sont plus courtes : silhouette en éventail.
    const length = size * (0.46 + rand() * 0.2) * (1 - Math.abs(angle) / 260);
    const tipX = cx + Math.sin(rad) * length;
    const tipY = baseY - Math.cos(rad) * length;
    const hue = 108 + (rand() - 0.5) * 22;
    const light = 22 + rand() * 12;

    // Rachis légèrement courbé.
    const controlX = (cx + tipX) / 2 + Math.sin(rad) * length * 0.06;
    const controlY = (baseY + tipY) / 2 - length * 0.04;

    fronds.push(
      `<path d="M${round(cx)},${round(baseY)} Q${round(controlX)},${round(controlY)} ${round(tipX)},${round(tipY)}" stroke="hsl(${round(hue)} 32% ${round(light - 5)}%)" stroke-width="${round(size * 0.007)}" fill="none" stroke-linecap="round"/>`,
    );

    // Folioles : losanges pleins, tangents au rachis, alignés sur la courbe.
    const pairs = 18;
    for (let k = 1; k <= pairs; k++) {
      const t = k / (pairs + 1);
      // Point sur la courbe quadratique.
      const px = (1 - t) * (1 - t) * cx + 2 * (1 - t) * t * controlX + t * t * tipX;
      const py = (1 - t) * (1 - t) * baseY + 2 * (1 - t) * t * controlY + t * t * tipY;

      const taper = Math.pow(Math.sin(Math.PI * Math.min(1, t * 1.06)), 0.55) * 0.9 + 0.1;
      const len = size * 0.082 * taper;
      const halfW = len * 0.36;

      // Normale au rachis, du côté correspondant.
      const tangentX = Math.sin(rad);
      const tangentY = -Math.cos(rad);
      const normalX = -tangentY;
      const normalY = tangentX;

      for (const side of [-1, 1]) {
        // Quadrilatère : attache large au rachis, pointe fine vers l'extérieur.
        const ax = px;
        const ay = py;
        const bx = px + normalX * side * len;
        const by = py + normalY * side * len;
        const mx = (ax + bx) / 2 + tangentX * halfW;
        const my = (ay + by) / 2 + tangentY * halfW;
        const nx = (ax + bx) / 2 - tangentX * halfW;
        const ny = (ay + by) / 2 - tangentY * halfW;
        fronds.push(
          `<path d="M${round(ax)},${round(ay)} Q${round(nx)},${round(ny)} ${round(bx)},${round(by)} Q${round(mx)},${round(my)} ${round(ax)},${round(ay)} Z" fill="hsl(${round(hue)} ${round(36 + rand() * 12)}% ${round(light + (k / pairs) * 6)}%)"/>`,
        );
      }
    }
  }

  // Rosette intérieure : frondes plus courtes, plus verticales, qui bouchent
  // le cœur de la plante (sinon on voit à travers).
  const innerCount = 11;
  for (let i = 0; i < innerCount; i++) {
    const angle = -58 + (i / (innerCount - 1)) * 116 + (rand() - 0.5) * 8;
    const rad = (angle * Math.PI) / 180;
    const length = size * (0.24 + rand() * 0.16);
    const tipX = cx + Math.sin(rad) * length;
    const tipY = baseY - Math.cos(rad) * length;
    const hue = 100 + (rand() - 0.5) * 20;
    const light = 15 + rand() * 10;

    fronds.push(
      `<path d="M${round(cx)},${round(baseY)} L${round(tipX)},${round(tipY)}" stroke="hsl(${round(hue)} 30% ${round(light)}%)" stroke-width="${round(size * 0.005)}" fill="none"/>`,
    );

    for (let k = 1; k <= 9; k++) {
      const t = k / 10;
      const px = cx + (tipX - cx) * t;
      const py = baseY + (tipY - baseY) * t;
      const taper = Math.pow(Math.sin(Math.PI * Math.min(1, t * 1.1)), 0.5);
      const len = size * 0.036 * taper;
      const normalX = Math.cos(rad);
      const normalY = Math.sin(rad);
      for (const side of [-1, 1]) {
        const bx = px + normalX * side * len;
        const by = py + normalY * side * len;
        fronds.push(
          `<path d="M${round(px)},${round(py)} L${round(bx)},${round(by)} L${round(px + Math.sin(rad) * len * 0.5)},${round(py - Math.cos(rad) * len * 0.5)} Z" fill="hsl(${round(hue)} 34% ${round(light + 5)}%)"/>`,
        );
      }
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">${fronds.join("")}</svg>`;
}

/**
 * Vue du dessous d'une canopée : feuillage dense percé de trous de lumière.
 *
 * Les trous sont obtenus en *n'insérant pas* de feuilles dans leur voisinage,
 * plutôt qu'en masquant la texture après coup : un masque flou laisse des
 * pixels semi-transparents que la quantification en palette transforme en
 * halos blancs une fois alpha-testés dans la scène 3D.
 */

/** Touffe d'herbe de baï : lames fines, jaune-vert, plus hautes que larges. */
export function grassSvg({ size = 512, blades = 46, seed = 61 } = {}) {
  const rand = rng(seed);
  const cx = size / 2;
  const baseY = size * 0.96;
  const out = [];

  for (let i = 0; i < blades; i++) {
    const baseX = cx + (rand() - 0.5) * size * 0.5;
    const height = size * (0.35 + Math.pow(rand(), 0.7) * 0.6);
    const tipX = baseX + (rand() - 0.5) * size * 0.34;
    const width = size * (0.006 + rand() * 0.012);
    const hue = 62 + rand() * 34;
    const light = 24 + rand() * 26;
    const sat = 38 + rand() * 26;
    const bend = (rand() - 0.5) * size * 0.1;
    out.push(
      `<path d="M${round(baseX - width)},${round(baseY)} Q${round(baseX + bend)},${round(baseY - height * 0.55)} ${round(tipX)},${round(baseY - height)} Q${round(baseX + bend + width * 0.6)},${round(baseY - height * 0.5)} ${round(baseX + width)},${round(baseY)} Z" fill="hsl(${round(hue)} ${round(sat)}% ${round(light)}%)" opacity="${round((0.6 + rand() * 0.4) * 100) / 100}"/>`,
    );
  }

  // Quelques épis plus clairs, qui accrochent la lumière.
  for (let i = 0; i < 10; i++) {
    const x = cx + (rand() - 0.5) * size * 0.46;
    const y = baseY - size * (0.5 + rand() * 0.4);
    out.push(
      `<ellipse cx="${round(x)}" cy="${round(y)}" rx="${round(size * 0.008)}" ry="${round(size * 0.03)}" fill="hsl(${round(66 + rand() * 20)} 50% ${round(46 + rand() * 22)}%)" opacity="0.85"/>`,
    );
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">${out.join("")}</svg>`;
}


/**
 * Feuilles éparses : pas de masse centrale, juste des feuilles dispersées.
 * Utilisée sur les cartes de bord de houppier, elle casse la silhouette
 * « boule » et laisse passer le ciel comme une vraie frondaison.
 */
export function spraySvg({ size = 512, count = 90, seed = 313 } = {}) {
  const rand = rng(seed);
  const cx = size / 2;
  const cy = size / 2;
  const out = [];

  // Grappes réparties en couronne : le centre reste plus clair, la carte se
  // lit comme une frondaison trouée plutôt que comme une boule pleine.
  for (let i = 0; i < count; i++) {
    const a = rand() * Math.PI * 2;
    const r = size * (0.12 + Math.pow(rand(), 0.7) * 0.34);
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r * 0.78;
    const leafW = size * (0.03 + Math.pow(rand(), 1.5) * 0.055);
    out.push(
      leafMarkup({
        x,
        y,
        w: leafW,
        h: leafW * (1.4 + rand() * 0.7),
        angle: rand() * 360,
        hue: 104 + (rand() - 0.5) * 34,
        sat: 34 + rand() * 16,
        light: 16 + rand() * 24,
        bend: (rand() - 0.5) * leafW * 0.35,
        dead: rand() < 0.08,
      }),
    );
  }

  // Quelques rameaux pour relier les feuilles.
  for (let i = 0; i < 4; i++) {
    const a = rand() * Math.PI * 2;
    const len = size * (0.12 + rand() * 0.14);
    out.push(
      `<path d="M${round(cx)},${round(cy)} L${round(cx + Math.cos(a) * len)},${round(cy + Math.sin(a) * len * 0.8)}" stroke="hsl(96 24% 15%)" stroke-width="${round(size * 0.006)}" opacity="0.75"/>`,
    );
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">${out.join("")}</svg>`;
}

export function canopySvg({ size = 768, count = 620, seed = 77 } = {}) {
  const rand = rng(seed);

  const holes = Array.from({ length: 15 }, () => ({
    x: size * (0.1 + rand() * 0.8),
    y: size * (0.1 + rand() * 0.8),
    r: size * (0.012 + rand() * 0.02),
  }));

  const inHole = (x, y, margin) =>
    holes.some((hole) => Math.hypot(x - hole.x, y - hole.y) < hole.r + margin);

  const leaves = [];
  let placed = 0;
  let attempts = 0;
  while (placed < count && attempts < count * 6) {
    attempts += 1;
    const x = rand() * size;
    const y = rand() * size;
    const w = size * (0.035 + rand() * 0.05);
    const h = w * (1.4 + rand() * 0.6);

    // On laisse un vide franc autour des trous (les bords restent nets).
    if (inHole(x, y, Math.max(w, h) * 0.3)) continue;

    leaves.push(
      leafMarkup({
        x,
        y,
        w,
        h,
        angle: rand() * 360,
        hue: 96 + rand() * 36,
        sat: 34 + rand() * 22,
        light: 12 + rand() * 20,
        bend: (rand() - 0.5) * w * 0.4,
      }),
    );
    placed += 1;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">${leaves.join("")}</svg>`;
}

/* ------------------------------------------------------------------ */
/* Écorce et sol                                                       */
/* ------------------------------------------------------------------ */

export function mistSvg({ size = 512, seed = 4 } = {}) {
  const rand = rng(seed);
  const blobs = Array.from({ length: 26 }, () => {
    const cx = size * (0.25 + rand() * 0.5);
    const cy = size * (0.35 + rand() * 0.3);
    const r = size * (0.12 + rand() * 0.2);
    return `<circle cx="${round(cx)}" cy="${round(cy)}" r="${round(r)}" fill="#fff" opacity="${round((0.06 + rand() * 0.14) * 100) / 100}"/>`;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
    <defs><filter id="b"><feGaussianBlur stdDeviation="${round(size * 0.05)}"/></filter></defs>
    <g filter="url(#b)">${blobs.join("")}</g>
  </svg>`;
}

function waterNormalSvg({ size = 256, seed = 5 } = {}) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
    <defs>
      <filter id="n">
        <feTurbulence type="fractalNoise" baseFrequency="0.02 0.06" numOctaves="3" seed="${seed}"/>
        <feColorMatrix values="0.5 0 0 0 0.22  0 0.5 0 0 0.42  0 0 0.5 0 0.66  0 0 0 0 1"/>
      </filter>
    </defs>
    <rect width="${size}" height="${size}" fill="#7f80ff"/>
    <rect width="${size}" height="${size}" filter="url(#n)" opacity="0.85"/>
  </svg>`;
}

export function rockSvg({ size = 512, seed = 11 } = {}) {
  const rand = rng(seed);
  const spots = Array.from({ length: 260 }, () => {
    const x = rand() * size;
    const y = rand() * size;
    const r = size * (0.004 + rand() * 0.02);
    const light = 28 + rand() * 22;
    return `<ellipse cx="${round(x)}" cy="${round(y)}" rx="${round(r)}" ry="${round(r * (0.6 + rand()))}" fill="hsl(${round(80 + rand() * 40)} ${round(6 + rand() * 12)}% ${round(light)}%)" opacity="${round((0.2 + rand() * 0.4) * 100) / 100}"/>`;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
    <defs>
      <filter id="n">
        <feTurbulence type="fractalNoise" baseFrequency="0.05" numOctaves="5" seed="${seed}"/>
        <feColorMatrix type="saturate" values="0.1"/>
        <feComponentTransfer>
          <feFuncR type="linear" slope="0.45" intercept="0.3"/>
          <feFuncG type="linear" slope="0.45" intercept="0.3"/>
          <feFuncB type="linear" slope="0.43" intercept="0.28"/>
        </feComponentTransfer>
      </filter>
    </defs>
    <rect width="${size}" height="${size}" fill="#5f6058"/>
    <rect width="${size}" height="${size}" filter="url(#n)" opacity="0.9"/>
    ${spots.join("")}
  </svg>`;
}

/* ------------------------------------------------------------------ */
/* Écriture                                                            */
/* ------------------------------------------------------------------ */

/**
 * Textures encore produites ici (procédurales) : uniquement les effets qui ne
 * sont pas des matières — brume, roche, normales d'eau. **Toutes les matières
 * de la forêt sont photographiques** (voir scripts/lib/photos.mjs) : un
 * feuillage dessiné par du code ne peut pas être photoréaliste.
 */
const RASTER = [
  { file: "mist.png", svg: mistSvg({}), type: "png", label: "brume" },
  { file: "rock.jpg", svg: rockSvg({}), type: "jpeg", label: "roche" },
  { file: "water_normal.jpg", svg: waterNormalSvg({}), type: "jpeg", label: "normales d'eau" },
];

/**
 * Ajoute un grain photographique aux cartes de feuillage : micro-variations de
 * luminance et de teinte, à l'intérieur de la découpe alpha. Sans cela, les
 * feuilles restent des aplats vectoriels — c'est le principal marqueur de
 * « dessin animé » d'un feuillage.
 */
async function grainify(buffer, { amount = 0.16, tint = 0.05 } = {}) {
  const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  const noise = fbm(width, height, { freq: 26, octaves: 4, seed: 1234 });
  const blotch = fbm(width, height, { freq: 7, octaves: 3, seed: 88 });
  for (let i = 0; i < width * height; i++) {
    const a = data[i * 4 + 3];
    if (a === 0) continue;
    const n = 1 + (noise[i] - 0.5) * amount * 2;
    const warm = 1 + (blotch[i] - 0.5) * tint * 2;
    data[i * 4] = Math.min(255, data[i * 4] * n * warm);
    data[i * 4 + 1] = Math.min(255, data[i * 4 + 1] * n);
    data[i * 4 + 2] = Math.min(255, data[i * 4 + 2] * n * (2 - warm));
  }
  return sharp(data, { raw: { width, height, channels: 4 } })
    .png({ compressionLevel: 9, palette: true, colors: 160, effort: 8 })
    .toBuffer();
}

/** Écrit une matière (albédo + normales) dans public/textures. */
async function writeMaterial(dir, name, maps, { albedoQuality = 86, normalQuality = 90, log }) {
  const { width, height, albedo, normal } = maps;
  const albedoFile = path.join(dir, `${name}.jpg`);
  const normalFile = path.join(dir, `${name}_normal.jpg`);
  const albedoOut = await sharp(Buffer.from(albedo), {
    raw: { width, height, channels: 3 },
  })
    .jpeg({ quality: albedoQuality, mozjpeg: true })
    .toBuffer();
  const normalOut = await sharp(Buffer.from(normal), {
    raw: { width, height, channels: 3 },
  })
    .jpeg({ quality: normalQuality, mozjpeg: true })
    .toBuffer();
  await writeFile(albedoFile, albedoOut);
  await writeFile(normalFile, normalOut);
  log(
    `✓ textures/${name}.jpg + ${name}_normal.jpg — ${Math.round((albedoOut.length + normalOut.length) / 1024)} Ko`,
  );
}

export async function generateTextures({ publicDir, force = false, log = console.log } = {}) {
  const dir = path.join(publicDir, "textures");
  await mkdir(dir, { recursive: true });

  // Sol et écorce : peints au pixel, avec leur carte de normales.
  for (const [name, maps, options] of [
    ["ground", groundMaps({ size: 1024, seed: 9 }), { normalQuality: 76 }],
    ["bark", barkMaps({ width: 512, height: 1024, seed: 3 }), { normalQuality: 82 }],
  ]) {
    if (!force && existsSync(path.join(dir, `${name}.jpg`))) {
      log(`· textures/${name}.jpg existe déjà`);
      continue;
    }
    await writeMaterial(dir, name, maps, { log, ...options });
  }

  for (const item of RASTER) {
    const target = path.join(dir, item.file);
    if (!force && existsSync(target)) {
      log(`· textures/${item.file} existe déjà`);
      continue;
    }
    const svg = Buffer.from(item.svg);
    const image = sharp(svg, { density: 144 });
    // Les grandes cartes de feuillage n'ont pas besoin d'un alpha 8 bits
    // complet : une palette les divise par 4 sans différence visible.
    const texture = await image
      .resize(item.width ?? 512, item.height ?? 512, { fit: "fill" })
      .toBuffer();
    const output =
      item.type === "png"
        ? await sharp(texture)
            .png({ compressionLevel: 9, palette: true, colors: 96, effort: 8 })
            .toBuffer()
        : await sharp(texture).jpeg({ quality: 80, mozjpeg: true }).toBuffer();
    const finalOutput = item.grain ? await grainify(output, item.grain) : output;
    await writeFile(target, finalOutput);
    log(`✓ textures/${item.file} — ${item.label} (${Math.round(finalOutput.length / 1024)} Ko)`);
  }

}
