#!/usr/bin/env node
/**
 * La bande-annonce du jeu, en vraie vidéo.
 *
 *   node scripts/game-trailer.mjs [--out public/video/minkebe-trailer.mp4]
 *                                 [--size 960x540] [--fps 24] [--still 240]
 *
 * Pourquoi un rasteriseur logiciel ? Il n'y a pas de navigateur dans cet
 * environnement : impossible de filmer le jeu en WebGL. Ce script construit
 * donc **le monde du jeu** avec ses propres modules — les tuiles de forêt
 * (`game/forest.ts`), le relief (`game/terrain.ts`), les animaux
 * (`components/AnimalModel.ts`), le personnage et son arme
 * (`components/HumanModel.ts`) — et le filme avec cinq vraies caméras.
 *
 * Ce n'est pas le rendu WebGL : lumière lambert, pas de PBR, pas d'ombres
 * portées, pas de bloom. C'est de la 3D animée, honnête : elle montre des
 * choses qui existent réellement dans le jeu (les animaux, le fusil, la
 * démarche, la nuit), au lieu d'une affiche retouchée qui n'existe nulle part.
 *
 * Encodage : ffmpeg, chemin donné par `--ffmpeg` (ou la variable FFMPEG_PATH).
 * Les images partent en flux brut sur l'entrée standard. Rien n'est écrit sur
 * le disque entre la scène et le MP4, sauf avec `--still`.
 */

import { spawn } from "node:child_process";
import { build } from "esbuild";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";

/* ------------------------------------------------------------------ */
/* Options                                                             */
/* ------------------------------------------------------------------ */

const argv = process.argv.slice(2);
const getArg = (name, fallback) => {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 ? argv[index + 1] : fallback;
};

const OUT = getArg("out", "public/video/minkebe-trailer.mp4");
const requested = getArg("size", "960x540").split("x").map(Number);
const WIDTH = Math.round(requested[0] / 2) * 2;
const HEIGHT = Math.round(requested[1] / 2) * 2;
const FPS = Number(getArg("fps", "24"));
const DURATION = Number(getArg("duration", "42"));
const STILL = getArg("still", null);
const AUDIO = getArg("audio", "public/audio/ambiance-canopee.wav");
const FFMPEG_ARG = getArg("ffmpeg", process.env.FFMPEG_PATH ?? "ffmpeg");

/* ------------------------------------------------------------------ */
/* Modules du jeu                                                      */
/* ------------------------------------------------------------------ */

async function loadModules() {
  const dir = await mkdtemp(path.join(tmpdir(), "minkebe-film-"));
  const outFile = path.join(dir, "bundle.mjs");
  await build({
    stdin: {
      contents: `
        export { buildTile, crownCards, plantCards, mulberry32, TILE_SIZE, tileSeed, tilesAround } from "./src/game/forest.ts";
        export { terrainHeight } from "./src/game/terrain.ts";
        export { createAnimalRig, disposeAnimalRig, poseAnimal } from "./src/components/AnimalModel.ts";
        export { createHumanRig, disposeHumanRig, poseHuman, setHumanWeapon, humanKick, HUMAN_HOLD } from "./src/components/HumanModel.ts";
        export { createViewModel } from "./src/components/WeaponView.ts";
        export * as THREE from "three";
      `,
      resolveDir: process.cwd(),
      loader: "ts",
    },
    bundle: true,
    format: "esm",
    platform: "node",
    tsconfig: path.join(process.cwd(), "tsconfig.json"),
    outfile: outFile,
    logLevel: "error",
  });
  const loaded = await import(`${outFile}?t=${Date.now()}`);
  await rm(dir, { recursive: true, force: true });
  return loaded;
}

/* ------------------------------------------------------------------ */
/* Couleur                                                             */
/* ------------------------------------------------------------------ */

const srgb = (hex) => [
  Math.pow(((hex >> 16) & 255) / 255, 2.2),
  Math.pow(((hex >> 8) & 255) / 255, 2.2),
  Math.pow((hex & 255) / 255, 2.2),
];

let FOG = srgb(0x2f4334);
let FOG_DENSITY = 0.028;
const FOG_DAY = srgb(0x2f4334);

function setFog(rgb, density) {
  FOG = rgb;
  FOG_DENSITY = density;
}

/** Soleil rasant d'après-midi : la lumière traverse la futaie de côté. */
let SUN = (() => {
  const v = [58, 44, 26];
  const l = Math.hypot(...v);
  return v.map((c) => c / l);
})();

/* ------------------------------------------------------------------ */
/* Textures                                                            */
/* ------------------------------------------------------------------ */

async function loadTexture(file, size = 128, opaque = false) {
  let pipeline = sharp(file).resize(size, size, { fit: "fill" });
  if (!opaque) pipeline = pipeline.ensureAlpha();
  const { data, info } = await pipeline.raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height, channels: info.channels };
}

function sampleTexture(tex, u, v) {
  const { width, height, channels, data } = tex;
  let x = Math.floor((((u % 1) + 1) % 1) * width);
  let y = Math.floor((1 - (((v % 1) + 1) % 1)) * height);
  x = Math.min(width - 1, Math.max(0, x));
  y = Math.min(height - 1, Math.max(0, y));
  const i = (y * width + x) * channels;
  return [
    data[i] / 255,
    channels > 1 ? data[i + 1] / 255 : data[i] / 255,
    channels > 2 ? data[i + 2] / 255 : data[i] / 255,
    channels > 3 ? data[i + 3] / 255 : 1,
  ];
}

/* ------------------------------------------------------------------ */
/* Image et caméra                                                     */
/* ------------------------------------------------------------------ */

const PIXELS = WIDTH * HEIGHT;
const colour = new Float32Array(PIXELS * 3);
const zBuffer = new Float32Array(PIXELS);
const TAN_HALF = Math.tan((62 * Math.PI) / 360);
const ASPECT = WIDTH / HEIGHT;

let EYE = [0, 1.6, 0];
let FWD = [0, 0, 1];
let RIGHT = [1, 0, 0];
let UP = [0, 1, 0];

const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross3 = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const norm3 = (v) => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};

function setCamera(eye, yaw, pitch, roll = 0) {
  EYE = eye;
  const cp = Math.cos(pitch);
  FWD = norm3([Math.sin(yaw) * cp, Math.sin(pitch), Math.cos(yaw) * cp]);
  RIGHT = norm3(cross3([0, 1, 0], FWD));
  UP = norm3(cross3(FWD, RIGHT));
  if (roll !== 0) {
    const c = Math.cos(roll);
    const s = Math.sin(roll);
    const r = [RIGHT[0] * c + UP[0] * s, RIGHT[1] * c + UP[1] * s, RIGHT[2] * c + UP[2] * s];
    const u = [UP[0] * c - RIGHT[0] * s, UP[1] * c - RIGHT[1] * s, UP[2] * c - RIGHT[2] * s];
    RIGHT = r;
    UP = u;
  }
}

function project(p) {
  const dx = p[0] - EYE[0];
  const dy = p[1] - EYE[1];
  const dz = p[2] - EYE[2];
  const z = dx * FWD[0] + dy * FWD[1] + dz * FWD[2];
  if (z < 0.06) return null;
  const x = dx * RIGHT[0] + dy * RIGHT[1] + dz * RIGHT[2];
  const y = dx * UP[0] + dy * UP[1] + dz * UP[2];
  return [
    (x / (z * TAN_HALF * ASPECT)) * 0.5 * WIDTH + WIDTH * 0.5,
    HEIGHT * 0.5 - (y / (z * TAN_HALF)) * 0.5 * HEIGHT,
    z,
  ];
}

