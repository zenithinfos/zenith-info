#!/usr/bin/env node
/**
 * Aperçu hors navigateur de la scène 3D.
 *
 *   node scripts/preview-scene.mjs [--out /tmp] [--size 640x360] [--views 3]
 *
 * Il n'y a pas de navigateur headless dans l'environnement de développement :
 * ce script rejoue donc la scène en raycasting logiciel, avec les **mêmes**
 * modules de génération (src/game/forest.ts, src/game/terrain.ts) et les
 * **mêmes** textures que le rendu WebGL. Le résultat n'est pas pixel-perfect
 * (pas de PBR, pas d'ombres douces) mais il permet de juger la densité, les
 * silhouettes, l'échelle des feuillages et la profondeur — c'est-à-dire
 * exactement ce qui fait qu'une forêt « sonne » vraie ou non.
 */

import { build } from "esbuild";
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

const OUT_DIR = getArg("out", "/tmp");
await mkdir(OUT_DIR, { recursive: true });
const [WIDTH, HEIGHT] = getArg("size", "640x360").split("x").map(Number);
/** Rayon (en unités) de végétation générée autour du centre de l'image. */
const VIEW_RADIUS = Number(getArg("radius", "70"));
const MAX_DIST = Number(getArg("dist", "70"));

/* ------------------------------------------------------------------ */
/* Modules du jeu                                                      */
/* ------------------------------------------------------------------ */

async function loadGame() {
  const dir = await mkdtemp(path.join(tmpdir(), "minkebe-preview-"));
  const out = path.join(dir, "bundle.mjs");
  await build({
    stdin: {
      contents: `export { buildTile, crownCards, mulberry32, plantCards, TILE_SIZE, tileSeed, tilesAround } from "./src/game/forest.ts";
                export { terrainHeight } from "./src/game/terrain.ts";`,
      resolveDir: process.cwd(),
      loader: "ts",
    },
    bundle: true,
    format: "esm",
    platform: "node",
    outfile: out,
    logLevel: "silent",
  });
  const mod = await import(out);
  await rm(dir, { recursive: true, force: true });
  return mod;
}

/* ------------------------------------------------------------------ */
/* Textures                                                            */
/* ------------------------------------------------------------------ */

async function loadTexture(file, size = 160) {
  const { data, info } = await sharp(file)
    .resize(size, size, { fit: "fill" })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  // Carte de normales tangente déduite de la luminance : c'est ce que le jeu
  // calcule à partir de ses fichiers `*_normal.jpg`. Sans elle, l'aperçu ne
  // montrerait aucune des nervures ni du relief des feuilles.
  const normals = new Float32Array(width * height * 3);
  const lum = (x, y) => {
    const px = ((x % width) + width) % width;
    const py = ((y % height) + height) % height;
    const i = (py * width + px) * channels;
    if (data[i + 3] < 60) return 0;
    return (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) / 255;
  };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const dx = (lum(x + 1, y) - lum(x - 1, y)) * 2.6;
      const dy = (lum(x, y + 1) - lum(x, y - 1)) * 2.6;
      const len = Math.hypot(dx, dy, 1);
      const i = (y * width + x) * 3;
      normals[i] = -dx / len;
      normals[i + 1] = -dy / len;
      normals[i + 2] = 1 / len;
    }
  }
  // Couleur moyenne des pixels opaques : sert de mip extrême quand une carte
  // ne couvre que quelques pixels à l'écran. Sans cela, l'image fourmille.
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (let i = 0; i < width * height; i++) {
    if (data[i * channels + 3] < 128) continue;
    r += data[i * channels];
    g += data[i * channels + 1];
    b += data[i * channels + 2];
    n++;
  }
  const average = n > 0 ? [r / n / 255, g / n / 255, b / n / 255] : [0.2, 0.3, 0.2];

  return { data, width, height, channels, normals, average };
}

/**
 * Échantillonnage bilinéaire avec mip approximé : plus la carte est loin,
 * plus on mélange vers sa couleur moyenne. C'est ce que fait le GPU avec ses
 * mipmaps ; sans ça, l'aperçu fourmille et ne représente pas le jeu.
 */
