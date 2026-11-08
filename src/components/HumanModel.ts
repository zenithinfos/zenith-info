/**
 * Un corps humain articulé, en pied, avec ses armes.
 *
 * La vue subjective ne montre que deux avant-bras : on ne peut pas dire qui
 * tient le fusil. Ici le personnage existe en entier — squelette hiérarchique
 * hanches → colonne → poitrine → épaules/cou, cuisses → genoux → chevilles —
 * et il est animé par cinématique directe, sauf les bras qui passent par une
 * résolution à deux os (IK analytique) pour que les **mains tombent réellement
 * sur la poignée et le garde-main** de l'arme.
 *
 * L'arme n'est donc pas un décor collé au torse : elle est posée dans l'espace
 * du corps, orientée par la visée, et les deux mains viennent la chercher. Si
 * une main ne peut pas l'atteindre, l'écart est mesurable et `check-human`
 * le signale.
 *
 * Repères : le personnage regarde vers -Z, les pieds à y = 0, la taille
 * (hanches) à 0,95 m, les yeux vers 1,66 m.
 */

import * as THREE from "three";
import { SKIN_BASE, SKIN_MAP_TINT, SKIN_SHADE, SKIN_SHEEN } from "@/game/appearance";
import { type WeaponId } from "@/game/hunting";
import { HUMAN_HOLD } from "@/game/holds";
import { createWeaponModel, disposeWeaponModel, type WeaponModel } from "./WeaponModels";

/**
 * Proportions d'un homme de 1,76 m.
 *
 * Les hanches étaient à 95 cm : jambes trop courtes de trois centimètres,
 * torse trop long d'autant. On ne le voit pas sur un portrait, on le voit
 * immédiatement en jeu — c'est ce qui donne cette allure de pantin monté sur
 * un bâton.
 */
export const HUMAN_HIPS_Y = 0.92;
export const HUMAN_EYE_Y = 1.65;
const SHOULDER_Y = 0.2; // dans l'espace de la poitrine
// L'articulation de l'épaule doit tomber **dans** le torse, pas à côté. À
// 0,172 m du centre, elle était déjà dehors : le bras flottait et la coiffe du
// deltoïde faisait office de pont — c'est ce qui donnait des épaulettes.
const SHOULDER_X = 0.142;
const UPPER_ARM = 0.295;
const FOREARM = 0.265;
const THIGH = 0.43;
const SHIN = 0.4;

export type HumanMotion = "idle" | "walk" | "run" | "sneak" | "swim";

export interface HumanPose {
  /** Pas de temps, en secondes. */
  dt: number;
  motion: HumanMotion;
  /** Vitesse réelle au sol (m/s), pour la cadence. */
  speed: number;
  aiming: boolean;
  /** Écart entre le regard et le buste, en radians. */
  aimYaw: number;
  /** Tangage du regard, en radians (positif : vers le haut). */
  aimPitch: number;
}

export interface HumanRig {
  group: THREE.Group;
  // `Object3D` et non `Group` : un os de squelette glTF est un `Bone`, et le
  // personnage peut être l'un ou l'autre sans que l'appelant ait à le savoir.
  hips: THREE.Object3D;
  spine: THREE.Object3D;
  chest: THREE.Object3D;
  neck: THREE.Object3D;
  head: THREE.Object3D;
  shoulder: { left: THREE.Object3D; right: THREE.Object3D };
  elbow: { left: THREE.Object3D; right: THREE.Object3D };
  wrist: { left: THREE.Object3D; right: THREE.Object3D };
  thigh: { left: THREE.Object3D; right: THREE.Object3D };
  knee: { left: THREE.Object3D; right: THREE.Object3D };
  ankle: { left: THREE.Object3D; right: THREE.Object3D };
  weaponHolder: THREE.Group;
  weapon: WeaponModel | null;
  flash: THREE.Sprite;
  flashLight: THREE.PointLight;
  materials: THREE.Material[];
  geometries: THREE.BufferGeometry[];
  /** État interne de l'animation. */
  gait: number;
  clock: number;
  aim: number;
  recoil: number;
  recoilVelocity: number;
  slash: number;
  /** Durée du coup en cours, en secondes : une machette est plus lente qu'un couteau. */
  slashDuration: number;
  weaponId: WeaponId | null;
}

// ---------------------------------------------------------------------------
// Matières
// ---------------------------------------------------------------------------

/**
 * Couleur de la matière quand sa texture n'est pas disponible.
 *
 * `material.color` multiplie la carte d'albédo : quand la carte est là, la
 * couleur doit rester blanche, sinon la peau est deux fois trop sombre. Mais
 * les outils hors navigateur (contrôles, rendus de géométrie) ne chargent
 * aucune image et n'ont que cette couleur. On garde donc la teinte réelle dans
 * `userData.swatch`, et c'est elle que ces outils lisent.
 */
function swatch(material: THREE.Material, colour: number): void {
  material.userData.swatch = new THREE.Color(colour);
}

function cloth(
  colour: number,
  roughness = 0.94,
  maps: Partial<Surface> = {},
): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    color: maps.map ? 0xffffff : colour,
    roughness,
    metalness: 0,
    ...maps,
  });
  material.normalScale = new THREE.Vector2(0.7, 0.7);
  swatch(material, colour);
  return material;
}

function leather(colour: number, maps: Partial<Surface> = {}): THREE.MeshPhysicalMaterial {
  const material = new THREE.MeshPhysicalMaterial({
    color: maps.map ? 0xffffff : colour,
    roughness: 0.55,
    metalness: 0.04,
    clearcoat: 0.25,
    clearcoatRoughness: 0.5,
    ...maps,
  });
  material.normalScale = new THREE.Vector2(0.9, 0.9);
  swatch(material, colour);
  return material;
}

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

function mesh(
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  collect: { geometries: THREE.BufferGeometry[] },
): THREE.Mesh {
  collect.geometries.push(geometry);
  const created = new THREE.Mesh(geometry, material);
  created.castShadow = true;
  created.receiveShadow = true;
  return created;
}

/* ------------------------------------------------------------------------ */
/* Patine                                                                   */
/* ------------------------------------------------------------------------ */

/**
 * Bruit de valeur déterministe, 3D.
 *
 * Pas de table, pas d'état : la même position donne toujours la même valeur,
 * ce qui rend la patine reproductible d'un chargement à l'autre — et vérifiable
 * par les contrôles.
 */
function hashNoise(x: number, y: number, z: number): number {
  const h = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return h - Math.floor(h);
}

/** Bruit lissé : interpolation trilineaire du bruit sur une grille. */
function smoothNoise(x: number, y: number, z: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fy = y - iy;
  const fz = z - iz;
  const ease = (t: number) => t * t * (3 - 2 * t);
  const ux = ease(fx);
  const uy = ease(fy);
  const uz = ease(fz);
  const corner = (dx: number, dy: number, dz: number) => hashNoise(ix + dx, iy + dy, iz + dz);
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  const x00 = lerp(corner(0, 0, 0), corner(1, 0, 0), ux);
  const x10 = lerp(corner(0, 1, 0), corner(1, 1, 0), ux);
  const x01 = lerp(corner(0, 0, 1), corner(1, 0, 1), ux);
  const x11 = lerp(corner(0, 1, 1), corner(1, 1, 1), ux);
  return lerp(lerp(x00, x10, uy), lerp(x01, x11, uy), uz);
}

/** Deux octaves : une trame large, une plus fine. */
function noise2(x: number, y: number, z: number): number {
  return smoothNoise(x, y, z) * 0.62 + smoothNoise(x * 2.7 + 11, y * 2.7 + 5, z * 2.7 + 3) * 0.38;
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Rampe douce entre deux bornes, dans les deux sens. */
function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0 || 1e-6));
  return t * t * (3 - 2 * t);
}

/** Bande de valeur autour d'une hauteur : sert aux plis de tissu. */
function band(value: number, centre: number, width: number): number {
  const d = (value - centre) / width;
  return Math.exp(-d * d);
}

/** Familles de matières : la patine ne s'applique pas de la même façon. */
export type PaintKind = "tissu" | "peau" | "cuir" | "metal" | "toile";

/**
 * Peint la patine sur une géométrie.
 *
 * La couleur par sommet **multiplie** l'albédo de la matière : c'est de
 * l'occlusion, de la crasse et de l'usure, pas de la peinture. C'est ce qui
 * distingue un vêtement d'un aplat de plastique, et c'est ce qui manquait le
 * plus à trois mètres, à la distance où l'on voit vraiment le personnage.
 */
function paintGeometry(
  geometry: THREE.BufferGeometry,
  kind: PaintKind,
  matrix: THREE.Matrix4,
): void {
  const position = geometry.getAttribute("position");
  const colours = new Float32Array(position.count * 3).fill(1);
  const point = new THREE.Vector3();
  for (let i = 0; i < position.count; i += 1) {
    point.fromBufferAttribute(position, i).applyMatrix4(matrix);
    const [r, g, b] = PATINA(point.x, point.y, point.z, kind);
    colours[i * 3] = r;
    colours[i * 3 + 1] = g;
    colours[i * 3 + 2] = b;
  }
  geometry.setAttribute("color", new THREE.BufferAttribute(colours, 3));
}

/**
 * La patine, en coordonnées du monde au repos.
 *
 * Trois ingrédients, dans l'ordre où un vrai vêtement les accumule :
 *
 *   1. **la crasse du sol** — elle monte du bas : bottes, bas de pantalon,
 *      genoux. C'est le repère qui dit « cet homme marche dans la forêt » ;
 *   2. **les creux** — aisselles, pli du coude, derrière le genou, sous la
 *      ceinture : là où le tissu s'entasse et où la lumière n'entre pas ;
 *   3. **le grain** — une variation lente, jamais nulle, qui casse l'aplat.
 *
 * Le tout reste dans des proportions faibles : 0,62 au plus sombre sur du
 * tissu trempé de boue, 0,86 pour un creux ordinaire. Une patine trop
 * appuyée ne fait pas plus vrai, elle fait sale.
 */
function PATINA(x: number, y: number, z: number, kind: PaintKind): [number, number, number] {
  const grain = noise2(x * 9.3, y * 9.3, z * 9.3);
  const coarse = noise2(x * 2.1 + 4, y * 2.1, z * 2.1 + 7);

  // --- 1. la crasse du sol
  // Elle culmine aux pieds et s'éteint vers la taille. Le facteur vertical est
  // propre à chaque matière : une botte en cuir ne se salit pas comme une
  // chemise.
  const ground = {
    tissu: smoothstep(1.02, 0.06, y),
    peau: smoothstep(0.95, 0.2, y) * 0.55,
    cuir: 0.55 + 0.45 * smoothstep(0.6, 0.02, y),
    metal: smoothstep(1.05, 0.3, y) * 0.7,
    toile: smoothstep(1.35, 0.2, y),
  }[kind];
  const mud = ground * (0.35 + 0.65 * coarse);
  // Un brun-gris, pas du noir : la boue sèche est terne.
  let r = 1 - mud * 0.3;
  let g = 1 - mud * 0.32;
  let b = 1 - mud * 0.36;

  // --- 2. les creux
  // Les hauteurs sont celles du corps au repos, en mètres depuis le sol.
  if (kind === "tissu" || kind === "toile") {
    // Aisselle : deux taches sous les bras, à hauteur de poitrine.
    const armpit = band(Math.abs(x), 0.19, 0.055) * band(y, 1.32, 0.16);
    // Pli du coude et derrière le genou : là où le membre se replie.
    const elbow = band(y, 1.1, 0.07) * band(Math.abs(x), 0.2, 0.09);
    const knee = band(y, 0.52, 0.09) * band(Math.abs(x), 0.1, 0.12);
    // Sous la ceinture et sous les bras, l'ombre propre du vêtement.
    const waist = band(y, 0.98, 0.05);
    const hollow = Math.min(1, armpit * 0.9 + elbow * 0.55 + knee * 0.6 + waist * 0.7);
    r *= 1 - hollow * 0.16;
    g *= 1 - hollow * 0.15;
    b *= 1 - hollow * 0.14;

    // Défraîchi : le soleil, les lavages et les frottements ont délavé de
    // larges plaques. C'est la variation que l'œil lit à trois mètres, bien
    // avant le détail des coutures ; sans elle, la chemise est un aplat de
    // couleur choisie dans un nuancier.
    const fade = smoothstep(0.5, 0.92, noise2(x * 0.95 + 11, y * 0.95 + 3, z * 0.95)) * 0.11;
    r += fade * 0.9;
    g += fade;
    b += fade * 0.7;

    // La sueur : plus sombre et plus froide à l'aisselle, au col et aux reins,
    // là où le tissu colle à la peau et sèche mal.
    const collar = band(y, 1.5, 0.075) * 0.75;
    const smallOfBack = band(y, 1.02, 0.09) * smoothstep(-0.2, 0.08, z) * 0.65;
    const sweat = Math.min(1, armpit * 1.15 + collar + smallOfBack);
    r *= 1 - sweat * 0.11;
    g *= 1 - sweat * 0.1;
    b *= 1 - sweat * 0.14;
  } else if (kind === "peau") {
    // Le creux du cou sous la mâchoire, le pli des paupières, les paumes.
    const neckShadow = band(y, 1.55, 0.05) * smoothstep(0.55, 0.25, z);
    const shade = neckShadow * 0.5;
    r *= 1 - shade * 0.18;
    g *= 1 - shade * 0.2;
    b *= 1 - shade * 0.2;
  }

  // --- 3. le grain
  // Très faible, mais jamais nul : c'est lui qui empêche une surface
  // d'apparaître comme une couleur choisie dans un nuancier.
  const tone = (grain - 0.5) * (kind === "metal" ? 0.16 : 0.11);
  r *= 1 + tone;
  g *= 1 + tone * 0.95;
  b *= 1 + tone * 0.9;

  // --- usure : les saillies s'éclaircissent, le tissu s'y détend
  if (kind === "tissu" || kind === "cuir" || kind === "toile") {
    const wear = smoothstep(0.55, 1.0, coarse) * smoothstep(1.3, 0.3, y) * 0.12;
    r += wear;
    g += wear;
    b += wear;
  }

  return [clamp01(r), clamp01(g), clamp01(b)];
}

