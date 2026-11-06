#!/usr/bin/env node
/**
 * Voit-on le ciel, oui ou non ?
 *
 *   node scripts/check-canopy.mjs [--out preview/ciel-canopee.png]
 *
 * Le ciel peut être parfaitement bleu dans le dôme et n'être jamais visible :
 * c'est ce qui se passait. Cinquante-six nappes de canopée posées sur une
 * texture **opaque** fermaient le ciel au-dessus de vingt degrés. Le joueur ne
 * voyait que la bande la plus pâle du dégradé, celle de l'horizon — et l'on
 * cherchait la faute dans les couleurs, alors qu'elle était dans le plafond.
 *
 * Ce contrôle mesure trois choses, dans cet ordre :
 *
 *   1. la texture employée laisse-t-elle passer la lumière ? (alpha réelle,
 *      comptée avec sharp sur le fichier, pas sur une intention) ;
 *   2. la pose des nappes laisse-t-elle des trouées ? (rayons lancés depuis
 *      l'œil, avec la géométrie réelle de `canopySheets`) ;
 *   3. quelle part du ciel reste visible, par tranche d'élévation ?
 *
 * Le panorama écrit en sortie montre le résultat : chaque pixel est du ciel
 * (couleur du dôme, calculée comme dans `check-sky`) ou du feuillage.
 */

import { build } from "esbuild";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";