function sampleTexture(tex, u, v, lod = 0) {
  const { width, height, channels } = tex;
  const fx = u * width - 0.5;
  const fy = (1 - v) * height - 0.5;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const tx = fx - x0;
  const ty = fy - y0;
  const wrap = (v2, max) => ((v2 % max) + max) % max;

  const rgba = [0, 0, 0, 0];
  const normal = [0, 0, 0];
  for (let dy = 0; dy <= 1; dy++) {
    for (let dx = 0; dx <= 1; dx++) {
      const px = wrap(x0 + dx, width);
      const py = wrap(y0 + dy, height);
      const w = (dx ? tx : 1 - tx) * (dy ? ty : 1 - ty);
      const i = (py * width + px) * channels;
      const n = (py * width + px) * 3;
      rgba[0] += (tex.data[i] / 255) * w;
      rgba[1] += (tex.data[i + 1] / 255) * w;
      rgba[2] += (tex.data[i + 2] / 255) * w;
      rgba[3] += (tex.data[i + 3] / 255) * w;
      normal[0] += tex.normals[n] * w;
      normal[1] += tex.normals[n + 1] * w;
      normal[2] += tex.normals[n + 2] * w;
    }
  }

  if (lod > 0) {
    const mix = Math.min(1, lod);
    rgba[0] += (tex.average[0] - rgba[0]) * mix;
    rgba[1] += (tex.average[1] - rgba[1]) * mix;
    rgba[2] += (tex.average[2] - rgba[2]) * mix;
    normal[0] += (0 - normal[0]) * mix * 0.6;
    normal[1] += (0 - normal[1]) * mix * 0.6;
    normal[2] += (1 - normal[2]) * mix * 0.6;
  }
  return { rgba, normal };
}

/* ------------------------------------------------------------------ */
/* Géométrie                                                           */
/* ------------------------------------------------------------------ */

function eulerMatrix(rx, ry, rz) {
  const cx = Math.cos(rx), sx = Math.sin(rx);
  const cy = Math.cos(ry), sy = Math.sin(ry);
  const cz = Math.cos(rz), sz = Math.sin(rz);

  // Ordre YXZ : le lacet s'applique en dernier, donc une carte couchée
  // (-90° autour de X) reste bien horizontale quelle que soit son orientation.
  return [
    [cy * cz + sy * sx * sz, -cy * sz + sy * sx * cz, sy * cx],
    [cx * sz, cx * cz, -sx],
    [-sy * cz + cy * sx * sz, sy * sz + cy * sx * cz, cy * cx],
  ];
}

const VIEWS = [
  { name: "spawn", x: 0, z: 6, yaw: 0.15, label: "Camp de base (vue par défaut)" },
  { name: "foret", x: 130, z: 90, yaw: 2.1, label: "Forêt profonde" },
  { name: "sentier", x: 60, z: 30, yaw: 0.9, label: "Sentier des pisteurs" },
  { name: "clairiere", x: 45, z: 160, yaw: 1.2, label: "Baï de la clairière" },
];