type CreasePart = "torse" | "bras" | "avant-bras" | "cuisse" | "tibia";

/**
 * Plis de tissu : une déformation de surface, pas une texture.
 *
 * Un vêtement n'est jamais lisse. Il s'entasse au pli du coude, se creuse
 * derrière le genou, se tend sur la cuisse et se relâche à la taille. Ces
 * plis font plus pour l'impression de réalité qu'un motif de couture : ce
 * sont eux qui accrochent la lumière et qui cassent la silhouette en tuyau.
 *
 * On travaille en coordonnées du monde au repos, comme la patine, et on ne
 * déplace que le rayon : la surface gondole, le membre ne se raccourcit pas.
 * L'amplitude reste sous le centimètre — au-delà, le vêtement devient une
 * loque.
 */
function creaseAt(x: number, y: number, z: number, part: CreasePart): number {
  // Trame large, pour l'ondulation générale du tissu, et trame serrée pour le
  // grain des plis. Deux fréquences : une seule donnerait des vagues.
  const broad = noise2(x * 5.5 + 3, y * 5.5, z * 5.5 + 9) - 0.5;
  const fine = noise2(x * 17 + 1, y * 17 + 7, z * 17) - 0.5;
  const wave = broad * 0.75 + fine * 0.45;

  const fold = (centre: number, width: number) => Math.exp(-(((y - centre) / width) ** 2));

  switch (part) {
    case "torse":
      // Le drapé se concentre là où le tissu est libre : à la taille, sous la
      // ceinture, et dans le creux des reins. Sur la poitrine, la chemise est
      // tendue — presque rien.
      return wave * (0.0022 + fold(1.08, 0.09) * 0.0032 + fold(1.34, 0.1) * 0.0016);
    case "bras":
      // Pli du coude : le tissu s'entasse juste au-dessus.
      return wave * (0.0016 + fold(1.12, 0.05) * 0.004);
    case "avant-bras":
      // La manche est roulée : bourrelet au bord, plis serrés en dessous.
      return wave * (0.0014 + fold(1.0, 0.035) * 0.0045);
    case "cuisse":
      // Tension sur le devant, plis sous l'aine et derrière le genou.
      return wave * (0.0018 + fold(0.78, 0.08) * 0.0028 + fold(0.5, 0.05) * 0.0026);
    case "tibia":
      // Le pantalon casse sur la chaussure : plis horizontaux serrés.
      return wave * (0.0016 + fold(0.22, 0.05) * 0.0038 + fold(0.34, 0.04) * 0.0022);
    default:
      return wave * 0.002;
  }
}

/**
 * Applique les plis à une géométrie de vêtement.
 *
 * La déformation se fait le long de la normale : c'est la seule direction qui
 * gondole la surface sans la déchirer. Les normales sont recalculées ensuite —
 * sans quoi les plis existeraient dans la géométrie mais pas dans la lumière,
 * et ne se verraient pas.
 */
function creaseGeometry(
  geometry: THREE.BufferGeometry,
  part: CreasePart,
  matrix: THREE.Matrix4,
): void {
  const position = geometry.getAttribute("position") as THREE.BufferAttribute;
  const normal = geometry.getAttribute("normal") as THREE.BufferAttribute;
  const point = new THREE.Vector3();
  const direction = new THREE.Vector3();
  const normalMatrix = new THREE.Matrix3().getNormalMatrix(matrix);

  for (let i = 0; i < position.count; i += 1) {
    point.fromBufferAttribute(position, i).applyMatrix4(matrix);
    const amount = creaseAt(point.x, point.y, point.z, part);
    if (amount === 0) continue;
    direction.fromBufferAttribute(normal, i).applyMatrix3(normalMatrix);
    // Le déplacement est en repère local : on reprojette la normale du monde
    // dans celui de la pièce, sinon un bras tourné s'écrase sur lui-même.
    direction.transformDirection(new THREE.Matrix4().copy(matrix).invert());
    position.setXYZ(
      i,
      position.getX(i) + direction.x * amount,
      position.getY(i) + direction.y * amount,
      position.getZ(i) + direction.z * amount,
    );
  }
  position.needsUpdate = true;
  geometry.computeVertexNormals();
}

type Ring = {
  /** Hauteur dans l'espace du membre. */
  y: number;
  /** Demi-largeur, axe X. */
  rx: number;
  /** Demi-profondeur, axe Z. */
  rz: number;
  x?: number;
  z?: number;
};

/**
 * Surface à sections variables.
 *
 * Un membre humain n'est pas un cylindre : épaule large, biceps, coude étroit,
 * avant-bras qui regrossit. On empile donc des sections elliptiques et on les
 * relie — c'est le geste du modeleur, et c'est ce qui distingue une jambe d'un
 * tuyau. `power` règle la superellipse : 2 = cercle, 2,4 = torse (plus large
 * que profond, un peu carré).
 */
/**
 * Volume signé d'un maillage fermé.
 *
 * Le signe dit de quel côté regardent les faces : positif, elles pointent vers
 * l'extérieur ; négatif, vers l'intérieur. C'est la seule façon fiable de
 * savoir si un tube est retourné, sans dépendre de l'ordre d'énumération de
 * ses sections.
 */
function signedVolume(positions: number[], indices: number[]): number {
  let total = 0;
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i] * 3;
    const b = indices[i + 1] * 3;
    const c = indices[i + 2] * 3;
    const ax = positions[a];
    const ay = positions[a + 1];
    const az = positions[a + 2];
    const bx = positions[b];
    const by = positions[b + 1];
    const bz = positions[b + 2];
    const cx = positions[c];
    const cy = positions[c + 1];
    const cz = positions[c + 2];
    total +=
      ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
  }
  return total / 6;
}

