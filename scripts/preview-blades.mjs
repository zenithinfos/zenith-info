#!/usr/bin/env node
/**
 * Les lames, vues de près.
 *
 *   node scripts/preview-blades.mjs [--out preview/lames.png]
 *
 * Rendu logiciel (pas de WebGL sans écran) avec tampon de profondeur, éclairage
 * Lambert sur les normales interpolées et couleur par sommet. Ce n'est pas la
 * lumière du jeu — c'est de quoi juger une silhouette, une épaisseur de dos,
 * une ligne de tranchant et une poignée.
 *
 * Trois vues par arme : profil, trois quarts, et un gros plan sur la poignée.
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
const OUT = getArg("out", "preview/lames.png");

const dir = await mkdtemp(path.join(tmpdir(), "blades-"));
const bundle = path.join(dir, "w.mjs");
await build({
  stdin: {
    contents: `export * from "./src/components/WeaponModels.ts";`,
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
const { createWeaponModel, disposeWeaponModel } = await import(`${bundle}?t=${Date.now()}`);
await rm(dir, { recursive: true, force: true });

const WEAPONS = [
  { id: "couteau", label: "Couteau de camp" },
  { id: "machette", label: "Machette" },
  { id: "lance", label: "Lance de chasse" },
];

const PANEL = 420;
const ROWS = WEAPONS.length;
const SS = 2;
const W = PANEL * 3 * SS;
const H = PANEL * ROWS * SS;

const buffer = new Float32Array(W * H * 3).fill(0.02);
const zbuffer = new Float32Array(W * H).fill(-Infinity);
const light = new THREE.Vector3(0.35, 0.75, -0.55).normalize();
const camera = new THREE.PerspectiveCamera(32, 1, 0.01, 40);

/**
 * Les vues, en coordonnées **relatives au centre de l'arme**.
 *
 * L'arme est modélisée vers -Z : la pointe est devant, la poignée derrière.
 * La caméra de profil se place donc sur +X, à hauteur moyenne, et recule de
 * la longueur de l'objet — sinon une lance de deux mètres sort du cadre et un
 * couteau de trente centimètres n'occupe que quelques pixels.
 */
const VIEWS = [
  { label: "profil", dir: [1, 0.18, 0.12], spread: 1.0, focus: 0 },
  { label: "trois quarts", dir: [0.75, 0.42, -0.62], spread: 1.05, focus: 0 },
  { label: "poignée", dir: [0.8, 0.35, 0.55], spread: 0.34, focus: 0.36 },
];