function buildScene(game, random, textures) {
  const quads = [];
  const trunks = [];
  const trees = [];

  // Les mêmes tuiles que le jeu : 48 unités, densité locale, graine stable.
  // On ne génère que celles qui entourent les points de vue rendus.
  const tileSet = new Map();
  for (const view of VIEWS) {
    const tilesRadius = Math.ceil((VIEW_RADIUS + 30) / game.TILE_SIZE);
    for (const [tx, tz] of game.tilesAround(view.x, view.z, tilesRadius)) {
      tileSet.set(`${tx}:${tz}`, [tx, tz]);
    }
  }
  const tiles = [...tileSet.values()];
  console.log(`${tiles.length} tuiles de forêt générées`);
  for (const [tileX, tileZ] of tiles) {
    const tile = game.buildTile(tileX, tileZ, {
      treeDensity: 0.058,
      understoryDensity: 0.46,
      clearing: { x: 0, z: 6, radius: 7 },
    });
    const tileRandom = game.mulberry32(game.tileSeed(tileX, tileZ));

    for (const tree of tile.trees) {
      trees.push(tree);
      // Charpente complète : chaque segment (fût, contrefort, branche, rameau)
      // devient un cylindre du raycaster. C'est la même donnée que le jeu.
      for (const segment of tree.segments ?? []) {
        const from = segment.from;
        const to = segment.to;
        const vertical =
          Math.abs(to[0] - from[0]) < 0.02 && Math.abs(to[2] - from[2]) < 0.02;
        const radius = (segment.radiusFrom + segment.radiusTo) * 0.5;
        if (vertical) {
          trunks.push({
            x: tree.x + from[0],
            z: tree.z + from[2],
            y0: tree.y + from[1],
            y1: tree.y + to[1],
            r: radius,
            shade:
              segment.kind === 0
                ? tree.kind === "emergent"
                  ? 0.55
                  : tree.kind === "mid"
                    ? 0.68
                    : 0.8
                : 0.62,
          });
        } else {
          trunks.push({
            x: tree.x + from[0],
            z: tree.z + from[2],
            y0: tree.y + from[1],
            y1: tree.y + to[1],
            r: radius,
            shade: segment.kind === 1 ? 0.5 : 0.68,
            horizontal: true,
            x2: tree.x + to[0],
            z2: tree.z + to[2],
          });
        }
      }

      for (const card of game.crownCards(tree, tileRandom)) {
        const rx = card.horizontal
          ? -Math.PI / 2 + (tileRandom() - 0.5) * card.tilt
          : (tileRandom() - 0.5) * card.tilt;
        const rz = card.horizontal ? 0 : (tileRandom() - 0.5) * card.tilt;
        const m = eulerMatrix(rx, card.angle, rz);

        const uAxis = [m[0][0], m[1][0], m[2][0]];
        const vAxis = [m[0][1], m[1][1], m[2][1]];
        const normal = [m[0][2], m[1][2], m[2][2]];

        const family = tileRandom();
        const tex = card.sparse
          ? textures.spray
          : family < 0.48
            ? textures.foliage
            : family < 0.82
              ? textures.foliageDeep
              : textures.foliagePale;

        quads.push({
          cx: tree.x + card.offset[0],
          cy: tree.y + card.offset[1],
          cz: tree.z + card.offset[2],
          uAxis,
          vAxis,
          normal,
          hw: card.width / 2,
          hh: card.height / 2,
          tex,
          // Occlusion verticale : les cartes basses sont dans l'ombre du couvert.
          tint:
            (0.86 + tileRandom() * 0.28) *
            (0.62 + (0.38 * Math.min(1, (card.offset[1] + tree.trunkHeight * 0.4) / 14))),
        });
      }
    }

    // --- Sous-bois : fougères, balisiers, buissons, couvre-sol ----------
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
        let uAxis;
        let vAxis;
        let normal;
        if (card.flat && card.slope) {
          // Dalle couchée sur le versant, comme dans le jeu.
          const [gx, gz] = card.slope;
          const nl = Math.hypot(gx, 1, gz);
          normal = [-gx / nl, 1 / nl, -gz / nl];
          uAxis = [Math.cos(card.angle), 0, -Math.sin(card.angle)];
          const d = uAxis[0] * normal[0] + uAxis[1] * normal[1] + uAxis[2] * normal[2];
          uAxis = [uAxis[0] - normal[0] * d, uAxis[1] - normal[1] * d, uAxis[2] - normal[2] * d];
          const ul = Math.hypot(...uAxis);
          uAxis = uAxis.map((c) => c / ul);
          vAxis = [
            normal[1] * uAxis[2] - normal[2] * uAxis[1],
            normal[2] * uAxis[0] - normal[0] * uAxis[2],
            normal[0] * uAxis[1] - normal[1] * uAxis[0],
          ];
        } else {
          const m = eulerMatrix(0, card.angle, 0);
          uAxis = [m[0][0], m[1][0], m[2][0]];
          vAxis = [m[0][1], m[1][1], m[2][1]];
          normal = [m[0][2], m[1][2], m[2][2]];
        }
        quads.push({
          cx: card.x,
          cy: card.y,
          cz: card.z,
          uAxis,
          vAxis,
          normal,
          hw: card.width / 2,
          hh: card.height / 2,
          tex: texture,
          tint: card.flat ? 0.5 + tileRandom() * 0.22 : 0.72 + tileRandom() * 0.3,
        });
      }
    }

    // --- Troncs tombés --------------------------------------------------
    for (const log of tile.logs) {
      const dx = Math.cos(log.rotation) * log.length * 0.35;
      const dz = Math.sin(log.rotation) * log.length * 0.35;
      trunks.push({
        x: log.x - dx,
        z: log.z - dz,
        y0: log.y - log.radius,
        y1: log.y + log.radius,
        r: log.radius * 1.4,
        shade: 0.5,
        horizontal: true,
        x2: log.x + dx,
        z2: log.z + dz,
      });
    }
  }

  // --- Plafond de canopée ---------------------------------------------
  // Une nappe par point de vue : c'est ce que le jeu fait en suivant le joueur.
  for (const view of VIEWS) {
    for (let i = 0; i < 40; i++) {
      const angle = random() * Math.PI * 2;
      const distance = Math.sqrt(random()) * 105;
      const angleToHorizon = -Math.PI / 2 + (random() - 0.5) * 0.14;
      const m = eulerMatrix(angleToHorizon, random() * Math.PI, 0);
      quads.push({
        cx: view.x + Math.cos(angle) * distance,
        cy: 24 + random() * 14,
        cz: view.z + Math.sin(angle) * distance,
        uAxis: [m[0][0], m[1][0], m[2][0]],
        vAxis: [m[0][1], m[1][1], m[2][1]],
        normal: [m[0][2], m[1][2], m[2][2]],
        hw: (44 + random() * 40) / 2,
        hh: (44 + random() * 40) / 2,
        tex: textures.canopy,
        tint: 0.6 + random() * 0.25,
      });
    }
  }

  // Cellule de discrétisation XZ pour accélérer le raycasting.
  const CELL = 5;
  const grid = new Map();
  const key = (ix, iz) => `${ix}:${iz}`;

  quads.forEach((quad, index) => {
    const extent = Math.max(quad.hw, quad.hh);
    const minX = Math.floor((quad.cx - extent) / CELL);
    const maxX = Math.floor((quad.cx + extent) / CELL);
    const minZ = Math.floor((quad.cz - extent) / CELL);
    const maxZ = Math.floor((quad.cz + extent) / CELL);
    for (let ix = minX; ix <= maxX; ix++) {
      for (let iz = minZ; iz <= maxZ; iz++) {
        const k = key(ix, iz);
        const bucket = grid.get(k);
        if (bucket) bucket.push(index);
        else grid.set(k, [index]);
      }
    }
  });

  trunks.forEach((trunk, index) => {
    if (trunk.horizontal) {
      // Segment oblique : on l'échantillonne dans toutes les cellules qu'il
      // traverse, plus une marge égale à son rayon.
      const steps = Math.max(2, Math.ceil(Math.hypot(trunk.x2 - trunk.x, trunk.z2 - trunk.z) / (CELL * 0.5)));
      const margin = Math.ceil((trunk.r + 0.4) / CELL);
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        const x = trunk.x + (trunk.x2 - trunk.x) * t;
        const z = trunk.z + (trunk.z2 - trunk.z) * t;
        const ix = Math.floor(x / CELL);
        const iz = Math.floor(z / CELL);
        for (let dz = -margin; dz <= margin; dz++) {
          for (let dx = -margin; dx <= margin; dx++) {
            const k = key(ix + dx, iz + dz);
            const bucket = grid.get(k);
            if (bucket) {
              if (!bucket.includes(-(index + 1))) bucket.push(-(index + 1));
            } else {
              grid.set(k, [-(index + 1)]);
            }
          }
        }
      }
      return;
    }
    const k = key(Math.floor(trunk.x / CELL), Math.floor(trunk.z / CELL));
    const bucket = grid.get(k);
    if (bucket) bucket.push(-(index + 1));
    else grid.set(k, [-(index + 1)]);
  });

  return { trees, quads, trunks, grid, cell: CELL };
}

