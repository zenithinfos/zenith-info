#!/usr/bin/env node
/**
 * Les plants à fruits, à l'échelle du monde.
 *
 *   node scripts/preview-fruits.mjs [--out preview/fruits.png]
 *
 * La géométrie vient de `src/components/FruitPlants.ts` — le module dont se
 * sert la scène. Ce n'est donc pas une illustration : c'est la plante du jeu,
 * rendue sans navigateur.
 *
 * Le personnage est posé à côté pour l'échelle : un plant dont les fruits
 * arrivent à la hanche ne se cueille pas d'une main distraite, et un plant qui
 * monte au-dessus de la tête oblige à grimper.
 */

import { build } from "esbuild";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import * as THREE from "three";
import sharp from "sharp";

const argv = process.argv.slice(2);
const getArg = (name, fallback) => {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 ? argv[index + 1] : fallback;
};
const OUT = getArg("out", "preview/fruits.png");

const dir = await mkdtemp(path.join(tmpdir(), "fruits-"));
const bundle = path.join(dir, "m.mjs");
await build({
  stdin: {
    contents: `export { buildFruitPlant, fruitMaterial } from "./src/components/FruitPlants.ts";
      export * from "./src/game/forage.ts";
      export { createHumanRig, poseHuman, setHumanWeapon } from "./src/components/HumanModel.ts";`,
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
const mod = await import(`${bundle}?t=${Date.now()}`);
await rm(dir, { recursive: true, force: true });

const PANEL = 260;
const SS = 2;
const SPECIES = mod.FRUIT_SPECIES;
const W = PANEL * SPECIES.length * SS;
const H = PANEL * SS;
const buffer = new Float32Array(W * H * 3);
const zbuffer = new Float32Array(W * H).fill(-Infinity);
const light = new THREE.Vector3(0.4, 0.86, -0.5).normalize();
const camera = new THREE.PerspectiveCamera(26, 1, 0.05, 60);

// Fond de sous-bois : c'est contre LUI qu'on juge si un fruit se voit.
const LEAF = new THREE.Color(0x2f4526);
for (let y = 0; y < H; y += 1) {
  const t = y / (H - 1);
  for (let x = 0; x < W; x += 1) {
    const i = (y * W + x) * 3;
    // Taches de lumière entre les feuilles : sans ça, le fond est un aplat
    // et tout ressort, y compris ce qui ne ressortirait pas en jeu.
    const fleck = 0.85 + 0.25 * Math.sin(x * 0.07 + y * 0.05) * Math.sin(y * 0.03);
    buffer[i] = LEAF.r * fleck * (0.55 + t * 0.5);
    buffer[i + 1] = LEAF.g * fleck * (0.55 + t * 0.5);
    buffer[i + 2] = LEAF.b * fleck * (0.55 + t * 0.45);
  }
}

function render(objects, offsetX, offsetY, position, target, fov) {
  camera.fov = fov;
  camera.position.set(...position);
  camera.lookAt(new THREE.Vector3(...target));
  camera.updateMatrixWorld(true);
  camera.aspect = 1;
  camera.updateProjectionMatrix();

  const x1 = offsetX + PANEL * SS - 1;
  const y1 = offsetY + PANEL * SS - 1;
  const triangles = [];

  for (const child of objects) {
    child.updateMatrixWorld(true);
  }
  for (const root of objects) {
    root.traverse((child) => {
      if (!child.isMesh) return;
      let visible = true;
      let pointer = child;
      while (pointer) {
        if (!pointer.visible) visible = false;
        pointer = pointer.parent;
      }
      if (!visible) return;
      const geometry = child.geometry;
      const attr = geometry.attributes.position;
      const index = geometry.index;
      const count = index ? index.count : attr.count;
      const material = child.material;
      const colour = (material.userData?.swatch ?? material.color ?? new THREE.Color(0.5, 0.5, 0.5)).clone();
      const normalsAttr = geometry.attributes.normal;
      const normalMatrix = new THREE.Matrix3().getNormalMatrix(child.matrixWorld);
      // Les cartes de feuillage : on les assombrit un peu, elles sont vues à
      // contre-jour dans le jeu et ne doivent pas éclipser les fruits.
      const shade = material.userData?.swatch ? 1 : 0.82;
      const uvAttr = geometry.attributes.uv;
      for (let i = 0; i < count; i += 3) {
        const screen = [];
        const normals = [];
        const uv = [];
        let ok = true;
        for (let k = 0; k < 3; k += 1) {
          const at = index ? index.getX(i + k) : i + k;
          const world = new THREE.Vector3().fromBufferAttribute(attr, at).applyMatrix4(child.matrixWorld);
          const p = world.clone().project(camera);
          if (p.z < -1 || p.z > 1) {
            ok = false;
            break;
          }
          screen.push([
            offsetX + (p.x * 0.5 + 0.5) * PANEL * SS,
            offsetY + (1 - (p.y * 0.5 + 0.5)) * PANEL * SS,
            1 - p.z,
          ]);
          normals.push(
            normalsAttr
              ? new THREE.Vector3().fromBufferAttribute(normalsAttr, at).applyMatrix3(normalMatrix).normalize()
              : new THREE.Vector3(0, 1, 0),
          );
          uv.push(uvAttr ? [uvAttr.getX(at), uvAttr.getY(at)] : [0.5, 0.5]);
        }
        if (!ok) continue;
        triangles.push({
          screen,
          normals,
          uv,
          cut: !material.userData?.swatch,
          colour: colour.clone().multiplyScalar(shade),
        });
      }
    });
  }

  for (const triangle of triangles) {
    const [[x0, y0], [x1v, y1v], [x2, y2]] = triangle.screen;
    if (Math.max(Math.abs(x0 - x1v), Math.abs(x1v - x2), Math.abs(y0 - y1v), Math.abs(y1v - y2)) > PANEL * SS * 3) continue;
    const minX = Math.max(offsetX, Math.floor(Math.min(x0, x1v, x2)));
    const maxX = Math.min(x1, Math.ceil(Math.max(x0, x1v, x2)));
    const minY = Math.max(offsetY, Math.floor(Math.min(y0, y1v, y2)));
    const maxY = Math.min(y1, Math.ceil(Math.max(y0, y1v, y2)));
    const area = (x1v - x0) * (y2 - y0) - (x2 - x0) * (y1v - y0);
    if (Math.abs(area) < 1e-9) continue;
    for (let py = minY; py <= maxY; py += 1) {
      for (let px = minX; px <= maxX; px += 1) {
        const cx = px + 0.5;
        const cy = py + 0.5;
        const w0 = ((x1v - cx) * (y2 - cy) - (x2 - cx) * (y1v - cy)) / area;
        const w1 = ((x2 - cx) * (y0 - cy) - (x0 - cx) * (y2 - cy)) / area;
        const w2 = 1 - w0 - w1;
        if (w0 < 0 || w1 < 0 || w2 < 0) continue;
        const depth = triangle.screen[0][2] * w0 + triangle.screen[1][2] * w1 + triangle.screen[2][2] * w2;
        const pixel = py * W + px;
        if (depth <= zbuffer[pixel] + 1e-6) continue;
        zbuffer[pixel] = depth;
        const i = pixel * 3;
        // Découpe alpha des cartes de feuillage : dans le jeu, `alphaTest` jette
        // les pixels transparents et l'on voit des feuilles découpées. Sans
        // cette simulation, l'aperçu affiche des carrés opaques, masque les
        // fruits et donne une fausse idée de leur visibilité.
        if (triangle.cut) {
          const u = triangle.uv[0][0] * w0 + triangle.uv[1][0] * w1 + triangle.uv[2][0] * w2;
          const v = triangle.uv[0][1] * w0 + triangle.uv[1][1] * w1 + triangle.uv[2][1] * w2;
          const rx = Math.abs(u - 0.5) * 2;
          const ry = Math.abs(v - 0.5) * 2;
          if (Math.hypot(rx, ry) > 0.92) continue;
        }
        const n = [0, 1, 2].map(
          (k) =>
            triangle.normals[0].getComponent(k) * w0 +
            triangle.normals[1].getComponent(k) * w1 +
            triangle.normals[2].getComponent(k) * w2,
        );
        const len = Math.hypot(...n) || 1;
        const lambert = Math.abs((n[0] * light.x + n[1] * light.y + n[2] * light.z) / len);
        // Une sphère qui renvoie un peu de ciel : c'est cette petite tache
        // claire qui fait repérer un fruit dans la pénombre.
        const specular = Math.pow(lambert, 12) * 0.35;
        const shade = 0.22 + 0.78 * Math.pow(lambert, 0.85);
        buffer[i] = Math.min(1, triangle.colour.r * shade + specular);
        buffer[i + 1] = Math.min(1, triangle.colour.g * shade + specular);
        buffer[i + 2] = Math.min(1, triangle.colour.b * shade + specular);
      }
    }
  }
}

const bark = new THREE.MeshStandardMaterial({ color: 0x4a3a2b, roughness: 0.96 });
const leaf = new THREE.MeshStandardMaterial({ color: 0x415b32, roughness: 0.9, side: THREE.DoubleSide });
const leafGeometry = new THREE.PlaneGeometry(1, 1);
const materials = { bark, leaf, leafGeometry };

const labels = [];
SPECIES.forEach((species, index) => {
  const kind = mod.FRUIT_KINDS[species];
  const plant = {
    id: index + 1,
    species,
    x: 0,
    z: 0,
    y: 0,
    ripe: kind.load[1],
    regrow: 0,
    turn: index * 1.1,
    phase: 0,
  };
  const mesh = mod.buildFruitPlant(plant, materials, 0);
  render([mesh.group], index * PANEL * SS, 0, [1.05, 1.24, -1.85], [0, 0.95, 0], 26);
  labels.push(
    `<text x="${index * PANEL + 10}" y="${PANEL - 26}" class="name">${kind.name}</text>`,
    `<text x="${index * PANEL + 10}" y="${PANEL - 10}" class="sub">${kind.latin}</text>`,
  );
});

// Le personnage à côté du safou, pour l'échelle : les fruits doivent tomber
// entre la main et l'épaule, pas au-dessus de la tête.
{
  const rig = mod.createHumanRig();
  mod.setHumanWeapon(rig, "couteau");
  for (let f = 0; f < 12; f += 1) {
    mod.poseHuman(rig, { dt: 1 / 60, motion: "idle", speed: 0, aiming: false, aimYaw: 0, aimPitch: 0 });
  }
  rig.group.position.set(0.72, 0, 0);
  const plant = {
    id: 9,
    species: "safou",
    x: 0,
    z: 0,
    y: 0,
    ripe: 4,
    regrow: 0,
    turn: 0.4,
    phase: 0,
  };
  const mesh = mod.buildFruitPlant(plant, materials, 0);
  // Panneau large : on le dessine sur toute la largeur (les deux derniers
  // panneaux mis bout à bout).
  render([mesh.group, rig.group], (SPECIES.length - 1) * PANEL * SS, 0, [1.6, 1.3, -2.7], [0.35, 0.95, 0], 30);
  labels.push(`<text x="${(SPECIES.length - 1) * PANEL + 10}" y="${PANEL - 44}" class="sub">échelle</text>`);
}

const pixels = Buffer.alloc(W * H * 3);
for (let i = 0; i < W * H * 3; i += 1) {
  pixels[i] = Math.round(Math.pow(Math.min(1, Math.max(0, buffer[i])), 1 / 2.2) * 255);
}

const overlay = `
  <svg width="${PANEL * SPECIES.length}" height="${PANEL}" xmlns="http://www.w3.org/2000/svg">
    <style>
      text { font-family: ui-monospace, monospace; fill: #f3ead7; }
      .name { font-size: 14px; }
      .sub { font-size: 10px; fill: #b9c8bb; }
      .rule { stroke: #ffffff; stroke-opacity: 0.12; }
    </style>
    ${Array.from({ length: SPECIES.length + 1 }, (_, i) => `<line x1="${i * PANEL}" y1="0" x2="${i * PANEL}" y2="${PANEL}" class="rule" />`).join("")}
    ${labels.join("")}
  </svg>`;

await mkdir(path.dirname(OUT), { recursive: true });
await sharp(pixels, { raw: { width: W, height: H, channels: 3 } })
  .resize(PANEL * SPECIES.length, PANEL, { kernel: "lanczos3" })
  .composite([{ input: Buffer.from(overlay) }])
  .png()
  .toFile(OUT);
console.log(OUT);
