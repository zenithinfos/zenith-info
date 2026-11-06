#!/usr/bin/env node
/**
 * Contrôle du personnage : articulations, prise en main des armes, proportions.
 *
 *   node scripts/check-human.mjs [--out preview/personnage.png]
 *
 * Il n'y a pas de WebGL hors navigateur. Ce script fait donc deux choses :
 *
 *   1. il pose le squelette exact du jeu (mêmes fonctions, mêmes nombres) et
 *      mesure ce qui doit être vrai : les pieds touchent le sol, la taille est
 *      humaine, le canon pointe devant, et surtout **les deux mains tombent sur
 *      la poignée et le garde-main** de chaque arme ;
 *   2. il rend le personnage par un rasteriseur logiciel (triangles projetés,
 *      ombrage plat) pour juger la silhouette : est-ce que ça ressemble à un
 *      homme qui porte un fusil, ou à un mannequin de bois ?
 *
 * Ce n'est pas une image du jeu — les matières, la lumière et les ombres y
 * sont fausses. C'est une image de la géométrie.
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

const OUT = getArg("out", "preview/personnage.png");
await mkdir(path.dirname(OUT), { recursive: true });

const WEAPONS = ["couteau", "machette", "lance", "pistolet", "m16"];

async function loadModules() {
  const dir = await mkdtemp(path.join(tmpdir(), "minkebe-perso-"));
  const outFile = path.join(dir, "bundle.mjs");
  await build({
    stdin: {
      contents: `
        export * from "./src/components/HumanModel.ts";
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

const human = await loadModules();
const THREE = human.THREE;

let failures = 0;
let checks = 0;
function check(name, ok, detail) {
  checks += 1;
  if (!ok) failures += 1;
  const mark = ok ? "✓" : "✗";
  console.log(`  ${mark} ${name}${detail ? ` — ${detail}` : ""}`);
}

const rig = human.createHumanRig();
human.setHumanWeapon(rig, "m16");

const pose = (overrides = {}) =>
  human.poseHuman(rig, {
    dt: 1 / 60,
    motion: "idle",
    speed: 0,
    aiming: false,
    aimYaw: 0,
    aimPitch: 0,
    ...overrides,
  });

const settle = (overrides, frames = 24) => {
  for (let i = 0; i < frames; i++) pose(overrides);
  rig.group.updateMatrixWorld(true);
};

const worldOf = (object) => {
  const v = new THREE.Vector3();
  object.getWorldPosition(v);
  return v;
};

const bounds = () => {
  rig.group.updateMatrixWorld(true);
  const box = new THREE.Box3();
  rig.group.traverse((child) => {
    if (!child.isMesh) return;
    child.geometry.computeBoundingBox();
    const local = child.geometry.boundingBox.clone();
    local.applyMatrix4(child.matrixWorld);
    box.union(local);
  });
  return box;
};

// ---------------------------------------------------------------------------
console.log("\nProportions");
// ---------------------------------------------------------------------------
settle({}, 4);
const box = bounds();
const height = box.max.y - box.min.y;
check("taille humaine", height > 1.68 && height < 1.86, `${height.toFixed(3)} m`);
check("pieds au sol", box.min.y > -0.035 && box.min.y < 0.02, `bas à ${box.min.y.toFixed(3)} m`);
check(
  "épaules à hauteur d'homme",
  Math.abs(worldOf(rig.shoulder.left).y - 1.43) < 0.05,
  `${worldOf(rig.shoulder.left).y.toFixed(3)} m`,
);
check(
  "tête au-dessus des épaules",
  worldOf(rig.head).y - worldOf(rig.shoulder.left).y > 0.12,
  `+${(worldOf(rig.head).y - worldOf(rig.shoulder.left).y).toFixed(3)} m`,
);

// ---------------------------------------------------------------------------
console.log("\nPrise en main des armes");
// ---------------------------------------------------------------------------
for (const id of WEAPONS) {
  human.setHumanWeapon(rig, id);
  settle({ aiming: true, aimPitch: 0 }, 40);
  const hold = human.HUMAN_HOLD[id];
  const grip = rig.weaponHolder.localToWorld(new THREE.Vector3(...hold.grip));
  const wristRight = worldOf(rig.wrist.right);
  const rightError = wristRight.distanceTo(grip);

  let leftError = 0;
  if (hold.fore) {
    const fore = rig.weaponHolder.localToWorld(new THREE.Vector3(...hold.fore));
    leftError = worldOf(rig.wrist.left).distanceTo(fore);
  }

  const muzzle = rig.weaponHolder.localToWorld(rig.weapon.muzzle.clone());
  const headCentre = worldOf(rig.head);
  const handsClearHead =
    Math.min(wristRight.distanceTo(headCentre), hold.fore ? 9 : Infinity) > 0.14;

  check(
    `${id} : main droite sur la poignée`,
    rightError < 0.05,
    `écart ${(rightError * 100).toFixed(1)} cm`,
  );
  if (hold.fore) {
    check(
      `${id} : main gauche sur le garde-main`,
      leftError < 0.05,
      `écart ${(leftError * 100).toFixed(1)} cm`,
    );
  } else {
    check(`${id} : arme à une main`, true, "pas de seconde prise");
  }
  check(
    `${id} : canon devant et au-dessus du sol`,
    muzzle.z < -0.35 && muzzle.y > 1.0 && muzzle.y < 1.8,
    `bouche ${muzzle.z.toFixed(2)} m devant, à ${muzzle.y.toFixed(2)} m`,
  );
  check(`${id} : les mains ne traversent pas la tête`, handsClearHead, "");
}

// ---------------------------------------------------------------------------
console.log("\nMarche et course");
// ---------------------------------------------------------------------------
human.setHumanWeapon(rig, "m16");
for (const motion of ["walk", "run"]) {
  let lowest = 0;
  let highest = 0;
  let previousFoot = null;
  let maxStep = 0;
  for (let frame = 0; frame < 120; frame++) {
    pose({ motion, speed: motion === "run" ? 4.4 : 2.1, aiming: false });
    rig.group.updateMatrixWorld(true);
    const foot = worldOf(rig.ankle.left);
    lowest = Math.min(lowest, foot.y);
    highest = Math.max(highest, foot.y);
    if (previousFoot) maxStep = Math.max(maxStep, Math.hypot(foot.x - previousFoot.x, foot.z - previousFoot.z));
    previousFoot = foot.clone();
  }
  const b = bounds();
  check(
    `${motion} : pied jamais sous le sol`,
    lowest > -0.06,
    `mini ${lowest.toFixed(3)} m`,
  );
  check(`${motion} : le pied se lève`, highest > 0.12, `maxi ${highest.toFixed(3)} m`);
  check(`${motion} : enjambée plausible`, maxStep > 0.01 && maxStep < 0.35, `${maxStep.toFixed(3)} m par image`);
  check(
    `${motion} : la tête reste à hauteur d'homme`,
    b.max.y > 1.5 && b.max.y < 2.0,
    `sommet ${b.max.y.toFixed(2)} m`,
  );
}

// ---------------------------------------------------------------------------
console.log("\nStabilité");
// ---------------------------------------------------------------------------
let finite = true;
for (const motion of ["idle", "walk", "run", "sneak"]) {
  for (let frame = 0; frame < 40; frame++) {
    pose({ motion, speed: 2, aiming: frame > 20, aimPitch: Math.sin(frame * 0.1) * 0.4, aimYaw: Math.cos(frame * 0.13) * 0.5 });
    rig.group.updateMatrixWorld(true);
  }
  rig.group.traverse((child) => {
    if (!child.isMesh) return;
    for (const value of child.matrixWorld.elements) if (!Number.isFinite(value)) finite = false;
  });
}
check("aucune matrice NaN", finite, "40 images par allure");

// ---------------------------------------------------------------------------
console.log("\nLes volumes regardent vers l'extérieur");
// ---------------------------------------------------------------------------
// Un maillage retourné ne se voit pas dans un rendu qui dessine les deux
// faces ; il se voit très bien en jeu, où seules les faces avant sont
// dessinées : on aperçoit alors la paroi opposée du membre, et le corps paraît
// creux — « transparent ». Dix-sept pièces étaient dans ce cas, parce qu'un
// bras s'énumère de l'épaule vers la main et un torse de la taille vers les
// épaules : le même ordre d'indices retourne l'un et pas l'autre.
//
// On mesure le volume signé : positif, les faces regardent dehors.
let inverted = 0;
let meshes = 0;
rig.group.traverse((child) => {
  if (!child.isMesh) return;
  const geometry = child.geometry;
  const index = geometry.index;
  const position = geometry.attributes.position;
  if (!index) return;
  meshes += 1;
  let volume = 0;
  for (let i = 0; i < index.count; i += 3) {
    const a = index.getX(i) * 3;
    const b = index.getX(i + 1) * 3;
    const c = index.getX(i + 2) * 3;
    const ax = position.array[a];
    const ay = position.array[a + 1];
    const az = position.array[a + 2];
    const bx = position.array[b];
    const by = position.array[b + 1];
    const bz = position.array[b + 2];
    const cx = position.array[c];
    const cy = position.array[c + 1];
    const cz = position.array[c + 2];
    volume += ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
  }
  if (volume < 0) inverted += 1;
});
check("aucun maillage retourné", inverted === 0, `${inverted} sur ${meshes}`);

// ---------------------------------------------------------------------------
console.log("\nLe corps n'est pas un aplat");
// ---------------------------------------------------------------------------
// Deux choses séparent un personnage de jeu d'un mannequin de plastique, et
// aucune ne se voit sur une capture d'écran : la **variation de valeur** et
// les **plis**. On les mesure ici, pièce par pièce, pour qu'une refonte de la
// sculpture ne les efface pas en silence.
{
  let painted = 0;
  let total = 0;
  let spread = 0;
  let darkest = 1;
  let brightest = 0;

  rig.group.traverse((child) => {
    if (!child.isMesh) return;
    // L'arme est posée dans la main : ce n'est pas le corps.
    if (!child.userData.body) return;
    total += 1;
    const colours = child.geometry.getAttribute("color");
    if (!colours) return;
    painted += 1;
    // Étendue de la patine sur la pièce : min et max de la valeur.
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < colours.count; i += 1) {
      const value = colours.getX(i) * 0.3 + colours.getY(i) * 0.55 + colours.getZ(i) * 0.15;
      lo = Math.min(lo, value);
      hi = Math.max(hi, value);
    }
    spread = Math.max(spread, hi - lo);
    darkest = Math.min(darkest, lo);
    brightest = Math.max(brightest, hi);

  });

  check("toutes les pièces du corps sont patinées", painted === total, `${painted} sur ${total}`);
  check("la patine varie fortement sur une même pièce", spread > 0.15, `étendue max ${spread.toFixed(2)}`);
  check("la patine descend sous 0,80", darkest < 0.8, `plus sombre ${darkest.toFixed(2)}`);
}

// ---------------------------------------------------------------------------
console.log("\nLe tissu plisse, le reste non");
// ---------------------------------------------------------------------------
// Un tube lisse se lit comme un mannequin. Le remède est un déplacement des
// sommets le long de la normale, à moyenne fréquence. On le mesure : chaque
// sommet est comparé à la moyenne de ses six plus proches voisins. Sur une
// peau tendue ou une sclère, l'écart reste sous le millimètre ; sur une
// chemise plissée, il dépasse plusieurs millimètres.
{
  const CLOTH = new Set(["chemise", "chemise-ombre", "pantalon", "pantalon-ombre", "bottes", "caoutchouc", "sangle", "chapeau"]);
  const SMOOTH = new Set(["peau", "sclere", "iris", "metal", "cheveux", "cuir"]);

  // Écart médian d'un sommet à la moyenne de ses plus proches voisins.
  const ripple = (geometry) => {
    const position = geometry.getAttribute("position");
    const points = [];
    const step = Math.max(1, Math.floor(position.count / 400));
    for (let i = 0; i < position.count; i += step) {
      points.push([position.getX(i), position.getY(i), position.getZ(i)]);
    }
    if (points.length < 12) return 0;
    const residuals = [];
    for (let i = 0; i < points.length; i += 1) {
      const nearest = [];
      for (let j = 0; j < points.length; j += 1) {
        if (i === j) continue;
        const dx = points[i][0] - points[j][0];
        const dy = points[i][1] - points[j][1];
        const dz = points[i][2] - points[j][2];
        nearest.push([dx * dx + dy * dy + dz * dz, j]);
      }
      nearest.sort((a, b) => a[0] - b[0]);
      const k = Math.min(6, nearest.length);
      let ax = 0;
      let ay = 0;
      let az = 0;
      for (let t = 0; t < k; t += 1) {
        const p = points[nearest[t][1]];
        ax += p[0];
        ay += p[1];
        az += p[2];
      }
      ax /= k;
      ay /= k;
      az /= k;
      residuals.push(Math.hypot(points[i][0] - ax, points[i][1] - ay, points[i][2] - az));
    }
    residuals.sort((a, b) => a - b);
    return residuals[Math.floor(residuals.length / 2)] ?? 0;
  };

  const cloth = [];
  const smooth = [];
  rig.group.traverse((child) => {
    if (!child.isMesh || !child.userData.body) return;
    const name = child.material?.name ?? "";
    if (CLOTH.has(name)) cloth.push([name, ripple(child.geometry)]);
    else if (SMOOTH.has(name)) smooth.push([name, ripple(child.geometry)]);
  });

  const mean = (list) => list.reduce((sum, [, value]) => sum + value, 0) / Math.max(1, list.length);
  const clothMean = mean(cloth);
  const smoothMean = mean(smooth);
  check("les vêtements portent des plis", cloth.length > 0 && clothMean > 0.004, `${(clothMean * 1000).toFixed(1)} mm sur ${cloth.length} pièces`);
  check("la peau et les yeux restent lisses", smooth.length > 0 && smoothMean < 0.004, `${(smoothMean * 1000).toFixed(1)} mm sur ${smooth.length} pièces`);
  check("le pli est plus marqué que la peau", clothMean > smoothMean, `tissu ${(clothMean * 1000).toFixed(1)} mm vs peau ${(smoothMean * 1000).toFixed(1)} mm`);
}

// ---------------------------------------------------------------------------
// Rendu logiciel
// ---------------------------------------------------------------------------
const panels = [
  { label: "face", pose: { aiming: false }, camera: [0.2, 1.3, -4.1], target: [0, 0.95, 0] },
  { label: "trois quarts", pose: { motion: "walk", speed: 2.1, frames: 34 }, camera: [2.0, 1.3, -3.4], target: [0, 0.95, 0] },
  { label: "dos", pose: { motion: "run", speed: 4.4, frames: 22 }, camera: [0.6, 1.4, 3.9], target: [0, 1.0, 0] },
  { label: "profil, en joue", pose: { aiming: true, aimPitch: -0.03, frames: 40 }, camera: [-2.9, 1.35, -2.2], target: [0, 1.2, -0.25] },
  { label: "profil", pose: { aiming: false }, camera: [-3.9, 1.25, 0.3], target: [0, 0.95, 0] },
  // Buste : les épaules et la taille se jugent de près. C'est là que se
  // voient les volumes mal accordés — une épaule qui déborde, une ceinture
  // qui flotte.
  { label: "buste", pose: { aiming: false }, camera: [1.5, 1.62, -2.3], target: [0, 1.24, 0] },
  // Portrait : à trois mètres, une tête fait quarante pixels. Sans ce plan,
  // on juge le visage sans le voir.
  { label: "visage", pose: { aiming: false }, camera: [0.16, 1.72, -0.92], target: [0, 1.61, 0] },
];
const PANEL_W = 300;
const PANEL_H = 430;
const SS = 2;
const W = PANEL_W * panels.length * SS;
const H = PANEL_H * SS;
const buffer = new Float32Array(W * H * 3);

// Fond : sous-bois sombre, pour juger la silhouette claire du personnage.
for (let y = 0; y < H; y++) {
  const t = y / (H - 1);
  for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 3;
    buffer[i] = 0.04 + t * 0.03;
    buffer[i + 1] = 0.07 + t * 0.05;
    buffer[i + 2] = 0.05 + t * 0.03;
  }
}

const camera = new THREE.PerspectiveCamera(30, PANEL_W / PANEL_H, 0.05, 60);
/**
 * Tampon de profondeur.
 *
 * Sans lui, deux surfaces qui se pénètrent — la ceinture et la chemise, par
 * exemple — se peignent dans un ordre arbitraire et l'on voit des dents de
 * scie qui n'existent pas dans le jeu, où la carte graphique garde le pixel
 * le plus proche. Un aperçu qui invente des défauts fait perdre du temps à
 * corriger des défauts qui n'existent pas.
 *
 * On interpole `1 - z` (proportionnel à l'inverse de la distance à la caméra,
 * donc linéaire à l'écran) : plus grand veut dire plus près.
 */