function loftGeometry(
  rings: Ring[],
  options: { radial?: number; power?: number; tile?: number; smooth?: number } = {},
): THREE.BufferGeometry {
  const radial = options.radial ?? 18;
  const power = options.power ?? 2;
  const tile = options.tile ?? 0.4;
  // `smooth` interpole des sections intermédiaires : une tête a besoin de
  // vingt sections là où une cuisse en a six.
  const subdiv = Math.max(0, options.smooth ?? 0);

  // Rééchantillonnage par **spline de Catmull-Rom**.
  //
  // La version précédente interpolait chaque paire de sections avec un
  // adoucissement (`t²(3−2t)`), dont la dérivée s'annule aux deux bouts : le
  // rayon marquait donc un palier à chaque section de contrôle. Sur un torse
  // de six sections, cela ne se voyait pas ; sur une tête de doute, cela
  // faisait des bourrelets horizontaux réguliers autour du visage — les
  // « ondulations » qu'on prenait pour un défaut de modélisation.
  //
  // Une spline passe par tous les points sans s'arrêter à aucun : le profil
  // est lisse, et les sections ne sont plus des marches.
  const n = rings.length;
  const at = (index: number): Ring => rings[Math.max(0, Math.min(n - 1, index))];
  const dense: Ring[] = [];
  for (let i = 0; i < n - 1; i++) {
    const p0 = at(i - 1);
    const p1 = at(i);
    const p2 = at(i + 1);
    const p3 = at(i + 2);
    const steps = subdiv + 1;
    for (let k = 0; k < steps; k++) {
      const t = k / steps;
      const t2 = t * t;
      const t3 = t2 * t;
      // Catmull-Rom uniforme : (2p1) + (−p0+p2)t + (2p0−5p1+4p2−p3)t² + (−p0+3p1−3p2+p3)t³, sur 2.
      const spline = (a0: number, a1: number, a2: number, a3: number) =>
        0.5 *
        (2 * a1 +
          (-a0 + a2) * t +
          (2 * a0 - 5 * a1 + 4 * a2 - a3) * t2 +
          (-a0 + 3 * a1 - 3 * a2 + a3) * t3);
      dense.push({
        y: spline(p0.y, p1.y, p2.y, p3.y),
        rx: Math.max(0.0005, spline(p0.rx, p1.rx, p2.rx, p3.rx)),
        rz: Math.max(0.0005, spline(p0.rz, p1.rz, p2.rz, p3.rz)),
        x: spline(p0.x ?? 0, p1.x ?? 0, p2.x ?? 0, p3.x ?? 0),
        z: spline(p0.z ?? 0, p1.z ?? 0, p2.z ?? 0, p3.z ?? 0),
      });
    }
  }
  dense.push(rings[n - 1]);

  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (const ring of dense) {
    const perimeter = Math.PI * (ring.rx + ring.rz);
    for (let i = 0; i < radial; i++) {
      const angle = (i / radial) * Math.PI * 2;
      const c = Math.cos(angle);
      const s = Math.sin(angle);
      const sx = Math.sign(c) * Math.pow(Math.abs(c), 2 / power);
      const sz = Math.sign(s) * Math.pow(Math.abs(s), 2 / power);
      positions.push((ring.x ?? 0) + sx * ring.rx, ring.y, (ring.z ?? 0) + sz * ring.rz);
      uvs.push((i / radial) * (perimeter / tile), ring.y / tile);
    }
  }

  for (let r = 0; r < dense.length - 1; r++) {
    for (let i = 0; i < radial; i++) {
      const a = r * radial + i;
      const b = r * radial + ((i + 1) % radial);
      const c = (r + 1) * radial + i;
      const d = (r + 1) * radial + ((i + 1) % radial);
      indices.push(a, c, b, b, c, d);
    }
  }

  // Bouchons : sans eux, on voit l'intérieur du membre au moindre mouvement.
  const first = dense[0];
  const last = dense[dense.length - 1];
  const bottomCentre = positions.length / 3;
  positions.push(first.x ?? 0, first.y, first.z ?? 0);
  uvs.push(0.5, first.y / tile);
  const topCentre = positions.length / 3;
  positions.push(last.x ?? 0, last.y, last.z ?? 0);
  uvs.push(0.5, last.y / tile);
  const topBase = (dense.length - 1) * radial;
  for (let i = 0; i < radial; i++) {
    indices.push(bottomCentre, i, (i + 1) % radial);
    indices.push(topCentre, topBase + ((i + 1) % radial), topBase + i);
  }

  // Sens d'enroulement — décidé par la géométrie, pas par convention.
  //
  // Le même ordre d'indices ne donne pas le même sens selon qu'on a énuméré
  // les sections de bas en haut (torse, tête) ou de haut en bas (bras, jambe :
  // on les décrit de l'épaule vers la main). Résultat, dix-sept pièces du
  // corps se retrouvaient avec leurs normales tournées vers l'intérieur. En
  // rendu « faces avant », on voit alors la paroi opposée du membre : le corps
  // paraît creux, donc translucide.
  //
  // On calcule donc le volume signé du maillage fermé. Négatif, les faces
  // regardent dedans : on inverse tous les triangles. C'est vrai quel que
  // soit l'ordre dans lequel les sections ont été écrites, et ça le restera
  // pour la prochaine pièce qu'on ajoutera.
  const volume = signedVolume(positions, indices);
  if (volume < 0) {
    for (let i = 0; i < indices.length; i += 3) {
      const swap = indices[i + 1];
      indices[i + 1] = indices[i + 2];
      indices[i + 2] = swap;
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function loft(
  rings: Ring[],
  material: THREE.Material,
  collect: { geometries: THREE.BufferGeometry[] },
  options: { radial?: number; power?: number; tile?: number; smooth?: number } = {},
): THREE.Mesh {
  return mesh(loftGeometry(rings, options), material, collect);
}

/** Ellipsoïde : la brique de base des volumes ronds (muscles, articulations). */
function ellipsoid(
  rx: number,
  ry: number,
  rz: number,
  material: THREE.Material,
  collect: { geometries: THREE.BufferGeometry[] },
  segments = 14,
): THREE.Mesh {
  const geometry = new THREE.SphereGeometry(1, segments, Math.max(8, Math.round(segments * 0.7)));
  geometry.scale(rx, ry, rz);
  return mesh(geometry, material, collect);
}

/**
 * Jeu de cartes d'une matière (albédo, normale, rugosité), s'il existe.
 *
 * Les cartes sont fabriquées par `scripts/gen-avatar-textures.mjs`. Hors
 * navigateur — contrôles, rendus de vérification — il n'y a pas de chargeur
 * d'images : on retombe sur la couleur unie, et la géométrie reste vérifiable.
 */
interface Surface {
  map: THREE.Texture;
  normalMap: THREE.Texture;
  roughnessMap: THREE.Texture;
}

function surface(name: string, repeat = 1): Partial<Surface> {
  if (typeof document === "undefined") return {};
  const loader = new THREE.TextureLoader();
  const load = (file: string, colour: boolean) => {
    const texture = loader.load(`/textures/avatar/${name}${file}`);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(repeat, repeat);
    texture.anisotropy = 8;
    if (colour) texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  };
  return {
    map: load(".jpg", true),
    normalMap: load("-normal.jpg", false),
    roughnessMap: load("-roughness.png", false),
  };
}

/**
 * Tête sculptée.
 *
 * Empiler des ellipsoïdes sur un crâne donne des boules collées : des
 * pommettes en rustines, un nez en cône, une mâchoire qui s'arrête net. Une
 * vraie tête est **une seule surface** dont les reliefs se fondent les uns
 * dans les autres.
 *
 * On construit donc le crâne par sections — ce qui règle la silhouette : front,
 * tempes, pommettes, mâchoire qui se resserre, menton — puis on déforme cette
 * surface point par point par des bosses et des creux : orbites, arcade, arête
 * du nez, lèvres, sillon du menton. C'est la version pauvre d'un sculpteur
 * numérique, mais c'en est un : la surface reste continue, aucun trait n'a de
 * bord.
 */
function sculptedHead(
  material: THREE.Material,
  collect: { geometries: THREE.BufferGeometry[] },
): THREE.Mesh {
  // Proportions : le visage était trop long et le crâne trop petit — un
  // menton qui descend, une calotte qui s'arrête, et le personnage prend un
  // air de masque. On remonte la mâchoire, on élargit le bas du visage et on
  // donne au crâne les trois cinquièmes de la hauteur qu'il mérite.
  const rings: Ring[] = [
    { y: -0.096, rx: 0.028, rz: 0.031, z: -0.02 },
    { y: -0.09, rx: 0.035, rz: 0.039, z: -0.018 },
    { y: -0.08, rx: 0.042, rz: 0.048, z: -0.014 },
    { y: -0.068, rx: 0.048, rz: 0.055, z: -0.009 },
    { y: -0.052, rx: 0.054, rz: 0.063, z: -0.004 },
    { y: -0.034, rx: 0.06, rz: 0.071, z: 0.001 },
    { y: -0.016, rx: 0.069, rz: 0.08, z: 0.005 },
    { y: 0.0, rx: 0.0725, rz: 0.084, z: 0.008 },
    { y: 0.018, rx: 0.0755, rz: 0.088, z: 0.011 },
    { y: 0.038, rx: 0.077, rz: 0.09, z: 0.013 },
    { y: 0.058, rx: 0.0775, rz: 0.091, z: 0.014 },
    { y: 0.078, rx: 0.0755, rz: 0.09, z: 0.015 },
    { y: 0.096, rx: 0.0705, rz: 0.085, z: 0.015 },
    { y: 0.111, rx: 0.06, rz: 0.074, z: 0.015 },
    { y: 0.122, rx: 0.04, rz: 0.053, z: 0.015 },
    { y: 0.128, rx: 0.019, rz: 0.027, z: 0.015 },
  ];

  // Résolution : les traits du visage font trois à dix millimètres. Si les
  // sommets sont plus espacés que ça, une bosse tombe entre deux sommets et la
  // surface part en paquets — l'aspect « fondu » qu'on avait. Soixante
  // sections et cinquante-six rayons donnent un pas de deux millimètres.
  const geometry = loftGeometry(rings, {
    radial: 56,
    power: 2.3,
    tile: 0.16,
    smooth: 6,
  });
  const position = geometry.attributes.position;

  const gauss = (d: number, radius: number) => Math.exp(-(d * d) / (radius * radius));

  for (let i = 0; i < position.count; i++) {
    let x = position.getX(i);
    let y = position.getY(i);
    let z = position.getZ(i);

    // Normale approchée : de l'axe du visage vers l'extérieur. On pousse
    // suivant cette direction pour que les bosses se fondent au lieu de
    // s'empiler.
    const nx = x / 0.074;
    const ny = (y - 0.01) / 0.118;
    const nz = z / 0.086;
    const nlen = Math.hypot(nx, ny, nz) || 1;

    const push = (cx: number, cy: number, cz: number, radius: number, amount: number) => {
      const d = Math.hypot(x - cx, (y - cy) * 0.9, (z - cz) * 0.75);
      const k = gauss(d, radius);
      if (k < 0.002) return;
      x += (nx / nlen) * amount * k;
      y += (ny / nlen) * amount * k * 0.5;
      z += (nz / nlen) * amount * k;
    };

    for (const side of [-1, 1]) {
      // Pommette : l'appui large sous l'angle externe de l'œil. Haute et
      // marquée — c'est elle qui structure un visage d'Afrique centrale.
      push(side * 0.045, -0.010, -0.052, 0.027, 0.0074);
      // Fossette sous la pommette : le creux qui dessine le visage.
      push(side * 0.052, -0.044, -0.046, 0.017, -0.0034);
      // Tempe : le creux latéral, au-dessus de la pommette.
      push(side * 0.062, 0.042, -0.02, 0.02, -0.0045);
      // Orbite : le globe s'enfonce, l'arcade ressort juste au-dessus.
      push(side * 0.03, 0.015, -0.068, 0.021, -0.0078);
      push(side * 0.03, 0.036, -0.064, 0.015, 0.0032);
      // Aile du nez, large et plate : un nez étroit sous cette peau, ce
      // serait le nez d'un autre visage.
      push(side * 0.0175, -0.037, -0.068, 0.0125, 0.0046);
      // Coin de la bouche : la ligne s'enfonce un peu.
      push(side * 0.019, -0.06, -0.058, 0.009, -0.002);
    }

    // Arête du nez : un bourrelet vertical dont la saillie grandit vers la
    // pointe. Étroit — le premier essai faisait un bec qui descendait jusqu'au
    // menton, parce que la bosse s'étalait sur toute la hauteur du visage.
    if (z < -0.01) {
      const ridge = gauss(x, 0.0115) * gauss(y + 0.006, 0.03);
      z -= ridge * 0.0105;
      const bridge = gauss(x, 0.013) * gauss(y - 0.012, 0.019);
      z -= bridge * 0.0055;
      // Pointe large et basse, posée sur des ailes écartées.
      const tip = gauss(Math.hypot(x * 1.02, (y + 0.035) * 1.25), 0.0175);
      z -= tip * 0.0118;
      // Narines : deux creux larges sous la pointe.
      for (const side of [-1, 1]) {
        z += gauss(Math.hypot((x - side * 0.0145) * 1.25, (y + 0.041) * 1.5), 0.0092) * 0.0038;
      }
    }

    // Bouche : **un seul creux**, très doux, puis les lèvres sont des volumes
    // rapportés (voir `lipVolume`). Pousser des gaussiennes de cinq
    // millimètres sur une surface dont les sections sont espacées de deux
    // produisait une série d'ondulations horizontales autour du menton : à
    // cette échelle, la bosse tombe entre deux sections et la surface plisse.
    if (z < -0.03) {
      // Lèvres : deux bombements larges et doux — rayon de neuf millimètres
      // pour une épaisseur de quatre, jamais un pli de deux millimètres sur
      // une surface échantillonnée à deux.
      const mouthWidth = gauss(x, 0.026);
      z -= gauss(y + 0.0665, 0.0078) * mouthWidth * 0.0055;
      z -= gauss(y + 0.0525, 0.0078) * mouthWidth * 0.0062;
      // La fente : une ligne mince, juste pour séparer les deux lèvres.
      z += gauss(y + 0.0595, 0.0028) * gauss(x, 0.0235) * 0.0032;
      // Sillon sous la lèvre, puis menton qui avance.
      z += gauss(y + 0.079, 0.0062) * gauss(x, 0.018) * 0.0014;
      push(0, -0.088, -0.046, 0.02, 0.005);
    }

    position.setXYZ(i, x, y, z);
  }

  position.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return mesh(geometry, material, collect);
}

export function createHumanRig(): HumanRig {
  const collect = { geometries: [] as THREE.BufferGeometry[] };
  const skinMaps = surface("skin");
  // Peau d'un homme du bassin du Congo : brun profond, pas « peau bronzée ».
  // Une valeur claire ne se contente pas de pâlir : elle vire au saumon sous
  // la lumière chaude de la canopée, et le personnage cesse d'être lui-même.
  // Le `sheen` garde le reflet doux des peaux foncées, sans lequel le visage
  // devient un masque plat.
  const skin = new THREE.MeshPhysicalMaterial({
    color: skinMaps.map ? SKIN_MAP_TINT : SKIN_BASE,
    roughness: 0.58,
    metalness: 0,
    sheen: 0.42,
    sheenColor: new THREE.Color(SKIN_SHEEN),
    clearcoat: 0.07,
    ...skinMaps,
  });
  skin.normalScale = new THREE.Vector2(0.55, 0.55);
  swatch(skin, SKIN_BASE);

  // Creux (narines, orbites, pli des lèvres) : deux tons plus bas, jamais du
  // noir — un pli noir sous un nez, c'est un trou, pas une ombre.
  const skinShade = new THREE.MeshStandardMaterial({ color: SKIN_SHADE, roughness: 0.72 });
  // Trois valeurs, pas une. Une tenue monochrome — tout en olive du col aux
  // chaussures — efface les volumes : les jambes disparaissent dans le torse,
  // les bras dans le fond. Chemise claire, pantalon sombre, sangle claire :
  // c'est la séparation des valeurs qui fait lire un corps, bien plus que le
  // nombre de polygones.
  const shirt = cloth(0x5b5c3c, 0.93, surface("shirt"));
  const shirtDark = cloth(0x40432c, 0.95);
  const trousers = cloth(0x373d2c, 0.96, surface("trousers"));
  const trousersDark = cloth(0x282d20, 0.97);
  const boots = leather(0x2b2018, surface("leather"));
  const rubber = new THREE.MeshStandardMaterial({ color: 0x12100c, roughness: 0.97 });
  const webbing = cloth(0x6d6144, 0.88, surface("webbing"));
  const pack = cloth(0x4c4a34, 0.92);
  const hat = cloth(0x615a3f, 0.94);
  const hair = cloth(0x120f0b, 0.98);
  // Le blanc de l'œil n'est pas blanc : c'est une peau très claire, un peu
  // ivoire, qui prend une ombre bleutée sous la paupière. Un blanc pur fait
  // des yeux de poupée, et c'est exactement ce qu'on voyait.
  const sclera = new THREE.MeshPhysicalMaterial({
    color: 0x8e8371,
    roughness: 0.35,
    metalness: 0,
    clearcoat: 0.6,
    clearcoatRoughness: 0.12,
  });
  swatch(sclera, 0x8e8371);
  // L'iris est brun sombre, presque noir au centre.
  const irisMaterial = new THREE.MeshPhysicalMaterial({
    color: 0x2a1810,
    roughness: 0.28,
    metalness: 0,
    clearcoat: 0.8,
    clearcoatRoughness: 0.08,
  });
  swatch(irisMaterial, 0x2a1810);
  const metal = new THREE.MeshStandardMaterial({ color: 0x6a6962, roughness: 0.42, metalness: 0.7 });
  const materials = [
    skin,
    skinShade,
    shirt,
    shirtDark,
    trousers,
    trousersDark,
    boots,
    rubber,
    webbing,
    pack,
    hat,
    hair,
    metal,
    sclera,
    irisMaterial,
  ];

  // Nommer les matières : sans nom, un contrôle qui parle du personnage doit
  // dire « la matière 2 » au lieu de « la chemise ». Les noms survivent au
  // clonage des matières fait pour les vêtements.
  [
    "peau",
    "peau-creux",
    "chemise",
    "chemise-ombre",
    "pantalon",
    "pantalon-ombre",
    "bottes",
    "caoutchouc",
    "sangle",
    "sac",
    "chapeau",
    "cheveux",
    "metal",
    "sclere",
    "iris",
  ].forEach((name, index) => {
    materials[index].name = name;
  });

  const group = new THREE.Group();
  group.name = "joueur";
  group.rotation.order = "YXZ";

  // Hanches : la racine du corps.
  const hips = new THREE.Group();
  hips.position.y = HUMAN_HIPS_Y;
  group.add(hips);

  // --- Bassin ---------------------------------------------------------
  // Un bassin se lit à sa ligne : large aux hanches, plus étroit au pubis.
  const pelvis = loft(
    [
      // Le haut du pantalon rentre sous la chemise : il doit être franchement
      // plus étroit qu'elle à la taille. Deux surfaces à un millimètre l'une
      // de l'autre ne se voient pas comme deux vêtements, elles clignotent.
      { y: -0.13, rx: 0.088, rz: 0.076 },
      { y: -0.07, rx: 0.108, rz: 0.086 },
      { y: -0.01, rx: 0.122, rz: 0.094 },
      { y: 0.05, rx: 0.118, rz: 0.094 },
      { y: 0.1, rx: 0.106, rz: 0.087 },
    ],
    trousers,
    collect,
    { radial: 22, power: 2.4 },
  );
  hips.add(pelvis);

  // Un anneau, pas un cylindre : les deux extrémités se resserrent sous le
  // tissu. Sinon les bouchons du maillage affleurent et l'on voit, à la
  // ceinture, une couronne de triangles clairs — le genre de détail qui fait
  // dire « ce n'est pas bien modulé » sans qu'on sache pourquoi.
  const belt = loft(
    [
      // Douze millimètres au-dessus de la chemise, pas trois centimètres :
      // une ceinture posée à 3 cm du corps est une bouée, pas une sangle.
      { y: 0.006, rx: 0.104, rz: 0.078 },
      { y: 0.012, rx: 0.13, rz: 0.0975 },
      { y: 0.026, rx: 0.133, rz: 0.1 },
      { y: 0.038, rx: 0.131, rz: 0.098 },
      { y: 0.046, rx: 0.104, rz: 0.078 },
    ],
    webbing,
    collect,
    { radial: 24, power: 2.4, smooth: 1 },
  );
  hips.add(belt);

  // Boucle : plate, soudée à la sangle. Une ellipsoïde posée dessus faisait
  // une pastille de métal qui flottait devant le ventre.
  const buckle = mesh(new THREE.BoxGeometry(0.05, 0.026, 0.012), metal, collect);
  buckle.position.set(0, 0.026, -0.0955);
  buckle.rotation.x = 0.04;
  hips.add(buckle);

  // Deux poches de ceinture : la silhouette d'un homme équipé, pas d'un
  // soldat de plomb.
  for (const side of [-1, 1]) {
    const pouch = ellipsoid(0.045, 0.055, 0.035, webbing, collect);
    pouch.position.set(side * 0.125, 0.01, 0.028);
    pouch.rotation.z = side * 0.12;
    hips.add(pouch);
  }

  // Fesses. Sans elles, le bassin se termine par un plan incliné et le
  // personnage, vu de trois quarts, a un dos plat jusqu'aux genoux. Deux
  // masses basses, à l'arrière, donnent son assise au pantalon.
  for (const side of [-1, 1]) {
    const seat = ellipsoid(0.062, 0.058, 0.044, trousers, collect);
    seat.position.set(side * 0.058, -0.055, 0.062);
    seat.rotation.z = side * 0.12;
    hips.add(seat);
  }

  const spine = new THREE.Group();
  spine.position.y = 0.09;
  hips.add(spine);

  const chest = new THREE.Group();
  chest.position.y = 0.19;
  spine.add(chest);

  // --- Tronc ----------------------------------------------------------
  // Une seule surface, de la taille aux trapèzes : taille resserrée, côtes qui
  // s'ouvrent, poitrine large, épaules qui redescendent. Les sections sont des
  // superellipses — un torse humain n'est pas rond, il est plus large que
  // profond et un peu carré.
  const torso = loft(
    [
      // La chemise est rentrée dans le pantalon. Son bas s'affine et passe
      // **sous** la ceinture : le croisement des deux surfaces tombe à 96 cm,
      // exactement là où la ceinture le cache. Élargi pour « retomber sur les
      // hanches », il formait une jupe ; laissé en l'air, il faisait un
      // panneau de tissu qui pendait sous la boucle.
      { y: -0.1, rx: 0.106, rz: 0.086 },
      { y: -0.06, rx: 0.12, rz: 0.09 },
      { y: -0.02, rx: 0.128, rz: 0.093 },
      { y: 0.04, rx: 0.131, rz: 0.094 },
      { y: 0.02, rx: 0.132, rz: 0.095, z: -0.002 },
      { y: 0.1, rx: 0.144, rz: 0.102, z: -0.004 },
      { y: 0.18, rx: 0.152, rz: 0.107, z: -0.004 },
      { y: 0.25, rx: 0.146, rz: 0.106, z: -0.002 },
      // Le haut du torse ne doit pas s'évader : c'est un piège de section
      // (un trapèze est plus étroit qu'une cage thoracique), et un torse qui
      // s'élargit jusqu'aux épaules fait une carrure de nageur — ou une
      // cloche. L'épaule se forme avec le deltoïde, pas avec le tronc.
      { y: 0.31, rx: 0.138, rz: 0.1 },
      { y: 0.37, rx: 0.118, rz: 0.09 },
      { y: 0.42, rx: 0.082, rz: 0.072 },
      { y: 0.45, rx: 0.055, rz: 0.058 },
    ],
    shirt,
    collect,
    { radial: 26, power: 2.5 },
  );
  spine.add(torso);

  // Omoplate : un léger bombement dans le dos, sinon le dos est une planche.
  for (const side of [-1, 1]) {
    const blade = ellipsoid(0.055, 0.075, 0.03, shirt, collect);
    blade.position.set(side * 0.085, 0.22, 0.096);
    blade.rotation.y = side * 0.24;
    spine.add(blade);
  }

  // Col de chemise.
  const collar = loft(
    [
      { y: 0.43, rx: 0.062, rz: 0.06 },
      { y: 0.455, rx: 0.068, rz: 0.065 },
      { y: 0.475, rx: 0.06, rz: 0.058 },
    ],
    shirtDark,
    collect,
    { radial: 20, tile: 0.25 },
  );
  spine.add(collar);

  // Gilet de terrain : deux poches plates à rabat, deux sangles, un poste
  // radio avec son antenne — les détails qu'on voit sur un homme de dos.
  for (const side of [-1, 1]) {
    // Poche et rabat dans **un même groupe orienté**. Avant, les deux boîtes
    // étaient tournées séparément de 0,42 rad : le rabat, mince et clair,
    // n'affleurait la chemise que par un coin et l'on voyait deux triangles
    // beiges en travers de la poitrine. Dans un groupe, ils restent parallèles
    // et la poche se lit comme une poche.
    const pocketGroup = new THREE.Group();
    pocketGroup.position.set(side * 0.052, 0.15, -0.101);
    pocketGroup.rotation.set(0.06, side * -0.34, 0);
    spine.add(pocketGroup);

    const pocket = mesh(new THREE.BoxGeometry(0.05, 0.052, 0.016), shirtDark, collect);
    pocket.position.z = -0.004;
    pocketGroup.add(pocket);

    const flap = mesh(new THREE.BoxGeometry(0.054, 0.012, 0.02), webbing, collect);
    flap.position.set(0, 0.026, -0.005);
    pocketGroup.add(flap);

    // Sangle d'épaule du sac : elle passe sur le haut de l'épaule, pas sur
    // le devant de la chemise. Deux bandes verticales sur la poitrine
    // ressemblaient à des bretelles de salopette.
    const strap = ellipsoid(0.017, 0.07, 0.014, webbing, collect);
    strap.position.set(side * 0.062, 0.355, 0.01);
    strap.rotation.x = 0.55;
    spine.add(strap);
  }

  // Radio : plaquée sur la poitrine, à hauteur de poche. Posée plus haut et
  // plus épaisse, elle flottait devant l'épaule comme une médaille.
  const radio = ellipsoid(0.026, 0.042, 0.016, pack, collect);
  radio.position.set(-0.082, 0.238, -0.092);
  radio.rotation.z = 0.08;
  spine.add(radio);
  const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.0035, 0.0022, 0.21, 6), metal);
  collect.geometries.push(antenna.geometry);
  antenna.position.set(-0.104, 0.33, -0.086);
  antenna.rotation.z = 0.14;
  spine.add(antenna);

  // Sac à dos : cadre + poche + couchage roulé.
  const packGeometry = new THREE.BoxGeometry(0.24, 0.3, 0.14);
  const backpack = mesh(packGeometry, pack, collect);
  backpack.position.set(0, 0.19, 0.175);
  backpack.rotation.x = -0.05;
  spine.add(backpack);

  const packFlap = ellipsoid(0.11, 0.05, 0.075, pack, collect);
  packFlap.position.set(0, 0.3, 0.17);
  spine.add(packFlap);

  const bedroll = new THREE.Mesh(new THREE.CylinderGeometry(0.048, 0.048, 0.26, 12), pack);
  collect.geometries.push(bedroll.geometry);
  bedroll.rotation.z = Math.PI / 2;
  bedroll.position.set(0, 0.02, 0.185);
  spine.add(bedroll);
  for (const side of [-1, 1]) {
    const strap = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.052, 0.012, 12), webbing);
    collect.geometries.push(strap.geometry);
    strap.rotation.z = Math.PI / 2;
    strap.position.set(side * 0.08, 0.02, 0.185);
    spine.add(strap);
  }

  // --- Épaules et bras -------------------------------------------------
  const shoulder = { left: new THREE.Group(), right: new THREE.Group() };
  const elbow = { left: new THREE.Group(), right: new THREE.Group() };
  const wrist = { left: new THREE.Group(), right: new THREE.Group() };

  for (const [key, sign] of [
    ["left", -1],
    ["right", 1],
  ] as const) {
    const joint = shoulder[key];
    joint.position.set(sign * SHOULDER_X, SHOULDER_Y, 0);
    chest.add(joint);

    // Épaule : une seule surface, du trapèze au bras.
    //
    // Avant, c'était deux ellipsoïdes posées côte à côte — une bille pour
    // l'aisselle, une autre pour le deltoïde. À l'écran, cela faisait des
    // épaulettes de footballeur américain, et c'est ce qui donnait au
    // personnage son air de mannequin articulé. Une épaule se lit à sa
    // courbe : elle monte du cou, s'arrondit, puis descend dans le bras sans
    // jamais s'interrompre.
    const shoulderCap = loft(
      [
        { y: 0.074, rx: 0.011, rz: 0.022, x: sign * -0.02 },
        { y: 0.058, rx: 0.028, rz: 0.037, x: sign * -0.018 },
        { y: 0.034, rx: 0.043, rz: 0.05, x: sign * -0.009 },
        { y: 0.0, rx: 0.053, rz: 0.057, x: 0 },
        { y: -0.045, rx: 0.052, rz: 0.055 },
        { y: -0.095, rx: 0.047, rz: 0.05 },
        { y: -0.14, rx: 0.044, rz: 0.046 },
      ],
      shirt,
      collect,
      { radial: 22, power: 2.15, smooth: 2 },
    );
    joint.add(shoulderCap);

    // Bras : biceps, creux du coude, avant-bras qui regrossit puis s'affine.
    const upper = loft(
      [
        { y: -0.06, rx: 0.046, rz: 0.049 },
        { y: -0.1, rx: 0.049, rz: 0.052 },
        { y: -0.15, rx: 0.048, rz: 0.051 },
        { y: -0.21, rx: 0.044, rz: 0.047 },
        { y: -0.26, rx: 0.041, rz: 0.043 },
        { y: -0.3, rx: 0.038, rz: 0.04 },
      ],
      shirt,
      collect,
      { radial: 20, power: 2.2, smooth: 1 },
    );
    joint.add(upper);

    // Manchette roulée au-dessus du coude.
    const cuff = loft(
      [
        { y: -0.235, rx: 0.045, rz: 0.047 },
        { y: -0.252, rx: 0.05, rz: 0.053 },
        { y: -0.272, rx: 0.049, rz: 0.052 },
        { y: -0.3, rx: 0.042, rz: 0.044 },
      ],
      shirtDark,
      collect,
      { radial: 20, smooth: 1 },
    );
    joint.add(cuff);

    const pivot = elbow[key];
    pivot.position.y = -UPPER_ARM;
    joint.add(pivot);

    const lower = loft(
      [
        { y: 0.02, rx: 0.043, rz: 0.045 },
        { y: -0.04, rx: 0.046, rz: 0.048 },
        { y: -0.1, rx: 0.042, rz: 0.044 },
        { y: -0.18, rx: 0.034, rz: 0.036 },
        { y: -0.24, rx: 0.028, rz: 0.031 },
        { y: -0.27, rx: 0.026, rz: 0.03 },
      ],
      skin,
      collect,
      { radial: 16, power: 2.1 },
    );
    pivot.add(lower);

    const wristJoint = wrist[key];
    wristJoint.position.y = -FOREARM;
    pivot.add(wristJoint);

    // Main : paume + doigts en deux phalanges repliées. Un cube avec un pouce
    // ne ressemble à une main que de loin.
    const palm = ellipsoid(0.036, 0.05, 0.026, skin, collect);
    palm.position.set(0, -0.045, -0.006);
    palm.rotation.z = sign * 0.05;
    wristJoint.add(palm);

    const knuckles = ellipsoid(0.036, 0.018, 0.024, skin, collect);
    knuckles.position.set(0, -0.082, -0.012);
    wristJoint.add(knuckles);

    for (let finger = 0; finger < 4; finger++) {
      const spread = (finger - 1.5) * 0.017;
      const proximal = new THREE.Mesh(new THREE.CapsuleGeometry(0.0085, 0.026, 3, 7), skin);
      collect.geometries.push(proximal.geometry);
      proximal.position.set(spread, -0.1, -0.018);
      proximal.rotation.set(-0.9 + finger * 0.03, 0, sign * 0.04);
      wristJoint.add(proximal);

      const distal = new THREE.Mesh(new THREE.CapsuleGeometry(0.0075, 0.022, 3, 7), skin);
      collect.geometries.push(distal.geometry);
      distal.position.set(spread, -0.118, -0.038);
      distal.rotation.set(-1.75, 0, sign * 0.04);
      wristJoint.add(distal);
    }

    const thumb = new THREE.Mesh(new THREE.CapsuleGeometry(0.011, 0.032, 3, 7), skin);
    collect.geometries.push(thumb.geometry);
    thumb.position.set(sign * 0.028, -0.062, -0.024);
    thumb.rotation.set(-0.5, 0, sign * 1.05);
    wristJoint.add(thumb);
  }

  // --- Cou et tête ------------------------------------------------------
  const neckJoint = new THREE.Group();
  neckJoint.position.y = 0.26;
  chest.add(neckJoint);

  // Le cou se resserre en montant et s'incline vers l'arrière. Élargi en
  // haut — pour « rejoindre la mâchoire » — il traversait le menton et l'on
  // voyait, sur la face, une série de bourrelets horizontaux qui n'existaient
  // nulle part dans le maillage du visage.
  const neck = loft(
    [
      { y: -0.02, rx: 0.062, rz: 0.064, z: 0.006 },
      { y: 0.03, rx: 0.056, rz: 0.058, z: 0.011 },
      { y: 0.07, rx: 0.05, rz: 0.052, z: 0.015 },
      { y: 0.1, rx: 0.047, rz: 0.049, z: 0.018 },
    ],
    skin,
    collect,
    { radial: 20, smooth: 1 },
  );
  neckJoint.add(neck);

  const head = new THREE.Group();
  head.position.y = 0.1;
  neckJoint.add(head);
  // Une tête d'homme fait un septième et demi de sa taille, soit 23 cm. Le
  // crâne sculpté mesure 22,4 cm : on le porte à l'échelle. C'est le rapport
  // tête/épaules qui fait lire un adulte plutôt qu'un mannequin — une tête
  // trop petite est le défaut le plus fréquent des personnages procéduraux,
  // et celui qui les fait paraître longs et étroits sans qu'on sache dire
  // pourquoi.
  head.scale.setScalar(1.06);

  // --- Tête -------------------------------------------------------------
  // Une seule surface sculptée (voir `sculptedHead`) : proportions du crâne,
  // mâchoire resserrée, pommettes, orbites, arête du nez, lèvres, menton.
  const headForm = sculptedHead(skin, collect);
  head.add(headForm);



  // Ce qui reste rapporté, comme sur un vrai visage : le globe des yeux, les
  // paupières, les sourcils, les oreilles.
  for (const side of [-1, 1]) {
    const socketY = 0.014;
    const socketZ = -0.069;

    // Globe : un blanc ivoire, puis l'iris brun et la pupille. Avant, le
    // globe était peint en noir de cheveu et l'iris en couleur de peau : à
    // l'écran, cela faisait deux fentes sombres sous les sourcils — un loup,
    // pas un regard.
    // Un œil humain n'est pas une bille : le globe est enfoncé dans l'orbite,
    // et les paupières en couvrent le tiers supérieur et le sixième inférieur.
    // Un globe trop gros et trop sorti donne ce regard fixe de grenouille —
    // c'est ce qu'on obtenait en cherchant à « voir les yeux ».
    // Un œil humain mesure 24 mm de diamètre : 12 mm de rayon. Le globe était
    // à 9 mm, et l'iris à 6 — à l'écran, deux têtes d'épingle. On repasse aux
    // dimensions réelles, ce qui est aussi le seul moyen d'avoir un regard
    // lisible à trois mètres.
    const eyeball = ellipsoid(0.0118, 0.0112, 0.0104, sclera, collect);
    eyeball.position.set(side * 0.0298, socketY, socketZ + 0.0028);
    head.add(eyeball);

    // L'iris occupe presque toute la fente palpébrale : c'est ce qui
    // distingue un regard d'une bille. On le pose juste à la surface du globe.
    const iris = ellipsoid(0.0068, 0.007, 0.0034, irisMaterial, collect);
    iris.position.set(side * 0.0299, socketY - 0.0001, socketZ - 0.0066);
    head.add(iris);

    const pupil = ellipsoid(0.0032, 0.0033, 0.0018, hair, collect);
    pupil.position.set(side * 0.0299, socketY - 0.0002, socketZ - 0.008);
    head.add(pupil);

    // Un point de lumière sur le globe. Sans lui, l'œil est mat et le visage
    // paraît absent, même bien modélisé.
    const glint = ellipsoid(0.0012, 0.0012, 0.0008, sclera, collect);
    glint.position.set(side * 0.0322, socketY + 0.003, socketZ - 0.0076);
    head.add(glint);

    // Paupières : deux voiles de peau qui coupent le globe. C'est ce qui fait
    // qu'un œil regarde au lieu de briller.
    // Les paupières sont des **coques** sphériques centrées sur le globe :
    // une calotte haute et une calotte basse, chacune un peu plus grande que
    // l'œil. Leur bord découpe la fente en amande. Posées comme des boules
    // devant l'œil, elles fermaient le regard ; retournées, elles le
    // recouvraient entièrement. C'est la seule forme qui donne une paupière
    // sans modèle de paupière.
    const lidShell = (big: number, thetaStart: number, thetaLength: number) => {
      const geometry = new THREE.SphereGeometry(big, 30, 24, 0, Math.PI * 2, thetaStart, thetaLength);
      collect.geometries.push(geometry);
      return new THREE.Mesh(geometry, skin);
    };

    // Le bord haut tombe juste au-dessus du centre du globe, le bord bas un
    // peu plus bas : la fente fait quatre millimètres de haut pour un œil de
    // dix-sept — l'ouverture d'un regard au repos.
    const upperLid = lidShell(0.0136, 0, Math.PI * 0.44);
    upperLid.position.set(side * 0.0298, socketY, socketZ + 0.0028);
    upperLid.rotation.z = side * -0.06;
    head.add(upperLid);

    const lowerLid = lidShell(0.0132, Math.PI * 0.62, Math.PI * 0.38);
    lowerLid.position.set(side * 0.0298, socketY - 0.0006, socketZ + 0.0028);
    head.add(lowerLid);

    // Pli de la paupière : une ligne sombre, pas un volume.
    const lidCrease = ellipsoid(0.0112, 0.0014, 0.0034, skinShade, collect);
    lidCrease.position.set(side * 0.0298, socketY + 0.0078, socketZ - 0.0002);
    lidCrease.rotation.z = side * -0.16;
    head.add(lidCrease);

    // Sourcil : un arc de poils, fin, posé sur l'arcade.
    // Sourcil : deux segments plutôt qu'une barre — l'arcade a une queue
    // fine et une tête plus fournie. Un seul fuseau fait un trait de crayon.
    const browHead = ellipsoid(0.0135, 0.0042, 0.005, hair, collect);
    browHead.position.set(side * 0.0245, 0.0462, -0.0692);
    browHead.rotation.z = side * -0.12;
    head.add(browHead);
    const browTail = ellipsoid(0.0115, 0.003, 0.0042, hair, collect);
    browTail.position.set(side * 0.0438, 0.0498, -0.0658);
    browTail.rotation.z = side * -0.32;
    head.add(browTail);

    // Oreille : pavillon ovale, creusé, collé à la tempe.
    const ear = ellipsoid(0.0075, 0.0225, 0.0145, skin, collect);
    ear.position.set(side * 0.0725, 0.002, 0.012);
    ear.rotation.y = side * 0.28;
    head.add(ear);
    const earHollow = ellipsoid(0.003, 0.0125, 0.0065, skinShade, collect);
    earHollow.position.set(side * 0.0765, 0.0, 0.009);
    head.add(earHollow);

    // Favoris : deux touches sombres sous la casquette.
    const sideburn = ellipsoid(0.0048, 0.013, 0.0068, hair, collect);
    sideburn.position.set(side * 0.0645, 0.034, 0.008);
    head.add(sideburn);
  }

  // --- Casquette de brousse ---------------------------------------------
  // Elle se pose sur le crâne, pas sur les sourcils : le bord doit laisser
  // voir les yeux, sinon le visage n'a plus de regard du tout.
  const cap = loft(
    [
      { y: 0.082, rx: 0.0785, rz: 0.088, z: 0.012 },
      { y: 0.098, rx: 0.0805, rz: 0.0895, z: 0.012 },
      { y: 0.116, rx: 0.0795, rz: 0.088, z: 0.012 },
      { y: 0.134, rx: 0.0735, rz: 0.081, z: 0.012 },
      { y: 0.15, rx: 0.061, rz: 0.067, z: 0.012 },
      { y: 0.163, rx: 0.041, rz: 0.045, z: 0.012 },
      { y: 0.171, rx: 0.017, rz: 0.019, z: 0.012 },
    ],
    hat,
    collect,
    { radial: 26, power: 2.1, tile: 0.22 },
  );
  head.add(cap);

  // Bord : large devant, plus court derrière, qui s'affaisse — c'est ce tombé
  // qui distingue une casquette de brousse d'une soucoupe.
  const brim = loft(
    [
      { y: 0.088, rx: 0.083, rz: 0.093, z: 0.004 },
      { y: 0.082, rx: 0.096, rz: 0.108, z: -0.006 },
      { y: 0.075, rx: 0.101, rz: 0.114, z: -0.011 },
      { y: 0.07, rx: 0.089, rz: 0.1, z: -0.006 },
    ],
    hat,
    collect,
    { radial: 30, power: 2, tile: 0.22, smooth: 1 },
  );
  brim.rotation.x = 0.045;
  head.add(brim);

  // Galon : un ruban sombre au pied de la calotte. Sans lui, le chapeau est
  // une soucoupe ; avec, c'est un couvre-chef — et il tient la lumière au
  // niveau du regard, là où un visage a besoin d'une ligne pour se lire.
  const hatBand = loft(
    [
      { y: 0.092, rx: 0.0785, rz: 0.0875, z: 0.012 },
      { y: 0.099, rx: 0.0846, rz: 0.0936, z: 0.012 },
      { y: 0.11, rx: 0.0785, rz: 0.0875, z: 0.012 },
    ],
    webbing,
    collect,
    { radial: 26, tile: 0.2 },
  );
  head.add(hatBand);

  // --- Jambes -----------------------------------------------------------
  const thigh = { left: new THREE.Group(), right: new THREE.Group() };
  const knee = { left: new THREE.Group(), right: new THREE.Group() };
  const ankle = { left: new THREE.Group(), right: new THREE.Group() };

  for (const [key, sign] of [
    ["left", -1],
    ["right", 1],
  ] as const) {
    const hip = thigh[key];
    // Les cuisses se touchent presque à 9 cm du centre. Un homme debout a les
    // pieds écartés de la largeur du bassin : sans cet écart, le pantalon se
    // lit comme une seule jambe fendue.
    hip.position.set(sign * 0.096, -0.03, 0);
    hips.add(hip);

    // La cuisse part sous le bassin sans l'élargir : c'est l'erreur classique
    // — un haut de cuisse plus large que la hanche, et le pantalon devient une
    // couche. Elle s'affine vers le genou, qui reste la partie la plus étroite.
    const upperLeg = loft(
      [
        { y: 0.07, rx: 0.078, rz: 0.086 },
        { y: 0, rx: 0.086, rz: 0.094 },
        { y: -0.1, rx: 0.088, rz: 0.096 },
        { y: -0.2, rx: 0.08, rz: 0.088 },
        { y: -0.32, rx: 0.068, rz: 0.074 },
        { y: -0.4, rx: 0.059, rz: 0.064 },
        { y: -0.44, rx: 0.053, rz: 0.057 },
      ],
      trousers,
      collect,
      { radial: 22, power: 2.2, smooth: 1 },
    );
    hip.add(upperLeg);

    // Poche cargo : un volume plaqué sur la cuisse.
    const cargo = ellipsoid(0.038, 0.05, 0.02, trousersDark, collect);
    cargo.position.set(sign * 0.082, -0.2, -0.03);
    cargo.rotation.y = sign * 0.3;
    hip.add(cargo);

    const kneeJoint = knee[key];
    kneeJoint.position.y = -THIGH;
    hip.add(kneeJoint);

    const lowerLeg = loft(
      [
        { y: 0.035, rx: 0.054, rz: 0.058 },
        { y: -0.03, rx: 0.058, rz: 0.066 },
        { y: -0.09, rx: 0.059, rz: 0.072 },
        { y: -0.17, rx: 0.054, rz: 0.064 },
        { y: -0.26, rx: 0.045, rz: 0.051 },
        { y: -0.34, rx: 0.038, rz: 0.042 },
        { y: -0.405, rx: 0.034, rz: 0.038 },
      ],
      trousers,
      collect,
      { radial: 20, power: 2.2, smooth: 1 },
    );
    kneeJoint.add(lowerLeg);

    const ankleJoint = ankle[key];
    ankleJoint.position.y = -SHIN;
    kneeJoint.add(ankleJoint);

    // Guêtre serrée sur la chaussure.
    const gaiter = loft(
      [
        { y: 0.115, rx: 0.035, rz: 0.038 },
        { y: 0.1, rx: 0.049, rz: 0.053 },
        { y: 0.07, rx: 0.05, rz: 0.054 },
        { y: 0.035, rx: 0.053, rz: 0.058 },
        { y: 0.012, rx: 0.043, rz: 0.047 },
      ],
      trousersDark,
      collect,
      { radial: 18, smooth: 1 },
    );
    ankleJoint.add(gaiter);

    // Chaussure : tige, pied, bout, talon, semelle. Le pied est un volume
    // horizontal : on le compose de volumes ronds plutôt que d'une boîte.
    const shaft = loft(
      [
        { y: 0.05, rx: 0.049, rz: 0.052 },
        { y: -0.005, rx: 0.052, rz: 0.058 },
        { y: -0.03, rx: 0.055, rz: 0.07 },
      ],
      boots,
      collect,
      { radial: 16 },
    );
    ankleJoint.add(shaft);

    const footBody = ellipsoid(0.054, 0.042, 0.098, boots, collect);
    footBody.position.set(0, -0.032, -0.045);
    ankleJoint.add(footBody);

    const toe = ellipsoid(0.047, 0.03, 0.05, boots, collect);
    toe.position.set(0, -0.04, -0.132);
    ankleJoint.add(toe);

    const heel = ellipsoid(0.048, 0.032, 0.042, boots, collect);
    heel.position.set(0, -0.04, 0.038);
    ankleJoint.add(heel);

    const sole = ellipsoid(0.055, 0.015, 0.152, rubber, collect);
    sole.position.set(0, -0.06, -0.05);
    ankleJoint.add(sole);

    const lacePanel = ellipsoid(0.022, 0.025, 0.012, webbing, collect);
    lacePanel.position.set(0, -0.016, -0.078);
    lacePanel.rotation.x = 0.5;
    ankleJoint.add(lacePanel);
  }

  // Étui de cuisse et gaine : deux volumes qui cassent la ligne du pantalon.
  const holsterMaterial = leather(0x2a2018);
  holsterMaterial.name = "cuir";
  materials.push(holsterMaterial);
  const holster = ellipsoid(0.024, 0.062, 0.026, holsterMaterial, collect);
  holster.position.set(0.107, -0.2, 0.005);
  holster.rotation.z = 0.06;
  thigh.right.add(holster);
  const holsterStrap = ellipsoid(0.045, 0.012, 0.035, webbing, collect);
  holsterStrap.position.set(0.075, -0.15, 0.0);
  thigh.right.add(holsterStrap);

  const sheath = ellipsoid(0.021, 0.115, 0.017, holsterMaterial, collect);
  sheath.position.set(-0.102, -0.25, 0.02);
  sheath.rotation.z = 0.1;
  thigh.left.add(sheath);

  // Porte-arme : l'arme vit dans l'espace du corps, pas dans la main.
  const weaponHolder = new THREE.Group();
  group.add(weaponHolder);

  let flashTexture: THREE.Texture;
  if (typeof document === "undefined") {
    // Hors navigateur (contrôles et rendus de vérification) : une texture
    // blanche d'un pixel suffit, personne ne verra l'éclair.
    const pixel = new THREE.DataTexture(new Uint8Array([255, 246, 228, 255]), 1, 1);
    pixel.needsUpdate = true;
    flashTexture = pixel;
  } else {
    const flashCanvas = document.createElement("canvas");
    flashCanvas.width = 64;
    flashCanvas.height = 64;
    const context = flashCanvas.getContext("2d");
    if (context) {
      const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32);
      gradient.addColorStop(0, "rgba(255,246,218,1)");
      gradient.addColorStop(0.3, "rgba(255,198,96,0.9)");
      gradient.addColorStop(1, "rgba(255,150,40,0)");
      context.fillStyle = gradient;
      context.fillRect(0, 0, 64, 64);
    }
    flashTexture = new THREE.CanvasTexture(flashCanvas);
  }
  const flashMaterial = new THREE.SpriteMaterial({
    map: flashTexture,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const flash = new THREE.Sprite(flashMaterial);
  flash.scale.setScalar(0.3);
  flash.visible = false;
  weaponHolder.add(flash);

  const flashLight = new THREE.PointLight(0xffd9a0, 0, 6, 2);
  weaponHolder.add(flashLight);

  group.updateMatrixWorld(true);

  // ------------------------------------------------------------------
  // Patine
  // ------------------------------------------------------------------
  //
  // Chaque pièce est peinte en coordonnées du monde au repos : la crasse
  // monte du sol, les creux s'assombrissent, le grain casse l'aplat. Les
  // matières sont partagées entre plusieurs pièces — une seule chemise pour
  // le torse et les manches — donc c'est la géométrie qui porte la couleur,
  // pas la matière.
  //
  // On le fait ici, une fois le squelette en place et les matrices à jour :
  // peindre chaque pièce à sa construction obligerait à recalculer à la main
  // la position du coude ou du genou dans chaque repère local.
  // --- plis de tissu
  // On les applique avant la patine : la patine lit la position, et un pli
  // doit avoir sa propre ombre dans les creux qu'il vient de créer.
  //
  // L'ordre est important et rien ne l'impose : un pli appliqué après la
  // peinture aurait des sommets colorés pour une surface qui n'existe plus.
  group.updateMatrixWorld(true);
  group.traverse((node) => {
    const child = node as THREE.Mesh;
    if (!child.isMesh) return;
    const material = child.material as THREE.Material;
    if (material === skin || material === skinShade) return;
    if (material === sclera || material === irisMaterial || material === hair) return;
    if (material === metal) return;
    if (material === boots || material === holsterMaterial) return;
    // Les pièces rigides — poches, boucle, sangles — ne se plissent pas. Une
    // boîte gondolée se lit comme un défaut de modélisation, pas comme un
    // vêtement.
    if (child.geometry.type === "BoxGeometry") return;

    // À quelle partie du corps appartient cette pièce ? On le déduit de la
    // hauteur de son centre : c'est grossier, mais une pièce ne s'étend
    // jamais sur deux régions à la fois, et cela évite de découper le corps
    // en repères locaux qu'il faudrait tenir à jour.
    const bounds = new THREE.Box3().setFromObject(child);
    const centreY = (bounds.min.y + bounds.max.y) / 2;
    const height = bounds.max.y - bounds.min.y;
    const part: CreasePart =
      centreY > 1.25 && height < 0.22
        ? "bras"
        : centreY > 1.05 && height < 0.4
          ? "avant-bras"
          : centreY > 1.15
            ? "torse"
            : centreY > 0.72
              ? "cuisse"
              : "tibia";
    creaseGeometry(child.geometry, part, child.matrixWorld);
  });

  group.traverse((node) => {
    const child = node as THREE.Mesh;
    if (!child.isMesh) return;
    const material = child.material as THREE.Material;
    const kind: PaintKind =
      material === skin || material === skinShade || material === sclera || material === irisMaterial
        ? "peau"
        : material === boots || material === holsterMaterial
          ? "cuir"
          : material === metal
            ? "metal"
            : material === pack
              ? "toile"
              : "tissu";
    // Marque : ce maillage appartient au corps. L'arme, elle, est ajoutée
    // plus tard dans `weaponHolder` et ne reçoit pas de patine — elle est
    // déjà usée par sa propre matière. Les contrôles s'appuient sur ce
    // marqueur pour ne pas confondre les deux.
    child.userData.body = true;
    paintGeometry(child.geometry, kind, child.matrixWorld);
  });

  // Toutes les matières lisent la couleur par sommet. Elle multiplie l'albédo,
  // donc une pièce non peinte reste exactement ce qu'elle était.
  for (const material of materials) {
    const lit = material as THREE.MeshStandardMaterial;
    lit.vertexColors = true;
    lit.needsUpdate = true;
  }

  return {
    group,
    hips,
    spine,
    chest,
    neck: neckJoint,
    head,
    shoulder,
    elbow,
    wrist,
    thigh,
    knee,
    ankle,
    weaponHolder,
    weapon: null,
    flash,
    flashLight,
    materials,
    geometries: collect.geometries,
    gait: 0,
    clock: 0,
    aim: 0,
    recoil: 0,
    recoilVelocity: 0,
    slash: 0,
    slashDuration: 0.4,
    weaponId: null,
  };
}

// ---------------------------------------------------------------------------
// Arme
// ---------------------------------------------------------------------------

export { HUMAN_HOLD, type Hold } from "@/game/holds";

/**
 * Prise de l'arme par le corps.
 *
 * `grip` et `fore` sont les points que les mains doivent atteindre, dans
 * l'espace de l'arme. `aim` et `carry` sont la pose de l'arme dans l'espace du
 * corps. Ces nombres sont mesurés : `check-human` vérifie que les deux épaules
 * peuvent effectivement atteindre leurs points (0,57 m de portée).
 */

export function setHumanWeapon(rig: HumanRig, id: WeaponId): void {
  if (rig.weaponId === id && rig.weapon) return;
  if (rig.weapon) {
    rig.weaponHolder.remove(rig.weapon.group);
    disposeWeaponModel(rig.weapon);
    rig.weapon = null;
  }
  const model = createWeaponModel(id);
  model.group.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.castShadow = true;
      child.receiveShadow = false;
    }
  });
  rig.weaponHolder.add(model.group);
  rig.weapon = model;
  rig.weaponId = id;
}