function fogMix(rgb, z) {
  const f = 1 - Math.exp(-Math.pow(z * FOG_DENSITY, 2));
  return [
    rgb[0] * (1 - f) + FOG[0] * f,
    rgb[1] * (1 - f) + FOG[1] * f,
    rgb[2] * (1 - f) + FOG[2] * f,
  ];
}

/* ------------------------------------------------------------------ */
/* Rastériseur                                                         */
/* ------------------------------------------------------------------ */

function triangle(a, b, c, shader, options = {}) {
  const pa = project(a);
  const pb = project(b);
  const pc = project(c);
  if (!pa || !pb || !pc) return;
  const { alphaTest = 0, blend = false, writeDepth = true } = options;

  const minX = Math.max(0, Math.floor(Math.min(pa[0], pb[0], pc[0])));
  const maxX = Math.min(WIDTH - 1, Math.ceil(Math.max(pa[0], pb[0], pc[0])));
  const minY = Math.max(0, Math.floor(Math.min(pa[1], pb[1], pc[1])));
  const maxY = Math.min(HEIGHT - 1, Math.ceil(Math.max(pa[1], pb[1], pc[1])));
  if (maxX < minX || maxY < minY) return;

  const area = (pb[0] - pa[0]) * (pc[1] - pa[1]) - (pc[0] - pa[0]) * (pb[1] - pa[1]);
  if (Math.abs(area) < 1e-9) return;
  const invArea = 1 / area;
  const ia = 1 / pa[2];
  const ib = 1 / pb[2];
  const ic = 1 / pc[2];

  for (let y = minY; y <= maxY; y++) {
    const py = y + 0.5;
    for (let x = minX; x <= maxX; x++) {
      const px = x + 0.5;
      const w0 = ((pb[0] - px) * (pc[1] - py) - (pc[0] - px) * (pb[1] - py)) * invArea;
      const w1 = ((pc[0] - px) * (pa[1] - py) - (pa[0] - px) * (pc[1] - py)) * invArea;
      const w2 = 1 - w0 - w1;
      if (w0 < 0 || w1 < 0 || w2 < 0) continue;

      const invZ = w0 * ia + w1 * ib + w2 * ic;
      if (invZ <= 0) continue;
      const z = 1 / invZ;
      const index = y * WIDTH + x;
      if (z >= zBuffer[index]) continue;

      const world = [
        (w0 * a[0] * ia + w1 * b[0] * ib + w2 * c[0] * ic) * z,
        (w0 * a[1] * ia + w1 * b[1] * ib + w2 * c[1] * ic) * z,
        (w0 * a[2] * ia + w1 * b[2] * ib + w2 * c[2] * ic) * z,
      ];
      const sample = shader(world, z, w0, w1, w2);
      if (!sample) continue;
      const alpha = sample[3] ?? 1;
      if (alpha < alphaTest) continue;

      const i = index * 3;
      if (blend || alpha < 1) {
        colour[i] += (sample[0] - colour[i]) * alpha;
        colour[i + 1] += (sample[1] - colour[i + 1]) * alpha;
        colour[i + 2] += (sample[2] - colour[i + 2]) * alpha;
      } else {
        colour[i] = sample[0];
        colour[i + 1] = sample[1];
        colour[i + 2] = sample[2];
      }
      if (writeDepth && alpha >= 1) zBuffer[index] = z;
    }
  }
}

function texturedQuad(corners, uvs, texture, light, options = {}) {
  const repeat = options.repeat ?? 1;
  const alphaTest = options.alphaTest ?? 0.35;
  const shader = (world, z, w0, w1, w2) => {
    const u = (uvs[0][0] * w0 + uvs[1][0] * w1 + uvs[2][0] * w2) * repeat;
    const v = (uvs[0][1] * w0 + uvs[1][1] * w1 + uvs[2][1] * w2) * repeat;
    const texel = sampleTexture(texture, u, v);
    if (texel[3] < alphaTest) return [0, 0, 0, 0];
    const shade = light(world, texel);
    return [...fogMix([texel[0] * shade[0], texel[1] * shade[1], texel[2] * shade[2]], z), texel[3]];
  };
  triangle(corners[0], corners[1], corners[2], shader, { alphaTest });
  triangle(corners[0], corners[2], corners[3], shader, { alphaTest });
}

/* ------------------------------------------------------------------ */
/* Ciel, sol                                                           */
/* ------------------------------------------------------------------ */

/**
 * Ciel. Sous couvert fermé on ne voit pas d'horizon : l'élévation la plus basse
 * est déjà de la brume, et au-dessus, la voûte. Un dégradé de ciel bleu laissait
 * une bande claire à hauteur d'homme — le défaut exact qu'on reproche à une
 * forêt en carton.
 */
function drawSky(ground, zenithFactor = 0.34) {
  // Sous la canopée, le fond n'est pas noir : c'est de la brume éclairée. Une
  // nappe de couleur sombre au ras de l'horizon fait un mur ; une nappe claire
  // fait un trou de lumière entre les fûts, et les feuilles se découpent en
  // silhouette devant — ce que fait une vraie forêt humide.
  const haze = [FOG[0] * 2.05, FOG[1] * 2.1, FOG[2] * 1.72];
  for (let y = 0; y < HEIGHT; y++) {
    const ny = 1 - ((y + 0.5) / HEIGHT) * 2;
    const elev = ny * TAN_HALF + FWD[1];
    for (let x = 0; x < WIDTH; x++) {
      const i = (y * WIDTH + x) * 3;
      let c;
      if (elev < 0) {
        const k = Math.min(1, -elev * 8);
        c = [
          haze[0] * (1 - k) + ground[0] * k,
          haze[1] * (1 - k) + ground[1] * k,
          haze[2] * (1 - k) + ground[2] * k,
        ];
      } else {
        const k = Math.min(1, elev * 2.6);
        c = [
          haze[0] * (1 - k) + FOG[0] * zenithFactor * k,
          haze[1] * (1 - k) + FOG[1] * (zenithFactor + 0.1) * k,
          haze[2] * (1 - k) + FOG[2] * zenithFactor * k,
        ];
      }
      // Un grain de brume : sans lui, la nappe se lit comme un aplat peint.
      const n = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
      const dither = (n - Math.floor(n) - 0.5) * 0.045;
      colour[i] = c[0] + dither;
      colour[i + 1] = c[1] + dither;
      colour[i + 2] = c[2] + dither;
      zBuffer[y * WIDTH + x] = Infinity;
    }
  }
}

