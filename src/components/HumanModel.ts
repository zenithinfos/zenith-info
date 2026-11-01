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
import { type WeaponId } from "@/game/hunting";
import { createWeaponModel, disposeWeaponModel, type WeaponModel } from "./WeaponModels";

export const HUMAN_HIPS_Y = 0.95;
export const HUMAN_EYE_Y = 1.66;
const SHOULDER_Y = 0.2; // dans l'espace de la poitrine
const SHOULDER_X = 0.195;
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
  hips: THREE.Group;
  spine: THREE.Group;
  chest: THREE.Group;
  neck: THREE.Group;
  head: THREE.Group;
  shoulder: { left: THREE.Group; right: THREE.Group };
  elbow: { left: THREE.Group; right: THREE.Group };
  wrist: { left: THREE.Group; right: THREE.Group };
  thigh: { left: THREE.Group; right: THREE.Group };
  knee: { left: THREE.Group; right: THREE.Group };
  ankle: { left: THREE.Group; right: THREE.Group };
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

function cloth(colour: number, roughness = 0.94): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: colour, roughness, metalness: 0 });
}

function leather(colour: number): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    color: colour,
    roughness: 0.55,
    metalness: 0.04,
    clearcoat: 0.25,
    clearcoatRoughness: 0.5,
  });
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

/** Un membre : pivot au joint, capsule qui pend vers le bas. */
function limb(
  radius: number,
  length: number,
  material: THREE.Material,
  collect: { geometries: THREE.BufferGeometry[] },
): THREE.Mesh {
  const geometry = new THREE.CapsuleGeometry(radius, Math.max(0.01, length - radius * 2), 4, 10);
  const created = mesh(geometry, material, collect);
  created.position.y = -length / 2;
  return created;
}

