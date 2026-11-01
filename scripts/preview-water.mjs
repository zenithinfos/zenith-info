#!/usr/bin/env node
/**
 * Aperçu hors navigateur des cours d'eau.
 *
 *   node scripts/preview-water.mjs [--out /tmp] [--size 480x270] [--ss 2]
 *
 * Il n'y a pas de WebGL dans l'environnement de développement. Ce script
 * rejoue **la même formule de shading** que le shader de `WaterSurface.ts`
 * (Fresnel, absorption de Beer-Lambert, trois couches de rides, éclat solaire,
 * écume de berge, brouillard exponentiel) en JavaScript, sur le même champ de
 * distance (`game/water.ts`) et le même relief (`game/terrain.ts`).
 *
 * Ce n'est pas une capture du jeu : pas de reflets d'arbres, pas de bloom, pas
 * de transluminescence. C'est un contrôle de vraisemblance — la forme des
 * rives, la couleur de l'eau selon la profondeur, l'écume, la façon dont la
 * lumière tombe sur la surface.
 */

import { build } from "esbuild";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";

const argv = process.argv.slice(2);
const getArg = (name, fallback) => {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 ? argv[index + 1] : fallback;
};

const OUT_DIR = getArg("out", "/tmp");
await mkdir(OUT_DIR, { recursive: true });
const [WIDTH, HEIGHT] = getArg("size", "480x270").split("x").map(Number);
const SS = Number(getArg("ss", "2"));
const TIME = Number(getArg("time", "8"));

/* ---------------------------------------------------------------- */
/* Modules du jeu                                                    */
/* ---------------------------------------------------------------- */

async function loadGame() {
  const dir = await mkdtemp(path.join(tmpdir(), "minkebe-eau-"));
  const outFile = path.join(dir, "bundle.mjs");
  await build({
    stdin: {
      contents: `export * from "./src/game/water.ts"; export { terrainHeight } from "./src/game/terrain.ts";`,
      resolveDir: process.cwd(),
      loader: "ts",
    },
    bundle: true,
    format: "esm",
    platform: "node",
    outfile: outFile,
    logLevel: "error",
  });
  const gameModule = await import(`${outFile}?t=${Date.now()}`);
  await rm(dir, { recursive: true, force: true });
  return gameModule;
}

const game = await loadGame();

/* ---------------------------------------------------------------- */
/* Textures                                                          */
/* ---------------------------------------------------------------- */

async function loadRgb(file, size) {
  const { data, info } = await sharp(file)
    .resize(size, size, { fit: "fill" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

const normalTex = await loadRgb("public/textures/water_normal.jpg", 256);
const groundTex = await loadRgb("public/textures/ground.jpg", 256);

/** Feuillage détouré : sert de masque au reflet (comme dans le shader). */
const canopyTex = await (async () => {
  const { data, info } = await sharp("public/textures/foliage.png")
    .resize(256, 256, { fit: "fill" })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height, channels: 4 };
})();

function sampleTex(tex, u, v) {
  const x = ((u % 1) + 1) % 1;
  const y = ((v % 1) + 1) % 1;
  const px = Math.min(tex.width - 1, Math.floor(x * tex.width));
  const py = Math.min(tex.height - 1, Math.floor(y * tex.height));
  const i = (py * tex.width + px) * 3;
  return [tex.data[i] / 255, tex.data[i + 1] / 255, tex.data[i + 2] / 255];
}

function canopySample(u, v) {
  const x = ((u % 1) + 1) % 1;
  const y = ((v % 1) + 1) % 1;
  const px = Math.min(canopyTex.width - 1, Math.floor(x * canopyTex.width));
  const py = Math.min(canopyTex.height - 1, Math.floor(y * canopyTex.height));
  const i = (py * canopyTex.width + px) * 4;
  return [
    canopyTex.data[i] / 255,
    canopyTex.data[i + 1] / 255,
    canopyTex.data[i + 2] / 255,
    canopyTex.data[i + 3] / 255,
  ];
}

function normalSample(u, v) {
  const [r, g] = sampleTex(normalTex, u, v);
  return [r * 2 - 1, g * 2 - 1];
}

/* ---------------------------------------------------------------- */
/* Champ de hauteur (accélère le lancer de rayons sur le sol)         */
/* ---------------------------------------------------------------- */

function makeHeightmap(centreX, centreZ, half, resolution) {
  const size = Math.ceil((half * 2) / resolution) + 1;
  const heights = new Float32Array(size * size);
  const originX = centreX - half;
  const originZ = centreZ - half;
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      heights[j * size + i] = game.terrainHeight(originX + i * resolution, originZ + j * resolution);
    }
  }
  return { heights, size, originX, originZ, resolution, half };
}

