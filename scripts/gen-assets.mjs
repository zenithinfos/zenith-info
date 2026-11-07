#!/usr/bin/env node
/**
 * Génération des assets de démonstration.
 *
 *   node scripts/gen-assets.mjs
 *
 * Produit dans public/ : icônes PWA, visuels de menu, textures, modèles GLB
 * low-poly et pistes audio d'ambiance. Tout est procédural afin de garder le
 * dépôt léger et reproductible : remplacez ces fichiers par vos propres
 * créations (mêmes noms) sans toucher au code.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { generateTextures } from "./lib/textures.mjs";
import { generatePhotoTextures } from "./lib/photos.mjs";

const ROOT = process.cwd();
const PUBLIC = path.join(ROOT, "public");

const args = new Set(process.argv.slice(2));
const force = args.has("--force");

async function ensureDir(relative) {
  const dir = path.join(PUBLIC, relative);
  await mkdir(dir, { recursive: true });
  return dir;
}

/* ------------------------------------------------------------------ */
/* Icônes PWA                                                          */
/* ------------------------------------------------------------------ */

function iconSvg(size, { maskable = false } = {}) {
  const padding = maskable ? size * 0.14 : size * 0.06;
  const inner = size - padding * 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs>
    <radialGradient id="bg" cx="35%" cy="25%" r="85%">
      <stop offset="0%" stop-color="#2c5a37"/>
      <stop offset="60%" stop-color="#0f2018"/>
      <stop offset="100%" stop-color="#060d09"/>
    </radialGradient>
    <linearGradient id="leaf" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#f2b544"/>
      <stop offset="55%" stop-color="#8fc47a"/>
      <stop offset="100%" stop-color="#4b7f4a"/>
    </linearGradient>
  </defs>
  <rect width="${size}" height="${size}" rx="${maskable ? 0 : size * 0.22}" fill="url(#bg)"/>
  <circle cx="${size / 2}" cy="${size / 2}" r="${inner / 2}" fill="none" stroke="#f2b544" stroke-opacity="0.35" stroke-width="${Math.max(1, size * 0.012)}"/>
  <g transform="translate(${size / 2} ${size / 2}) scale(${inner / 100})">
    <path d="M0,-34 C22,-24 30,-4 18,20 C10,34 2,38 0,40 C-2,38 -10,34 -18,20 C-30,-4 -22,-24 0,-34 Z" fill="url(#leaf)" opacity="0.95"/>
    <path d="M0,-30 L0,34" stroke="#060d09" stroke-width="2.6" stroke-opacity="0.55" stroke-linecap="round"/>
    <path d="M0,-12 L13,-2 M0,2 L14,12 M0,-20 L-11,-12 M0,8 L-12,18" stroke="#060d09" stroke-width="2" stroke-opacity="0.4" stroke-linecap="round"/>
  </g>
</svg>`;
}

async function generateIcons() {
  const dir = await ensureDir("icons");
  const sizes = [32, 64, 96, 180, 192, 512];
  for (const size of sizes) {
    const target = path.join(dir, `icon-${size}.png`);
    if (!force && existsSync(target)) {
      console.log(`· icon-${size}.png existe déjà`);
      continue;
    }
    await sharp(Buffer.from(iconSvg(size)))
      .png({ compressionLevel: 9, quality: 90 })
      .toFile(target);
    console.log(`✓ icons/icon-${size}.png`);
  }

  const maskable = path.join(dir, "maskable-512.png");
  if (force || !existsSync(maskable)) {
    await sharp(Buffer.from(iconSvg(512, { maskable: true })))
      .png({ compressionLevel: 9 })
      .toFile(maskable);
    console.log("✓ icons/maskable-512.png");
  }

  const favicon = path.join(PUBLIC, "favicon.png");
  if (force || !existsSync(favicon)) {
    await sharp(Buffer.from(iconSvg(32))).png().toFile(favicon);
    console.log("✓ favicon.png");
  }
}

/* ------------------------------------------------------------------ */
/* Visuels de menu                                                     */
/* ------------------------------------------------------------------ */

/**
 * Les images de décor ne sont **plus** dessinées en SVG.
 *
 * `forestSvg` produisait une forêt de traits et d'ellipses : des troncs en
 * bézier et des houppes en médaillons, c'est-à-dire exactement des lampadaires
 * verticaux. C'était un décor de remplacement, et il se voyait.
 *
 * L'image du héros est désormais un rendu du moteur — le même sous-bois que
 * celui du jeu, avec ses vraies textures et ses vrais arbres — et les anciennes
 * images sont supprimées. Ce générateur n'a donc plus rien à produire, et il
 * est retiré pour qu'un `npm run assets` ne puisse pas remettre les lampadaires
 * par-dessus un rendu correct.
 */

/* ------------------------------------------------------------------ */
/* Textures                                                            */
/* ------------------------------------------------------------------ */

// Les textures de la forêt sont dessinées dans scripts/lib/textures.mjs
// (feuillages à découpe alpha, écorce, litière, canopée, brume, roche).
/**
 * Deux sources, volontairement séparées :
 *   · `photos.mjs` — les matières de la forêt, dérivées de photographies
 *     (sol, écorce, feuillages, herbe, canopée). C'est ce qui donne le
 *     photoréalisme ; du code seul ne peut pas le produire.
 *   · `textures.mjs` — les effets qui ne sont pas des matières (brume, roche,
 *     normales d'eau).
 */
async function generateForestTextures() {
  await generatePhotoTextures({ publicDir: PUBLIC, force });
  await generateTextures({ publicDir: PUBLIC, force });
}

/* ------------------------------------------------------------------ */
/* Modèles GLB low-poly                                                */
/* ------------------------------------------------------------------ */

function boxGeometry(cx, cy, cz, sx, sy, sz, colour) {
  const half = [sx / 2, sy / 2, sz / 2];
  const positions = [];
  const normals = [];
  const indices = [];
  const colours = [];

  const faces = [
    { n: [1, 0, 0], v: [[1, -1, -1], [1, 1, -1], [1, 1, 1], [1, -1, 1]] },
    { n: [-1, 0, 0], v: [[-1, -1, 1], [-1, 1, 1], [-1, 1, -1], [-1, -1, -1]] },
    { n: [0, 1, 0], v: [[-1, 1, -1], [-1, 1, 1], [1, 1, 1], [1, 1, -1]] },
    { n: [0, -1, 0], v: [[-1, -1, 1], [-1, -1, -1], [1, -1, -1], [1, -1, 1]] },
    { n: [0, 0, 1], v: [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]] },
    { n: [0, 0, -1], v: [[1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1]] },
  ];

  for (const face of faces) {
    const start = positions.length / 3;
    for (const vertex of face.v) {
      positions.push(cx + vertex[0] * half[0], cy + vertex[1] * half[1], cz + vertex[2] * half[2]);
      normals.push(...face.n);
      colours.push(colour[0], colour[1], colour[2], 1);
    }
    indices.push(start, start + 1, start + 2, start, start + 2, start + 3);
  }

  return { positions, normals, indices, colours };
}

function buildGlb(parts) {
  const positions = [];
  const normals = [];
  const indices = [];
  const colours = [];

  for (const part of parts) {
    const geo = boxGeometry(...part);
    const offset = positions.length / 3;
    positions.push(...geo.positions);
    normals.push(...geo.normals);
    colours.push(...geo.colours);
    for (const index of geo.indices) indices.push(index + offset);
  }

  const positionBuffer = Buffer.from(new Float32Array(positions).buffer);
  const normalBuffer = Buffer.from(new Float32Array(normals).buffer);
  const colourBuffer = Buffer.from(new Float32Array(colours).buffer);
  const indexBuffer = Buffer.from(new Uint16Array(indices).buffer);
  const pad4 = (buffer) => {
    const remainder = buffer.length % 4;
    return remainder === 0 ? buffer : Buffer.concat([buffer, Buffer.alloc(4 - remainder)]);
  };

  const posPadded = pad4(positionBuffer);
  const normPadded = pad4(normalBuffer);
  const colPadded = pad4(colourBuffer);
  const idxPadded = pad4(indexBuffer);

  const bin = Buffer.concat([posPadded, normPadded, colPadded, idxPadded]);

  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    for (let axis = 0; axis < 3; axis++) {
      min[axis] = Math.min(min[axis], positions[i + axis]);
      max[axis] = Math.max(max[axis], positions[i + axis]);
    }
  }

  const gltf = {
    asset: { version: "2.0", generator: "zenith-info gen-assets" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name: "MinkebeCharacter" }],
    meshes: [
      {
        name: "Body",
        primitives: [
          {
            attributes: { POSITION: 0, NORMAL: 1, COLOR_0: 2 },
            indices: 3,
            material: 0,
          },
        ],
      },
    ],
    materials: [
      {
        name: "VertexColour",
        pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0.05, roughnessFactor: 0.82 },
        doubleSided: false,
      },
    ],
    buffers: [{ byteLength: bin.length }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: posPadded.length, target: 34962 },
      { buffer: 0, byteOffset: posPadded.length, byteLength: normPadded.length, target: 34962 },
      { buffer: 0, byteOffset: posPadded.length + normPadded.length, byteLength: colPadded.length, target: 34962 },
      {
        buffer: 0,
        byteOffset: posPadded.length + normPadded.length + colPadded.length,
        byteLength: idxPadded.length,
        target: 34963,
      },
    ],
    accessors: [
      {
        bufferView: 0,
        componentType: 5126,
        count: positions.length / 3,
        type: "VEC3",
        min,
        max,
      },
      { bufferView: 1, componentType: 5126, count: normals.length / 3, type: "VEC3" },
      { bufferView: 2, componentType: 5126, count: colours.length / 4, type: "VEC4" },
      { bufferView: 3, componentType: 5123, count: indices.length, type: "SCALAR" },
    ],
  };

  return { gltf, bin };
}

function glbFromParts(parts) {
  const { gltf, bin } = buildGlb(parts);
  let json = Buffer.from(JSON.stringify(gltf), "utf8");
  const jsonPad = (4 - (json.length % 4)) % 4;
  if (jsonPad) json = Buffer.concat([json, Buffer.alloc(jsonPad, 0x20)]);
  const binPad = (4 - (bin.length % 4)) % 4;
  const binChunk = binPad ? Buffer.concat([bin, Buffer.alloc(binPad)]) : bin;

  const total = 12 + 8 + json.length + 8 + binChunk.length;
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0); // "glTF"
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(total, 8);

  const jsonHeader = Buffer.alloc(8);
  jsonHeader.writeUInt32LE(json.length, 0);
  jsonHeader.writeUInt32LE(0x4e4f534a, 4); // "JSON"

  const binHeader = Buffer.alloc(8);
  binHeader.writeUInt32LE(binChunk.length, 0);
  binHeader.writeUInt32LE(0x004e4942, 4); // "BIN"

  return Buffer.concat([header, jsonHeader, json, binHeader, binChunk]);
}

async function generateModels() {
  const dir = await ensureDir("models");

  const michelle = [
    [0, 1.05, 0, 0.46, 0.9, 0.28, [0.42, 0.55, 0.32]],
    [0, 1.72, 0, 0.3, 0.34, 0.3, [0.55, 0.38, 0.26]],
    [0, 2.02, 0, 0.28, 0.28, 0.28, [0.16, 0.12, 0.09]],
    [-0.32, 1.0, 0, 0.14, 0.78, 0.16, [0.62, 0.45, 0.3]],
    [0.32, 1.0, 0, 0.14, 0.78, 0.16, [0.62, 0.45, 0.3]],
    [-0.14, 0.28, 0, 0.17, 0.62, 0.19, [0.24, 0.3, 0.2]],
    [0.14, 0.28, 0, 0.17, 0.62, 0.19, [0.24, 0.3, 0.2]],
    [0, 1.35, 0.19, 0.34, 0.4, 0.1, [0.3, 0.36, 0.22]],
  ];

  const soldier = [
    [0, 1.08, 0, 0.54, 0.94, 0.32, [0.26, 0.3, 0.2]],
    [0, 1.76, 0, 0.32, 0.36, 0.32, [0.5, 0.36, 0.26]],
    [0, 2.08, 0, 0.34, 0.24, 0.34, [0.18, 0.2, 0.13]],
    [-0.36, 1.02, 0, 0.16, 0.82, 0.18, [0.24, 0.28, 0.19]],
    [0.36, 1.02, 0, 0.16, 0.82, 0.18, [0.24, 0.28, 0.19]],
    [-0.15, 0.28, 0, 0.19, 0.64, 0.21, [0.16, 0.19, 0.13]],
    [0.15, 0.28, 0, 0.19, 0.64, 0.21, [0.16, 0.19, 0.13]],
    [0, 1.3, 0.22, 0.4, 0.52, 0.16, [0.15, 0.17, 0.12]],
  ];

  for (const [name, parts] of [
    ["Michelle.glb", michelle],
    ["Soldier.glb", soldier],
  ]) {
    const target = path.join(dir, name);
    if (!force && existsSync(target)) {
      console.log(`· models/${name} existe déjà`);
      continue;
    }
    await writeFile(target, glbFromParts(parts));
    console.log(`✓ models/${name}`);
  }
}

/* ------------------------------------------------------------------ */
/* Audio                                                               */
/* ------------------------------------------------------------------ */

function encodeWav(samples, sampleRate = 22050) {
  const channels = 1;
  const buffer = Buffer.alloc(44 + samples.length * 2);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + samples.length * 2, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * channels * 2, 28);
  buffer.writeUInt16LE(channels * 2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i++) {
    const value = Math.max(-1, Math.min(1, samples[i]));
    buffer.writeInt16LE(Math.round(value * 32767), 44 + i * 2);
  }
  return buffer;
}

function noise(seed) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

function ambience({ seconds = 30, sampleRate = 22050, seed = 7, birds = true }) {
  const rand = noise(seed);
  const length = seconds * sampleRate;
  const samples = new Float32Array(length);
  let brown = 0;

  for (let i = 0; i < length; i++) {
    const t = i / sampleRate;
    const white = rand() * 2 - 1;
    brown = (brown + 0.02 * white) / 1.02;
    // Souffle de feuillage + légère modulation.
    const wind = brown * 0.5 * (0.6 + 0.4 * Math.sin(t * 0.14));
    // Grésillement d'insectes.
    const insect = Math.sin(2 * Math.PI * 4200 * t) * 0.012 * (0.5 + 0.5 * Math.sin(t * 3.1));
    samples[i] = wind + insect;
  }

  if (birds) {
    // Quelques chants d'oiseaux synthétiques (glissandi courts).
    for (let b = 0; b < seconds / 4; b++) {
      const start = Math.floor(rand() * (length - sampleRate * 2));
      const duration = Math.floor(sampleRate * (0.18 + rand() * 0.25));
      const base = 900 + rand() * 1400;
      for (let i = 0; i < duration; i++) {
        const t = i / sampleRate;
        const envelope = Math.sin((Math.PI * i) / duration);
        const freq = base * (1 + 0.35 * Math.sin(t * 26));
        samples[start + i] += Math.sin(2 * Math.PI * freq * t) * 0.14 * envelope;
      }
    }
  }

  // Fondu d'entrée/sortie pour boucler proprement.
  const fade = Math.floor(sampleRate * 1.2);
  for (let i = 0; i < fade; i++) {
    const gain = i / fade;
    samples[i] *= gain;
    samples[length - 1 - i] *= gain;
  }

  return samples;
}

function drumTheme({ seconds = 40, sampleRate = 22050, seed = 21 }) {
  const rand = noise(seed);
  const length = seconds * sampleRate;
  const samples = new Float32Array(length);

  const hit = (startSec, freq, decay, gain, noiseAmount = 0) => {
    const start = Math.floor(startSec * sampleRate);
    const duration = Math.floor(decay * 6 * sampleRate);
    for (let i = 0; i < duration && start + i < length; i++) {
      const t = i / sampleRate;
      const envelope = Math.exp(-t / decay);
      const tone = Math.sin(2 * Math.PI * freq * t * (1 - 0.4 * Math.min(1, t / decay)));
      const noisePart = noiseAmount ? (rand() * 2 - 1) * noiseAmount * Math.exp(-t / (decay * 0.2)) : 0;
      samples[start + i] += (tone + noisePart) * envelope * gain;
    }
  };

  // Trame de tambours (6/8) + cloche.
  let t = 0;
  const beat = 0.52;
  let step = 0;
  while (t < seconds - 1) {
    const pattern = step % 6;
    if (pattern === 0) hit(t, 92, 0.16, 0.55, 0.12);
    if (pattern === 2) hit(t, 148, 0.1, 0.32);
    if (pattern === 3) hit(t, 210, 0.07, 0.22);
    if (pattern === 4) hit(t, 120, 0.12, 0.36, 0.06);
    if (pattern === 5) hit(t, 640, 0.3, 0.12);
    // Chant lointain toutes les deux mesures.
    if (pattern === 0 && step % 12 === 0) {
      const start = Math.floor(t * sampleRate);
      const duration = Math.floor(sampleRate * 1.4);
      for (let i = 0; i < duration && start + i < length; i++) {
        const tt = i / sampleRate;
        const envelope = Math.sin((Math.PI * i) / duration) ** 2;
        const freq = 210 + 30 * Math.sin(tt * 5.5) + 12 * Math.sin(tt * 19);
        samples[start + i] +=
          (Math.sin(2 * Math.PI * freq * tt) * 0.5 + Math.sin(2 * Math.PI * freq * 2 * tt) * 0.16) *
          0.07 *
          envelope;
      }
    }
    t += beat;
    step += 1;
  }

  const fade = Math.floor(sampleRate * 1.5);
  for (let i = 0; i < fade; i++) {
    const gain = i / fade;
    samples[i] *= gain;
    samples[length - 1 - i] *= gain;
  }

  return samples;
}

async function generateAudio() {
  const dir = await ensureDir("audio");

  const tracks = [
    {
      name: "le-mougongo.wav",
      samples: drumTheme({ seconds: 42, seed: 21 }),
      label: "le-mougongo.wav (thème des tambours)",
    },
    {
      name: "reveil-dans-la-foret.wav",
      samples: ambience({ seconds: 30, seed: 7, birds: true }),
      label: "reveil-dans-la-foret.wav (aube)",
    },
    {
      name: "ambiance-canopee.wav",
      samples: ambience({ seconds: 30, seed: 19, birds: false }),
      label: "ambiance-canopee.wav (jour)",
    },
  ];

  for (const track of tracks) {
    const target = path.join(dir, track.name);
    if (!force && existsSync(target)) {
      console.log(`· audio/${track.name} existe déjà`);
      continue;
    }
    await writeFile(target, encodeWav(track.samples));
    const size = (encodeWav(track.samples).length / 1024 / 1024).toFixed(1);
    console.log(`✓ audio/${track.name} (${size} Mo)`);
  }
}

/* ------------------------------------------------------------------ */
/* Exécution                                                           */
/* ------------------------------------------------------------------ */

async function main() {
  console.log("Génération des assets Minkébé…\n");
  await generateIcons();
  await generateForestTextures();
  await generateModels();
  await generateAudio();
  console.log("\nTerminé. Remplacez librement ces fichiers par vos propres assets.");
}

main().catch((error) => {
  console.error("Échec de la génération :", error);
  process.exit(1);
});