/** Sol : maillage de 4 m, lancer de rayon remplacé par de la projection. */
function drawGround(game, groundTexture, radius, lightLevel) {
  const cx = EYE[0];
  const cz = EYE[2];
  const step = 4;
  const minX = Math.floor((cx - radius) / step) * step;
  const maxX = Math.ceil((cx + radius) / step) * step;
  const minZ = Math.floor((cz - radius) / step) * step;
  const maxZ = Math.ceil((cz + radius) / step) * step;
  const light = 0.14 + 0.26 * lightLevel;

  const shader = (world, z) => {
    const texel = sampleTexture(
      groundTexture,
      ((world[0] / 4) % 1 + 1) % 1,
      ((world[2] / 4) % 1 + 1) % 1,
    );
    const texel2 = sampleTexture(
      groundTexture,
      ((world[0] / 1.2) % 1 + 1) % 1,
      ((world[2] / 1.2) % 1 + 1) % 1,
    );
    // Deux échelles : une litière de 4 m pour la masse, un grain de 1,2 m pour
    // le premier plan. Une seule échelle fourmille de près et fait des taches
    // de loin.
    const mix = (a, b) => texel[a] * 0.55 + texel2[b] * 0.45;
    const red = mix(0, 0) * light * 0.9;
    const green = mix(1, 1) * light * 1.02;
    const blue = mix(2, 2) * light * 0.66;
    // La litière a des taches de latérite. On borne le rouge : la terre reste
    // chaude et brune, elle ne vire pas au rouge vif au premier plan.
    return fogMix([Math.min(red, green * 1.18 + 0.015), green, blue], z);
  };

  for (let x = minX; x < maxX; x += step) {
    for (let z = minZ; z < maxZ; z += step) {
      if (Math.hypot(x + step / 2 - cx, z + step / 2 - cz) > radius) continue;
      const p00 = [x, game.terrainHeight(x, z), z];
      const p10 = [x + step, game.terrainHeight(x + step, z), z];
      const p01 = [x, game.terrainHeight(x, z + step), z + step];
      const p11 = [x + step, game.terrainHeight(x + step, z + step), z + step];
      triangle(p00, p01, p11, shader);
      triangle(p00, p11, p10, shader);
    }
  }
}

/* ------------------------------------------------------------------ */
/* Monde                                                               */
/* ------------------------------------------------------------------ */

function eulerMatrix(rx, ry, rz) {
  const cx = Math.cos(rx), sx = Math.sin(rx);
  const cy = Math.cos(ry), sy = Math.sin(ry);
  const cz = Math.cos(rz), sz = Math.sin(rz);
  return [
    [cy * cz + sy * sx * sz, -cy * sz + sy * sx * cz, sy * cx],
    [cx * sz, cx * cz, -sx],
    [-sy * cz + cy * sx * sz, sy * sz + cy * sx * cz, cy * cx],
  ];
}

/**
 * Construit les tuiles autour des lieux filmés. `clearing` est décalé hors des
 * plans : la trouée du camp est un vrai vide de sept mètres, on ne filme pas
 * dedans.
 */
function buildWorld(game, textures, centres, radius) {
  const tiles = new Set();
  for (const centre of centres) {
    const span = Math.ceil((radius + 40) / game.TILE_SIZE);
    for (const [tx, tz] of game.tilesAround(centre[0], centre[1], span)) {
      tiles.add(`${tx}:${tz}`);
    }
  }

  const cards = [];
  const trunks = [];
  for (const key of tiles) {
    const [tx, tz] = key.split(":").map(Number);
    const tile = game.buildTile(tx, tz, {
      treeDensity: 0.058,
      understoryDensity: 0.52,
      clearing: { x: 0, z: 6, radius: 7 },
    });
    const random = game.mulberry32(game.tileSeed(tx, tz));

    for (const tree of tile.trees) {
      for (const segment of tree.segments ?? []) {
        const from = segment.from;
        const to = segment.to;
        const vertical = Math.abs(to[0] - from[0]) < 0.02 && Math.abs(to[2] - from[2]) < 0.02;
        trunks.push({
          x: tree.x + from[0],
          z: tree.z + from[2],
          y0: tree.y + from[1],
          y1: tree.y + to[1],
          r: (segment.radiusFrom + segment.radiusTo) * 0.5,
          horizontal: !vertical,
          x2: tree.x + to[0],
          z2: tree.z + to[2],
          shade: segment.kind === 0 ? (tree.kind === "emergent" ? 0.6 : 0.78) : 0.62,
        });
      }
      for (const card of game.crownCards(tree, random)) {
        const rx = card.horizontal
          ? -Math.PI / 2 + (random() - 0.5) * card.tilt
          : (random() - 0.5) * card.tilt;
        const rz = card.horizontal ? 0 : (random() - 0.5) * card.tilt;
        const m = eulerMatrix(rx, card.angle, rz);
        const family = random();
        cards.push({
          cx: tree.x + card.offset[0],
          cy: tree.y + card.offset[1],
          cz: tree.z + card.offset[2],
          u: [m[0][0], m[1][0], m[2][0]],
          v: [m[0][1], m[1][1], m[2][1]],
          n: [m[0][2], m[1][2], m[2][2]],
          hw: card.width / 2,
          hh: card.height / 2,
          tex: card.sparse
            ? textures.spray
            : family < 0.48
              ? textures.foliage
              : family < 0.82
                ? textures.foliageDeep
                : textures.foliagePale,
          tint:
            (0.86 + random() * 0.28) *
            (0.62 + 0.38 * Math.min(1, (card.offset[1] + tree.trunkHeight * 0.4) / 14)),
          // Une carte de couronne fait jusqu'à sept mètres. De près, une
          // feuille de sept mètres est un drap de bâche : on la découpe en
          // répétant la texture deux fois.
          repeat: Math.max(1, Math.round(card.width / 3.2)),
        });
      }
    }

    for (const plant of tile.understory) {
      const isCover = plant.variant === 3;
      const texture =
        plant.variant === 1
          ? textures.bigleaf
          : plant.variant === 2
            ? textures.foliage
            : isCover
              ? textures.foliageDeep
              : plant.variant === 4
                ? textures.grass
                : textures.fern;
      for (const card of game.plantCards(plant)) {
        // Le couvre-sol est une couche de détail dans le jeu, vue à travers la
        // végétation et mangée par les ombres. En image nette, empilé, il fait
        // une moquette. On en garde un tiers.
        if (card.flat && random() > 0.34) continue;
        let u = [1, 0, 0];
        let v = [0, 1, 0];
        let n = [0, 0, 1];
        if (card.flat && card.slope) {
          const [gx, gz] = card.slope;
          const nl = Math.hypot(gx, 1, gz);
          n = [-gx / nl, 1 / nl, -gz / nl];
          u = [Math.cos(card.angle), 0, -Math.sin(card.angle)];
          const d = dot3(u, n);
          u = norm3([u[0] - n[0] * d, u[1] - n[1] * d, u[2] - n[2] * d]);
          v = cross3(n, u);
        } else {
          const m = eulerMatrix(0, card.angle, 0);
          u = [m[0][0], m[1][0], m[2][0]];
          v = [m[0][1], m[1][1], m[2][1]];
          n = [m[0][2], m[1][2], m[2][2]];
        }
        cards.push({
          cx: card.x,
          cy: card.y,
          cz: card.z,
          u,
          v,
          n,
          hw: card.width / 2,
          hh: card.height / 2,
          tex: texture,
          tint: card.flat ? 0.22 + random() * 0.12 : 0.46 + random() * 0.24,
          repeat: card.hw > 1.6 ? 2 : 1,
        });
      }
    }
  }

  // --- voûte ---------------------------------------------------------
  // Sans plafond de feuillage, le ciel apparaît entre les couronnes et la forêt
  // ressemble à un parc. Petites nappes de feuille : une seule de trente mètres
  // fait une bâche.
  const random = game.mulberry32(77123);
  for (const centre of centres) {
    for (let i = 0; i < 900; i++) {
      const angle = random() * Math.PI * 2;
      const distance = Math.sqrt(random()) * (radius + 24);
      const m = eulerMatrix(
        -Math.PI / 2 + (random() - 0.5) * 0.35,
        random() * Math.PI,
        (random() - 0.5) * 0.35,
      );
      const size = 7 + random() * 9;
      cards.push({
        cx: centre[0] + Math.cos(angle) * distance,
        cy: 15 + random() * 17,
        cz: centre[1] + Math.sin(angle) * distance,
        u: [m[0][0], m[1][0], m[2][0]],
        v: [m[0][1], m[1][1], m[2][1]],
        n: [m[0][2], m[1][2], m[2][2]],
        hw: size / 2,
        hh: size / 2,
        tex: random() < 0.6 ? textures.canopy : textures.foliageDeep,
        tint: 0.46 + random() * 0.22,
        repeat: 2,
      });
    }
  }

  // Baï de tournage : autour de la trouée où se tient la harde, on dégage le
  // sous-bois. Un baï est justement une clairière humide à sels minéraux, et
  // sans elle les animaux sont invisibles derrière les feuilles.
  const BAI = { x: 7, z: 92, r: 9 };
  const cleared = cards.filter(
    (card) => !(Math.hypot(card.cx - BAI.x, card.cz - BAI.z) < BAI.r && card.cy < 7),
  );

  return { cards: cleared, trunks };
}