function render(model, view, offsetX, offsetY, frame) {
  camera.position
    .set(...view.dir)
    .normalize()
    .multiplyScalar(frame.distance)
    .add(frame.target);
  camera.lookAt(frame.target);
  camera.updateMatrixWorld(true);
  camera.aspect = 1;
  camera.updateProjectionMatrix();

  const triangles = [];
  model.group.updateMatrixWorld(true);
  model.group.traverse((child) => {
    if (!child.isMesh) return;
    const geometry = child.geometry;
    const position = geometry.attributes.position;
    const index = geometry.index;
    const count = index ? index.count : position.count;
    const colour = (child.material.color ?? new THREE.Color(0.7, 0.7, 0.7)).clone();
    const tints = geometry.attributes.color;
    const normalsAttr = geometry.attributes.normal;
    const normalMatrix = new THREE.Matrix3().getNormalMatrix(child.matrixWorld);
    const v = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
    const screen = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
    const normals = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];

    for (let i = 0; i < count; i += 3) {
      for (let k = 0; k < 3; k += 1) {
        const at = index ? index.getX(i + k) : i + k;
        v[k].fromBufferAttribute(position, at).applyMatrix4(child.matrixWorld);
        screen[k].copy(v[k]).project(camera);
        if (normalsAttr) {
          normals[k].fromBufferAttribute(normalsAttr, at).applyMatrix3(normalMatrix).normalize();
        }
      }
      if (screen.some((p) => p.z < -1 || p.z > 1)) continue;
      triangles.push({
        points: screen.map((p) => [
          offsetX + (p.x * 0.5 + 0.5) * PANEL * SS,
          offsetY + (1 - (p.y * 0.5 + 0.5)) * PANEL * SS,
        ]),
        depth: (screen[0].z + screen[1].z + screen[2].z) / 3,
        near: screen.map((point) => 1 - point.z),
        colour,
        roughness: child.material.roughness ?? 0.5,
        metalness: child.material.metalness ?? 0,
        tints: tints
          ? [0, 1, 2].map((k) => {
              const at = index ? index.getX(i + k) : i + k;
              return [tints.getX(at), tints.getY(at), tints.getZ(at)];
            })
          : null,
        normals: normals.map((n) => n.clone()),
      });
    }
  });

  // Bornes **du panneau**, pas de l'image. Un triangle dont un sommet passe
  // derrière la caméra est projeté à des centaines de pixels : sans borne par
  // panneau, il repeignait toute la planche. C'est ce qui faisait apparaître
  // une poignée géante en travers de trois vignettes.
  const panelX0 = offsetX;
  const panelX1 = offsetX + PANEL * SS - 1;
  const panelY0 = offsetY;
  const panelY1 = offsetY + PANEL * SS - 1;
  for (const triangle of triangles) {
    const [[x0, y0], [x1, y1], [x2, y2]] = triangle.points;
    // Un triangle dégénéré (un sommet derrière la caméra) couvre une surface
    // absurde : on l'écarte au lieu de le laisser repeindre le panneau.
    const span = Math.max(
      Math.abs(x0 - x1),
      Math.abs(x1 - x2),
      Math.abs(y0 - y1),
      Math.abs(y1 - y2),
    );
    if (span > PANEL * SS * 3) continue;
    const minX = Math.max(panelX0, Math.floor(Math.min(x0, x1, x2)));
    const maxX = Math.min(panelX1, Math.ceil(Math.max(x0, x1, x2)));
    const minY = Math.max(panelY0, Math.floor(Math.min(y0, y1, y2)));
    const maxY = Math.min(panelY1, Math.ceil(Math.max(y0, y1, y2)));
    const area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
    if (Math.abs(area) < 1e-9) continue;
    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        const px = x + 0.5;
        const py = y + 0.5;
        const w0 = ((x1 - px) * (y2 - py) - (x2 - px) * (y1 - py)) / area;
        const w1 = ((x2 - px) * (y0 - py) - (x0 - px) * (y2 - py)) / area;
        const w2 = 1 - w0 - w1;
        if (w0 < 0 || w1 < 0 || w2 < 0) continue;
        const depth = triangle.near[0] * w0 + triangle.near[1] * w1 + triangle.near[2] * w2;
        const pixel = y * W + x;
        if (depth <= zbuffer[pixel] + 1e-6) continue;
        zbuffer[pixel] = depth;
        const i = pixel * 3;

        const nx = triangle.normals[0].x * w0 + triangle.normals[1].x * w1 + triangle.normals[2].x * w2;
        const ny = triangle.normals[0].y * w0 + triangle.normals[1].y * w1 + triangle.normals[2].y * w2;
        const nz = triangle.normals[0].z * w0 + triangle.normals[1].z * w1 + triangle.normals[2].z * w2;
        const len = Math.hypot(nx, ny, nz) || 1;
        const lambert = Math.abs((nx * light.x + ny * light.y + nz * light.z) / len);
        // Le métal réfléchit : on ajoute un reflet spéculaire serré, d'autant
        // plus net que la rugosité est faible. Sans lui, l'acier est du gris.
        const half = Math.pow(lambert, 8 / (triangle.roughness * 4 + 0.6));
        const spec = triangle.metalness * half * 1.5;
        const shade = 0.16 + 0.84 * Math.pow(lambert, 0.9) + spec;

        const tintR = triangle.tints ? triangle.tints[0][0] * w0 + triangle.tints[1][0] * w1 + triangle.tints[2][0] * w2 : 1;
        const tintG = triangle.tints ? triangle.tints[0][1] * w0 + triangle.tints[1][1] * w1 + triangle.tints[2][1] * w2 : 1;
        const tintB = triangle.tints ? triangle.tints[0][2] * w0 + triangle.tints[1][2] * w1 + triangle.tints[2][2] * w2 : 1;
        const r = Math.min(1, triangle.colour.r * tintR * shade);
        const gg = Math.min(1, triangle.colour.g * tintG * shade);
        const b = Math.min(1, triangle.colour.b * tintB * shade);
        buffer[i] = r;
        buffer[i + 1] = gg;
        buffer[i + 2] = b;
      }
    }
  }
}