// ---------------------------------------------------------------------------
// Cinématique
// ---------------------------------------------------------------------------

const scratch = {
  a: new THREE.Vector3(),
  b: new THREE.Vector3(),
  c: new THREE.Vector3(),
  dir: new THREE.Vector3(),
  pole: new THREE.Vector3(),
  upper: new THREE.Vector3(),
  elbow: new THREE.Vector3(),
  bend: new THREE.Vector3(),
  x: new THREE.Vector3(),
  y: new THREE.Vector3(),
  z: new THREE.Vector3(),
  matrix: new THREE.Matrix4(),
  quaternion: new THREE.Quaternion(),
  parent: new THREE.Quaternion(),
  walk: new THREE.Quaternion(),
  target: new THREE.Vector3(),
};

/**
 * Résout un bras à deux os : place l'épaule et le coude pour que le poignet
 * atteigne `target` (coordonnées monde).
 *
 * Analogue à un solveur IK à deux os classique. `pole` donne la direction dans
 * laquelle le coude doit pointer (vers l'extérieur, jamais à travers le torse).
 * Si la cible est hors de portée, le bras se tend sans dépasser.
 */
function solveArm(
  shoulder: THREE.Object3D,
  elbow: THREE.Object3D,
  target: THREE.Vector3,
  pole: THREE.Vector3,
  amount: number,
): void {
  if (!shoulder.parent) return;
  shoulder.updateWorldMatrix(true, false);
  const shoulderPos = scratch.a.setFromMatrixPosition(shoulder.matrixWorld);

  const toTarget = scratch.b.copy(target).sub(shoulderPos);
  const reach = THREE.MathUtils.clamp(toTarget.length(), 0.12, UPPER_ARM + FOREARM - 0.004);
  const dir = scratch.dir.copy(toTarget).normalize();

  // Angle entre le bras et la ligne épaule → cible (loi des cosinus).
  const cosAlpha = THREE.MathUtils.clamp(
    (UPPER_ARM * UPPER_ARM + reach * reach - FOREARM * FOREARM) / (2 * UPPER_ARM * reach),
    -1,
    1,
  );
  const alpha = Math.acos(cosAlpha);

  // Le coude part du côté du pôle, jamais dans le torse.
  const poleDir = scratch.pole.copy(pole).sub(shoulderPos);
  poleDir.addScaledVector(dir, -poleDir.dot(dir));
  if (poleDir.lengthSq() < 1e-6) poleDir.set(0, 0, -1);
  poleDir.normalize();

  const upperDir = scratch.upper
    .copy(dir)
    .multiplyScalar(Math.cos(alpha))
    .addScaledVector(poleDir, Math.sin(alpha))
    .normalize();

  const elbowPos = scratch.elbow.copy(shoulderPos).addScaledVector(upperDir, UPPER_ARM);

  // Direction de flexion : de la cible vers le coude, perpendiculaire au bras.
  const bend = scratch.bend.copy(target).sub(elbowPos);
  bend.addScaledVector(upperDir, -bend.dot(upperDir));
  if (bend.lengthSq() < 1e-6) bend.copy(poleDir);
  bend.normalize();

  // Base orthonormée : -Y de l'os vers l'épaule au poignet, -Z vers la flexion.
  const yAxis = scratch.y.copy(upperDir).negate();
  const zAxis = scratch.z.copy(bend).negate();
  const xAxis = scratch.x.crossVectors(yAxis, zAxis).normalize();
  zAxis.crossVectors(xAxis, yAxis).normalize();
  scratch.matrix.makeBasis(xAxis, yAxis, zAxis);
  scratch.quaternion.setFromRotationMatrix(scratch.matrix);

  // Quaternion de repos (balancement) pour le mélange.
  scratch.walk.copy(shoulder.quaternion);
  scratch.parent.setFromRotationMatrix(shoulder.parent.matrixWorld).invert();
  scratch.quaternion.premultiply(scratch.parent);
  scratch.walk.slerp(scratch.quaternion, amount);
  shoulder.quaternion.copy(scratch.walk);

  // Angle du coude : 0 bras tendu, π complètement plié.
  const cosInterior = THREE.MathUtils.clamp(
    (UPPER_ARM * UPPER_ARM + FOREARM * FOREARM - reach * reach) / (2 * UPPER_ARM * FOREARM),
    -1,
    1,
  );
  const bendAngle = Math.PI - Math.acos(cosInterior);
  elbow.rotation.set(elbow.rotation.x * (1 - amount) + bendAngle * amount, 0, 0);
}