/** Dessine le décor statique autour de la caméra. */
function drawWorld(world, radius, sunStrength = 1, translucency = 1) {
  const maxD2 = radius * radius;
  const order = [];
  for (const card of world.cards) {
    const dx = card.cx - EYE[0];
    const dz = card.cz - EYE[2];
    const d2 = dx * dx + dz * dz;
    if (d2 > maxD2) continue;
    // Une feuille à moins d'un mètre de l'objectif occupe tout l'écran et
    // ressemble à un drap. Un vrai objectif ne fait pas la mise au point si
    // près : on écarte les cartes du premier centimètre.
    if (d2 < 1.44) continue;
    // Même chose un peu plus loin : une carte de trois mètres vue à cinq
    // mètres couvre déjà la moitié de l'image. On la réserve au fond.
    if (d2 < 64 && Math.max(card.hw, card.hh) > 1.15) continue;
    if (dx * FWD[0] + dz * FWD[2] < -Math.max(card.hw, card.hh) - 2) continue;
    order.push([d2, card]);
  }
  order.sort((a, b) => a[0] - b[0]);

  for (const [, card] of order) {
    const corners = [
      [
        card.cx - card.u[0] * card.hw - card.v[0] * card.hh,
        card.cy - card.u[1] * card.hw - card.v[1] * card.hh,
        card.cz - card.u[2] * card.hw - card.v[2] * card.hh,
      ],
      [
        card.cx + card.u[0] * card.hw - card.v[0] * card.hh,
        card.cy + card.u[1] * card.hw - card.v[1] * card.hh,
        card.cz + card.u[2] * card.hw - card.v[2] * card.hh,
      ],
      [
        card.cx + card.u[0] * card.hw + card.v[0] * card.hh,
        card.cy + card.u[1] * card.hw + card.v[1] * card.hh,
        card.cz + card.u[2] * card.hw + card.v[2] * card.hh,
      ],
      [
        card.cx - card.u[0] * card.hw + card.v[0] * card.hh,
        card.cy - card.u[1] * card.hw + card.v[1] * card.hh,
        card.cz - card.u[2] * card.hw + card.v[2] * card.hh,
      ],
    ];

    const front = Math.max(0, dot3(card.n, SUN));
    const sky = 0.5 + 0.5 * card.n[1];
    const back = Math.max(0, -dot3(card.n, SUN));
    // Lumière transmise : le soleil traverse la feuille et ressort vert. C'est
    // ce qui distingue une canopée d'une masse grise quand on la voit à
    // contre-jour — et depuis le sol, on la voit toujours à contre-jour.
    const through = Math.pow(back, 1.6) * 0.5 * translucency;
    const base = 0.14 + sky * 0.26 + front * 0.55 * sunStrength;
    const light = () => {
      const t = card.tint;
      return [
        (base * t + through * 0.5) * 0.62,
        (base * t + through * 1.0) * 0.78,
        (base * t + through * 0.3) * 0.55,
      ];
    };
    texturedQuad(corners, [[0, 0], [1, 0], [1, 1], [0, 1]], card.tex, light, {
      repeat: card.repeat ?? 1,
    });
  }

  // --- fûts ----------------------------------------------------------
  // Quatre facettes verticales par fût, chacune éclairée par sa normale. Une
  // seule bande plate donne des panneaux de contreplaqué : l'écorce n'y tourne
  // pas autour de l'arbre.
  const FACETS = 4;
  for (const trunk of world.trunks) {
    if (trunk.horizontal) continue;
    const dx = trunk.x - EYE[0];
    const dz = trunk.z - EYE[2];
    if (dx * dx + dz * dz > maxD2) continue;
    const r = trunk.r;
    const height = trunk.y1 - trunk.y0;
    if (r < 0.06 || height < 0.4) continue;

    const toCam = norm3([-dx, 0, -dz]);
    const side = norm3(cross3([0, 1, 0], toCam));
    const circumference = 2 * Math.PI * r;
    const uRepeat = Math.max(1, Math.round(circumference / 0.55));
    const vRepeat = Math.max(1, Math.round(height / 1.1));

    for (let facet = 0; facet < FACETS; facet++) {
      const a0 = (facet / FACETS) * Math.PI - Math.PI / 2;
      const a1 = ((facet + 1) / FACETS) * Math.PI - Math.PI / 2;
      const p0 = [
        trunk.x + side[0] * Math.sin(a0) * r + toCam[0] * Math.cos(a0) * r,
        0,
        trunk.z + side[2] * Math.sin(a0) * r + toCam[2] * Math.cos(a0) * r,
      ];
      const p1 = [
        trunk.x + side[0] * Math.sin(a1) * r + toCam[0] * Math.cos(a1) * r,
        0,
        trunk.z + side[2] * Math.sin(a1) * r + toCam[2] * Math.cos(a1) * r,
      ];
      const normal = norm3([
        (Math.sin(a0) + Math.sin(a1)) * side[0] + (Math.cos(a0) + Math.cos(a1)) * toCam[0],
        0,
        (Math.sin(a0) + Math.sin(a1)) * side[2] + (Math.cos(a0) + Math.cos(a1)) * toCam[2],
      ]);
      const lambert = 0.3 + 0.7 * Math.max(0, dot3(normal, SUN));
      const shade = trunk.shade * lambert * (0.45 + 0.55 * sunStrength);
      texturedQuad(
        [
          [p0[0], trunk.y0, p0[2]],
          [p1[0], trunk.y0, p1[2]],
          [p1[0], trunk.y1, p1[2]],
          [p0[0], trunk.y1, p0[2]],
        ],
        [
          [(facet / FACETS) * uRepeat, 0],
          [((facet + 1) / FACETS) * uRepeat, 0],
          [((facet + 1) / FACETS) * uRepeat, vRepeat],
          [(facet / FACETS) * uRepeat, vRepeat],
        ],
        textures.bark,
        () => [shade * 1.12, shade * 0.98, shade * 0.76],
        { alphaTest: 0 },
      );
    }
  }
}

