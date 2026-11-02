/**
 * Le squelette du personnage importé.
 *
 * Un maillage glTF arrive avec ses os, et ces os n'ont pas les axes auxquels on
 * s'attendrait : les bras sont déjà à 60° sous l'horizontale, l'axe de
 * flexion d'un doigt n'est pas celui d'un genou, la moitié droite est le
 * miroir de la moitié gauche. Poser une allure « à l'œil » sur ce squelette ne
 * marche pas — chaque essai demande un rendu pour vérifier.
 *
 * Ce module règle ça une fois pour toutes : il applique les rotations de
 * `game/avatarPose`, puis amène les mains sur la prise de l'arme par cinématique
 * inverse à deux os. Il travaille sur des `Object3D` three.js, donc le jeu et
 * l'outil d'aperçu exécutent exactement le même code : ce qu'on voit dans
 * `preview/avatar-*.png` est ce que le navigateur calcule.
 */

import * as THREE from "three";
import { avatarPose, type AvatarMotion } from "@/game/avatarPose";
import { HUMAN_HOLD } from "@/game/holds";
import { type WeaponId } from "@/game/hunting";

/** Noms d'os recherchés, avec les variantes des squelettes courants. */
const BONE_ALIASES: Record<string, string[]> = {
  hips: ["Hips", "hip", "pelvis"],
  spine: ["Spine"],
  spine1: ["Spine1", "spine1"],
  chest: ["Spine2", "Chest"],
  neck: ["Neck"],
  head: ["Head"],
  leftArm: ["LeftArm", "LeftShoulder", "upper_arm.L"],
  leftForeArm: ["LeftForeArm", "LeftElbow", "forearm.L"],
  leftHand: ["LeftHand", "hand.L"],
  rightArm: ["RightArm", "RightShoulder", "upper_arm.R"],
  rightForeArm: ["RightForeArm", "RightElbow", "forearm.R"],
  rightHand: ["RightHand", "hand.R"],
  leftUpLeg: ["LeftUpLeg", "thigh.L"],
  leftLeg: ["LeftLeg", "shin.L"],
  leftFoot: ["LeftFoot", "foot.L"],
  rightUpLeg: ["RightUpLeg", "thigh.R"],
  rightLeg: ["RightLeg", "shin.R"],
  rightFoot: ["RightFoot", "foot.R"],
};

export interface AvatarSkeleton {
  /** Le groupe du joueur : pieds à y = 0, regard vers -Z. */
  root: THREE.Group;
  /** Le nœud qui porte les os. */
  armature: THREE.Object3D;
  /** Tous les os, indexés par leur nom d'origine. */
  bones: Map<string, THREE.Object3D>;
  /** Les os utiles, indexés par rôle. */
  joints: Record<string, THREE.Object3D>;
  restQuat: Map<THREE.Object3D, THREE.Quaternion>;
  restPos: Map<THREE.Object3D, THREE.Vector3>;
}

export interface AvatarMotionState {
  clock: number;
  gait: number;
  aim: number;
  recoil: number;
  recoilVelocity: number;
  slash: number;
}

export interface AvatarPoseRequest {
  dt: number;
  motion: AvatarMotion;
  speed: number;
  aiming: boolean;
  aimYaw: number;
  aimPitch: number;
}

/**
 * Construit les repères d'os à partir de la racine d'un modèle importé.
 *
 * Le groupe renvoyé n'est pas encore placé dans la scène : c'est l'appelant qui
 * décide où il vit.
 */
export function readSkeleton(model: THREE.Object3D): AvatarSkeleton {
  const all = new Map<string, THREE.Object3D>();
  model.traverse((child) => {
    if (child.name) all.set(child.name, child);
  });

  const joints: Record<string, THREE.Object3D> = {};
  for (const [role, names] of Object.entries(BONE_ALIASES)) {
    for (const name of names) {
      const bone = all.get(name);
      if (bone) {
        joints[role] = bone;
        break;
      }
    }
  }

  const root = new THREE.Group();
  root.name = "joueur";
  // Le modèle regarde déjà vers -Z, comme le reste du jeu : aucune rotation à
  // appliquer. C'est vérifié par `scripts/preview-avatar.mjs`, dont la première
  // vue est une vue de face.
  root.add(model);

  const restQuat = new Map<THREE.Object3D, THREE.Quaternion>();
  const restPos = new Map<THREE.Object3D, THREE.Vector3>();
  model.traverse((child) => {
    if (child instanceof THREE.Bone || all.has(child.name)) {
      restQuat.set(child, child.quaternion.clone());
      restPos.set(child, child.position.clone());
    }
  });

  return { root, armature: model, bones: all, joints, restQuat, restPos };
}

/* ------------------------------------------------------------------ */
/* Cinématique inverse                                                 */
/* ------------------------------------------------------------------ */

const IDENTITY = new THREE.Quaternion();
const scratchQ = new THREE.Quaternion();
const scratchDelta = new THREE.Quaternion();
const scratchWorld = new THREE.Quaternion();
const scratchParentQ = new THREE.Quaternion();
const scratchVec = new THREE.Vector3();
const scratchVecB = new THREE.Vector3();
const scratchVecC = new THREE.Vector3();