/** Applique la pose de l'arme et renvoie les deux points de prise (monde). */
function placeWeapon(
  rig: HumanRig,
  aim: number,
  pitch: number,
  yawOffset: number,
  kick: number,
  slashPhase: number,
): { grip: THREE.Vector3 | null; fore: THREE.Vector3 | null; swing: number } {
  const model = rig.weapon;
  if (!model) return { grip: null, fore: null, swing: 0 };
  const hold = HUMAN_HOLD[model.id];

  const holder = rig.weaponHolder;
  const carry = hold.carry;
  const aimPos = hold.aim.position;

  holder.position.set(
    THREE.MathUtils.lerp(carry.position[0], aimPos[0], aim),
    THREE.MathUtils.lerp(carry.position[1], aimPos[1], aim),
    THREE.MathUtils.lerp(carry.position[2], aimPos[2], aim) + kick * 0.05,
  );
  holder.rotation.order = "YXZ";
  holder.rotation.set(
    THREE.MathUtils.lerp(carry.rotation[0], pitch, aim) + kick * 0.22,
    THREE.MathUtils.lerp(carry.rotation[1], hold.aim.yaw + yawOffset, aim),
    THREE.MathUtils.lerp(carry.rotation[2], hold.aim.roll ?? 0, aim),
  );
  // Le coup se **superpose** à la pose de repos : on mélange vers la pose de
  // frappe avec un poids qui monte et redescend, donc le bras repart de sa
  // position de repos sans à-coup.
  const strike = strikeAt(model.id, slashPhase);
  if (strike) {
    const k = strike.weight;
    holder.position.lerp(strike.pose.position, k);
    holder.rotation.x += (strike.pose.rotation.x - holder.rotation.x) * k;
    holder.rotation.y += (strike.pose.rotation.y - holder.rotation.y) * k;
    holder.rotation.z += (strike.pose.rotation.z - holder.rotation.z) * k;
  }
  holder.updateMatrixWorld(true);

  const grip = holder.localToWorld(new THREE.Vector3(...hold.grip));
  const fore = hold.fore
    ? holder.localToWorld(new THREE.Vector3(...hold.fore))
    : null;
  return { grip, fore, swing: 0 };
}

