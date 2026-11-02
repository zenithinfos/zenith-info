#!/usr/bin/env node
/**
 * Planche des Mewas.
 *
 *   node scripts/preview-mewa.mjs --out preview/mewas.png
 *
 * Il n'y a pas de WebGL hors navigateur : cette planche ne montre donc pas une
 * capture du jeu. Elle dessine la **silhouette** du Mewa à partir des mêmes
 * primitives que `Scene.tsx` (sphère de 0.27, deux cônes d'oreilles, deux yeux
 * noirs, halo additif bleu) et à la même échelle que le monde : 0.54 unité de
 * diamètre pour un personnage de 1.87 m. Ce que ça vérifie : les proportions,
 * la hauteur de flottement (1.12 m au-dessus du sol) et la lisibilité de loin.
 */

import { mkdir } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const argv = process.argv.slice(2);
const getArg = (name, fallback) => {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 ? argv[index + 1] : fallback;
};

const OUT = getArg("out", "preview/mewas.png");
await mkdir(path.dirname(OUT), { recursive: true });

const W = 1200;
const H = 830;
/** Pixels par mètre : à 120, un personnage de 1,87 m fait 224 px de haut. */
const PPM = 120;

/** Un Mewa : boule blanche, deux oreilles, deux yeux, halo bleu. */
function mewa({ x, y, scale, glow = 1, flip = false, distant = false }) {
  const r = 0.27 * scale * PPM;
  const eye = 0.046 * scale * PPM;
  const earH = 0.2 * scale * PPM;
  const earW = 0.19 * scale * PPM;
  const tilt = flip ? -1 : 1;
  const halo = r * 4.6 * glow;
  return `
    <g>
      <circle cx="${x}" cy="${y}" r="${halo}" fill="url(#halo)" opacity="${distant ? 0.55 : 0.9}"/>
      <g transform="rotate(${flip ? -6 : 6} ${x} ${y})">
        <path d="M ${x - 0.28 * r} ${y - 0.86 * r}
                 L ${x - 0.62 * r} ${y - 0.86 * r - earH}
                 L ${x - 0.02 * r} ${y - 0.98 * r} Z"
              fill="#f4fbff" opacity="${distant ? 0.7 : 1}"/>
        <path d="M ${x + 0.28 * r} ${y - 0.86 * r}
                 L ${x + 0.62 * r} ${y - 0.86 * r - earH}
                 L ${x + 0.02 * r} ${y - 0.98 * r} Z"
              fill="#f4fbff" opacity="${distant ? 0.7 : 1}"/>
        <circle cx="${x}" cy="${y}" r="${r}" fill="url(#body)"/>
        <circle cx="${x - 0.31 * r * tilt}" cy="${y - 0.06 * r}" r="${eye}" fill="#070a0d"/>
        <circle cx="${x + 0.31 * r * tilt}" cy="${y - 0.06 * r}" r="${eye}" fill="#070a0d"/>
        <circle cx="${x - 0.34 * r * tilt}" cy="${y - 0.1 * r}" r="${eye * 0.3}" fill="#ffffff" opacity="0.85"/>
        <circle cx="${x + 0.28 * r * tilt}" cy="${y - 0.1 * r}" r="${eye * 0.3}" fill="#ffffff" opacity="0.85"/>
      </g>
    </g>
    ${earW ? "" : ""}`;
}