/**
 * Forêt lointaine.
 *
 * Le monde détaillé s'arrête à une quarantaine de mètres : au-delà, il ne
 * reste que le sol et la couleur de brume, et l'horizon devient un mur vert
 * parfaitement plat. On sème donc, entre 48 et 150 m, des fûts en silhouette
 * — sombres, mangés par la brume — pour donner une profondeur à ce fond.
 */
function drawFarForest() {
  const random = game.mulberry32(20261101);
  for (let i = 0; i < 420; i++) {
    const angle = random() * Math.PI * 2;
    const distance = 48 + Math.pow(random(), 0.7) * 104;
    const x = EYE[0] + Math.cos(angle) * distance;
    const z = EYE[2] + Math.sin(angle) * distance;
    // On ne garde que ce qui est devant la caméra : le reste ne se voit pas.
    if ((x - EYE[0]) * FWD[0] + (z - EYE[2]) * FWD[2] < 6) continue;
    const height = 14 + random() * 16;
    const base = game.terrainHeight(x, z) - 1.2;
    const halfW = 0.3 + random() * 0.85;
    const toCam = norm3([EYE[0] - x, 0, EYE[2] - z]);
    const side = norm3(cross3([0, 1, 0], toCam));
    // Un fût à cent mètres est mangé par la brume : inutile de passer par
    // fogMix, il ne resterait rien. On peint directement un ton de brume
    // assombri, d'autant plus clair que le fût est loin — c'est l'aplatissement
    // atmosphérique, à la main.
    const far = Math.min(1, (distance - 48) / 102);
    const shade = 0.52 + far * 0.46;
    const shader = (world, z) => {
      void world;
      void z;
      return [FOG[0] * shade, FOG[1] * shade * 1.02, FOG[2] * shade * 0.94];
    };
    const corners = [
      [x - side[0] * halfW, base, z - side[2] * halfW],
      [x + side[0] * halfW, base, z + side[2] * halfW],
      [x + side[0] * halfW * 0.7, base + height, z + side[2] * halfW * 0.7],
      [x - side[0] * halfW * 0.7, base + height, z - side[2] * halfW * 0.7],
    ];
    triangle(corners[0], corners[1], corners[2], shader, { blend: true, writeDepth: false });
    triangle(corners[0], corners[2], corners[3], shader, { blend: true, writeDepth: false });
  }
}

/* ------------------------------------------------------------------ */
/* Objets animés (animaux, personnage)                                 */
/* ------------------------------------------------------------------ */

/**
 * Rastérise un groupe Three. Pas de texture : les matières du personnage sont
 * des couleurs unies, et les animaux aussi — c'est déjà vrai dans le jeu pour
 * la peau et la robe.
 */
function drawObject(group, lightLevel = 1) {
  group.updateMatrixWorld(true);
  const a = [0, 0, 0];
  const b = [0, 0, 0];
  const c = [0, 0, 0];

  const walk = (object) => {
    if (!object.visible) return;
    if (object.isMesh) {
      const geometry = object.geometry;
      const position = geometry.attributes.position;
      const index = geometry.index;
      const count = index ? index.count : position.count;
      const material = Array.isArray(object.material) ? object.material[0] : object.material;
      const base = material.color
        ? [material.color.r, material.color.g, material.color.b]
        : [0.5, 0.5, 0.5];
      const emissive = material.emissive
        ? [material.emissive.r, material.emissive.g, material.emissive.b]
        : [0, 0, 0];
      const elements = object.matrixWorld.elements;
      const perVertex = position.count;
      const transformed = new Float32Array(perVertex * 3);
      for (let i = 0; i < perVertex; i++) {
        const px = position.getX(i);
        const py = position.getY(i);
        const pz = position.getZ(i);
        transformed[i * 3] = elements[0] * px + elements[4] * py + elements[8] * pz + elements[12];
        transformed[i * 3 + 1] = elements[1] * px + elements[5] * py + elements[9] * pz + elements[13];
        transformed[i * 3 + 2] = elements[2] * px + elements[6] * py + elements[10] * pz + elements[14];
      }
      for (let i = 0; i < count; i += 3) {
        const i0 = (index ? index.getX(i) : i) * 3;
        const i1 = (index ? index.getX(i + 1) : i + 1) * 3;
        const i2 = (index ? index.getX(i + 2) : i + 2) * 3;
        a[0] = transformed[i0];
        a[1] = transformed[i0 + 1];
        a[2] = transformed[i0 + 2];
        b[0] = transformed[i1];
        b[1] = transformed[i1 + 1];
        b[2] = transformed[i1 + 2];
        c[0] = transformed[i2];
        c[1] = transformed[i2 + 1];
        c[2] = transformed[i2 + 2];
        const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
        const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
        const n = norm3(cross3(e1, e2));
        const facing = Math.abs(dot3(n, SUN));
        const sky = 0.58 + 0.42 * n[1];
        const shade = (0.16 + facing * 0.55) * lightLevel + sky * 0.2 * lightLevel;
        const triple = [
          base[0] * shade + emissive[0] * 0.5,
          base[1] * shade * 1.03 + emissive[1] * 0.5,
          base[2] * shade * 0.94 + emissive[2] * 0.5,
        ];
        triangle(a, b, c, (world, z) => fogMix(triple, z));
      }
    }
    for (const child of object.children) walk(child);
  };
  walk(group);
}

/* ------------------------------------------------------------------ */
/* Atmosphère                                                          */
/* ------------------------------------------------------------------ */

function drawBillboard(cx, cy, cz, width, height, rgb, alpha) {
  const toCam = norm3([EYE[0] - cx, 0, EYE[2] - cz]);
  const side = norm3(cross3([0, 1, 0], toCam));
  const corners = [
    [cx - side[0] * width, cy - height / 2, cz - side[2] * width],
    [cx + side[0] * width, cy - height / 2, cz + side[2] * width],
    [cx + side[0] * width, cy + height / 2, cz + side[2] * width],
    [cx - side[0] * width, cy + height / 2, cz - side[2] * width],
  ];
  const shader = (world, z) => {
    void world;
    // Dégradé doux vers le haut : une brume qui s'épaissit au sol.
    return [rgb[0], rgb[1], rgb[2], alpha * Math.max(0, 1 - z / 60)];
  };
  triangle(corners[0], corners[1], corners[2], shader, { blend: true, writeDepth: false });
  triangle(corners[0], corners[2], corners[3], shader, { blend: true, writeDepth: false });
}

/** Tache douce, additive, décroissante du centre vers les bords. */
function drawLampHalo(intensity) {
  const corners = [
    EYE[0] + RIGHT[0] * 2.6 + UP[0] * 2.6 + FWD[0] * 3.2,
    EYE[1] + RIGHT[1] * 2.6 + UP[1] * 2.6 + FWD[1] * 3.2,
    EYE[2] + RIGHT[2] * 2.6 + UP[2] * 2.6 + FWD[2] * 3.2,
  ];
  void corners;
  const centre = [EYE[0] + FWD[0] * 4, EYE[1] + FWD[1] * 4, EYE[2] + FWD[2] * 4];
  const p = project(centre);
  if (!p) return;
  const radius = (HEIGHT * 0.42) / Math.max(0.5, p[2]);
  const cx = p[0];
  const cy = p[1];
  for (let y = Math.max(0, Math.floor(cy - radius)); y < Math.min(HEIGHT, cy + radius); y++) {
    for (let x = Math.max(0, Math.floor(cx - radius)); x < Math.min(WIDTH, cx + radius); x++) {
      const d = Math.hypot(x - cx, y - cy) / radius;
      if (d > 1) continue;
      const a = intensity * Math.pow(1 - d, 2.2);
      const i = (y * WIDTH + x) * 3;
      colour[i] += 0.9 * a;
      colour[i + 1] += 0.82 * a;
      colour[i + 2] += 0.6 * a;
    }
  }
}

