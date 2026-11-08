/**
 * Le personnage joueur : un vrai maillage humain.
 *
 * Le corps fait de capsules et d'ellipsoïdes atteignait son plafond. Une tête
 * sculptée à la main reste une tête sculptée à la main ; des mains faites de
 * boîtes restent des boîtes. Pour un jeu où le personnage est vu à trois
 * mètres, il faut autre chose : un maillage humain complet — peau, visage,
 * paupières, doigts, vêtements cousus — livré avec son squelette.
 *
 * On charge donc `public/models/explorateur.glb` (16 000 triangles, ~70 os,
 * textures 2K) et on l'habille pour la forêt : la peau et le visage gardent
 * leur texture photographique — c'est justement ce qu'on ne sait pas fabriquer
 * —, les tissus reçoivent nos cartes de toile, de cuir et de sangle.
 *
 * L'animation reste la nôtre : `game/avatarPose` donne les rotations d'os,
 * `avatarRig` les applique et amène les mains sur l'arme. Aucune animation
 * préenregistrée : une démarche figée ne sait ni viser, ni s'accroupir, ni
 * encaisser un recul.
 *
 * Repli : si le fichier ne se charge pas (hors ligne), la scène garde le corps
 * procédural. Un jeu qui plante parce qu'un décor n'est pas arrivé est pire
 * qu'un jeu avec un personnage plus simple.
 */

import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { SKIN_GLB_TINT, SKIN_SHEEN } from "@/game/appearance";
import { type WeaponId } from "@/game/hunting";
import { createWeaponModel, disposeWeaponModel } from "./WeaponModels";
import { type HumanPose, type HumanRig } from "./HumanModel";
import {
  applyAvatarPose,
  kickAvatar,
  readSkeleton,
  slashAvatar,
  type AvatarMotionState,
  type AvatarSkeleton,
} from "./avatarRig";

export interface AvatarRig extends HumanRig {
  /** D'où vient ce corps : ici, toujours le maillage importé. */
  source: "gltf";
  skeleton: AvatarSkeleton;
  /** État de l'animation, partagé avec `avatarRig`. */
  motion: AvatarMotionState;
  /** L'arme est portée par la main droite du squelette. */
  mount: THREE.Group;
}

/* ------------------------------------------------------------------ */
/* Habitat                                                            */
/* ------------------------------------------------------------------ */

/**
 * Habille le personnage pour la forêt.
 *
 * Les matières d'origine (costume de ville, chaussures cirées) sont remplacées
 * sur tout ce qui est tissu ; la peau, les yeux et les cheveux restent intacts.
 */