export function humanKick(rig: HumanRig, strength = 1): void {
  rig.recoilVelocity += 3.4 * strength;
  if (rig.weaponId === "pistolet" || rig.weaponId === "m16") {
    rig.flash.visible = true;
    rig.flash.scale.setScalar(rig.weaponId === "m16" ? 0.42 : 0.28);
    rig.flashLight.intensity = 6;
  }
  if (rig.weapon) rig.flash.position.copy(rig.weapon.muzzle);
}

/**
 * Le coup de lame : montée, frappe, retour.
 *
 * Ce n'est pas un détail d'animation. Sans geste, l'arme reste au repos et le
 * personnage encaisse une charge de potamochère sans lever le bras — on voyait
 * le sang partir, pas le coup. Le corps entier participe : l'épaule monte, le
 * torse tourne, les hanches contre-tournent, et la main libre part en
 * balancier.
 *
 * Trois temps, exprimés en fraction du coup (`p` de 0 à 1) :
 *
 *   · **l'armé** (0 → 0,18) : la lame monte au-dessus de l'épaule droite ;
 *   · **la frappe** (0,18 → 0,60) : elle balaie en diagonale vers le bas et la
 *     gauche, devant la poitrine ;
 *   · **le retour** (0,60 → 1) : le bras revient au repos.
 *
 * Les poses sont données en coordonnées du corps, comme `HUMAN_HOLD` : le
 * holdeur d'arme s'y place, et les deux mains suivent par IK. C'est pour cela
 * qu'il suffit de bouger le holdeur pour que les bras fassent le geste.
 */