function heightAt(map, x, z) {
  const fx = (x - map.originX) / map.resolution;
  const fz = (z - map.originZ) / map.resolution;
  if (fx < 0 || fz < 0 || fx >= map.size - 1 || fz >= map.size - 1) return null;
  const i = Math.floor(fx);
  const j = Math.floor(fz);
  const tx = fx - i;
  const tz = fz - j;
  const a = map.heights[j * map.size + i];
  const b = map.heights[j * map.size + i + 1];
  const c = map.heights[(j + 1) * map.size + i];
  const d = map.heights[(j + 1) * map.size + i + 1];
  return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
}

/* ---------------------------------------------------------------- */
/* Maths                                                             */
/* ---------------------------------------------------------------- */

const SUN_DIR = (() => {
  const v = [52, 62, 30];
  const l = Math.hypot(...v);
  return [v[0] / l, v[1] / l, v[2] / l];
})();
const SUN_COLOUR = [1.0, 0.9, 0.74];
const SUN_INTENSITY = 0.92;
const FOG_COLOUR = [0.113, 0.165, 0.133];
const FOG_DENSITY = 0.0125;
const CANOPY_COLOUR = [0.11, 0.18, 0.12];

/** Couleur sRGB → linéaire, comme le fait Three sur `new Color(0x…)`. */
function srgb(hex) {
  return [
    Math.pow(((hex >> 16) & 255) / 255, 2.2),
    Math.pow(((hex >> 8) & 255) / 255, 2.2),
    Math.pow((hex & 255) / 255, 2.2),
  ];
}

/**
 * Environnement de la scène (dégradé de ciel dessiné dans Scene.tsx), échantillonné
 * par la direction réfléchie : l'eau renvoie le ciel chaud de l'horizon puis le
 * bleu du zénith.
 */
const ENV_STOPS = [
  [0.0, srgb(0x7fa8c4)],
  [0.42, srgb(0xa8c0c4)],
  [0.5, srgb(0xe6dcb8)],
  [0.56, srgb(0x5c7048)],
  [1.0, srgb(0x1a2416)],
];

function sampleEnvironment(upness) {
  const v = clamp(upness, 0, 1);
  for (let i = 0; i < ENV_STOPS.length - 1; i++) {
    const [a, ca] = ENV_STOPS[i];
    const [b, cb] = ENV_STOPS[i + 1];
    if (v >= a && v <= b) {
      const t = (v - a) / Math.max(1e-5, b - a);
      return mix3(ca, cb, t);
    }
  }
  return ENV_STOPS[ENV_STOPS.length - 1][1];
}

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const mix = (a, b, t) => a + (b - a) * t;
const mix3 = (a, b, t) => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];
const smoothstep = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};

function hash(px, py) {
  const s = Math.sin(px * 127.1 + py * 311.7) * 43758.5453123;
  return s - Math.floor(s);
}

function valueNoise(px, py) {
  const ix = Math.floor(px);
  const iy = Math.floor(py);
  const fx = px - ix;
  const fy = py - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy);
  const b = hash(ix + 1, iy);
  const c = hash(ix, iy + 1);
  const d = hash(ix + 1, iy + 1);
  return mix(mix(a, b, ux), mix(c, d, ux), uy);
}