/* ------------------------------------------------------------------ */
/* Rendu                                                               */
/* ------------------------------------------------------------------ */

const SUN = (() => {
  const v = [46, 96, 34];
  const n = Math.hypot(...v);
  return v.map((c) => c / n);
})();

function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/** Intersection rayon / capsule (segments obliques : branches, troncs tombés). */
function capsuleHit(o, d, trunk, bestT) {
  const a = [trunk.x, trunk.y0, trunk.z];
  const b = [trunk.x2 ?? trunk.x, trunk.y1, trunk.z2 ?? trunk.z];
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const ao = [o[0] - a[0], o[1] - a[1], o[2] - a[2]];
  const abLen2 = dot(ab, ab);
  if (abLen2 < 1e-6) return null;
  // On projette dans un repère où la capsule est un cylindre infini, puis on
  // borne le paramètre au segment.
  const abd = dot(ab, d);
  const abab = abLen2;
  const abao = dot(ab, ao);
  const dao = dot(d, ao);
  const d2 = dot(d, d);
  const A = abab * d2 - abd * abd;
  if (Math.abs(A) < 1e-8) return null;
  const B = abab * dao * 2 - abd * abao * 2;
  const C = abab * dot(ao, ao) - abao * abao - abab * trunk.r * trunk.r;
  const disc = B * B - 4 * A * C;
  if (disc <= 0) return null;
  const sq = Math.sqrt(disc);
  for (const t of [(-B - sq) / (2 * A), (-B + sq) / (2 * A)]) {
    if (t <= 0.05 || t >= bestT) continue;
    const p = [o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t];
    const ap = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
    const proj = dot(ap, ab) / abab;
    if (proj < 0 || proj > 1) continue;
    return t;
  }
  return null;
}