/**
 * Tourne un os pour que la direction `from` devienne `to`, dans l'espace du
 * monde. `weight` permet de fondre entre la pose animée et la pose contrainte.
 */
function turnBone(bone: THREE.Object3D, from: THREE.Vector3, to: THREE.Vector3, weight: number): void {
  if (!bone.parent || weight <= 0.001) return;
  const delta = scratchDelta.setFromUnitVectors(from, to);
  if (weight < 0.999) delta.slerp(IDENTITY, 1 - weight);
  bone.parent.getWorldQuaternion(scratchParentQ);
  bone.getWorldQuaternion(scratchWorld);
  // q_monde_nouveau = delta * q_monde_ancien, ramené dans le repère du parent.
  scratchWorld.premultiply(delta);
  bone.quaternion.copy(scratchParentQ.invert()).multiply(scratchWorld).normalize();
  bone.updateMatrixWorld(true);
}

/**
 * Amène une main sur une cible. Deux os, un pôle pour le coude : c'est la même
 * mécanique que dans un jeu de tir, en plus court.
 */
function solveArm(
  shoulder: THREE.Object3D,
  elbow: THREE.Object3D,
  hand: THREE.Object3D,
  target: THREE.Vector3,
  pole: THREE.Vector3,
  weight: number,
): void {
  const s = shoulder.getWorldPosition(scratchVec.clone());
  const e = elbow.getWorldPosition(scratchVecB.clone());
  const w = hand.getWorldPosition(scratchVecC.clone());

  const upper = s.distanceTo(e);
  const fore = e.distanceTo(w);
  if (upper < 1e-4 || fore < 1e-4) return;

  const toTarget = target.clone().sub(s);
  const reach = THREE.MathUtils.clamp(toTarget.length(), 0.05, upper + fore - 0.004);
  const dir = toTarget.normalize();

  // Loi des cosinus : l'angle entre le bras et la ligne épaule → main.
  const cosAlpha = THREE.MathUtils.clamp(
    (upper * upper + reach * reach - fore * fore) / (2 * upper * reach),
    -1,
    1,
  );
  const alpha = Math.acos(cosAlpha);

  const poleDir = pole.clone().sub(s);
  poleDir.addScaledVector(dir, -poleDir.dot(dir));
  if (poleDir.lengthSq() < 1e-8) poleDir.set(0, -1, 0);
  poleDir.normalize();

  const upperDir = dir
    .clone()
    .multiplyScalar(Math.cos(alpha))
    .addScaledVector(poleDir, Math.sin(alpha))
    .normalize();
  const elbowPos = s.clone().addScaledVector(upperDir, upper);
  const handPos = s.clone().addScaledVector(dir, reach);
  const foreDir = handPos.sub(elbowPos).normalize();

  turnBone(shoulder, e.clone().sub(s).normalize(), upperDir, weight);

  // L'avant-bras a bougé avec l'épaule : on relit sa position avant de le
  // tourner, sinon la correction porterait sur l'ancienne pose.
  const e2 = elbow.getWorldPosition(new THREE.Vector3());
  const w2 = hand.getWorldPosition(new THREE.Vector3());
  turnBone(elbow, w2.clone().sub(e2).normalize(), foreDir.clone(), weight);
}

/* ------------------------------------------------------------------ */
/* Pose complète                                                       */
/* ------------------------------------------------------------------ */

export interface WeaponMount {
  object: THREE.Object3D;
  id: WeaponId;
  /**
   * De quel côté se trouve la main qui porte l'arme, dans le repère du modèle.
   *
   * La table de prises est écrite pour le corps procédural, dont l'épaule
   * « droite » est du côté +X. Un squelette humain correct, tourné vers -Z, a sa
   * droite en -X : il faut donc refléter la prise. `side: -1` le fait, sans
   * toucher à la table ni au corps procédural.
   */
  side?: 1 | -1;
}

const weaponMatrix = new THREE.Matrix4();
const weaponQuat = new THREE.Quaternion();
const weaponEuler = new THREE.Euler(0, 0, 0, "YXZ");
const gripPoint = new THREE.Vector3();
const forePoint = new THREE.Vector3();

/**
 * Anime le squelette.
 *
 * À appeler une fois par image, avant le rendu. `mount` peut être absent : le
 * personnage marche alors les mains vides.
 */