function normalize3(v) {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

/* ---------------------------------------------------------------- */
/* Shading de l'eau — miroir de WaterSurface.ts                      */
/* ---------------------------------------------------------------- */

function shadeWater(field, point, eye) {
  const body = field.body;
  const flow = field.flow;
  const length = Math.hypot(flow[0], flow[1]) || 1;
  const dir = [flow[0] / length, flow[1] / length];
  const side = [-dir[1], dir[0]];
  const advect = TIME * (0.045 + body.current * 0.055);

  // Les UV du maillage valent (abscisse/7,5 ; travers/7,5). En aperçu on
  // approxime par la position monde : les rides ont la même échelle, elles ne
  // suivent simplement pas exactement les boucles du courant.
  const uv = [point[0] / 7.5, point[2] / 7.5];
  const dotSide = uv[0] * side[0] + uv[1] * side[1];
  const dotDir = uv[0] * dir[0] + uv[1] * dir[1];

  const nA = normalSample(dotSide * 0.9, dotDir * 0.55 - advect);
  const nB = normalSample(dotSide * 2.6 + 0.37, dotDir * 1.9 - advect * 1.7 + 7.3);
  const nC = normalSample(dotDir * 5.5, dotSide * 9 + TIME * 0.32);

  const distance = Math.hypot(eye[0] - point[0], eye[1] - point[1], eye[2] - point[2]);
  const detail = mix(1, 0.28, smoothstep(18, 85, distance));
  const rx = (nA[0] * 0.52 + nB[0] * 0.32 + nC[0] * 0.26) * detail;
  const ry = (nA[1] * 0.52 + nB[1] * 0.32 + nC[1] * 0.26) * detail;
  const N = normalize3([rx * 0.62, 1, ry * 0.62]);

  const V = normalize3([eye[0] - point[0], eye[1] - point[1], eye[2] - point[2]]);
  const ndv = clamp(N[0] * V[0] + N[1] * V[1] + N[2] * V[2], 0, 1);
  const fresnel = 0.02 + 0.98 * Math.pow(1 - ndv, 5);

  const absorb = 1 - Math.exp(-field.depth * 1.5);
  const deep = srgb(body.deep);
  const shallow = srgb(body.shallow);
  const waterBody = mix3(shallow, deep, absorb);

  const dotNV = V[0] * N[0] + V[1] * N[1] + V[2] * N[2];
  const reflectDir = [
    -V[0] + 2 * dotNV * N[0],
    -V[1] + 2 * dotNV * N[1],
    -V[2] + 2 * dotNV * N[2],
  ];
  // L'équirectangulaire est parcourue du zénith (R.y = 1) à l'horizon (R.y = 0).
  const envBase = sampleEnvironment(1 - reflectDir[1]);
  const envU = Math.atan2(reflectDir[2], reflectDir[0]) / (Math.PI * 2) + 0.5;
  const envV = Math.acos(clamp(reflectDir[1], -1, 1)) / Math.PI;
  const canopy = canopySample(envU * 3, envV * 2.2);
  const shade = (canopy[0] + canopy[1] + canopy[2]) / 3;
  const canopyMix = canopy.map((c, k) => mix([0.09, 0.13, 0.08][k], c, canopy[3] * 0.9));
  const shadeValue = (canopyMix[0] + canopyMix[1] + canopyMix[2]) / 3;
  void shade;
  const envColour = envBase.map(
    (c) => c * mix(0.45, 1.7, smoothstep(0.03, 0.4, shadeValue)),
  );
  const sky = mix3(CANOPY_COLOUR, envColour, 0.62);

  const half = normalize3([SUN_DIR[0] + V[0], SUN_DIR[1] + V[1], SUN_DIR[2] + V[2]]);
  const ndh = Math.max(N[0] * half[0] + N[1] * half[1] + N[2] * half[2], 0);
  const glitter = smoothstep(0.55, 1, valueNoise(uv[0] * 90 - dir[0] * TIME * 0.8, uv[1] * 90 - dir[1] * TIME * 0.8));
  const glint =
    Math.pow(ndh, 900) * (1.6 + glitter * 5.5) +
    Math.pow(ndh, 48) * 0.18 * (1 - detail * 0.5);

  const shoreBand = 1 - smoothstep(0, 0.55, -field.edge);
  let foam = 0;
  if (shoreBand > 0.001) {
    const bu = uv[0] * 9 + dir[0] * TIME * 0.32;
    const bv = uv[1] * 5 + dir[1] * TIME * 0.32;
    let bands = valueNoise(bu, bv);
    bands += valueNoise(bu * 2.7 - dir[0] * TIME * 0.5, bv * 2.7 - dir[1] * TIME * 0.5) * 0.5;
    foam = shoreBand * shoreBand * smoothstep(0.72, 1.05, bands) * 0.5;
  }
  const wetEdge = 1 - smoothstep(0, 0.3, Math.abs(field.edge));

  const colour = mix3(waterBody, sky, fresnel);
  for (let k = 0; k < 3; k++) {
    colour[k] += SUN_COLOUR[k] * glint * SUN_INTENSITY;
    colour[k] += shallow[k] * 0.22 * (1 - absorb) * SUN_INTENSITY;
    colour[k] = mix(colour[k], SUN_COLOUR[k] * 0.8, foam * 0.55);
    colour[k] *= 1 - wetEdge * 0.28;
  }

  const alpha = clamp(
    mix(0.7, body.opacity, smoothstep(0, 1.2, -field.edge)) + fresnel * 0.55 + foam * 0.2,
    0,
    1,
  ) * (1 - smoothstep(0, 0.25, field.edge));
  return { colour, alpha };
}

/* ---------------------------------------------------------------- */
/* Shading du sol                                                    */
/* ---------------------------------------------------------------- */

function shadeGround(point, wet) {
  const tex = sampleTex(groundTex, point[0] * 0.07, point[2] * 0.07);
  // Lumière : soleil rasant + ciel diffus.
  const upness = 0.62;
  const lambert = 0.42 + SUN_INTENSITY * upness * 0.9;
  const colour = tex.map((c) => c * lambert * 0.62);
  if (wet) {
    // Vase mouillée : plus sombre, plus froide, sans être noire.
    return [colour[0] * 0.42 + 0.012, colour[1] * 0.44 + 0.02, colour[2] * 0.4 + 0.016];
  }
  return colour;
}

/* ---------------------------------------------------------------- */
/* Rendu d'une vue                                                   */
/* ---------------------------------------------------------------- */

const VIEWS = [
  // Depuis la berge, à hauteur d'œil : c'est le cadrage où l'on juge si une
  // surface d'eau ressemble à de l'eau.
  { name: "riviere", eye: [-64, 1.9, 96], target: [-82, -0.35, 106] },
  { name: "ruisseau", eye: [-30, 1.55, 116], target: [-42, -0.3, 128] },
  { name: "bai", eye: [28, 1.65, 138], target: [46, -0.22, 156] },
];

async function renderView(view, outFile) {
  const map = makeHeightmap(view.target[0], view.target[2], 110, 0.55);
  const forward = normalize3([
    view.target[0] - view.eye[0],
    view.target[1] - view.eye[1],
    view.target[2] - view.eye[2],
  ]);
  // Base caméra : droite = forward × up, haut = droite × forward.
  const upWorld = [0, 1, 0];
  const rightV = normalize3([
    forward[1] * upWorld[2] - forward[2] * upWorld[1],
    forward[2] * upWorld[0] - forward[0] * upWorld[2],
    forward[0] * upWorld[1] - forward[1] * upWorld[0],
  ]);
  const upV = [
    rightV[1] * forward[2] - rightV[2] * forward[1],
    rightV[2] * forward[0] - rightV[0] * forward[2],
    rightV[0] * forward[1] - rightV[1] * forward[0],
  ];
  const fov = (62 * Math.PI) / 180;
  const tanHalf = Math.tan(fov / 2);
  const aspect = WIDTH / HEIGHT;
  const pixels = Buffer.alloc(WIDTH * HEIGHT * 3);

  const superWidth = WIDTH * SS;
  const superHeight = HEIGHT * SS;

  for (let py = 0; py < HEIGHT; py++) {
    for (let px = 0; px < WIDTH; px++) {
      let accum = [0, 0, 0];
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = (px * SS + sx + 0.5) / superWidth;
          const y = (py * SS + sy + 0.5) / superHeight;
          const ndcX = x * 2 - 1;
          const ndcY = 1 - y * 2;
          const dir = normalize3([
            forward[0] + rightV[0] * ndcX * tanHalf * aspect + upV[0] * ndcY * tanHalf,
            forward[1] + rightV[1] * ndcX * tanHalf * aspect + upV[1] * ndcY * tanHalf,
            forward[2] + rightV[2] * ndcX * tanHalf * aspect + upV[2] * ndcY * tanHalf,
          ]);

          const sample = trace(view.eye, dir, map);
          accum[0] += sample[0];
          accum[1] += sample[1];
          accum[2] += sample[2];
        }
      }
      const total = SS * SS;
      const index = (py * WIDTH + px) * 3;
      pixels[index] = Math.round(clamp(accum[0] / total, 0, 1) ** (1 / 2.2) * 255);
      pixels[index + 1] = Math.round(clamp(accum[1] / total, 0, 1) ** (1 / 2.2) * 255);
      pixels[index + 2] = Math.round(clamp(accum[2] / total, 0, 1) ** (1 / 2.2) * 255);
    }
  }

  await sharp(pixels, { raw: { width: WIDTH, height: HEIGHT, channels: 3 } })
    .png()
    .toFile(outFile);
  console.log(`  ${path.basename(outFile)}`);
}