function dressForForest(root: THREE.Object3D): THREE.Material[] {
  const created: THREE.Material[] = [];
  const loader = new THREE.TextureLoader();
  const canLoadTextures = typeof document !== "undefined";

  const maps = (name: string, repeat: number) => {
    if (!canLoadTextures) return {};
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
  };

  root.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    child.castShadow = true;
    child.receiveShadow = true;
    const material = child.material as THREE.MeshStandardMaterial | THREE.MeshStandardMaterial[];
    const first = Array.isArray(material) ? material[0] : material;
    const name = (first.name ?? "").toLowerCase();

    // La peau, les yeux, les dents, les cheveux et le chapeau restent tels
    // quels : on ne fabrique pas une peau crédible, celle du modèle l'est.
    if (
      name.includes("skin") ||
      name.includes("eye") ||
      name.includes("teeth") ||
      name.includes("beard") ||
      name.includes("hair") ||
      name.includes("head")
    ) {
      first.roughness = name.includes("skin") ? 0.58 : 0.8;
      first.metalness = 0;
      if (name.includes("skin")) {
        // La peau du modèle importé est une texture claire. On ne la remplace
        // pas : on la multiplie. Les pores, les taches et les plis de la carte
        // d'origine restent, seule la carnation descend — c'est la seule façon
        // d'obtenir un visage qui ne soit pas un aplat de couleur.
        first.color.set(SKIN_GLB_TINT);
        // Un peu de reflet diffus : sans lui, une peau foncée sous la canopée
        // se lit comme une silhouette découpée.
        if ("sheen" in first) {
          const physical = first as THREE.MeshPhysicalMaterial;
          physical.sheen = 0.45;
          physical.sheenColor.set(SKIN_SHEEN);
          physical.sheenRoughness = 0.6;
        }
      }
      // Le chapeau de ville devient un feutre de brousse : même forme, autre
      // matière. Un fedora noir au milieu de la forêt ne pardonne pas.
      if (name.includes("headwear") && "color" in first) {
        (first as THREE.MeshStandardMaterial).color.set(0x4a4436);
        first.roughness = 0.95;
      }
      return;
    }

    const isShoe = name.includes("foot") || name.includes("shoe") || name.includes("boot");
    const isTrousers = name.includes("bottom") || name.includes("leg") || name.includes("pant");
    const isTop = name.includes("top") || name.includes("body") || name.includes("shirt");

    const replacement = isShoe
      ? new THREE.MeshPhysicalMaterial({
          color: 0x2c2118,
          roughness: 0.55,
          metalness: 0.04,
          clearcoat: 0.25,
          clearcoatRoughness: 0.5,
          ...maps("leather", 3),
        })
      : isTrousers
        ? new THREE.MeshStandardMaterial({
            color: 0x4a4f3a,
            roughness: 0.96,
            metalness: 0,
            ...maps("trousers", 6),
          })
        : isTop
          ? new THREE.MeshStandardMaterial({
              color: 0x565e3e,
              roughness: 0.94,
              metalness: 0,
              ...maps("shirt", 6),
            })
          : new THREE.MeshStandardMaterial({
              color: 0x5c5e46,
              roughness: 0.92,
              metalness: 0,
              ...maps("webbing", 4),
            });

    replacement.name = `${first.name}-foret`;
    replacement.normalScale = new THREE.Vector2(0.55, 0.55);
    child.material = replacement;
    created.push(replacement);
  });

  return created;
}

/* ------------------------------------------------------------------ */
/* Chargement                                                          */
/* ------------------------------------------------------------------ */

let modelPromise: Promise<THREE.Object3D | null> | null = null;

/**
 * Charge le maillage une seule fois.
 *
 * Pas de `clone()` : cloner un maillage peau sans `SkeletonUtils` laisse le
 * `SkinnedMesh` branché sur le squelette d'origine, et le personnage se fige
 * pendant que ses os bougent. Il n'y a qu'un joueur, on partage donc l'objet.
 */
function loadModel(): Promise<THREE.Object3D | null> {
  if (!modelPromise) {
    modelPromise = new GLTFLoader()
      .loadAsync("/models/explorateur.glb")
      .then((gltf) => gltf.scene)
      .catch(() => null);
  }
  return modelPromise;
}

/**
 * Prépare un personnage jouable.
 *
 * Renvoie `null` si le maillage ne peut pas être chargé : l'appelant garde
 * alors son corps procédural.
 */
export async function loadAvatarRig(): Promise<AvatarRig | null> {
  const model = await loadModel();
  if (!model) return null;

  const skeleton = readSkeleton(model);
  const group = skeleton.root;

  const mount = new THREE.Group();
  mount.name = "prise";
  group.add(mount);

  const flash = new THREE.Sprite(
    new THREE.SpriteMaterial({ color: 0xffd9a0, transparent: true, opacity: 0.9, depthWrite: false }),
  );
  flash.scale.setScalar(0.22);
  flash.visible = false;
  mount.add(flash);

  const flashLight = new THREE.PointLight(0xffd9a0, 0, 5, 2);
  mount.add(flashLight);

  const materials = dressForForest(model);
  const joints = skeleton.joints;

  const motion: AvatarMotionState = { clock: 0, gait: 0, aim: 0, recoil: 0, recoilVelocity: 0, slash: 0 };

  return {
    source: "gltf" as const,
    group,
    hips: joints.hips,
    spine: joints.spine,
    chest: joints.chest,
    neck: joints.neck,
    head: joints.head,
    shoulder: { left: joints.leftArm, right: joints.rightArm },
    elbow: { left: joints.leftForeArm, right: joints.rightForeArm },
    wrist: { left: joints.leftHand, right: joints.rightHand },
    thigh: { left: joints.leftUpLeg, right: joints.rightUpLeg },
    knee: { left: joints.leftLeg, right: joints.rightLeg },
    ankle: { left: joints.leftFoot, right: joints.rightFoot },
    weaponHolder: mount,
    weapon: null,
    flash,
    flashLight,
    materials,
    geometries: [],
    gait: 0,
    clock: 0,
    aim: 0,
    recoil: 0,
    recoilVelocity: 0,
    slash: 0,
    slashDuration: 0.4,
    weaponId: null,
    skeleton,
    motion,
    mount,
  };
}