function drawShafts(time, strength) {
  if (strength <= 0.01) return;
  for (let i = 0; i < 7; i++) {
    const angle = (i / 7) * Math.PI * 2 + time * 0.02;
    const distance = 16 + (i % 3) * 9;
    drawBillboard(
      EYE[0] + Math.cos(angle) * distance,
      9 + Math.sin(i) * 2,
      EYE[2] + Math.sin(angle) * distance,
      3.4 + Math.sin(i * 2.3) * 1.2,
      18,
      [0.95, 0.86, 0.62],
      0.05 * strength,
    );
  }
}

/**
 * Brume. Des panneaux texturés donneraient des rectangles visibles dès qu'on
 * les voit de biais ; un léger voile additif sur les basses lumières suffit à
 * donner l'humidité sans trahir la géométrie. C'est aussi ce que fait le
 * brouillard exponentiel du jeu.
 */
function drawMist(time, strength) {
  if (strength <= 0.01) return;
  const amount = 0.012 * strength * (0.85 + 0.15 * Math.sin(time * 0.3));
  for (let y = 0; y < HEIGHT; y++) {
    // Plus dense en bas : la brume s'accumule dans les fonds.
    const weight = amount * (0.35 + (y / HEIGHT) * 0.9);
    for (let x = 0; x < WIDTH; x++) {
      const i = (y * WIDTH + x) * 3;
      colour[i] += 0.5 * weight;
      colour[i + 1] += 0.56 * weight;
      colour[i + 2] += 0.46 * weight;
    }
  }
}

function drawFireflies(time, strength) {
  if (strength <= 0.01) return;
  for (let i = 0; i < 70; i++) {
    const angle = (i * 2.399) % (Math.PI * 2);
    const distance = 3 + ((i * 13) % 20);
    const flicker = 0.5 + 0.5 * Math.sin(time * 2.4 + i * 1.7);
    drawBillboard(
      EYE[0] + Math.cos(angle + time * 0.08) * distance,
      0.6 + ((i * 7) % 5) * 0.35 + Math.sin(time + i) * 0.3,
      EYE[2] + Math.sin(angle + time * 0.08) * distance,
      0.035,
      0.035,
      [0.8, 0.95, 0.5],
      strength * flicker * 0.8,
    );
  }
}

/* ------------------------------------------------------------------ */
/* Étalonnage                                                          */
/* ------------------------------------------------------------------ */

/**
 * Exposition globale du plan. La courbe ACES relève fortement les basses
 * lumières : une scène de nuit réglée uniquement en baissant le soleil ressort
 * gris-vert. On baisse donc aussi l'exposition avant la courbe.
 */
let EXPOSURE = 1;

function tone(value) {
  const x = Math.max(0, value * 1.35 * EXPOSURE);
  const mapped = (x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14);
  return Math.pow(Math.min(1, Math.max(0, mapped)), 1 / 2.2);
}

const frameBuffer = Buffer.alloc(PIXELS * 3);
let grainSeed = 1;

function encodeFrame(grain = 0.016) {
  grainSeed = (grainSeed * 1103515245 + 12345) & 0x7fffffff;
  const halfPixels = PIXELS;
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const i = y * WIDTH + x;
      const dx = x / WIDTH - 0.5;
      const dy = y / HEIGHT - 0.5;
      const vig = 1 - (dx * dx + dy * dy) * 1.2;
      const noise = ((i * 2654435761 + grainSeed) % 1000) / 1000 - 0.5;
      const g = 1 + noise * grain;
      let r = tone(colour[i * 3] * vig * g);
      let gg = tone(colour[i * 3 + 1] * vig * g);
      let b = tone(colour[i * 3 + 2] * vig * g);
      const luma = 0.299 * r + 0.587 * gg + 0.114 * b;
      r = luma + (r - luma) * 0.9;
      gg = luma + (gg - luma) * 0.9;
      b = luma + (b - luma) * 0.9;
      const high = Math.max(0, Math.min(1, (luma - 0.5) * 2));
      const low = 1 - Math.min(1, luma * 2);
      r = Math.min(1, r + high * 0.03 - low * 0.012);
      gg = Math.min(1, gg + high * 0.016);
      b = Math.min(1, b - high * 0.012 + low * 0.02);
      // Attention : frameBuffer est un Buffer Node, pas un Uint8ClampedArray.
      // Écrire -0.009 y stocke 254 — le grain rouge qui mouchetait les zones
      // sombres venait de là, pas des textures. On borne explicitement.
      const toByte = (v) => Math.max(0, Math.min(255, Math.round(v * 255)));
      frameBuffer[i * 3] = toByte(r);
      frameBuffer[i * 3 + 1] = toByte(gg);
      frameBuffer[i * 3 + 2] = toByte(b);
    }
  }
  void halfPixels;
  return frameBuffer;
}

/* ------------------------------------------------------------------ */
/* Chargement                                                          */
/* ------------------------------------------------------------------ */

/** Canvas minimal : deux dimensions et un contexte 2D qui ne dessine rien. */
function fakeCanvas() {
  const context = new Proxy(
    {},
    {
      get: (_target, key) => {
        if (key === "createRadialGradient") {
          return () => ({ addColorStop() {} });
        }
        if (key === "getImageData") {
          return () => ({ data: new Uint8ClampedArray(4) });
        }
        return () => {};
      },
      set: () => true,
    },
  );
  return { width: 0, height: 0, getContext: () => context };
}

/**
 * Carton de fin.
 *
 * Le renderer ne connaît pas de glyphes : le mot-symbole est donc composé en
 * SVG par sharp (c'est déjà une dépendance du projet pour écrire les PNG), une
 * fois, au démarrage, puis posé sur les dernières secondes en fondu.
 */
async function buildEndCard() {
  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}">
  <rect width="100%" height="100%" fill="#050b07" opacity="0.55"/>
  <g font-family="DejaVu Sans, Helvetica, Arial, sans-serif" text-anchor="middle">
    <text x="${WIDTH / 2}" y="${HEIGHT * 0.5}" font-size="${Math.round(HEIGHT * 0.17)}"
      letter-spacing="${Math.round(HEIGHT * 0.035)}" fill="#f4efe3">MINKÉBÉ</text>
    <rect x="${WIDTH * 0.34}" y="${HEIGHT * 0.56}" width="${WIDTH * 0.32}" height="2" fill="#c8974f"/>
    <text x="${WIDTH / 2}" y="${HEIGHT * 0.64}" font-size="${Math.round(HEIGHT * 0.038)}"
      letter-spacing="${Math.round(HEIGHT * 0.006)}" fill="#cfd6c6">Forêt de Minkébé · province de l'Ogooué-Ivindo · Gabon</text>
    <text x="${WIDTH / 2}" y="${HEIGHT * 0.72}" font-size="${Math.round(HEIGHT * 0.03)}"
      letter-spacing="${Math.round(HEIGHT * 0.008)}" fill="#8f9c86">Windows · macOS · Android · navigateur</text>
  </g>