const MAX_DIST = 120;

function trace(eye, dir, map) {
  // --- intersection avec chaque plan d'eau
  let waterT = Infinity;
  let waterField = null;
  for (const body of game.WATER_BODIES) {
    if (Math.abs(dir[1]) < 1e-4) continue;
    const t = (body.level - eye[1]) / dir[1];
    if (t <= 0.2 || t > MAX_DIST) continue;
    const px = eye[0] + dir[0] * t;
    const pz = eye[2] + dir[2] * t;
    const field = game.waterField(px, pz);
    if (!field || field.body.id !== body.id || field.edge > 0) continue;
    if (t < waterT) {
      waterT = t;
      waterField = field;
    }
  }

  // --- intersection avec le sol (marche dans la carte de hauteur)
  let groundT = Infinity;
  let prevY = eye[1];
  for (let t = 0.6; t < Math.min(MAX_DIST, waterT + 4); t += 0.35) {
    const px = eye[0] + dir[0] * t;
    const py = eye[1] + dir[1] * t;
    const pz = eye[2] + dir[2] * t;
    const h = heightAt(map, px, pz);
    if (h === null) break;
    if (py <= h) {
      const ratio = (prevY - h) / Math.max(1e-5, prevY - py);
      groundT = t - 0.35 * (1 - ratio);
      break;
    }
    prevY = py;
  }

  const fog = (distance) => clamp(1 - Math.exp(-Math.pow(distance * FOG_DENSITY, 2)), 0, 1);

  if (waterT < groundT && waterField) {
    const point = [eye[0] + dir[0] * waterT, eye[1] + dir[1] * waterT, eye[2] + dir[2] * waterT];
    const { colour, alpha } = shadeWater(waterField, point, eye);
    // Le lit, vu à travers la lame d'eau.
    const bedHeight = heightAt(map, point[0], point[2]);
    const bed =
      bedHeight === null
        ? [0.03, 0.035, 0.025]
        : shadeGround([point[0], bedHeight, point[2]], true);
    let out = mix3(bed, colour, alpha);
    out = mix3(out, FOG_COLOUR, fog(waterT));
    return out;
  }

  if (groundT < Infinity) {
    const point = [eye[0] + dir[0] * groundT, eye[1] + dir[1] * groundT, eye[2] + dir[2] * groundT];
    let out = shadeGround(point, false);
    out = mix3(out, FOG_COLOUR, fog(groundT));
    return out;
  }

  // Ciel : sous couvert, vert profond au ras de l'horizon.
  const sky = clamp(dir[1], 0, 1);
  const base = [0.11 + sky * 0.34, 0.16 + sky * 0.4, 0.12 + sky * 0.3];
  return mix3(FOG_COLOUR, base, smoothstep(0, 0.35, sky));
}

/* ---------------------------------------------------------------- */

console.log("\nAperçu des cours d'eau");
for (const view of VIEWS) {
  const file = path.join(OUT_DIR, `eau-${view.name}.png`);
  await renderView(view, file);
}
console.log("");