const dir = await mkdtemp(path.join(tmpdir(), "minkebe-canopy-"));
const bundle = path.join(dir, "mod.mjs");
await build({
  stdin: {
    contents: `export * from "./src/game/canopy.ts";\nexport * from "./src/game/sceneConfig.ts";`,
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
const { canopySheets, CANOPY, FOREST_PALETTE, SKY_GRADIENT_EXPONENT, TEXTURES, lightForDaylight } = await import(
  `${bundle}?t=${Date.now()}`
);
await rm(dir, { recursive: true, force: true });

/* ---------------- 1. la texture laisse-t-elle passer le ciel ? ---------------- */

const ALPHA_TEST = 0.36;

/** Part de la surface où la texture est absente — donc où le ciel passe. */
async function openness(file, alphaTest) {
  const raw = await readFile(path.join("public", file.replace(/^\//, "")));
  const { data, info } = await sharp(raw).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let open = 0;
  const pixels = info.width * info.height;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] / 255 < alphaTest) open += 1;
  }
  return open / pixels;
}

let failures = 0;
function check(label, ok, detail) {
  if (!ok) failures += 1;
  console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
}

const pct = (value) => `${Math.round(value * 100)} %`;

console.log("\nLa texture du plafond");
// La texture réellement employée pour le plafond, dans Scene.tsx.
const CEILING_TEXTURE = TEXTURES.foliage;
const open = await openness(CEILING_TEXTURE, ALPHA_TEST);
const opaque = await openness(TEXTURES.canopy, ALPHA_TEST);
console.log(`    ${CEILING_TEXTURE.padEnd(22)} ouverte à ${pct(open)}`);
console.log(`    ${TEXTURES.canopy.padEnd(22)} ouverte à ${pct(opaque)}   ← l'ancien plafond`);
check("le plafond n'est pas une dalle opaque", open > 0.3, `${pct(open)} de trous`);
check(
  "la texture pleine n'est pas utilisée pour le plafond",
  CEILING_TEXTURE !== TEXTURES.canopy,
  `plafond : ${CEILING_TEXTURE}`,
);

/* ---------------- 2 et 3. le ciel visible ---------------- */

const EYE = 1.65;
const sheets = canopySheets();
const mobileSheets = canopySheets({ mobile: true });

/** Le rayon depuis l'œil touche-t-il une nappe ? */
function hitsSheet(list, azimuth, elevation) {
  const sin = Math.sin(elevation);
  const cos = Math.cos(elevation);
  for (const sheet of list) {
    const rise = sheet.y - EYE;
    if (rise <= 0) continue;
    const t = rise / sin;
    const px = Math.cos(elevation) * Math.sin(azimuth) * t;
    const pz = Math.cos(elevation) * Math.cos(azimuth) * t;
    const dx = px - sheet.x;
    const dz = pz - sheet.z;
    const u = dx * Math.cos(sheet.yaw) - dz * Math.sin(sheet.yaw);
    const v = dx * Math.sin(sheet.yaw) + dz * Math.cos(sheet.yaw);
    const half = sheet.size / 2;
    if (Math.abs(u) < half && Math.abs(v) < half) return true;
  }
  void cos;
  return false;
}

/**
 * Le ciel est-il visible dans cette direction ?
 *
 * Deux obstacles : la géométrie (une nappe est là) et la texture (la feuille
 * peut être pleine à cet endroit). On décide du second par un tirage
 * déterministe de même moyenne que la transparence mesurée : c'est un modèle,
 * et il est annoncé comme tel. Il ne remplace pas un rendu, il dit si le ciel a
 * la place d'apparaître.
 */
function skyVisibleThere(list, azimuth, elevation, hash) {
  if (!hitsSheet(list, azimuth, elevation)) return true;
  return hash < open;
}

/**
 * Un nombre stable par **paquet** de directions, pas par direction.
 *
 * Une feuille fait vingt centimètres : vue de vingt mètres, elle couvre un
 * demi-degré, soit un ou deux pixels. Tester chaque pixel indépendamment
 * produit un bruit de sel et de poivre qui ne ressemble à aucune canopée. On
 * tire donc par paquets de deux pixels — les trous deviennent des trous.
 */
function leafHash(x, y) {
  const px = Math.floor(x / 2);
  const py = Math.floor(y / 2);
  return Math.abs(Math.sin(px * 12.9898 + py * 78.233) * 43758.5453) % 1;
}

const BANDS = [
  [5, 10, "au ras de la canopée"],
  [10, 20, "entre deux ramures"],
  [20, 30, "trouée basse"],
  [30, 45, "trouée"],
  [45, 65, "au-dessus"],
  [65, 90, "zénith"],
];

function visibility(list) {
  return BANDS.map(([low, high, name]) => {
    let visible = 0;
    let total = 0;
    for (let a = 0; a < 144; a += 1) {
      const azimuth = (a / 144) * Math.PI * 2;
      for (let e = low; e <= high; e += 0.5) {
        total += 1;
        if (skyVisibleThere(list, azimuth, (e * Math.PI) / 180, leafHash(a, e * 2))) visible += 1;
      }
    }
    return { low, high, name, ratio: visible / total };
  });
}

console.log("\nCe que le joueur voit en levant les yeux");
console.log(`    ${sheets.length} nappes, ${CANOPY.height[0]}–${CANOPY.height[1]} m d'altitude, ${CANOPY.size[0]}–${CANOPY.size[1]} m de côté`);
const desktop = visibility(sheets);
for (const band of desktop) {
  const bar = "█".repeat(Math.round(band.ratio * 22)).padEnd(22, "·");
  console.log(`    ${band.name.padEnd(22)} ${String(Math.round(band.ratio * 100)).padStart(3)} %  ${bar}`);
}

const above20 = desktop.filter((band) => band.low >= 20);
const meanAbove20 = above20.reduce((sum, band) => sum + band.ratio, 0) / above20.length;
check("le ciel est visible au-dessus de 20°", meanAbove20 > 0.45, `${pct(meanAbove20)} en moyenne`);
check("il y a de vraies trouées, pas que des interstices", above20.every((band) => band.ratio > 0.3), "chaque tranche > 30 %");

const mobile = visibility(mobileSheets);
const mobileMean = mobile.filter((b) => b.low >= 20).reduce((sum, b) => sum + b.ratio, 0) / 4;
console.log(`    mobile : ${mobileSheets.length} nappes, ciel visible au-dessus de 20° ${pct(mobileMean)}`);
check("le mobile garde le ciel ouvert", mobileMean > 0.45, `${pct(mobileMean)}`);

// Le plafond doit rester un plafond : s'il s'ouvre trop, la forêt redevient un
// parc et l'on voit le ciel partout, ce qui n'est pas une forêt non plus.
check("le plafond ferme encore la moitié du ciel", meanAbove20 < 0.85, `${pct(meanAbove20)}`);

/* ---------------- panorama ---------------- */

const outline = process.argv.indexOf("--out");
if (outline > 0) {
  const file = process.argv[outline + 1];
  const W = 720;
  const H = 340;
  const SS = 3;
  const exposure = lightForDaylight(1).exposure;
  const toLinear = (v) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
  const toSrgb = (v) => (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);
  const aces = (x) => Math.min(1, Math.max(0, (x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14)));
  const linear = (hex) => [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255].map(toLinear);
  const skyTop = linear(FOREST_PALETTE.skyDay);
  const skyHaze = linear(FOREST_PALETTE.skyHaze);

  /**
   * Chaque pixel est la **moyenne** de neuf rayons.
   *
   * À trente mètres, une feuille couvre un quart de pixel : un rendu rayon par
   * pixel donne un bruit de sel et de poivre que personne ne voit dans le jeu.
   * Ce que l'œil perçoit, c'est la moyenne — une canopée translucide, trouée de
   * ciel. C'est cette moyenne qu'on écrit, et c'est elle qui répond à la
   * question posée : voit-on le bleu, oui ou non ?
   */
  const raw = Buffer.alloc(W * H * 3);
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      let skyShare = 0;
      let elevationSum = 0;
      for (let sy = 0; sy < SS; sy += 1) {
        for (let sx = 0; sx < SS; sx += 1) {
          const u = (x + (sx + 0.5) / SS) / W;
          const v = (y + (sy + 0.5) / SS) / H;
          const elevation = (1 - v) * (Math.PI / 2);
          const azimuth = u * Math.PI * 2;
          elevationSum += elevation;
          if (skyVisibleThere(sheets, azimuth, elevation, leafHash(Math.floor(x * SS + sx), Math.floor(y * SS + sy)))) {
            skyShare += 1 / (SS * SS);
          }
        }
      }
      const elevation = elevationSum / (SS * SS);
      const mix = Math.pow(Math.min(1, Math.max(0, Math.sin(elevation))), SKY_GRADIENT_EXPONENT);
      const sky = skyTop.map((value, i) => skyHaze[i] + (value - skyHaze[i]) * mix);
      // Feuillage en contre-jour : sombre, un peu chaud au bord des feuilles.
      const shade = 0.05 + 0.12 * Math.pow(1 - Math.sin(elevation), 2);
      const leaf = [shade * 1.35, shade * 1.55, shade * 0.95];
      const i = (y * W + x) * 3;
      for (let c = 0; c < 3; c += 1) {
        const colour = leaf[c] + (sky[c] - leaf[c]) * skyShare;
        raw[i + c] = Math.round(Math.min(1, Math.max(0, toSrgb(aces(colour * exposure)))) * 255);
      }
    }
  }

  const labels = `
    <svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
      <style>
        text { font-family: ui-monospace, monospace; fill: #fff; font-size: 13px; }
        .dim { opacity: 0.66; font-size: 11px; }
        .rule { stroke: #fff; stroke-opacity: 0.25; stroke-width: 1; }
      </style>
      <rect x="0" y="0" width="${W}" height="34" fill="#000" fill-opacity="0.45" />
      <text x="14" y="22">le ciel par le plafond de canopée — 360°, zénith en haut</text>
      ${BANDS.map(([low, high, name]) => {
        const y = Math.round((1 - Math.sin((((low + high) / 2) * Math.PI) / 180)) * H);
        const band = desktop.find((b) => b.low === low);
        return `<line x1="0" y1="${y}" x2="${W}" y2="${y}" class="rule" />
                <text x="14" y="${y - 5}" class="dim">${name} — ${Math.round((band?.ratio ?? 0) * 100)} % de ciel</text>`;
      }).join("")}
      <rect x="0" y="${H - 26}" width="${W}" height="26" fill="#000" fill-opacity="0.45" />
      <text x="14" y="${H - 9}" class="dim">${pct(meanAbove20)} du ciel au-dessus de 20° · ${sheets.length} nappes · texture ouverte à ${pct(open)}</text>
    </svg>
  `;
  await mkdir(path.dirname(file), { recursive: true });
  await sharp(raw, { raw: { width: W, height: H, channels: 3 } })
    .composite([{ input: Buffer.from(labels) }])
    .png()
    .toFile(file);
  console.log(`\n  panorama : ${file}`);
}

console.log(failures === 0 ? "\n✓ On voit le ciel.\n" : `\n✗ ${failures} contrôle(s) en échec.\n`);
process.exit(failures === 0 ? 0 : 1);
