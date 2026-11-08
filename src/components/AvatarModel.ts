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
import { getOutfit } from "@/game/outfits";
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

/** Ce qu'une matière du maillage représente : peau, tissu, cuir, sangles. */
type ClothSlot = "top" | "bottom" | "boot" | "gear";

/**
 * Classe une matière d'après son nom.
 *
 * Le modèle importé nomme ses matières `Wolf3D_Body`, `Wolf3D_Outfit_Top`,
 * `Wolf3D_Outfit_Bottom`, `Wolf3D_Outfit_Footwear`. Le piège est là :
 * **`Wolf3D_Body` est le corps nu** — les bras, les mains, les jambes sous le
 * short — et non un vêtement. L'ancien test cherchait « body » pour reconnaître
 * un haut : le corps entier recevait donc la matière de la chemise, couleur
 * olive comprise. Le personnage avait la peau peinte en tissu, et l'on ne
 * pouvait plus distinguer le corps de la tenue. C'est exactement ce qui était
 * signalé.
 */
function classify(name: string): { skin: boolean; face: boolean; hat: boolean; cloth: ClothSlot | null } {
  const n = name.toLowerCase();
  // La peau du corps porte le nom du corps : c'est le cas à traiter en premier.
  if (n.includes("skin") || n === "wolf3d_body" || n.endsWith("_body")) {
    return { skin: true, face: false, hat: false, cloth: null };
  }
  // Yeux, dents, barbe, cheveux : matières propres, ni peau ni tissu.
  if (n.includes("eye") || n.includes("teeth") || n.includes("beard") || n.includes("hair")) {
    return { skin: false, face: true, hat: false, cloth: null };
  }
  if (n.includes("headwear") || n.includes("hat")) {
    return { skin: false, face: false, hat: true, cloth: null };
  }
  if (n.includes("footwear") || n.includes("shoe") || n.includes("boot") || n.includes("foot")) {
    return { skin: false, face: false, hat: false, cloth: "boot" };
  }
  if (n.includes("bottom") || n.includes("leg") || n.includes("pant") || n.includes("short")) {
    return { skin: false, face: false, hat: false, cloth: "bottom" };
  }
  if (n.includes("top") || n.includes("shirt") || n.includes("sleeve")) {
    return { skin: false, face: false, hat: false, cloth: "top" };
  }
  return { skin: false, face: false, hat: false, cloth: "gear" };
}

/**
 * Habille le personnage pour la forêt.
 *
 * La peau garde sa texture photographique — c'est justement ce qu'on ne sait
 * pas fabriquer — et reçoit seulement la carnation. Les tissus reçoivent nos
 * cartes de toile, de cuir et de sangle.
 *
 * Chaque matière de vêtement est étiquetée (`userData.slot`) pour que le choix
 * de tenue puisse ensuite la recolorer sans reconstruire le maillage.
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
    const kind = classify(name);

    if (kind.skin) {
      first.roughness = 0.58;
      first.metalness = 0;
      // La carnation du visage **et** du corps : la même. Deux peaux
      // différentes — un visage sombre et des avant-bras pâles — c'était le
      // résultat quand seule la tête recevait la teinte.
      first.color.set(SKIN_GLB_TINT);
      if ("sheen" in first) {
        const physical = first as THREE.MeshPhysicalMaterial;
        physical.sheen = 0.45;
        physical.sheenColor.set(SKIN_SHEEN);
        physical.sheenRoughness = 0.6;
      }
      first.name = `${first.name}-peau`;
      return;
    }

    if (kind.face) {
      first.roughness = 0.8;
      first.metalness = 0;
      return;
    }

    if (kind.hat) {
      // Le chapeau de ville devient un feutre de brousse.
      first.color.set(0x4a4436);
      first.roughness = 0.95;
      first.userData.slot = "gear";
      created.push(first);
      return;
    }

    const slot: ClothSlot = kind.cloth ?? "gear";
    const replacement =
      slot === "boot"
        ? new THREE.MeshPhysicalMaterial({
            color: 0x2c2118,
            roughness: 0.55,
            metalness: 0.04,
            clearcoat: 0.25,
            clearcoatRoughness: 0.5,
            ...maps("leather", 3),
          })
        : slot === "bottom"
          ? new THREE.MeshStandardMaterial({
              color: 0x3d4430,
              roughness: 0.96,
              metalness: 0,
              ...maps("trousers", 6),
            })
          : slot === "top"
            ? new THREE.MeshStandardMaterial({
                color: 0x8a8f6d,
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
    replacement.userData.slot = slot;
    child.material = replacement;
    created.push(replacement);
  });

  return created;
}

/**
 * Applique une tenue au maillage déjà habillé.
 *
 * On ne reconstruit rien : on change la couleur et la brillance des matières
 * étiquetées. C'est instantané, et ça évite de recharger un modèle de 16 000
 * triangles à chaque fois qu'on ouvre le vestiaire.
 *
 * Les valeurs sont choisies pour **séparer la peau du tissu** : la carnation
 * d'un homme du bassin du Congo est sombre et chaude ; les étoffes sont plus
 * claires et plus froides, ou franchement plus sombres que la peau. Une tenue
 * de la même valeur que le corps redevient un corps.
 */
export function applyAvatarOutfit(rig: { materials: THREE.Material[] }, outfitId: string): void {
  const palette = getOutfit(outfitId).palette;
  for (const material of rig.materials) {
    const slot = material.userData?.slot as ClothSlot | undefined;
    if (!slot) continue;
    const cloth = material as THREE.MeshStandardMaterial;
    cloth.color.set(
      slot === "top"
        ? palette.top
        : slot === "bottom"
          ? palette.bottom
          : slot === "boot"
            ? palette.boot
            : palette.gear,
    );
    // Le cuir garde son vernis ; les tissus tissés de fils ont une légère
    // transparence de surface, pas un plastique.
    cloth.roughness = slot === "boot" ? 0.55 : 0.94 - palette.sheen * 0.22;
    if ("sheen" in cloth) {
      const physical = cloth as THREE.MeshPhysicalMaterial;
      physical.sheen = palette.sheen * 0.55;
      physical.sheenColor.set(palette.top).lerp(new THREE.Color(0xffffff), 0.4);
    }
  }
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