</svg>`;
  const { data, info } = await sharp(Buffer.from(svg))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height, channels: info.channels };
}

/** Pose le carton de fin sur l'image courante, en fondu. */
function drawEndCard(card, alpha) {
  const a = Math.max(0, Math.min(1, alpha));
  if (a <= 0.001) return;
  const scale = Math.max(WIDTH / card.width, HEIGHT / card.height);
  for (let y = 0; y < HEIGHT; y++) {
    const sy = Math.min(card.height - 1, Math.floor((y - (HEIGHT - card.height * scale) / 2) / scale));
    for (let x = 0; x < WIDTH; x++) {
      const sx = Math.min(card.width - 1, Math.floor((x - (WIDTH - card.width * scale) / 2) / scale));
      const si = (sy * card.width + sx) * card.channels;
      const sa = (card.data[si + 3] / 255) * a;
      if (sa <= 0.002) continue;
      const i = (y * WIDTH + x) * 3;
      for (let c = 0; c < 3; c++) {
        const src = Math.pow(card.data[si + c] / 255, 2.2);
        colour[i + c] = colour[i + c] * (1 - sa) + src * sa;
      }
    }
  }
}

const game = await loadModules();
const THREE = game.THREE;
const textures = {
  foliage: await loadTexture("public/textures/foliage.png", 128),
  foliageDeep: await loadTexture("public/textures/foliage-deep.png", 128),
  foliagePale: await loadTexture("public/textures/foliage-pale.png", 128),
  fern: await loadTexture("public/textures/fern.png", 128),
  grass: await loadTexture("public/textures/grass.png", 96),
  spray: await loadTexture("public/textures/spray.png", 64),
  bigleaf: await loadTexture("public/textures/bigleaf.png", 128),
  bark: await loadTexture("public/textures/bark.jpg", 96, true),
  ground: await loadTexture("public/textures/ground.jpg", 192, true),
  canopy: await loadTexture("public/textures/canopy.png", 128),
};
const endCard = await buildEndCard();

/* ------------------------------------------------------------------ */
/* Distribution des scènes                                             */
/* ------------------------------------------------------------------ */

/*
 * Cinq lieux filmés :
 *   1. la futaie, caméra à l'épaule qui avance (ouverture) ;
 *   2. le pisteur, vu de dos, qui marche fusil en main (présentation) ;
 *   3. la harde dans une trouée (la faune) ;
 *   4. vue subjective, arme en joue, éclair de bouche (la chasse) ;
 *   5. la nuit, lucioles et lampe (la nuit tombe) ;
 *   6. générique : le titre.
 */
const PLACES = [
  [0, 44],
  [6, 74],
  [-4, 96],
  [10, 118],
];
const world = buildWorld(game, textures, PLACES, 58);
console.log(`monde : ${world.cards.length} cartes, ${world.trunks.length} fûts`);

const human = game.createHumanRig();
game.setHumanWeapon(human, "m16");

const animalEntries = [
  { species: "bongo", x: 3.5, z: 96, heading: 1.45, scale: 1 },
  { species: "bongo", x: 6.2, z: 99, heading: 1.3, scale: 0.94 },
  { species: "gorille", x: -3.5, z: 92, heading: 1.2, scale: 1.05 },
  { species: "elephant", x: 13, z: 108, heading: 1.7, scale: 1 },
].map((entry, index) => ({
  ...entry,
  id: index,
  rig: game.createAnimalRig(entry.species),
}));

function animalState(entry, time, speed) {
  const x = entry.x + Math.sin(time * 0.14 + entry.id) * 1.4;
  const z = entry.z + ((time * speed) % 26);
  return {
    id: entry.id,
    speciesId: entry.species,
    x,
    z,
    groundY: game.terrainHeight(x, z),
    heading: entry.heading,
    gait: time * 4.2 + entry.id,
    speed,
    state: "marche",
    health: 100,
    maxHealth: 100,
    timer: 0,
    alert: 0,
    wander: entry.heading,
    deadTimer: 0,
    harvested: false,
    hitFlash: 0,
    scale: entry.scale,
    variant: 0.25 + entry.id * 0.18,
  };
}

/* ------------------------------------------------------------------ */
/* Plans                                                               */
/* ------------------------------------------------------------------ */

/** 1. La futaie : on avance à hauteur d'œil, la caméra respire. */
function shotForest(local) {
  const z = 44 + local * 1.4;
  const x = Math.sin(local * 0.16) * 1.4;
  const groundY = game.terrainHeight(x, z);
  setCamera(
    [x, groundY + 1.66 + Math.sin(local * 5.2) * 0.018, z],
    0.08 + Math.sin(local * 0.25) * 0.07,
    0.09,
    Math.sin(local * 0.4) * 0.006,
  );
  setFog(FOG_DAY, 0.03);
  drawSky(srgb(0x1e2a1c));
  drawGround(game, textures.ground, 84, 1);
  drawFarForest();
  drawWorld(world, 46, 1, 1.1);
  drawShafts(local, 0.9);
  drawMist(local, 0.9);
}

/** 2. Le pisteur, de dos, fusil en main. */
function shotHunter(local) {
  const z = 72 + local * 1.0;
  const x = Math.sin(local * 0.2) * 0.7;
  const groundY = game.terrainHeight(x, z);
  human.group.visible = true;
  human.group.position.set(x, groundY, z);
  human.group.rotation.y = Math.PI + Math.sin(local * 0.18) * 0.07;
  // Deux images de pose pour que la démarche avance : le personnage est animé,
  // pas figé.
  for (let i = 0; i < 2; i++) {
    game.poseHuman(human, {
      dt: 1 / FPS,
      motion: "walk",
      speed: 1.85,
      aiming: false,
      aimYaw: 0,
      aimPitch: 0,
    });
  }

  setCamera([x - 1.15, groundY + 2.2, z - 3.1], 0.62, 0.02);
  setFog(FOG_DAY, 0.028);
  drawSky(srgb(0x1e2a1c));
  drawGround(game, textures.ground, 78, 1);
  drawFarForest();
  drawWorld(world, 44, 0.95, 1.05);
  drawObject(human.group, 1.05);
  drawShafts(local, 0.5);
}

/** 3. La harde dans la trouée. */
function shotWildlife(local) {
  const z = 92;
  const x = 7;
  const groundY = game.terrainHeight(x, z);
  for (const entry of animalEntries) {
    game.poseAnimal(entry.rig, animalState(entry, local * 0.7, 0.5 + entry.id * 0.06), 10);
  }
  setCamera([x - 5.4, groundY + 1.9, z - 8.6], 0.42, 0.02);
  setFog(FOG_DAY, 0.024);
  drawSky(srgb(0x1e2a1c));
  drawGround(game, textures.ground, 80, 1.05);
  drawFarForest();
  drawWorld(world, 46, 1, 1.15);
  for (const entry of animalEntries) drawObject(entry.rig.group, 1.1);
}

/** 4. Vue subjective : arme en joue, tir, recul. */
function shotAim(local) {
  const z = 118 + local * 0.4;
  const x = 10;
  const groundY = game.terrainHeight(x, z);
  setCamera([x, groundY + 1.62, z], 0.12, 0.02);

  // La vue subjective a besoin d'un canvas (éclair de bouche) : hors
  // navigateur, on lui donne un canvas factice, sinon `createViewModel` lève.
  if (!shotAim.viewModel) {
    globalThis.document = globalThis.document ?? { createElement: () => fakeCanvas() };
    shotAim.viewModel = game.createViewModel();
  }
  const model = shotAim.viewModel;
  model.setWeapon("m16");
  model.setAiming(true);
  // Le recul tombe au début du plan, puis le canon se repose.
  if (local < 0.12) model.kick(1);
  for (let i = 0; i < 2; i++) model.update(1 / FPS, false, true);
  model.group.updateMatrixWorld(true);

  setFog(FOG_DAY, 0.03);
  drawSky(srgb(0x1e2a1c));
  drawGround(game, textures.ground, 84, 1);
  drawFarForest();
  drawWorld(world, 46, 1, 1.1);
  drawMist(local, 0.6);
  drawObject(model.group, 1.2);
}

/** 5. La nuit : lucioles, lampe frontale. */
function shotNight(local) {
  EXPOSURE = 0.4;
  const z = 44 + local * 0.9;
  const x = Math.sin(local * 0.18) * 1.2;
  const groundY = game.terrainHeight(x, z);
  setCamera([x, groundY + 1.64, z], 0.1, 0.02);
  setFog(srgb(0x0e1a14), 0.03);
  // La lune remplace le soleil : lumière froide, presque nulle.
  SUN = norm3([-30, 60, -20]);
  drawSky(srgb(0x08110c), 0.5);
  drawGround(game, textures.ground, 54, 0.28);
  drawWorld(world, 40, 0.16, 0.3);
  drawFireflies(local * 3, 1);
  drawMist(local, 0.5);

  // Lampe frontale : un cône de lumière porté par le regard.
  // Halo de lampe frontale : une tache lumineuse au centre du regard, qui
  // éclaire la végétation proche. Une pile de losanges donnerait un projecteur
  // de théâtre.
  drawLampHalo(0.09);
}

/** 6. Carton de fin : le titre, dans la brume. */
function shotTitle(local) {
  const z = 44 + local * 0.6;
  const x = Math.sin(local * 0.16) * 1.0;
  const groundY = game.terrainHeight(x, z);
  setCamera([x, groundY + 1.66, z], 0.08, 0.14);
  setFog(srgb(0x16221a), 0.045);
  SUN = norm3([58, 44, 26]);
  drawSky(srgb(0x0a120c), 0.6);
  drawGround(game, textures.ground, 60, 0.55);
  drawWorld(world, 36, 0.4, 0.6);
  drawMist(local, 1.4);
  drawEndCard(endCard, (local - 0.9) / 1.3);
}

/** Découpe du montage, en secondes. */
const CUTS = [
  { at: 0, shot: shotForest, length: 9 },
  { at: 9, shot: shotHunter, length: 7 },
  { at: 16, shot: shotWildlife, length: 8 },
  { at: 24, shot: shotAim, length: 5 },
  { at: 29, shot: shotNight, length: 8 },
  { at: 37, shot: shotTitle, length: 5 },
];

function renderFrame(t) {
  EXPOSURE = 1;
  let cut = CUTS[0];
  for (const entry of CUTS) if (t >= entry.at) cut = entry;
  cut.shot(t - cut.at);
}

/* ------------------------------------------------------------------ */
/* Encodage                                                            */
/* ------------------------------------------------------------------ */

function resolveFfmpeg() {
  if (FFMPEG_ARG !== "ffmpeg") return FFMPEG_ARG;
  const candidates = [
    "/home/user/.local/lib/python3.11/site-packages/imageio_ffmpeg/binaries/ffmpeg-linux-x86_64-v7.0.2",
    "/usr/bin/ffmpeg",
    "/usr/local/bin/ffmpeg",
  ];
  for (const candidate of candidates) if (existsSync(candidate)) return candidate;
  return "ffmpeg";
}

async function main() {
  await mkdir(path.dirname(OUT), { recursive: true });

  if (STILL !== null) {
    const frames = String(STILL)
      .split(",")
      .map(Number);
    for (const frame of frames) {
      renderFrame(frame / FPS);
      const file = `/tmp/trailer-still-${frame}.png`;
      await sharp(encodeFrame(), { raw: { width: WIDTH, height: HEIGHT, channels: 3 } })
        .png()
        .toFile(file);
      console.log(`✓ image ${frame} (t=${(frame / FPS).toFixed(2)} s) → ${file}`);
    }
    return;
  }

  const hasAudio = existsSync(AUDIO);
  const audioArgs = hasAudio ? ["-stream_loop", "-1", "-i", AUDIO] : [];
  const audioFilter = hasAudio
    ? [
        "-filter_complex",
        `[1:a]atrim=0:${DURATION},` +
          `afade=t=in:st=0:d=${Math.min(2.5, DURATION / 4).toFixed(2)},` +
          `afade=t=out:st=${Math.max(0, DURATION - Math.min(3, DURATION / 4)).toFixed(2)}:d=${Math.min(3, DURATION / 4).toFixed(2)},` +
          `volume=0.55[a]`,
        "-map",
        "0:v",
        "-map",
        "[a]",
        "-c:a",
        "aac",
        "-b:a",
        "112k",
        "-shortest",
      ]
    : ["-an"];

  const encoder = spawn(
    resolveFfmpeg(),
    [
      "-y",
      "-loglevel",
      "error",
      "-f",
      "rawvideo",
      "-pix_fmt",
      "rgb24",
      "-s",
      `${WIDTH}x${HEIGHT}`,
      "-r",
      String(FPS),
      "-i",
      "-",
      ...audioArgs,
      ...audioFilter,
      // Le grain du rendu est un bruit par pixel : en CRF 24 le film pèse
      // quarante mégaoctets pour quarante-deux secondes. Un léger débruitage
      // temporel, un CRF plus haut et un preset lent ramènent le fichier sous
      // les dix mégaoctets sans qu'on voie la différence à l'écran.
      "-vf",
      "hqdn3d=1.3:1.3:5:5",
      "-c:v",
      "libx264",
      "-preset",
      "slow",
      "-crf",
      "32",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      OUT,
    ],
    { stdio: ["pipe", "ignore", "pipe"] },
  );

  let ffmpegLog = "";
  encoder.stderr.on("data", (chunk) => {
    ffmpegLog += chunk.toString();
  });
  encoder.stdin.on("error", (error) => {
    if (error.code !== "EPIPE") throw error;
  });

  const totalFrames = Math.round(DURATION * FPS);
  const startedAt = performance.now();
  for (let frame = 0; frame < totalFrames; frame++) {
    renderFrame(frame / FPS);
    const buffer = encodeFrame();
    if (!encoder.stdin.write(buffer)) {
      await new Promise((resolve) => encoder.stdin.once("drain", resolve));
    }
    if (frame % 24 === 0 || frame === totalFrames - 1) {
      const elapsed = (performance.now() - startedAt) / 1000;
      const rate = ((frame + 1) / Math.max(0.001, elapsed)).toFixed(2);
      const eta = (elapsed / (frame + 1)) * (totalFrames - frame - 1);
      console.log(
        `image ${frame + 1}/${totalFrames} · ${rate} img/s · ${elapsed.toFixed(0)} s · reste ~${eta.toFixed(0)} s`,
      );
    }
  }

  encoder.stdin.end();
  await new Promise((resolve, reject) => {
    encoder.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`ffmpeg ${code}\n${ffmpegLog}`)),
    );
  });

  console.log(`✓ ${OUT}`);
}

await main();
void THREE;