const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#0b1a14"/>
      <stop offset="55%" stop-color="#12251b"/>
      <stop offset="100%" stop-color="#0a1510"/>
    </linearGradient>
    <radialGradient id="halo" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#cdefff" stop-opacity="0.95"/>
      <stop offset="26%" stop-color="#7fd0ff" stop-opacity="0.55"/>
      <stop offset="62%" stop-color="#3f9bff" stop-opacity="0.16"/>
      <stop offset="100%" stop-color="#1f5cff" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="body" cx="38%" cy="34%" r="72%">
      <stop offset="0%" stop-color="#ffffff"/>
      <stop offset="52%" stop-color="#eef9ff"/>
      <stop offset="86%" stop-color="#cbe8ff"/>
      <stop offset="100%" stop-color="#9fd3ff"/>
    </radialGradient>
    <radialGradient id="ground" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#4d7f6a" stop-opacity="0.35"/>
      <stop offset="100%" stop-color="#4d7f6a" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="trunk" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#0a120d"/>
      <stop offset="45%" stop-color="#1b2a20"/>
      <stop offset="100%" stop-color="#070d09"/>
    </linearGradient>
    <linearGradient id="fog" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#2a4033" stop-opacity="0"/>
      <stop offset="100%" stop-color="#2c4335" stop-opacity="0.55"/>
    </linearGradient>
  </defs>

  <rect width="${W}" height="${H}" fill="url(#sky)"/>

  <!-- Troncs et sous-bois : un fond de forêt, pas un décor de dessin animé -->
  ${[
    [70, 1.0],
    [250, 0.7],
    [470, 0.5],
    [840, 0.9],
    [1010, 0.6],
    [1150, 0.8],
  ]
    .map(
      ([x, k]) => `
    <rect x="${x - 26 * k}" y="0" width="${52 * k}" height="${H}" fill="url(#trunk)" opacity="0.85"/>
    <ellipse cx="${x}" cy="${H * 0.82}" rx="${90 * k}" ry="16" fill="#07110c" opacity="0.6"/>`,
    )
    .join("")}

  <rect x="0" y="${H * 0.62}" width="${W}" height="${H * 0.38}" fill="url(#fog)"/>
  <ellipse cx="${W * 0.5}" cy="${H * 0.86}" rx="${W * 0.55}" ry="120" fill="url(#ground)"/>

  <!-- Trois échelles : au contact, à dix mètres, et en lisière -->
  ${mewa({ x: 290, y: 400, scale: 2.05 })}
  ${mewa({ x: 620, y: 445, scale: 1.08, glow: 0.95, flip: true })}
  ${mewa({ x: 860, y: 470, scale: 0.48, glow: 0.8, distant: true })}

  <!-- Repères de lecture -->
  <g font-family="ui-sans-serif, system-ui, sans-serif" fill="#cfe6dd">
    <text x="60" y="70" font-size="13" letter-spacing="6" fill="#7fd0ff">LES MEWAS</text>
    <text x="60" y="104" font-size="30" font-weight="600" fill="#f2fbf6">Dix esprits dans la forêt</text>
    <text x="60" y="132" font-size="13" fill="#9fb8ab">Planche de proportions — pas une capture du jeu.</text>

    <g font-size="12" fill="#a8c4b6">
      <text x="${290 - 78}" y="560">au contact · 0,54 m</text>
      <text x="${620 - 46}" y="560">à dix mètres</text>
      <text x="${860 - 36}" y="560">en lisière</text>
    </g>

    <g transform="translate(60, 650)">
      <text x="0" y="0" font-size="11" letter-spacing="4" fill="#7fd0ff">SURVIE</text>
      ${[
        ["♥", "Santé", "#d17340", "repos, fruits, viande"],
        ["◆", "Faim", "#f2b544", "F · fruits · G · viande grillée"],
        ["●", "Soif", "#4fb3e8", "E · rivière"],
        ["▲", "Endurance", "#8fc47a", "courir l'épuise"],
      ]
        .map((entry, index) => {
          const x = index * 270;
          return `
          <g transform="translate(${x}, 22)">
            <text x="0" y="0" font-size="13" fill="#e7f4ec">${entry[0]} ${entry[1]}</text>
            <rect x="0" y="9" width="200" height="5" rx="2.5" fill="#22352a"/>
            <rect x="0" y="9" width="${[148, 112, 186, 132][index]}" height="5" rx="2.5" fill="${entry[2]}"/>
            <text x="0" y="31" font-size="10.5" fill="#8fa89c">${entry[3]}</text>
          </g>`;
        })
        .join("")}
    </g>

    <g transform="translate(60, 772)" font-size="11.5" fill="#8fa89c">
      <text x="0" y="0">Mewas x/10 dans le HUD · repères sur le GPS · 2 à 4 fils de rêve par esprit · +40 XP · +40 style</text>
      <text x="0" y="20">Santé à zéro : fin d'expédition (déshydratation, famine, attaque de potamochère) et score au classement.</text>
    </g>
  </g>
</svg>`;

await sharp(Buffer.from(svg)).png().toFile(OUT);
console.log(`Planche écrite : ${OUT}`);