const labels = [];
WEAPONS.forEach((weapon, row) => {
  const model = createWeaponModel(weapon.id);
  // Longueur de l'arme : c'est elle qui règle le recul de la caméra, sinon la
  // lance sort du cadre et le couteau est un timbre-poste.
  const box = new THREE.Box3().setFromObject(model.group);
  const size = new THREE.Vector3();
  box.getSize(size);
  const reach = Math.max(size.z, 0.25);
  const zoom = reach * 1.15;

  // Cadrage : la plus grande dimension de l'arme, corrigée du champ.
  const span = Math.max(size.z, size.x * 2.2, 0.12);
  const centre = box.getCenter(new THREE.Vector3());
  VIEWS.forEach((view, col) => {
    // La poignée se cadre sur le quart arrière, au plus près.
    // Le point de prise est au tiers arrière : c'est là qu'une main se pose,
    // et c'est donc là qu'on juge une poignée. Viser `max.z` recadrait sur le
    // pommeau collé à la caméra.
    const focus = new THREE.Vector3(0, centre.y, box.max.z - size.z * 0.22);
    const distance = (span * view.spread) / (2 * Math.tan((camera.fov * Math.PI) / 360));
    if (process.env.BLADE_DEBUG) {
      console.log(`    ${view.label.padEnd(13)} distance ${distance.toFixed(3)} m · span ${span.toFixed(3)} m · centre ${centre.toArray().map((n) => n.toFixed(2)).join(",")}`);
    }
    render(model, view, col * PANEL * SS, row * PANEL * SS, {
      target: view.label === "poignée" ? focus : centre,
      distance: view.label === "poignée" ? distance * 0.55 : distance,
    });
    labels.push(
      `<text x="${col * PANEL + 16}" y="${row * PANEL + 26}" class="name">${col === 0 ? weapon.label : view.label}</text>`,
    );
  });
  console.log(`${weapon.id.padEnd(10)} ${(size.z * 100).toFixed(1)} cm de long · ${(size.x * 100).toFixed(1)} × ${(size.y * 100).toFixed(1)} cm`);
  disposeWeaponModel(model);
});

/**
 * Conversion en octets **explicite**.
 *
 * `Buffer.from(Float32Array)` ne lit pas des flottants : il tronque chaque
 * valeur en octet, donc 0,4 devient 0. Le premier essai rendait une image
 * entièrement noire alors que les triangles étaient bien dessinés. On applique
 * aussi la correction gamma, comme le fait `check-human`.
 */
const pixels = Buffer.alloc(W * H * 3);
for (let i = 0; i < W * H; i += 1) {
  for (let c = 0; c < 3; c += 1) {
    const value = Math.min(1, Math.max(0, buffer[i * 3 + c]));
    pixels[i * 3 + c] = Math.round(Math.pow(value, 1 / 2.2) * 255);
  }
}

await mkdir(path.dirname(OUT), { recursive: true });
const overlay = `
  <svg width="${PANEL * 3}" height="${PANEL * ROWS}" xmlns="http://www.w3.org/2000/svg">
    <style>
      text { font-family: ui-monospace, monospace; fill: #eee; font-size: 14px; }
      .name { font-size: 15px; fill: #f3ead7; }
      .rule { stroke: #ffffff; stroke-opacity: 0.12; }
    </style>
    ${Array.from({ length: ROWS - 1 }, (_, i) => `<line x1="0" y1="${(i + 1) * PANEL}" x2="${PANEL * 3}" y2="${(i + 1) * PANEL}" class="rule" />`).join("")}
    ${Array.from({ length: 2 }, (_, i) => `<line x1="${(i + 1) * PANEL}" y1="0" x2="${(i + 1) * PANEL}" y2="${PANEL * ROWS}" class="rule" />`).join("")}
    ${labels.join("")}
  </svg>`;

await sharp(pixels, { raw: { width: W, height: H, channels: 3 } })
  .resize(PANEL * 3, PANEL * ROWS, { kernel: "lanczos3" })
  .composite([{ input: Buffer.from(overlay) }])
  .png()
  .toFile(OUT);
console.log(`\n${OUT}`);