const zbuffer = new Float32Array(W * H).fill(-Infinity);
const light = new THREE.Vector3(0.45, 0.85, -0.55).normalize();

function renderPanel(offsetX, poseState, cameraPosition, target) {
  rig.group.updateMatrixWorld(true);
  camera.position.set(...cameraPosition);
  camera.lookAt(new THREE.Vector3(...target));
  camera.updateMatrixWorld(true);
  camera.aspect = PANEL_W / PANEL_H;
  camera.updateProjectionMatrix();

  const triangles = [];
  rig.group.traverse((child) => {
    if (!child.isMesh) return;
    let visible = true;
    let pointer = child;
    while (pointer) {
      if (!pointer.visible) visible = false;
      pointer = pointer.parent;
    }
    if (!visible) return;

    const geometry = child.geometry;
    const position = geometry.attributes.position;
    const index = geometry.index;
    const count = index ? index.count : position.count;
    // Hors navigateur, aucune texture n'est chargée : la couleur du matériau
    // peut être blanche (elle multiplie la carte d'albédo dans le jeu). On
    // peint donc avec la teinte de référence, `userData.swatch`.
    const colour = (
      child.material.userData?.swatch ??
      child.material.color ??
      new THREE.Color(0.7, 0.7, 0.7)
    ).clone();
    // La patine : une couleur par sommet, qui multiplie l'albédo. Sans elle
    // l'aperçu montrerait un aplat que le jeu n'affiche plus.
    const tints = geometry.attributes.color;
    const v = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
    const screen = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
    const normals = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
    const normalsAttr = geometry.attributes.normal;
    const normalMatrix = new THREE.Matrix3().getNormalMatrix(child.matrixWorld);

    for (let i = 0; i < count; i += 3) {
      for (let k = 0; k < 3; k++) {
        const at = index ? index.getX(i + k) : i + k;
        v[k].fromBufferAttribute(position, at).applyMatrix4(child.matrixWorld);
        screen[k].copy(v[k]).project(camera);
        if (normalsAttr) {
          normals[k].fromBufferAttribute(normalsAttr, at).applyMatrix3(normalMatrix).normalize();
        }
      }
      if (screen.some((p) => p.z < -1 || p.z > 1)) continue;

      // Ombrage lissé : on interpole la normale aux sommets, comme le fait le
      // GPU. Un rendu à facettes (une normale par triangle) fait passer un
      // maillage correct pour un mannequin de bois — c'était le cas avant.
      const flat = new THREE.Vector3()
        .subVectors(v[1], v[0])
        .cross(new THREE.Vector3().subVectors(v[2], v[0]));
      if (flat.lengthSq() < 1e-14) continue;
      if (!normalsAttr) {
        flat.normalize();
        for (const n of normals) n.copy(flat);
      }
      triangles.push({
        points: screen.map((p) => [
          offsetX + (p.x * 0.5 + 0.5) * PANEL_W * SS,
          (1 - (p.y * 0.5 + 0.5)) * PANEL_H * SS,
        ]),
        depth: (screen[0].z + screen[1].z + screen[2].z) / 3,
        near: screen.map((point) => 1 - point.z),
        colour,
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

  triangles.sort((a, b) => b.depth - a.depth);

  for (const triangle of triangles) {
    const [[x0, y0], [x1, y1], [x2, y2]] = triangle.points;
    const q = triangle.near;
    const minX = Math.max(0, Math.floor(Math.min(x0, x1, x2)));
    const maxX = Math.min(W - 1, Math.ceil(Math.max(x0, x1, x2)));
    const minY = Math.max(0, Math.floor(Math.min(y0, y1, y2)));
    const maxY = Math.min(H - 1, Math.ceil(Math.max(y0, y1, y2)));
    const area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
    if (Math.abs(area) < 1e-9) continue;
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const px = x + 0.5;
        const py = y + 0.5;
        const w0 = ((x1 - px) * (y2 - py) - (x2 - px) * (y1 - py)) / area;
        const w1 = ((x2 - px) * (y0 - py) - (x0 - px) * (y2 - py)) / area;
        const w2 = 1 - w0 - w1;
        if (w0 < 0 || w1 < 0 || w2 < 0) continue;
        const depth = q[0] * w0 + q[1] * w1 + q[2] * w2;
        const pixel = y * W + x;
        if (depth <= zbuffer[pixel] + 1e-6) continue;
        zbuffer[pixel] = depth;
        const i = pixel * 3;
        // Normale interpolée, puis Lambert adouci + un filet de lumière
        // ambiante colorée : c'est ce qui donne du volume à un bras.
        const nx = triangle.normals[0].x * w0 + triangle.normals[1].x * w1 + triangle.normals[2].x * w2;
        const ny = triangle.normals[0].y * w0 + triangle.normals[1].y * w1 + triangle.normals[2].y * w2;
        const nz = triangle.normals[0].z * w0 + triangle.normals[1].z * w1 + triangle.normals[2].z * w2;
        const len = Math.hypot(nx, ny, nz) || 1;
        const lambert = Math.abs((nx * light.x + ny * light.y + nz * light.z) / len);
        const s = 0.2 + 0.8 * Math.pow(lambert, 0.9);
        // Patine interpolée entre les trois sommets, comme le fait le GPU.
        const tintR = triangle.tints
          ? triangle.tints[0][0] * w0 + triangle.tints[1][0] * w1 + triangle.tints[2][0] * w2
          : 1;
        const tintG = triangle.tints
          ? triangle.tints[0][1] * w0 + triangle.tints[1][1] * w1 + triangle.tints[2][1] * w2
          : 1;
        const tintB = triangle.tints
          ? triangle.tints[0][2] * w0 + triangle.tints[1][2] * w1 + triangle.tints[2][2] * w2
          : 1;
        buffer[i] = buffer[i] * 0.15 + triangle.colour.r * tintR * s * 0.85;
        buffer[i + 1] = buffer[i + 1] * 0.15 + triangle.colour.g * tintG * s * 0.85;
        buffer[i + 2] = buffer[i + 2] * 0.15 + triangle.colour.b * tintB * s * 0.85;
      }
    }
  }
}



// On remet les compteurs à zéro pour des poses reproductibles.
for (let i = 0; i < panels.length; i++) {
  const panel = panels[i];
  rig.gait = 0;
  rig.aim = 0;
  rig.recoil = 0;
  rig.recoilVelocity = 0;
  human.setHumanWeapon(rig, "m16");
  if (panel.label === "en joue") human.setHumanWeapon(rig, "pistolet");
  const frames = panel.pose.frames ?? 12;
  for (let f = 0; f < frames; f++) {
    human.poseHuman(rig, {
      dt: 1 / 60,
      motion: panel.pose.motion ?? "idle",
      speed: panel.pose.speed ?? 0,
      aiming: panel.pose.aiming ?? false,
      aimYaw: 0,
      aimPitch: panel.pose.aimPitch ?? 0,
    });
  }
  renderPanel(i * PANEL_W * SS, panel.pose, panel.camera, panel.target);
}

const pixels = Buffer.alloc(W * H * 3);
for (let i = 0; i < W * H; i++) {
  const r = Math.min(1, Math.max(0, Math.pow(buffer[i * 3], 1 / 2.2)));
  const g = Math.min(1, Math.max(0, Math.pow(buffer[i * 3 + 1], 1 / 2.2)));
  const b = Math.min(1, Math.max(0, Math.pow(buffer[i * 3 + 2], 1 / 2.2)));
  pixels[i * 3] = Math.round(r * 255);
  pixels[i * 3 + 1] = Math.round(g * 255);
  pixels[i * 3 + 2] = Math.round(b * 255);
}

const labels = panels
  .map((panel, index) => {
    const x = index * PANEL_W + 12;
    return `<text x="${x}" y="26" font-family="Helvetica, Arial, sans-serif" font-size="15" fill="#e8e2d0">${panel.label}</text>`;
  })
  .join("");

await sharp(pixels, { raw: { width: W, height: H, channels: 3 } })
  .resize(PANEL_W * panels.length, PANEL_H, { kernel: "lanczos3" })
  .composite([
    {
      input: Buffer.from(
        `<svg width="${PANEL_W * panels.length}" height="${PANEL_H}" xmlns="http://www.w3.org/2000/svg">
           <line x1="0" y1="${PANEL_H - 40}" x2="${PANEL_W * panels.length}" y2="${PANEL_H - 40}" stroke="#6f7a63" stroke-width="1" stroke-dasharray="4 6"/>
           ${labels}
         </svg>`,
      ),
      top: 0,
      left: 0,
    },
  ])
  .png()
  .toFile(OUT);

console.log(`\n${failures === 0 ? "✓" : "✗"} ${checks - failures}/${checks} contrôles · image ${OUT}`);
if (failures > 0) process.exitCode = 1;
