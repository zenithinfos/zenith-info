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
  return { data, width: info.width, height: info.height, channels: info.channels };
}

function sampleTexture(tex, u, v) {
  const x = Math.min(tex.width - 1, Math.max(0, Math.floor(u * tex.width)));
  const y = Math.min(tex.height - 1, Math.max(0, Math.floor((1 - v) * tex.height)));
  const i = (y * tex.width + x) * tex.channels;
  return [tex.data[i] / 255, tex.data[i + 1] / 255, tex.data[i + 2] / 255, tex.data[i + 3] / 255];
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
      trunks.push({
        x: tree.x,
        z: tree.z,
        y0: tree.y - 0.4,
        y1: tree.y + tree.trunkHeight,
        r: tree.trunkRadius,
        shade:
          tree.kind === "emergent" ? 0.55 : tree.kind === "mid" ? 0.68 : tree.kind === "understory" ? 0.8 : 0.72,
      });

      // Charpentières : segments obliques, dessinés comme des troncs couchés.
      for (const branch of tree.branches ?? []) {
        const dx = Math.cos(branch.angle) * branch.length * Math.cos(branch.rise);
        const dz = Math.sin(branch.angle) * branch.length * Math.cos(branch.rise);
        const dy = Math.sin(branch.rise) * branch.length;
        trunks.push({
          x: tree.x,
          z: tree.z,
          y0: tree.y + branch.y,
          y1: tree.y + branch.y + dy,
          r: branch.radius,
          shade: 0.7,
          horizontal: true,
          x2: tree.x + dx,
          z2: tree.z + dz,
        });
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
          : family < 0.45
            ? textures.foliage
            : family < 0.78
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
            (0.82 + tileRandom() * 0.36) *
            (0.55 + (0.45 * Math.min(1, (card.offset[1] + tree.trunkHeight * 0.4) / 14))),
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
          tint: card.flat ? 0.42 + tileRandom() * 0.22 : 0.6 + tileRandom() * 0.3,
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

  const fogColor = [0.33, 0.44, 0.35];
  const fogNear = 8;
  const fogFar = 95;

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
                  hit = { kind: "trunk", trunk, t: tc };
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
              hit = { kind: "trunk", trunk, t: tc };
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

              const texel = sampleTexture(quad.tex, u, v);
              if (texel[3] < 0.42) continue;

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
        const blue = [0.52 + sky * 0.32, 0.68 + sky * 0.26, 0.78 + sky * 0.18];
        r = blue[0] + (fogColor[0] * 1.0 - blue[0]) * haze;
        g = blue[1] + (fogColor[1] * 0.98 - blue[1]) * haze;
        b = blue[2] + (fogColor[2] * 0.95 - blue[2]) * haze;
      } else if (hit.kind === "ground") {
        const texel = sampleTexture(textures.ground, (hit.x * 0.06) % 1, (hit.z * 0.06) % 1);
        const lambert = 0.35 + 0.5 * Math.max(0, SUN[1]);
        r = texel[0] * lambert * 0.72;
        g = texel[1] * lambert * 0.72;
        b = texel[2] * lambert * 0.72;
      } else if (hit.kind === "trunk") {
        const shade = hit.trunk.shade;
        const lambert = 0.3 + 0.55 * Math.abs(SUN[0]);
        r = 0.30 * shade * lambert;
        g = 0.23 * shade * lambert;
        b = 0.16 * shade * lambert;
      } else {
        const lambert = 0.42 + 0.62 * Math.abs(dot(hit.normal, SUN));
        const warm = 1 + 0.12 * Math.max(0, dot(hit.normal, SUN));
        r = hit.texel[0] * hit.quad.tint * lambert * warm;
        g = hit.texel[1] * hit.quad.tint * lambert * warm;
        b = hit.texel[2] * hit.quad.tint * lambert * warm;
      }

      // --- brouillard ---
      if (hit) {
        const f = Math.min(1, Math.max(0, (bestT - fogNear) / (fogFar - fogNear))) ** 1.6;
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
  ground: await loadTexture("public/textures/ground.jpg"),
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