export function applyAvatarPose(
  skeleton: AvatarSkeleton,
  state: AvatarMotionState,
  request: AvatarPoseRequest,
  mount?: WeaponMount | null,
): void {
  const dt = Math.min(0.05, request.dt);
  state.clock += dt;
  state.aim += ((request.aiming ? 1 : 0) - state.aim) * Math.min(1, dt * 10);

  // Recul : oscillateur amorti, comme la vue subjective.
  state.recoilVelocity -= state.recoil * 110 * dt;
  state.recoilVelocity *= Math.exp(-11 * dt);
  state.recoil += state.recoilVelocity * dt;
  if (state.slash > 0) state.slash = Math.max(0, state.slash - dt * 3.2);

  const moving =
    request.motion === "walk" || request.motion === "run" || request.motion === "sneak" || request.motion === "swim";
  const cadence =
    request.motion === "run" ? 9.6 : request.motion === "sneak" ? 4.6 : request.motion === "swim" ? 3.4 : 6.4;
  if (moving) state.gait += dt * cadence;

  const posed = avatarPose({
    motion: request.motion,
    speed: request.speed,
    phase: state.gait,
    time: state.clock,
    aim: state.aim,
    aimYaw: request.aimYaw,
    aimPitch: request.aimPitch,
    recoil: state.recoil,
  });

  // --- Os -------------------------------------------------------------
  for (const [name, delta] of Object.entries(posed.rotations)) {
    const bone = skeleton.bones.get(name);
    if (!bone) continue;
    const rest = skeleton.restQuat.get(bone);
    if (rest) bone.quaternion.copy(rest);
    weaponEuler.set(delta[0], delta[1], delta[2], "XYZ");
    scratchQ.setFromEuler(weaponEuler);
    bone.quaternion.multiply(scratchQ);
  }

  // Le bassin s'abaisse quand on s'accroupit ou qu'on marche.
  const hips = skeleton.joints.hips;
  if (hips) {
    const rest = skeleton.restPos.get(hips);
    if (rest) hips.position.set(rest.x, rest.y - posed.hipsDrop, rest.z);
  }

  skeleton.root.updateMatrixWorld(true);

  // --- Arme -----------------------------------------------------------
  if (!mount) return;
  const hold = HUMAN_HOLD[mount.id];
  const side = mount.side ?? 1;
  const aim = state.aim;
  const swing = state.slash > 0 ? Math.sin((1 - state.slash) * Math.PI) * state.slash : 0;
  const kick = state.recoil;

  weaponEuler.set(
    THREE.MathUtils.lerp(hold.carry.rotation[0], request.aimPitch, aim) + kick * 0.22 - swing * 1.5,
    THREE.MathUtils.lerp(hold.carry.rotation[1], hold.aim.yaw, aim) * side + request.aimYaw,
    THREE.MathUtils.lerp(hold.carry.rotation[2], hold.aim.roll ?? 0, aim) * side + swing * 0.4,
    "YXZ",
  );
  weaponQuat.setFromEuler(weaponEuler);

  mount.object.position.set(
    THREE.MathUtils.lerp(hold.carry.position[0], hold.aim.position[0], aim) * side,
    // L'arme descend avec le corps quand on s'accroupit : sans cela, la main
    // reste accrochée à une prise située à hauteur de debout.
    THREE.MathUtils.lerp(hold.carry.position[1], hold.aim.position[1], aim) +
      swing * 0.12 -
      posed.hipsDrop,
    THREE.MathUtils.lerp(hold.carry.position[2], hold.aim.position[2], aim) + kick * 0.05,
  );
  mount.object.quaternion.copy(weaponQuat);
  mount.object.updateMatrixWorld(true);

  weaponMatrix.copy(mount.object.matrixWorld);
  gripPoint.set(hold.grip[0] * side, hold.grip[1], hold.grip[2]).applyMatrix4(weaponMatrix);
  if (hold.fore) forePoint.set(hold.fore[0] * side, hold.fore[1], hold.fore[2]).applyMatrix4(weaponMatrix);

  // --- Mains ----------------------------------------------------------
  const { leftArm, leftForeArm, leftHand, rightArm, rightForeArm, rightHand, chest } = skeleton.joints;
  if (!leftArm || !leftForeArm || !leftHand || !rightArm || !rightForeArm || !rightHand) return;

  const chestPos = chest ? chest.getWorldPosition(new THREE.Vector3()) : new THREE.Vector3();

  const poleFor = (shoulder: THREE.Object3D) => {
    const shoulderPos = shoulder.getWorldPosition(new THREE.Vector3());
    const outward = shoulderPos.clone().sub(chestPos);
    outward.y = 0;
    if (outward.lengthSq() < 1e-6) outward.set(1, 0, 0);
    outward.normalize();
    return shoulderPos.addScaledVector(outward, 0.32).add(new THREE.Vector3(0, -0.62, 0));
  };

  // La main droite tient la poignée en permanence : l'arme la suit, pas
  // l'inverse. La main gauche ne rejoint la garde que si l'on vise.
  solveArm(rightArm, rightForeArm, rightHand, gripPoint, poleFor(rightArm), 1);
  if (hold.fore) {
    solveArm(leftArm, leftForeArm, leftHand, forePoint, poleFor(leftArm), aim);
  }
}

/** Recul de l'arme : appelé au tir. */
export function kickAvatar(state: AvatarMotionState, strength = 1): void {
  state.recoilVelocity += 3.4 * strength;
}

/** Coup d'arme blanche. */
export function slashAvatar(state: AvatarMotionState): void {
  state.slash = 1;
}
