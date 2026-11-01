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

function leafMarkup({ x, y, w, h, angle, hue, sat, light, bend = 0, opacity = 1, vein = true }) {
  const fill = `hsl(${round(hue)} ${round(sat)}% ${round(light)}%)`;
  const parts = [
    `<g transform="translate(${round(x)} ${round(y)}) rotate(${round(angle)})" opacity="${round(opacity * 100) / 100}">`,
    `<path d="${leafPath(w, h, bend)}" fill="${fill}"/>`,
  ];
  if (vein) {
    parts.push(
      `<path d="M${bend},${-h * 0.92} L${bend * 0.4},${h * 0.72}" stroke="hsl(${round(hue)} ${round(sat)}% ${round(light + 12)}%)" stroke-width="${round(Math.max(0.6, w * 0.035))}" fill="none" opacity="0.55"/>`,
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
function foliageSvg({ size = 512, count = 190, hue = 116, sat = 40, light = 27, seed = 11 } = {}) {
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
      const leafW = size * (0.05 + rand() * 0.062) * pass.scaleMod;
      const leafH = leafW * (1.45 + rand() * 0.6);
      const maxR = size / 2;
      const safeR = maxR - Math.max(leafW, leafH) * 0.95 - wedge;
      const angle = rand() * Math.PI * 2;
      const r = Math.pow(rand(), 0.72) * Math.max(8, safeR);
      const x = cx + Math.cos(angle) * r;
      const y = cy + Math.sin(angle) * r;

      leaves.push(
        leafMarkup({
          x,
          y,
          w: leafW,
          h: leafH,
          angle: (angle * 180) / Math.PI + 90 + (rand() - 0.5) * 62,
          hue: hue + (rand() - 0.5) * 24,
          sat: sat + (rand() - 0.5) * 14,
          light: Math.max(11, light + pass.lightMod + (rand() - 0.5) * 12),
          bend: (rand() - 0.5) * leafW * 0.3,
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
function bigleafSvg({ size = 512, count = 9, seed = 29 } = {}) {
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
function fernSvg({ size = 512, count = 16, seed = 5 } = {}) {
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
function canopySvg({ size = 768, count = 620, seed = 77 } = {}) {
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

function barkSvg({ width = 512, height = 1024, seed = 3 } = {}) {
  const rand = rng(seed);
  const ridges = [];

  // Fond : dégradé vertical + variations.
  const base = `<rect width="${width}" height="${height}" fill="url(#barkBase)"/>`;

  for (let i = 0; i < 150; i++) {
    const x = rand() * width;
    const w = 3 + rand() * 26;
    const light = 12 + rand() * 26;
    const opacity = 0.25 + rand() * 0.55;
    const wobble = 6 + rand() * 22;
    const d = [
      `M${round(x)},-20`,
      `C${round(x + (rand() - 0.5) * wobble)},${round(height * 0.3)} ${round(x + (rand() - 0.5) * wobble)},${round(height * 0.65)} ${round(x + (rand() - 0.5) * wobble)},${height + 20}`,
    ].join(" ");
    ridges.push(
      `<path d="${d}" stroke="hsl(${round(24 + rand() * 14)} ${round(18 + rand() * 16)}% ${round(light)}%)" stroke-width="${round(w)}" fill="none" opacity="${round(opacity * 100) / 100}" stroke-linecap="round"/>`,
    );
  }

  // Crevasses sombres et lichens.
  const cracks = Array.from({ length: 60 }, () => {
    const x = rand() * width;
    const y = rand() * height;
    const len = 20 + rand() * 120;
    return `<path d="M${round(x)},${round(y)} q${round((rand() - 0.5) * 14)},${round(len * 0.5)} ${round((rand() - 0.5) * 22)},${round(len)}" stroke="hsl(26 30% ${round(6 + rand() * 6)}%)" stroke-width="${round(1 + rand() * 3)}" fill="none" opacity="0.75"/>`;
  });

  const lichen = Array.from({ length: 26 }, () => {
    const x = rand() * width;
    const y = rand() * height;
    const r = 8 + rand() * 34;
    return `<ellipse cx="${round(x)}" cy="${round(y)}" rx="${round(r)}" ry="${round(r * (0.5 + rand() * 0.6))}" fill="hsl(${round(72 + rand() * 30)} 26% ${round(30 + rand() * 14)}%)" opacity="${round((0.1 + rand() * 0.22) * 100) / 100}"/>`;
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <defs>
      <linearGradient id="barkBase" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stop-color="#3a2b1d"/>
        <stop offset="42%" stop-color="#4d3a26"/>
        <stop offset="70%" stop-color="#3f2f20"/>
        <stop offset="100%" stop-color="#2f2317"/>
      </linearGradient>
      <filter id="grain">
        <feTurbulence type="fractalNoise" baseFrequency="0.9 0.22" numOctaves="3" seed="${seed}"/>
        <feColorMatrix type="saturate" values="0"/>
        <feComponentTransfer><feFuncA type="linear" slope="0.16"/></feComponentTransfer>
      </filter>
    </defs>
    ${base}
    ${ridges.join("")}
    ${cracks.join("")}
    ${lichen.join("")}
    <rect width="${width}" height="${height}" filter="url(#grain)" opacity="0.55"/>
  </svg>`;
}

function groundSvg({ size = 1024, seed = 9 } = {}) {
  const rand = rng(seed);
  const litter = [];

  // Litière : feuilles mortes de teintes brunes/olives.
  for (let i = 0; i < 900; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const w = size * (0.006 + rand() * 0.018);
    const h = w * (1.3 + rand() * 0.8);
    const hue = 22 + rand() * 46;
    const light = 12 + rand() * 22;
    litter.push(
      `<g transform="translate(${round(x)} ${round(y)}) rotate(${round(rand() * 360)})" opacity="${round((0.35 + rand() * 0.5) * 100) / 100}">
        <path d="${leafPath(w, h, (rand() - 0.5) * w * 0.4)}" fill="hsl(${round(hue)} ${round(22 + rand() * 26)}% ${round(light)}%)"/>
      </g>`,
    );
  }

  // Mousse et taches d'humus.
  const moss = Array.from({ length: 90 }, () => {
    const x = rand() * size;
    const y = rand() * size;
    const r = size * (0.012 + rand() * 0.06);
    return `<ellipse cx="${round(x)}" cy="${round(y)}" rx="${round(r)}" ry="${round(r * (0.5 + rand() * 0.7))}" fill="hsl(${round(88 + rand() * 40)} ${round(24 + rand() * 26)}% ${round(14 + rand() * 14)}%)" opacity="${round((0.18 + rand() * 0.35) * 100) / 100}"/>`;
  });

  // Brindilles.
  const twigs = Array.from({ length: 110 }, () => {
    const x = rand() * size;
    const y = rand() * size;
    const len = size * (0.02 + rand() * 0.08);
    const angle = rand() * Math.PI * 2;
    return `<path d="M${round(x)},${round(y)} L${round(x + Math.cos(angle) * len)},${round(y + Math.sin(angle) * len)}" stroke="hsl(${round(24 + rand() * 16)} 26% ${round(10 + rand() * 12)}%)" stroke-width="${round(size * (0.0012 + rand() * 0.0028))}" opacity="0.7" stroke-linecap="round"/>`;
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
    <defs>
      <linearGradient id="soil" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#3b2b1c"/>
        <stop offset="45%" stop-color="#2e2317"/>
        <stop offset="100%" stop-color="#221a11"/>
      </linearGradient>
      <filter id="noise">
        <feTurbulence type="fractalNoise" baseFrequency="0.55" numOctaves="4" seed="${seed}"/>
        <feColorMatrix type="saturate" values="0.2"/>
        <feComponentTransfer><feFuncA type="linear" slope="0.3"/></feComponentTransfer>
      </filter>
    </defs>
    <rect width="${size}" height="${size}" fill="url(#soil)"/>
    <rect width="${size}" height="${size}" filter="url(#noise)" opacity="0.75"/>
    ${moss.join("")}
    ${litter.join("")}
    ${twigs.join("")}
  </svg>`;
}

/* ------------------------------------------------------------------ */
/* Divers : brume, eau                                                 */
/* ------------------------------------------------------------------ */

function mistSvg({ size = 512, seed = 4 } = {}) {
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

function rockSvg({ size = 512, seed = 11 } = {}) {
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

const RASTER = [
  { file: "foliage.png", svg: foliageSvg({}), type: "png", label: "bouquet de feuilles" },
  {
    file: "foliage-deep.png",
    svg: foliageSvg({ seed: 42, hue: 132, sat: 34, light: 18, count: 190 }),
    type: "png",
    label: "feuillage de sous-bois",
  },
  {
    file: "foliage-pale.png",
    svg: foliageSvg({ seed: 91, hue: 86, sat: 48, light: 40, count: 120 }),
    type: "png",
    label: "feuillage de lumière",
  },
  { file: "bigleaf.png", svg: bigleafSvg({}), type: "png", label: "grandes feuilles" },
  { file: "fern.png", svg: fernSvg({}), type: "png", label: "fougère" },
  {
    file: "canopy.png",
    svg: canopySvg({}),
    type: "png",
    width: 768,
    height: 768,
    label: "canopée (vue du sol)",
  },
  { file: "mist.png", svg: mistSvg({}), type: "png", label: "brume" },
  { file: "bark.jpg", svg: barkSvg({}), type: "jpeg", label: "écorce" },
  { file: "ground.jpg", svg: groundSvg({}), type: "jpeg", label: "litière du sol" },
  { file: "rock.jpg", svg: rockSvg({}), type: "jpeg", label: "roche" },
  { file: "water_normal.jpg", svg: waterNormalSvg({}), type: "jpeg", label: "normales d'eau" },
];

export async function generateTextures({ publicDir, force = false, log = console.log } = {}) {
  const dir = path.join(publicDir, "textures");
  await mkdir(dir, { recursive: true });

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
            .png({ compressionLevel: 9, palette: true, colors: 128, effort: 8 })
            .toBuffer()
        : await sharp(texture).jpeg({ quality: 80, mozjpeg: true }).toBuffer();
    await writeFile(target, output);
    log(`✓ textures/${item.file} — ${item.label} (${Math.round(output.length / 1024)} Ko)`);
  }
}