interface StrikePose {
  /** Position du holdeur d'arme, en mètres depuis le sol. */
  position: THREE.Vector3;
  /** Rotation du holdeur (Euler YXZ) : 0 pointe devant, positif pointe en haut. */
  rotation: THREE.Vector3;
  /**
   * Rotation du **buste** autour de la verticale, en radians.
   *
   * Positive : le buste tourne vers la gauche, comme la frappe. Le signe a été
   * inversé une première fois : à l'armé, le buste s'ouvrait du côté opposé à
   * l'arme, ce qui donnait un corps qui se contredit. Il s'ouvre désormais du
   * côté de la lame, puis se referme en travers du coup.
   */
  twist: number;
}

/** Points de l'armé et de la frappe, par arme. */
const STRIKES: Record<string, { wind: StrikePose; cut: StrikePose }> = {
  // Machette et couteau : taille en diagonale, de l'épaule droite vers la
  // hanche gauche. C'est le coup que porte un défricheur, pas une estoc.
  couteau: {
    // Un couteau ne s'arme pas au-dessus de la tête : la garde monte à hauteur
    // de poitrine, lame retournée vers l'arrière, et le coup part de là.
    wind: {
      position: new THREE.Vector3(0.29, 1.3, 0.02),
      rotation: new THREE.Vector3(-1.15, -0.34, 0.3),
      twist: -0.28,
    },
    cut: {
      position: new THREE.Vector3(-0.02, 1.12, -0.4),
      rotation: new THREE.Vector3(0.35, 0.7, -0.5),
      twist: 0.56,
    },
  },
  machette: {
    // Plus lourde : l'armé monte plus haut et plus loin derrière, la frappe
    // descend plus bas.
    wind: {
      position: new THREE.Vector3(0.34, 1.46, 0.08),
      rotation: new THREE.Vector3(-1.3, -0.36, 0.38),
      twist: -0.34,
    },
    cut: {
      position: new THREE.Vector3(-0.06, 1.06, -0.44),
      rotation: new THREE.Vector3(0.45, 0.78, -0.55),
      twist: 0.68,
    },
  },
  // Lance : ce n'est pas une taille, c'est un estoc. On recule la hampe, puis
  // on pousse droit devant, à deux mains.
  lance: {
    // L'estoc ne tourne presque pas : il pousse. Un quart de radian d'ouverture
    // au recul, rien à l'extension.
    // La lance est modélisée pointe vers −Z. Un holdeur couché sur +π/2 la
    // redresse à la verticale : c'était une perche brandie, pas un estoc. Ces
    // deux poses-la gardent quasi horizontales, pointe devant.
    // Le recul de l'estoc est franc : la hampe part de 40 cm derrière la main
    // et va 85 cm devant. Un quart de mètre de poussée ne se voyait pas.
    wind: {
      position: new THREE.Vector3(0.26, 1.0, 0.42),
      rotation: new THREE.Vector3(-0.1, 0.18, 0.06),
      twist: -0.34,
    },
    cut: {
      position: new THREE.Vector3(0.08, 1.26, -0.6),
      rotation: new THREE.Vector3(0.06, 0.06, 0.02),
      twist: 0.2,
    },
  },
};