export function createHumanRig(): HumanRig {
  const collect = { geometries: [] as THREE.BufferGeometry[] };
  const skin = new THREE.MeshPhysicalMaterial({
    color: 0x5b3a28,
    roughness: 0.62,
    metalness: 0,
    sheen: 0.3,
    sheenColor: new THREE.Color(0xffcaa8),
    clearcoat: 0.08,
  });
  const shirt = cloth(0x4f5639);
  const trousers = cloth(0x454a37, 0.96);
  const boots = leather(0x241b13);
  const webbing = cloth(0x565b3f, 0.9);
  const pack = cloth(0x46442f, 0.92);
  const hat = cloth(0x6d6849, 0.95);
  const hair = cloth(0x120f0b, 0.98);
  const materials = [skin, shirt, trousers, boots, webbing, pack, hat, hair];

  const group = new THREE.Group();
  group.name = "joueur";
  group.rotation.order = "YXZ";

  // Hanches : la racine du corps.
  const hips = new THREE.Group();
  hips.position.y = HUMAN_HIPS_Y;
  group.add(hips);

  const pelvis = mesh(new THREE.CapsuleGeometry(0.132, 0.05, 4, 12), trousers, collect);
  pelvis.scale.set(1, 1, 0.76);
  pelvis.position.y = -0.02;
  hips.add(pelvis);

  const belt = mesh(new THREE.CylinderGeometry(0.136, 0.14, 0.05, 14, 1, true), webbing, collect);
  belt.scale.set(1, 1, 0.78);
  belt.position.y = 0.035;
  hips.add(belt);

  const spine = new THREE.Group();
  spine.position.y = 0.09;
  hips.add(spine);

  const chest = new THREE.Group();
  chest.position.y = 0.2;
  spine.add(chest);

  // Deux volumes plutôt qu'un cylindre : une taille qui se resserre, une
  // poitrine plus large. Un seul tonneau donnait un bonhomme de bois.
  const abdomen = mesh(new THREE.CapsuleGeometry(0.146, 0.1, 4, 14), shirt, collect);
  abdomen.scale.set(1, 1, 0.74);
  abdomen.position.y = -0.01;
  chest.add(abdomen);

  const ribcage = mesh(new THREE.CapsuleGeometry(0.16, 0.1, 4, 14), shirt, collect);
  ribcage.scale.set(1.02, 1, 0.76);
  ribcage.position.y = 0.12;
  chest.add(ribcage);

  // Trapèzes : la pente du cou vers les épaules, ce qui manque toujours aux
  // personnages faits de cylindres.
  for (const side of [-1, 1]) {
    const trap = mesh(new THREE.CapsuleGeometry(0.055, 0.1, 3, 8), shirt, collect);
    trap.rotation.z = side * 1.15;
    trap.position.set(side * 0.09, 0.235, 0.005);
    chest.add(trap);
  }

  // Gilet de terrain : deux poches plates, deux sangles.
  const vest = mesh(new THREE.CapsuleGeometry(0.167, 0.03, 4, 14), webbing, collect);
  vest.scale.set(1, 1, 0.77);
  vest.position.y = 0.125;
  chest.add(vest);

  for (const side of [-1, 1]) {
    const pocket = mesh(new THREE.BoxGeometry(0.055, 0.06, 0.016), pack, collect);
    pocket.position.set(side * 0.066, 0.14, -0.132);
    pocket.rotation.x = 0.08;
    chest.add(pocket);

    const strap = mesh(new THREE.BoxGeometry(0.03, 0.26, 0.014), pack, collect);
    strap.position.set(side * 0.086, 0.11, -0.133);
    strap.rotation.x = 0.06;
    chest.add(strap);
  }

  const packGeometry = new THREE.BoxGeometry(0.235, 0.26, 0.135);
  const backpack = mesh(packGeometry, pack, collect);
  backpack.position.set(0, 0.1, 0.165);
  backpack.rotation.x = -0.06;
  chest.add(backpack);

  const bedroll = mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.25, 10), pack, collect);
  bedroll.rotation.z = Math.PI / 2;
  bedroll.position.set(0, -0.03, 0.175);
  chest.add(bedroll);

  // Épaules.
  const shoulder = { left: new THREE.Group(), right: new THREE.Group() };
  const elbow = { left: new THREE.Group(), right: new THREE.Group() };
  const wrist = { left: new THREE.Group(), right: new THREE.Group() };

  for (const [key, sign] of [["left", -1], ["right", 1]] as const) {
    const joint = shoulder[key];
    joint.position.set(sign * SHOULDER_X, SHOULDER_Y, 0);
    chest.add(joint);

    const deltoid = mesh(new THREE.SphereGeometry(0.066, 12, 10), shirt, collect);
    deltoid.scale.set(1, 1.05, 0.95);
    joint.add(deltoid);

    const upper = limb(0.053, UPPER_ARM, shirt, collect);
    upper.position.y = -UPPER_ARM / 2;
    joint.add(upper);

    const pivot = elbow[key];
    pivot.position.y = -UPPER_ARM;
    joint.add(pivot);

    const lower = limb(0.043, FOREARM, skin, collect);
    lower.position.y = -FOREARM / 2;
    pivot.add(lower);

    const wristJoint = wrist[key];
    wristJoint.position.y = -FOREARM;
    pivot.add(wristJoint);

    const hand = mesh(new THREE.BoxGeometry(0.062, 0.095, 0.042), skin, collect);
    hand.position.set(0, -0.045, -0.008);
    wristJoint.add(hand);

    // Pouce et doigts fermés : le poing doit lire comme une main, pas un cube.
    const thumb = mesh(new THREE.CapsuleGeometry(0.011, 0.035, 3, 6), skin, collect);
    thumb.position.set(sign * 0.03, -0.045, -0.03);
    thumb.rotation.z = sign * 0.9;
    wristJoint.add(thumb);

    for (let i = 0; i < 4; i++) {
      const finger = mesh(new THREE.CapsuleGeometry(0.009, 0.03, 3, 6), skin, collect);
      finger.rotation.x = Math.PI / 2;
      finger.position.set(-sign * 0.015, -0.07 + i * 0.017, -0.035);
      wristJoint.add(finger);
    }
  }

  // Cou et tête.
  const neckJoint = new THREE.Group();
  neckJoint.position.y = 0.26;
  chest.add(neckJoint);

  const neck = mesh(new THREE.CylinderGeometry(0.052, 0.058, 0.09, 10), skin, collect);
  neck.position.y = 0.03;
  neckJoint.add(neck);

  const head = new THREE.Group();
  head.position.y = 0.1;
  neckJoint.add(head);

  const skullGeometry = new THREE.SphereGeometry(0.098, 16, 14);
  const skull = mesh(skullGeometry, skin, collect);
  skull.scale.set(1, 1.14, 1.02);
  skull.position.y = 0.02;
  head.add(skull);

  const jaw = mesh(new THREE.BoxGeometry(0.105, 0.085, 0.12), skin, collect);
  jaw.position.set(0, -0.035, -0.022);
  head.add(jaw);

  const nose = mesh(new THREE.ConeGeometry(0.019, 0.042, 6), skin, collect);
  nose.rotation.x = -Math.PI / 2.2;
  nose.position.set(0, -0.005, -0.098);
  head.add(nose);

  for (const side of [-1, 1]) {
    const ear = mesh(new THREE.SphereGeometry(0.022, 8, 6), skin, collect);
    ear.scale.set(0.55, 1, 0.8);
    ear.position.set(side * 0.098, 0.005, 0.005);
    head.add(ear);

    const eye = mesh(new THREE.SphereGeometry(0.013, 8, 6), hair, collect);
    eye.position.set(side * 0.038, 0.022, -0.088);
    head.add(eye);
  }

  const brow = mesh(new THREE.BoxGeometry(0.13, 0.018, 0.03), skin, collect);
  brow.position.set(0, 0.048, -0.088);
  head.add(brow);

  // Casquette de brousse : calotte + large bord, la silhouette qui distingue
  // un humain d'un pantin à 30 m sous la futaie.
  const capGeometry = new THREE.SphereGeometry(0.104, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2);
  const cap = mesh(capGeometry, hat, collect);
  cap.position.y = 0.045;
  cap.scale.set(1.02, 0.95, 1.04);
  head.add(cap);

  const brim = mesh(new THREE.CylinderGeometry(0.175, 0.185, 0.012, 18), hat, collect);
  brim.position.y = 0.042;
  head.add(brim);

  const band = mesh(new THREE.CylinderGeometry(0.106, 0.106, 0.022, 14, 1, true), pack, collect);
  band.position.y = 0.07;
  head.add(band);

  // Jambes.
  const thigh = { left: new THREE.Group(), right: new THREE.Group() };
  const knee = { left: new THREE.Group(), right: new THREE.Group() };
  const ankle = { left: new THREE.Group(), right: new THREE.Group() };

  for (const [key, sign] of [["left", -1], ["right", 1]] as const) {
    const hip = thigh[key];
    hip.position.set(sign * 0.095, -0.03, 0);
    hips.add(hip);

    const upperLeg = limb(0.082, THIGH, trousers, collect);
    upperLeg.position.y = -THIGH / 2;
    hip.add(upperLeg);

    const kneeJoint = knee[key];
    kneeJoint.position.y = -THIGH;
    hip.add(kneeJoint);

    const lowerLeg = limb(0.057, SHIN, trousers, collect);
    lowerLeg.position.y = -SHIN / 2;
    kneeJoint.add(lowerLeg);

    const ankleJoint = ankle[key];
    ankleJoint.position.y = -SHIN;
    kneeJoint.add(ankleJoint);

    const boot = mesh(new THREE.BoxGeometry(0.105, 0.085, 0.26), boots, collect);
    boot.position.set(0, -0.045, -0.045);
    ankleJoint.add(boot);

    const sole = mesh(new THREE.BoxGeometry(0.112, 0.024, 0.272), boots, collect);
    sole.position.set(0, -0.088, -0.045);
    ankleJoint.add(sole);

    const laces = mesh(new THREE.BoxGeometry(0.06, 0.05, 0.04), pack, collect);
    laces.position.set(0, -0.02, -0.14);
    ankleJoint.add(laces);

    // Pantalon resserré sur la botte : sans cela la jambe s'arrête net dans
    // la chaussure et le personnage a des jambes de mannequin.
    const blouse = mesh(new THREE.CylinderGeometry(0.072, 0.062, 0.13, 12), trousers, collect);
    blouse.position.set(0, 0.06, 0);
    ankleJoint.add(blouse);
  }

  // Étui de cuisse et gaine : deux volumes qui cassent la ligne du pantalon.
  const holster = mesh(new THREE.BoxGeometry(0.05, 0.125, 0.048), boots, collect);
  holster.position.set(0.105, -0.2, 0.005);
  thigh.right.add(holster);
  const holsterStrap = mesh(new THREE.BoxGeometry(0.085, 0.026, 0.07), webbing, collect);
  holsterStrap.position.set(0.07, -0.15, 0.0);
  thigh.right.add(holsterStrap);

  const sheath = mesh(new THREE.BoxGeometry(0.042, 0.23, 0.033), boots, collect);
  sheath.position.set(-0.1, -0.25, 0.02);
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

