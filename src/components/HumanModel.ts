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

export const HUMAN_HIPS_Y = 0.95;
export const HUMAN_EYE_Y = 1.66;
const SHOULDER_Y = 0.2; // dans l'espace de la poitrine
const SHOULDER_X = 0.172;
const UPPER_ARM = 0.3;
const FOREARM = 0.27;
const THIGH = 0.44;
const SHIN = 0.405;

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

  // Rééchantillonnage par interpolation monotone des rayons : les sections
  // ajoutées ne créent pas de facettes, elles suivent la courbe existante.
  const dense: Ring[] = [];
  for (let i = 0; i < rings.length - 1; i++) {
    const a = rings[i];
    const b = rings[i + 1];
    dense.push(a);
    for (let k = 1; k <= subdiv; k++) {
      const t = k / (subdiv + 1);
      const ease = t * t * (3 - 2 * t);
      dense.push({
        y: a.y + (b.y - a.y) * t,
        rx: a.rx + (b.rx - a.rx) * ease,
        rz: a.rz + (b.rz - a.rz) * ease,
        x: (a.x ?? 0) + ((b.x ?? 0) - (a.x ?? 0)) * t,
        z: (a.z ?? 0) + ((b.z ?? 0) - (a.z ?? 0)) * ease,
      });
    }
  }
  dense.push(rings[rings.length - 1]);

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
  const rings: Ring[] = [
    { y: -0.104, rx: 0.03, rz: 0.033, z: -0.019 },
    { y: -0.098, rx: 0.037, rz: 0.041, z: -0.018 },
    { y: -0.088, rx: 0.045, rz: 0.05, z: -0.016 },
    { y: -0.074, rx: 0.052, rz: 0.058, z: -0.013 },
    { y: -0.058, rx: 0.056, rz: 0.063, z: -0.008 },
    { y: -0.04, rx: 0.062, rz: 0.07, z: -0.003 },
    { y: -0.02, rx: 0.067, rz: 0.076, z: 0.001 },
    { y: 0.0, rx: 0.0705, rz: 0.081, z: 0.005 },
    { y: 0.02, rx: 0.0725, rz: 0.084, z: 0.008 },
    { y: 0.04, rx: 0.0735, rz: 0.0855, z: 0.01 },
    { y: 0.06, rx: 0.073, rz: 0.0855, z: 0.011 },
    { y: 0.08, rx: 0.0705, rz: 0.0835, z: 0.012 },
    { y: 0.098, rx: 0.064, rz: 0.077, z: 0.012 },
    { y: 0.112, rx: 0.052, rz: 0.064, z: 0.012 },
    { y: 0.121, rx: 0.034, rz: 0.044, z: 0.012 },
    { y: 0.126, rx: 0.016, rz: 0.024, z: 0.012 },
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
      push(side * 0.03, 0.015, -0.068, 0.019, -0.0058);
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
      const ridge = gauss(x, 0.0102) * gauss(y + 0.004, 0.028);
      z -= ridge * 0.0072;
      const bridge = gauss(x, 0.0115) * gauss(y - 0.012, 0.018);
      z -= bridge * 0.004;
      // Pointe large et basse, posée sur des ailes écartées.
      const tip = gauss(Math.hypot(x * 1.05, (y + 0.034) * 1.3), 0.0165);
      z -= tip * 0.0082;
      // Narines : deux creux larges sous la pointe.
      for (const side of [-1, 1]) {
        z += gauss(Math.hypot((x - side * 0.0145) * 1.25, (y + 0.041) * 1.5), 0.0092) * 0.0038;
      }
    }

    // Bouche : un pli creux entre deux lèvres en relief. Il faut le marquer
    // franchement — une fente de deux dixièmes de millimètre ne se voit pas.
    if (z < -0.03) {
      // Lèvres pleines : le pli central reste net, mais les deux lèvres
      // avancent franchement. Une bouche plate sous un nez large, et le
      // visage perd son milieu.
      z += gauss(y + 0.0605, 0.0032) * gauss(x, 0.0235) * 0.0058;
      z -= gauss(y + 0.0565, 0.0062) * gauss(x, 0.0245) * 0.0052;
      z -= gauss(y + 0.0685, 0.0052) * gauss(x, 0.0225) * 0.0062;
      // Sillon sous la lèvre, puis menton qui avance.
      z += gauss(y + 0.080, 0.0044) * gauss(x, 0.015) * 0.0018;
      push(0, -0.09, -0.044, 0.018, 0.0055);
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
  const shirt = cloth(0x565e3e, 0.94, surface("shirt"));
  const shirtDark = cloth(0x3c4330, 0.95);
  const trousers = cloth(0x4a4f3a, 0.96, surface("trousers"));
  const trousersDark = cloth(0x373c2d, 0.97);
  const boots = leather(0x30241b, surface("leather"));
  const rubber = new THREE.MeshStandardMaterial({ color: 0x14110d, roughness: 0.97 });
  const webbing = cloth(0x5c5e46, 0.9, surface("webbing"));
  const pack = cloth(0x46442f, 0.92);
  const hat = cloth(0x6d6849, 0.95);
  const hair = cloth(0x120f0b, 0.98);
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
  ];

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
      { y: -0.13, rx: 0.104, rz: 0.082 },
      { y: -0.07, rx: 0.128, rz: 0.094 },
      { y: -0.01, rx: 0.14, rz: 0.1 },
      { y: 0.05, rx: 0.141, rz: 0.102 },
      { y: 0.1, rx: 0.133, rz: 0.098 },
    ],
    trousers,
    collect,
    { radial: 22, power: 2.4 },
  );
  hips.add(pelvis);

  const belt = loft(
    [
      { y: 0.02, rx: 0.146, rz: 0.106 },
      { y: 0.035, rx: 0.15, rz: 0.109 },
      { y: 0.055, rx: 0.146, rz: 0.106 },
    ],
    webbing,
    collect,
    { radial: 22, power: 2.4 },
  );
  hips.add(belt);

  const buckle = ellipsoid(0.026, 0.02, 0.012, metal, collect);
  buckle.position.set(0, 0.038, -0.108);
  hips.add(buckle);

  // Deux poches de ceinture : la silhouette d'un homme équipé, pas d'un
  // soldat de plomb.
  for (const side of [-1, 1]) {
    const pouch = ellipsoid(0.045, 0.055, 0.035, webbing, collect);
    pouch.position.set(side * 0.125, 0.01, 0.028);
    pouch.rotation.z = side * 0.12;
    hips.add(pouch);
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
      { y: -0.2, rx: 0.121, rz: 0.088 },
      { y: -0.14, rx: 0.126, rz: 0.09 },
      { y: -0.06, rx: 0.129, rz: 0.093 },
      { y: 0.02, rx: 0.132, rz: 0.095, z: -0.002 },
      { y: 0.1, rx: 0.144, rz: 0.102, z: -0.004 },
      { y: 0.18, rx: 0.152, rz: 0.107, z: -0.004 },
      { y: 0.25, rx: 0.158, rz: 0.109, z: -0.002 },
      { y: 0.31, rx: 0.152, rz: 0.104 },
      { y: 0.37, rx: 0.132, rz: 0.095 },
      { y: 0.42, rx: 0.098, rz: 0.08 },
      { y: 0.45, rx: 0.066, rz: 0.064 },
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
    const pocket = mesh(new THREE.BoxGeometry(0.074, 0.072, 0.016), shirtDark, collect);
    pocket.position.set(side * 0.068, 0.157, -0.104);
    pocket.rotation.set(0.04, side * -0.22, 0);
    spine.add(pocket);

    const flap = mesh(new THREE.BoxGeometry(0.076, 0.02, 0.019), webbing, collect);
    flap.position.set(side * 0.068, 0.188, -0.104);
    flap.rotation.set(0.04, side * -0.22, 0);
    spine.add(flap);

    // Sangle d'épaule du sac : elle passe sur le haut de l'épaule, pas sur
    // le devant de la chemise. Deux bandes verticales sur la poitrine
    // ressemblaient à des bretelles de salopette.
    const strap = ellipsoid(0.017, 0.07, 0.014, webbing, collect);
    strap.position.set(side * 0.062, 0.355, 0.01);
    strap.rotation.x = 0.55;
    spine.add(strap);
  }

  const radio = ellipsoid(0.032, 0.052, 0.022, pack, collect);
  radio.position.set(-0.078, 0.32, -0.098);
  spine.add(radio);
  const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.0025, 0.22, 6), metal);
  collect.geometries.push(antenna.geometry);
  antenna.position.set(-0.108, 0.43, -0.09);
  antenna.rotation.z = 0.16;
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

    // Aisselle : un volume court qui bouche l'angle entre le bras et le
    // torse. Sans lui, on voit le fond du décor entre le bras et le flanc.
    const armpit = ellipsoid(0.05, 0.075, 0.062, shirt, collect);
    armpit.position.set(sign * 0.012, -0.03, 0);
    armpit.rotation.z = sign * 0.16;
    joint.add(armpit);

    // Deltoïde : une masse ronde posée sur l'épaule, pas une bille.
    const deltoid = ellipsoid(0.041, 0.052, 0.05, shirt, collect);
    deltoid.position.set(sign * -0.004, -0.032, 0);
    deltoid.rotation.z = sign * 0.3;
    joint.add(deltoid);

    // Bras : biceps, creux du coude, avant-bras qui regrossit puis s'affine.
    const upper = loft(
      [
        { y: 0.0, rx: 0.045, rz: 0.048 },
        { y: -0.05, rx: 0.05, rz: 0.054 },
        { y: -0.1, rx: 0.052, rz: 0.056 },
        { y: -0.17, rx: 0.047, rz: 0.05 },
        { y: -0.24, rx: 0.042, rz: 0.044 },
        { y: -0.3, rx: 0.039, rz: 0.041 },
      ],
      shirt,
      collect,
      { radial: 18, power: 2.2 },
    );
    joint.add(upper);

    // Manchette roulée au-dessus du coude.
    const cuff = loft(
      [
        { y: -0.24, rx: 0.046, rz: 0.048 },
        { y: -0.265, rx: 0.048, rz: 0.05 },
        { y: -0.3, rx: 0.044, rz: 0.046 },
      ],
      shirtDark,
      collect,
      { radial: 18 },
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

  const neck = loft(
    [
      { y: -0.02, rx: 0.056, rz: 0.058 },
      { y: 0.03, rx: 0.05, rz: 0.052 },
      { y: 0.08, rx: 0.049, rz: 0.05 },
      { y: 0.1, rx: 0.053, rz: 0.055 },
    ],
    skin,
    collect,
    { radial: 16 },
  );
  neckJoint.add(neck);

  const head = new THREE.Group();
  head.position.y = 0.1;
  neckJoint.add(head);

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

    const eyeball = ellipsoid(0.0122, 0.011, 0.0105, hair, collect);
    eyeball.position.set(side * 0.0295, socketY, socketZ);
    head.add(eyeball);

    const iris = ellipsoid(0.0044, 0.0048, 0.0035, skin, collect);
    iris.position.set(side * 0.0305, socketY - 0.0005, socketZ - 0.0092);
    head.add(iris);

    // Paupières : deux voiles de peau qui coupent le globe. C'est ce qui fait
    // qu'un œil regarde au lieu de briller.
    const upperLid = ellipsoid(0.0145, 0.0075, 0.0118, skin, collect);
    upperLid.position.set(side * 0.0295, socketY + 0.0072, socketZ + 0.0018);
    upperLid.rotation.z = side * -0.14;
    head.add(upperLid);

    const lowerLid = ellipsoid(0.0135, 0.0048, 0.0112, skin, collect);
    lowerLid.position.set(side * 0.0295, socketY - 0.0078, socketZ + 0.002);
    head.add(lowerLid);

    // Sourcil : un arc de poils, fin, posé sur l'arcade.
    const eyebrow = ellipsoid(0.0185, 0.003, 0.0048, hair, collect);
    eyebrow.position.set(side * 0.0295, 0.0448, -0.0685);
    eyebrow.rotation.z = side * -0.17;
    head.add(eyebrow);

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
      { y: 0.086, rx: 0.093, rz: 0.104, z: -0.008 },
      { y: 0.08, rx: 0.108, rz: 0.121, z: -0.013 },
      { y: 0.074, rx: 0.115, rz: 0.13, z: -0.016 },
      { y: 0.07, rx: 0.11, rz: 0.124, z: -0.017 },
    ],
    hat,
    collect,
    { radial: 28, power: 2, tile: 0.22 },
  );
  brim.rotation.x = 0.05;
  head.add(brim);

  // --- Jambes -----------------------------------------------------------
  const thigh = { left: new THREE.Group(), right: new THREE.Group() };
  const knee = { left: new THREE.Group(), right: new THREE.Group() };
  const ankle = { left: new THREE.Group(), right: new THREE.Group() };

  for (const [key, sign] of [
    ["left", -1],
    ["right", 1],
  ] as const) {
    const hip = thigh[key];
    hip.position.set(sign * 0.095, -0.03, 0);
    hips.add(hip);

    const upperLeg = loft(
      [
        { y: 0.07, rx: 0.092, rz: 0.1 },
        { y: 0, rx: 0.1, rz: 0.108 },
        { y: -0.1, rx: 0.095, rz: 0.101 },
        { y: -0.2, rx: 0.086, rz: 0.092 },
        { y: -0.32, rx: 0.073, rz: 0.078 },
        { y: -0.4, rx: 0.064, rz: 0.068 },
        { y: -0.44, rx: 0.057, rz: 0.06 },
      ],
      trousers,
      collect,
      { radial: 20, power: 2.2 },
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
        { y: 0.03, rx: 0.062, rz: 0.066 },
        { y: -0.06, rx: 0.067, rz: 0.077 },
        { y: -0.14, rx: 0.061, rz: 0.07 },
        { y: -0.24, rx: 0.049, rz: 0.054 },
        { y: -0.34, rx: 0.039, rz: 0.042 },
        { y: -0.405, rx: 0.034, rz: 0.038 },
      ],
      trousers,
      collect,
      { radial: 18, power: 2.2 },
    );
    kneeJoint.add(lowerLeg);

    const ankleJoint = ankle[key];
    ankleJoint.position.y = -SHIN;
    kneeJoint.add(ankleJoint);

    // Guêtre serrée sur la chaussure.
    const gaiter = loft(
      [
        { y: 0.11, rx: 0.05, rz: 0.054 },
        { y: 0.07, rx: 0.048, rz: 0.052 },
        { y: 0.02, rx: 0.051, rz: 0.056 },
      ],
      trousersDark,
      collect,
      { radial: 16 },
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
): { grip: THREE.Vector3 | null; fore: THREE.Vector3 | null } {
  const model = rig.weapon;
  if (!model) return { grip: null, fore: null };
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
  holder.updateMatrixWorld(true);

  const grip = holder.localToWorld(new THREE.Vector3(...hold.grip));
  const fore = hold.fore
    ? holder.localToWorld(new THREE.Vector3(...hold.fore))
    : null;
  return { grip, fore };
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

export function humanSlash(rig: HumanRig): void {
  rig.slash = 1;
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
  if (rig.slash > 0) rig.slash = Math.max(0, rig.slash - dt * 4);

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

  // --- Hanches ---------------------------------------------------------
  const bob = moving ? Math.abs(Math.cos(phase)) * 0.022 : 0;
  rig.hips.position.y = HUMAN_HIPS_Y - crouch - bob + breath * 0.003;
  rig.hips.rotation.set(
    0,
    moving ? Math.sin(phase) * 0.06 : Math.sin(time * 0.4) * 0.02,
    moving ? Math.sin(phase) * 0.025 : Math.sin(time * 0.55) * 0.015,
  );

  // --- Tronc -----------------------------------------------------------
  const aimTwist = THREE.MathUtils.clamp(pose.aimYaw, -0.95, 0.95);
  rig.spine.rotation.set(
    lean + breath * 0.006,
    THREE.MathUtils.lerp(moving ? -Math.sin(phase) * 0.1 : 0, aimTwist * 0.35, rig.aim),
    moving ? Math.sin(phase) * 0.02 : 0,
  );
  rig.chest.rotation.set(
    breath * 0.012 - rig.recoil * 0.05,
    THREE.MathUtils.lerp(moving ? -Math.sin(phase) * 0.05 : 0, aimTwist * 0.6, rig.aim) -
      rig.aim * 0.3,
    -rig.slash * 0.18,
  );

  // --- Tête ------------------------------------------------------------
  const headYaw = THREE.MathUtils.clamp(pose.aimYaw - aimTwist * 0.9, -0.7, 0.7);
  rig.neck.rotation.set(pose.aimPitch * 0.25, headYaw * 0.4, 0);
  rig.head.rotation.set(
    pose.aimPitch * 0.55 + Math.sin(time * 0.37) * 0.02,
    headYaw * 0.6 + (moving ? 0 : Math.sin(time * 0.21) * 0.16),
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
    const { grip, fore } = placeWeapon(rig, rig.aim, pose.aimPitch, pose.aimYaw, kick);

    // La main droite tient toujours l'arme ; la gauche vient la soutenir.
    if (grip) {
      const pole = scratch.c.copy(grip).add(new THREE.Vector3(0.32, -0.5, 0.16));
      solveArm(rig.shoulder.right, rig.elbow.right, grip, pole, 0.6 + 0.4 * rig.aim);
    }
    if (fore) {
      const pole = scratch.c.copy(fore).add(new THREE.Vector3(-0.32, -0.5, 0.16));
      solveArm(rig.shoulder.left, rig.elbow.left, fore, pole, rig.aim);
    } else if (rig.aim > 0.02) {
      // Lame : la main libre se lève en garde devant la poitrine.
      const guard = rig.chest.localToWorld(new THREE.Vector3(-0.2, 0.02, -0.34));
      const pole = scratch.c.copy(guard).add(new THREE.Vector3(-0.4, -0.2, 0.3));
      solveArm(rig.shoulder.left, rig.elbow.left, guard, pole, rig.aim);
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