function render(scene, game, camera, textures) {
  const { quads, trunks, grid, cell } = scene;
  const fov = (62 * Math.PI) / 180;
  const aspect = WIDTH / HEIGHT;
  const tanHalf = Math.tan(fov / 2);

  // Repère caméra : direction = (sin yaw, 0, cos yaw) à l'horizontale.
  const yaw = camera.yaw;
  const forward = [Math.sin(yaw), camera.pitch ?? 0, Math.cos(yaw)];
  const fl = Math.hypot(...forward);
  forward[0] /= fl; forward[1] /= fl; forward[2] /= fl;
  const right = [Math.cos(yaw), 0, -Math.sin(yaw)];
  const up = [
    right[1] * forward[2] - right[2] * forward[1],
    right[2] * forward[0] - right[0] * forward[2],
    right[0] * forward[1] - right[1] * forward[0],
  ].map((v) => -v);

  const origin = [camera.x, camera.y, camera.z];
  const pixels = Buffer.alloc(WIDTH * HEIGHT * 3);
  const debugPixels = process.env.PREVIEW_DEBUG ? new Array(WIDTH * HEIGHT).fill(null) : null;
  const hitCounts = {};
  const hitSamples = [];
  const stamp = new Int32Array(quads.length).fill(-1);
  const trunkStamp = new Int32Array(trunks.length).fill(-1);

  const fogColor = [0.38, 0.45, 0.38];
  // Même densité que le jeu (FogExp2, 0,0125) pour juger la profondeur réelle.
  const FOG_DENSITY = 0.0125;

  for (let py = 0; py < HEIGHT; py++) {
    for (let px = 0; px < WIDTH; px++) {
      const ndcX = ((px + 0.5) / WIDTH) * 2 - 1;
      const ndcY = 1 - ((py + 0.5) / HEIGHT) * 2;

      const dir = [
        forward[0] + right[0] * ndcX * tanHalf * aspect + up[0] * ndcY * tanHalf,
        forward[1] + right[1] * ndcX * tanHalf * aspect + up[1] * ndcY * tanHalf,
        forward[2] + right[2] * ndcX * tanHalf * aspect + up[2] * ndcY * tanHalf,
      ];
      const dn = Math.hypot(...dir);
      dir[0] /= dn; dir[1] /= dn; dir[2] /= dn;

      let bestT = Infinity;
      let hit = null;

      // --- marche le long du rayon, cellule par cellule ---
      let t = 0.4;
      while (t < MAX_DIST) {
        const x = origin[0] + dir[0] * t;
        const y = origin[1] + dir[1] * t;
        const z = origin[2] + dir[2] * t;

        const ix = Math.floor(x / cell);
        const iz = Math.floor(z / cell);
        const bucket = grid.get(`${ix}:${iz}`);
        if (bucket) {
          for (const ref of bucket) {
            if (ref < 0) {
              // tronc
              const index = -ref - 1;
              if (trunkStamp[index] === py * WIDTH + px) continue;
              trunkStamp[index] = py * WIDTH + px;
              const trunk = trunks[index];
              if (trunk.horizontal) {
                const tc = capsuleHit(origin, dir, trunk, bestT);
                if (tc !== null) {
                  bestT = tc;
                  hit = {
                    kind: "trunk",
                    trunk,
                    t: tc,
                    px: origin[0] + dir[0] * tc,
                    py: origin[1] + dir[1] * tc,
                  };
                }
                continue;
              }
              const ox = origin[0] - trunk.x;
              const oz = origin[2] - trunk.z;
              const a = dir[0] * dir[0] + dir[2] * dir[2];
              if (a < 1e-6) continue;
              const b = 2 * (ox * dir[0] + oz * dir[2]);
              const c = ox * ox + oz * oz - trunk.r * trunk.r;
              const disc = b * b - 4 * a * c;
              if (disc <= 0) continue;
              const tc = (-b - Math.sqrt(disc)) / (2 * a);
              if (tc <= 0.05 || tc >= bestT) continue;
              const hy = origin[1] + dir[1] * tc;
              if (hy < trunk.y0 || hy > trunk.y1) continue;
              bestT = tc;
              hit = {
                kind: "trunk",
                trunk,
                t: tc,
                px: origin[0] + dir[0] * tc,
                py: hy,
              };
            } else {
              if (stamp[ref] === py * WIDTH + px) continue;
              stamp[ref] = py * WIDTH + px;
              const quad = quads[ref];
              const denom = dot(dir, quad.normal);
              if (Math.abs(denom) < 1e-6) continue;
              const toQuad = [
                quad.cx - origin[0],
                quad.cy - origin[1],
                quad.cz - origin[2],
              ];
              const tq = dot(toQuad, quad.normal) / denom;
              if (tq <= 0.05 || tq >= bestT) continue;

              const pxw = origin[0] + dir[0] * tq - quad.cx;
              const pyw = origin[1] + dir[1] * tq - quad.cy;
              const pzw = origin[2] + dir[2] * tq - quad.cz;
              const u = (pxw * quad.uAxis[0] + pyw * quad.uAxis[1] + pzw * quad.uAxis[2]) / (2 * quad.hw) + 0.5;
              const v = (pxw * quad.vAxis[0] + pyw * quad.vAxis[1] + pzw * quad.vAxis[2]) / (2 * quad.hh) + 0.5;
              if (u < 0 || u > 1 || v < 0 || v > 1) continue;

              const texel = sampleTexture(quad.tex, u, v, 0);
              if (texel.rgba[3] < 0.5) continue;

              bestT = tq;
              hit = { kind: "card", quad, texel, normal: quad.normal, u, v, t: tq };
            }
          }
        }

        // Le sol est testé APRÈS la cellule : sinon une carte de litière posée
        // à quelques centimètres du sol serait toujours masquée.
        const ground = game.terrainHeight(x, z);
        if (y <= ground) {
          if (t < bestT) {
            bestT = t;
            hit = { kind: "ground", x, y: ground, z };
          }
          break;
        }

        t += 0.32;
      }

      // --- ombrage ---
      let r = 0;
      let g = 0;
      let b = 0;

      if (!hit) {
        // Ciel : bleu au zénith, mais lavé par le brouillard à l'horizon —
        // sans quoi une bande de ciel nue apparaît entre les troncs.
        const sky = Math.max(0, dir[1]);
        const haze = Math.pow(1 - Math.min(1, sky / 0.55), 1.6);
        // Ciel sous couvert : lumineux au zénith seulement, vert profond
        // dès qu'on s'approche de l'horizon — on ne voit jamais l'horizon
        // dégagé depuis le sol d'une forêt fermée.
        const blue = [0.18 + sky * 0.62, 0.26 + sky * 0.62, 0.2 + sky * 0.6];
        r = blue[0] + (fogColor[0] * 1.0 - blue[0]) * haze;
        g = blue[1] + (fogColor[1] * 0.98 - blue[1]) * haze;
        b = blue[2] + (fogColor[2] * 0.95 - blue[2]) * haze;
      } else if (hit.kind === "ground") {
        // Même échelle que le jeu : une tuile de texture tous les 4 mètres.
        const repeat = 1 / 4;
        const texel = sampleTexture(
          textures.ground,
          ((hit.x * repeat) % 1 + 1) % 1,
          ((hit.z * repeat) % 1 + 1) % 1,
        );
        // Normale du sol dans son propre repère (Y vers le haut).
        const n = texel.normal;
        const lambert = 0.28 + 0.72 * Math.max(0, n[0] * SUN[0] + n[1] * SUN[2] + n[2] * SUN[1]);
        const ambient = 0.22;
        r = texel.rgba[0] * (lambert * 0.85 + ambient);
        g = texel.rgba[1] * (lambert * 0.85 + ambient);
        b = texel.rgba[2] * (lambert * 0.85 + ambient);
      } else if (hit.kind === "trunk" && hit.trunk.horizontal) {
        // Segments (branches, troncs tombes) : teinte unie, une texture
        // d'ecorce appliquee a un cylindre couche ferait des rayures.
        const shade = hit.trunk.shade;
        const lambert = 0.25 + 0.75 * Math.max(0.2, SUN[1]);
        r = 0.3 * shade * lambert;
        g = 0.23 * shade * lambert;
        b = 0.165 * shade * lambert;
      } else if (hit.kind === "trunk") {
        const shade = hit.trunk.shade;
        // Lumière rasante : le fût est modelé par le côté d'où vient le soleil.
        const lambert = 0.18 + 0.82 * Math.max(0, SUN[0] * 0.8 + SUN[2] * 0.4);
        // Écorce : deux répétitions en travers du fût, six sur la hauteur.
        const trunk = hit.trunk;
        const u = (hit.px * 2) % 1;
        const v = ((hit.py - trunk.y0) / Math.max(1, trunk.y1 - trunk.y0)) * 6 % 1;
        const bark = sampleTexture(textures.bark, (u + 1) % 1, (v + 1) % 1);
        const bn = bark.normal;
        const barkLambert = 0.15 + 0.85 * Math.max(0, bn[0] * SUN[0] + bn[2] * SUN[2]);
        r = bark.rgba[0] * shade * (lambert * 0.5 + barkLambert * 0.7);
        g = bark.rgba[1] * shade * (lambert * 0.5 + barkLambert * 0.7);
        b = bark.rgba[2] * shade * (lambert * 0.5 + barkLambert * 0.7);
      } else {
        const quad = hit.quad;
        const tn = hit.texel.normal;
        // Normale monde : repère de la carte × normale tangente de la texture.
        const nx = quad.uAxis[0] * tn[0] + quad.vAxis[0] * tn[1] + quad.normal[0] * tn[2];
        const ny = quad.uAxis[1] * tn[0] + quad.vAxis[1] * tn[1] + quad.normal[1] * tn[2];
        const nz = quad.uAxis[2] * tn[0] + quad.vAxis[2] * tn[1] + quad.normal[2] * tn[2];
        const nl = Math.hypot(nx, ny, nz) || 1;
        const N = [nx / nl, ny / nl, nz / nl];

        const front = Math.max(0, dot(N, SUN));
        // Ciel : plus une surface regarde vers le haut, plus elle reçoit du ciel.
        const sky = 0.5 + 0.5 * N[1];
        const lambert = 0.08 + front * 0.9 + sky * 0.18;
        const warm = 1 + 0.1 * front;

        // Transluminescence : le soleil traverse les feuilles minces.
        const back = Math.max(0, -dot(N, SUN));
        const through = Math.pow(back, 1.4) * 0.6;

        const alb = hit.texel.rgba;
        const tint = quad.tint;
        // La lumière transmise est filtrée par la feuille : on multiplie par
        // l'albédo, on n'ajoute pas du blanc (sinon tout vire au beige).
        r = alb[0] * (lambert * warm + through) * tint;
        g = alb[1] * (lambert * warm + through * 1.05) * tint;
        b = alb[2] * (lambert * warm + through * 0.7) * tint;
      }

      // --- brouillard exponentiel (densité) ---
      if (hit) {
        const f = 1 - Math.exp(-Math.pow(bestT * FOG_DENSITY, 2));
        r = r * (1 - f) + fogColor[0] * f;
        g = g * (1 - f) + fogColor[1] * f;
        b = b * (1 - f) + fogColor[2] * f;
      }

      if (debugPixels) {
        const tag =
          !hit ? "ciel"
            : hit.kind === "ground" ? "sol"
            : hit.kind === "trunk" ? "tronc"
            : hit.quad.cy > 18 ? "plafond"
            : hit.quad.hh * 2 < 3 && hit.quad.cy < game.terrainHeight(hit.quad.cx, hit.quad.cz) + 3 ? "plant"
            : "carte";
        hitCounts[tag] = (hitCounts[tag] ?? 0) + 1;
        if (Math.abs(py - HEIGHT / 2) < 2 && px % 40 === 0) {
          hitSamples.push(`${tag}@${bestT.toFixed(0)}m`);
        }
      }

      if (debugPixels && px === Math.floor(WIDTH / 2)) {
        const names = new Map(Object.entries(textures).map(([name, tex]) => [tex, name]));
        debugPixels[py * WIDTH + px] = hit
          ? {
              kind: hit.kind,
              t: bestT,
              tex: hit.quad ? names.get(hit.quad.tex) : undefined,
              size: hit.quad ? `${(hit.quad.hw * 2).toFixed(1)}x${(hit.quad.hh * 2).toFixed(1)} @${hit.quad.cy.toFixed(1)}` : "",
            }
          : null;
      }

      const i = (py * WIDTH + px) * 3;
      pixels[i] = Math.min(255, Math.round(r ** (1 / 1.6) * 255));
      pixels[i + 1] = Math.min(255, Math.round(g ** (1 / 1.6) * 255));
      pixels[i + 2] = Math.min(255, Math.round(b ** (1 / 1.6) * 255));
    }
  }

  if (process.env.PREVIEW_DEBUG) {
    console.log(
      `debug répartition: ${Object.entries(hitCounts).map(([k, v]) => `${k} ${((v / (WIDTH * HEIGHT)) * 100).toFixed(0)}%`).join(" · ")}`,
    );
    console.log(`debug ligne d'horizon: ${hitSamples.join(" ")}`);
    const centre = Math.floor(WIDTH / 2);
    for (const py of [40, 90, 130, 145, 150, 160, 185, 230]) {
      const px = centre;
      const i = (py * WIDTH + px) * 3;
      const meta = debugPixels[py * WIDTH + px];
      console.log(
        `debug y=${py}: rgb(${pixels[i]},${pixels[i + 1]},${pixels[i + 2]}) ` +
          (meta
            ? `${meta.kind} t=${meta.t.toFixed(1)} ${meta.tex ?? ""} size=${meta.size ?? ""}`
            : "ciel"),
      );
    }
  }
  return pixels;
}