/**
 * Prise de l'arme par le corps.
 *
 * `grip` et `fore` sont les points que les mains doivent atteindre, dans
 * l'espace de l'arme. `aim` et `carry` sont la pose de l'arme dans l'espace du
 * corps. Ces nombres sont mesurés : `check-human` vérifie que les deux épaules
 * peuvent effectivement atteindre leurs points (0,57 m de portée).
 */
export interface Hold {
  grip: [number, number, number];
  fore: [number, number, number] | null;
  aim: { position: [number, number, number]; yaw: number; roll?: number };
  carry: { position: [number, number, number]; rotation: [number, number, number] };
}

export const HUMAN_HOLD: Record<WeaponId, Hold> = {
  pistolet: {
    grip: [0, -0.045, 0.03],
    fore: [-0.035, -0.05, 0.012],
    aim: { position: [0.055, 1.335, -0.44], yaw: 0 },
    carry: { position: [0.235, 1.0, 0.02], rotation: [-1.44, 0.16, 0.08] },
  },
  m16: {
    grip: [0, -0.05, 0.03],
    fore: [0, 0, -0.18],
    aim: { position: [0.16, 1.325, -0.28], yaw: -0.1 },
    carry: { position: [0.255, 1.02, 0.02], rotation: [-1.46, 0.14, 0.06] },
  },
  couteau: {
    grip: [0, -0.02, 0.03],
    fore: null,
    aim: { position: [0.24, 1.28, -0.34], yaw: 0.12, roll: 0.3 },
    carry: { position: [0.24, 1.04, 0.0], rotation: [-1.5, 0.18, 0.08] },
  },
  machette: {
    grip: [0, -0.02, 0.03],
    fore: null,
    aim: { position: [0.24, 1.3, -0.34], yaw: 0.12, roll: 0.3 },
    carry: { position: [0.24, 1.04, 0.0], rotation: [-1.5, 0.18, 0.08] },
  },
  lance: {
    grip: [0, -0.01, 0],
    fore: [0, -0.01, -0.22],
    aim: { position: [0.1, 1.3, -0.16], yaw: 0.02 },
    carry: { position: [0.27, 0.98, -0.02], rotation: [1.5, 0.1, 0.05] },
  },
};

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
  rig.shoulder.left.rotation.set(-swing * armSwing - crouch * 0.2, 0, 0.12);
  rig.shoulder.right.rotation.set(
    swing * armSwing - crouch * 0.2,
    0,
    -0.12,
  );
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
  for (const material of rig.materials) material.dispose();
  rig.flash.material.map?.dispose();
  rig.flash.material.dispose();
  rig.group.removeFromParent();
}