/* ------------------------------------------------------------------ */
/* Animation                                                           */
/* ------------------------------------------------------------------ */

/** Anime le personnage. À appeler une fois par image. */
export function poseAvatar(rig: AvatarRig, pose: HumanPose): void {
  applyAvatarPose(
    rig.skeleton,
    rig.motion,
    {
      dt: pose.dt,
      motion: pose.motion,
      speed: pose.speed,
      aiming: pose.aiming,
      aimYaw: pose.aimYaw,
      aimPitch: pose.aimPitch,
    },
    rig.weaponId ? { object: rig.mount, id: rig.weaponId, side: -1 } : null,
  );

  // Les champs plats servent aux autres modules (HUD, contrôles).
  rig.clock = rig.motion.clock;
  rig.gait = rig.motion.gait;
  rig.aim = rig.motion.aim;
  rig.recoil = rig.motion.recoil;
  rig.slash = rig.motion.slash;

  if (rig.flash.visible) {
    rig.flashLight.intensity = Math.max(0, rig.flashLight.intensity - pose.dt * 40);
    if (rig.flashLight.intensity <= 0.01) {
      rig.flash.visible = false;
      rig.flashLight.intensity = 0;
    }
  }
}

/** Recul : appelé au tir. */
export function kickAvatarRig(rig: AvatarRig, strength = 1): void {
  kickAvatar(rig.motion, strength);
  if (rig.weaponId === "pistolet" || rig.weaponId === "m16") {
    rig.flash.visible = true;
    rig.flash.scale.setScalar(rig.weaponId === "m16" ? 0.36 : 0.24);
    rig.flashLight.intensity = 5;
    if (rig.weapon) rig.flash.position.copy(rig.weapon.muzzle);
  }
}

/** Coup d'arme blanche. */
export function slashAvatarRig(rig: AvatarRig): void {
  slashAvatar(rig.motion);
}

export function equipAvatarWeapon(rig: AvatarRig, id: WeaponId): void {
  if (rig.weaponId === id && rig.weapon) return;
  if (rig.weapon) {
    rig.mount.remove(rig.weapon.group);
    disposeWeaponModel(rig.weapon);
    rig.weapon = null;
  }
  const model = createWeaponModel(id);
  // Aucun miroir sur le modèle : c'est le porte-arme qui est placé de l'autre
  // côté, et une échelle négative retournerait les faces (l'arme se verrait
  // de l'intérieur).
  model.group.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.castShadow = true;
      child.receiveShadow = false;
    }
  });
  rig.mount.add(model.group);
  rig.weapon = model;
  rig.weaponId = id;
}

export function disposeAvatar(rig: AvatarRig): void {
  if (rig.weapon) disposeWeaponModel(rig.weapon);
  for (const material of rig.materials) {
    const standard = material as THREE.MeshStandardMaterial;
    standard.map?.dispose();
    standard.normalMap?.dispose();
    standard.roughnessMap?.dispose();
    material.dispose();
  }
  rig.group.traverse((child) => {
    if (child instanceof THREE.Mesh) child.geometry.dispose();
  });
  rig.group.removeFromParent();
}