/* ------------------------------------------------------------------ */
/* Programme                                                           */
/* ------------------------------------------------------------------ */

const game = await loadGame();
const textures = {
  foliage: await loadTexture("public/textures/foliage.png"),
  foliageDeep: await loadTexture("public/textures/foliage-deep.png"),
  foliagePale: await loadTexture("public/textures/foliage-pale.png"),
  ground: await loadTexture("public/textures/ground.jpg", 448),
  bark: await loadTexture("public/textures/bark.jpg", 256),
  fern: await loadTexture("public/textures/fern.png"),
  grass: await loadTexture("public/textures/grass.png"),
  spray: await loadTexture("public/textures/spray.png"),
  bigleaf: await loadTexture("public/textures/bigleaf.png"),
  canopy: await loadTexture("public/textures/canopy.png", 128),
};

const random = game.mulberry32(4242);
const scene = buildScene(game, random, textures);


// Diagnostic : densité du sous-bois autour du point de vue.
for (const view of VIEWS) {
  let near = 0;
  for (const q of scene.quads) {
    const d = Math.hypot(q.cx - view.x, q.cz - view.z);
    if (d < 12 && q.cy < game.terrainHeight(q.cx, q.cz) + 2.2) near++;
  }
  console.log(`diagnostic ${view.name}: ${near} plans de sous-bois à moins de 12 unités`);
}

const startedAt = performance.now();
for (const view of VIEWS) {
  const camera = {
    x: view.x,
    y: game.terrainHeight(view.x, view.z) + 1.62,
    z: view.z,
    yaw: view.yaw,
    pitch: 0.02,
  };
  const pixels = render(scene, game, camera, textures);
  const file = path.join(OUT_DIR, `preview-${view.name}.png`);
  await sharp(pixels, { raw: { width: WIDTH, height: HEIGHT, channels: 3 } })
    .png({ compressionLevel: 9 })
    .toFile(file);
  console.log(`✓ ${file} — ${view.label}`);
}

console.log(
  `\n${scene.trees.length} arbres · ${scene.quads.length} cartes de feuillage · ` +
    `${WIDTH}×${HEIGHT} en ${((performance.now() - startedAt) / 1000).toFixed(1)} s`,
);