/**
 * Durée du coup, en secondes.
 *
 * Réglée par la vitesse de la main, pas par le réalisme cinématographique :
 * une machette qui frappe met environ un demi-seconde du début de l'armé à la
 * fin du retour, et à 60 images par seconde cela donne des pas de dix à
 * quinze centimètres — la vitesse réelle d'une lame. Plus court, la main
 * saute d'une image à l'autre.
 */
const SLASH_DURATION: Record<string, number> = {
  couteau: 0.56,
  machette: 0.66,
  lance: 0.72,
};

export function humanSlash(rig: HumanRig): void {
  rig.slash = 1;
  rig.slashDuration = SLASH_DURATION[rig.weaponId ?? ""] ?? 0.4;
}

/**
 * Pose du holdeur pendant le coup, ou `null` hors du coup.
 *
 * Le mélange se fait par un poids qui monte vite et redescend lentement : à
 * `p = 0` le poids est nul, donc le bras repart exactement de sa pose de repos
 * — sans ce garde-fou, la première image du coup ferait sauter le personnage.
 */
function strikeAt(id: WeaponId | null, p: number): { pose: StrikePose; weight: number } | null {
  const strike = id ? STRIKES[id] : undefined;
  if (!strike || p <= 0 || p >= 1) return null;

  // Montée et descente **longues**. Réglées sur 0,16 du geste, la main passait
  // de 0 à 57 % du chemin en deux images : un saut de 26 cm, qui se lit comme
  // une téléportation, pas comme un coup.
  const weight = THREE.MathUtils.smoothstep(p, 0, 0.26) * (1 - THREE.MathUtils.smoothstep(p, 0.8, 1));
  if (weight <= 0.001) return null;

  // Armé puis frappe. La courbe en puissance 0,55 donnait un départ si sec
  // qu'entre deux images à 60 Hz la main sautait de **30 cm** : à l'écran, ce
  // n'est pas un coup rapide, c'est une téléportation. 0,95 garde un léger
  // surcroît de vitesse en fin de course — la lame accélère — sans dépasser la
  // vitesse qu'un poignet peut réellement imprimer.
  const t = THREE.MathUtils.clamp((p - 0.26) / (0.72 - 0.26), 0, 1);
  const eased = Math.pow(THREE.MathUtils.smoothstep(t, 0, 1), 0.95);

  return {
    pose: {
      position: strike.wind.position.clone().lerp(strike.cut.position, eased),
      rotation: strike.wind.rotation.clone().lerp(strike.cut.rotation, eased),
      twist: THREE.MathUtils.lerp(strike.wind.twist, strike.cut.twist, eased),
    },
    weight,
  };
}

/** Anime le personnage. À appeler une fois par image. */
export function poseHuman(rig: HumanRig, pose: HumanPose): void {
  const dt = Math.min(0.05, pose.dt);
  rig.clock += dt;
  const time = rig.clock;
  rig.aim += ((pose.aiming ? 1 : 0) - rig.aim) * Math.min(1, dt * 10);

  // Recul : oscillateur amorti, comme la vue subjective.
  rig.recoilVelocity -= rig.recoil * 110 * dt;
  rig.recoilVelocity *= Math.exp(-11 * dt);
  rig.recoil += rig.recoilVelocity * dt;
  if (rig.slash > 0) rig.slash = Math.max(0, rig.slash - dt / Math.max(0.15, rig.slashDuration));

  const moving = pose.motion === "walk" || pose.motion === "run" || pose.motion === "sneak" || pose.motion === "swim";
  const cadence =
    pose.motion === "run" ? 9.6 : pose.motion === "sneak" ? 4.6 : pose.motion === "swim" ? 3.4 : 6.4;
  const amp = pose.motion === "run" ? 0.82 : pose.motion === "sneak" ? 0.26 : pose.motion === "swim" ? 0.22 : 0.46;
  if (moving) rig.gait += dt * cadence;
  const phase = rig.gait;
  const crouch = pose.motion === "sneak" ? 0.16 : pose.motion === "swim" ? 0.3 : 0;

  const breath = Math.sin(time * 1.35) * (moving ? 0.4 : 1);
  const lean =
    pose.motion === "run" ? 0.2 : pose.motion === "sneak" ? 0.34 : pose.motion === "walk" ? 0.05 : 0.02;

  // --- Le coup, en un seul endroit ---------------------------------------
  // Le torse, les hanches et le bras libre lisent la même courbe que le
  // holdeur : une seule source, sinon le bras part d'un côté et le buste de
  // l'autre.
  const strike = strikeAt(rig.weaponId, 1 - rig.slash);
  const strikeWeight = strike?.weight ?? 0;
  // Le torse tourne de la droite vers la gauche pendant la frappe. Les hanches
  // contre-tournent de moitié — c'est ce contre-mouvement qui distingue un
  // coup de tout le corps d'un mouvement de bras.
  const slashTwist = strike ? strike.pose.twist * strike.weight : 0;

  // --- Hanches ---------------------------------------------------------
  const bob = moving ? Math.abs(Math.cos(phase)) * 0.022 : 0;
  rig.hips.position.y = HUMAN_HIPS_Y - crouch - bob + breath * 0.003;
  rig.hips.rotation.set(
    0,
    (moving ? Math.sin(phase) * 0.06 : Math.sin(time * 0.4) * 0.02) - slashTwist * 0.45,
    (moving ? Math.sin(phase) * 0.025 : Math.sin(time * 0.55) * 0.015) + slashTwist * 0.08,
  );

  // --- Tronc -----------------------------------------------------------
  const aimTwist = THREE.MathUtils.clamp(pose.aimYaw, -0.95, 0.95);
  rig.spine.rotation.set(
    lean + breath * 0.006,
    THREE.MathUtils.lerp(moving ? -Math.sin(phase) * 0.1 : 0, aimTwist * 0.35, rig.aim),
    moving ? Math.sin(phase) * 0.02 : 0,
  );
  rig.chest.rotation.set(
    breath * 0.012 - rig.recoil * 0.05 + strikeWeight * 0.12,
    THREE.MathUtils.lerp(moving ? -Math.sin(phase) * 0.05 : 0, aimTwist * 0.6, rig.aim) -
      rig.aim * 0.3 +
      slashTwist,
    -rig.slash * 0.12 + slashTwist * 0.12,
  );

  // --- Tête ------------------------------------------------------------
  const headYaw = THREE.MathUtils.clamp(pose.aimYaw - aimTwist * 0.9, -0.7, 0.7);
  rig.neck.rotation.set(pose.aimPitch * 0.25, headYaw * 0.4, 0);
  rig.head.rotation.set(
    pose.aimPitch * 0.55 + Math.sin(time * 0.37) * 0.02 - strikeWeight * 0.06,
    headYaw * 0.6 + (moving ? 0 : Math.sin(time * 0.21) * 0.16) - slashTwist * 0.5,
    moving ? Math.sin(phase) * 0.02 : 0,
  );

  // --- Jambes ----------------------------------------------------------
  const swing = Math.sin(phase);
  const kneeL = -Math.max(0, Math.sin(phase - 1.15)) * amp * 2.0 - (moving ? 0.06 : 0.03);
  const kneeR = -Math.max(0, Math.sin(phase + Math.PI - 1.15)) * amp * 2.0 - (moving ? 0.06 : 0.03);

  rig.thigh.left.rotation.set(swing * amp + crouch * 0.55, 0, 0);
  rig.thigh.right.rotation.set(-swing * amp + crouch * 0.55, 0, 0);
  rig.knee.left.rotation.set(kneeL - crouch * 0.9, 0, 0);
  rig.knee.right.rotation.set(kneeR - crouch * 0.9, 0, 0);
  rig.ankle.left.rotation.set(-(rig.thigh.left.rotation.x + rig.knee.left.rotation.x) * 0.55, 0, 0);
  rig.ankle.right.rotation.set(-(rig.thigh.right.rotation.x + rig.knee.right.rotation.x) * 0.55, 0, 0);

  // --- Bras au repos (balancement) -------------------------------------
  const armSwing = amp * 0.85;
  rig.shoulder.left.rotation.set(-swing * armSwing - crouch * 0.2, 0, 0.055);
  rig.shoulder.right.rotation.set(swing * armSwing - crouch * 0.2, 0, -0.055);
  rig.elbow.left.rotation.set(-0.12 - Math.max(0, -swing) * amp * 0.6 - rig.aim * 0.2, 0, 0);
  rig.elbow.right.rotation.set(-0.28 - Math.max(0, swing) * amp * 0.5, 0, 0);

  // --- Arme et mains ---------------------------------------------------
  // Les matrices doivent être à jour : l'IK travaille en coordonnées monde.
  rig.group.updateMatrixWorld(true);
  const weapon = rig.weapon;
  if (weapon) {
    const kick = rig.recoil;
    const slashPhase = 1 - rig.slash;
    const { grip, fore } = placeWeapon(rig, rig.aim, pose.aimPitch, pose.aimYaw, kick, slashPhase);

    // La main droite tient toujours l'arme ; la gauche vient la soutenir.
    if (grip) {
      const pole = scratch.c.copy(grip).add(new THREE.Vector3(0.32, -0.5, 0.16));
      solveArm(rig.shoulder.right, rig.elbow.right, grip, pole, 0.6 + 0.4 * rig.aim);
    }
    if (fore) {
      const pole = scratch.c.copy(fore).add(new THREE.Vector3(-0.32, -0.5, 0.16));
      solveArm(rig.shoulder.left, rig.elbow.left, fore, pole, rig.aim);
    } else if (rig.aim > 0.02 || slashTwist > 0.06) {
      // Lame : la main libre part en balancier. En garde elle se lève devant la
      // poitrine ; pendant le coup elle s'ouvre vers l'arrière-gauche, ce qui
      // équilibre la rotation du buste au lieu de la contrarier.
      // La main libre ne s'ouvre qu'à la **frappe** : à l'armé elle reste près
      // du corps. La faire partir en même temps que la lame donnait un
      // personnage qui s'écarte les bras avant même de frapper.
      const spread = THREE.MathUtils.clamp(slashTwist / 0.6, 0, 1);
      const guard = rig.chest.localToWorld(
        new THREE.Vector3(-0.2 - spread * 0.16, 0.02, -0.34 + spread * 0.3),
      );
      const pole = scratch.c.copy(guard).add(new THREE.Vector3(-0.4, -0.2, 0.3));
      solveArm(rig.shoulder.left, rig.elbow.left, guard, pole, Math.max(rig.aim, spread));
    }
  }

  // Les mains suivent l'arme : on aligne le poignet sur l'axe du canon.
  rig.wrist.left.rotation.set(0, 0, 0);
  rig.wrist.right.rotation.set(0, 0, 0);

  // Éclair et lampe de bouche.
  if (rig.flash.visible) {
    rig.flashLight.position.copy(rig.flash.position);
    rig.flashLight.intensity = Math.max(0, rig.flashLight.intensity - dt * 40);
    if (rig.flashLight.intensity <= 0.01) {
      rig.flash.visible = false;
      rig.flashLight.intensity = 0;
    }
  }
}

export function disposeHumanRig(rig: HumanRig): void {
  if (rig.weapon) disposeWeaponModel(rig.weapon);
  rig.weapon = null;
  for (const geometry of rig.geometries) geometry.dispose();
  for (const material of rig.materials) {
    const physical = material as THREE.MeshStandardMaterial;
    for (const texture of [physical.map, physical.normalMap, physical.roughnessMap]) {
      texture?.dispose();
    }
    material.dispose();
  }
  rig.flash.material.map?.dispose();
  rig.flash.material.dispose();
  rig.group.removeFromParent();
}
