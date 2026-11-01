/**
 * Les armes, seules — sans bras.
 *
 * Elles servent à deux endroits : la vue subjective (WeaponView), où deux
 * avant-bras les tiennent devant la caméra, et le personnage en pied
 * (HumanModel), où c'est le squelette du corps qui les tient. Une arme ne doit
 * donc pas embarquer ses propres mains.
 *
 * Chaque modèle expose ses points de prise, en coordonnées locales :
 *
 *   · `grip`  — la main droite, sur la poignée ;
 *   · `fore`  — la main gauche, sur le garde-main (null pour une arme à une
 *               main) ;
 *   · `muzzle` — la bouche du canon, pour l'éclair et le point d'émission.
 *
 * Le canon pointe vers -Z, comme la caméra : une arme posée droite regarde
 * devant elle.
 */

import * as THREE from "three";
import { type WeaponId } from "@/game/hunting";

export interface WeaponModel {
  id: WeaponId;
  group: THREE.Group;
  /** Bouche du canon, en coordonnées locales. */
  muzzle: THREE.Vector3;
  /** Main droite. */
  grip: THREE.Vector3;
  /** Main gauche, quand l'arme se tient à deux mains. */
  fore: THREE.Vector3 | null;
  materials: THREE.Material[];
  geometries: THREE.BufferGeometry[];
}

export function steelMaterial(dark = 0x2a2c2e): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: dark,
    roughness: 0.36,
    metalness: 0.92,
    envMapIntensity: 0.9,
  });
}

function polymerMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: 0x1a1c1b,
    roughness: 0.72,
    metalness: 0.12,
  });
}

function woodMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: 0x5a3a20,
    roughness: 0.78,
    metalness: 0.02,
  });
}

/** Lame extrudée à partir d'un profil, orientée vers l'avant (-Z). */
function blade(
  length: number,
  width: number,
  thickness: number,
  material: THREE.Material,
  curve = 0,
): THREE.Mesh {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.quadraticCurveTo(width * 0.55, -length * 0.35, width * 0.42, -length * 0.82);
  shape.quadraticCurveTo(width * 0.3, -length * 0.95, curve, -length);
  shape.quadraticCurveTo(-width * 0.36, -length * 0.86, -width * 0.5, -length * 0.3);
  shape.quadraticCurveTo(-width * 0.5, -length * 0.05, 0, 0);
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: thickness,
    bevelEnabled: true,
    bevelSize: thickness * 0.6,
    bevelThickness: thickness * 0.6,
    bevelSegments: 1,
  });
  geometry.rotateX(Math.PI / 2);
  return new THREE.Mesh(geometry, material);
}

function pistol(): { group: THREE.Group; materials: THREE.Material[] } {
  const group = new THREE.Group();
  const steel = steelMaterial();
  const polymer = polymerMaterial();

  const slide = new THREE.Mesh(new THREE.BoxGeometry(0.032, 0.036, 0.19), steel);
  slide.position.set(0, 0.03, -0.06);
  group.add(slide);

  const frame = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.028, 0.14), polymer);
  frame.position.set(0, 0.002, -0.03);
  group.add(frame);

  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.0075, 0.0075, 0.05, 8), steel);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 0.028, -0.155);
  group.add(barrel);

  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.028, 0.105, 0.045), polymer);
  grip.position.set(0, -0.045, 0.03);
  grip.rotation.x = -0.24;
  group.add(grip);

  const mag = new THREE.Mesh(new THREE.BoxGeometry(0.024, 0.012, 0.04), steel);
  mag.position.set(0, -0.098, 0.043);
  mag.rotation.x = -0.24;
  group.add(mag);

  const guard = new THREE.Mesh(new THREE.TorusGeometry(0.022, 0.004, 5, 10, Math.PI), steel);
  guard.rotation.y = Math.PI / 2;
  guard.rotation.x = Math.PI;
  guard.position.set(0, -0.02, -0.03);
  group.add(guard);

  const frontSight = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.008, 0.007), polymer);
  frontSight.position.set(0, 0.052, -0.145);
  group.add(frontSight);
  const rearSight = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.006, 0.006), polymer);
  rearSight.position.set(0, 0.052, 0.026);
  group.add(rearSight);

  return { group, materials: [steel, polymer] };
}

function m16(): { group: THREE.Group; materials: THREE.Material[] } {
  const group = new THREE.Group();
  const steel = steelMaterial(0x24262a);
  const polymer = polymerMaterial();

  const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.055, 0.24), steel);
  receiver.position.set(0, 0.01, -0.06);
  group.add(receiver);

  const handle = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.018, 0.16), polymer);
  handle.position.set(0, 0.046, -0.05);
  group.add(handle);

  const guard = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.2, 8), polymer);
  guard.rotation.x = Math.PI / 2;
  guard.position.set(0, 0.005, -0.28);
  group.add(guard);

  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.3, 8), steel);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 0.012, -0.5);
  group.add(barrel);

  const flashHider = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.012, 0.05, 8), steel);
  flashHider.rotation.x = Math.PI / 2;
  flashHider.position.set(0, 0.012, -0.66);
  group.add(flashHider);

  const frontSight = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.05, 0.012), steel);
  frontSight.position.set(0, 0.042, -0.36);
  group.add(frontSight);

  const stock = new THREE.Mesh(new THREE.BoxGeometry(0.036, 0.065, 0.22), polymer);
  stock.position.set(0, 0.008, 0.17);
  stock.rotation.x = -0.05;
  group.add(stock);

  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.09, 0.042), polymer);
  grip.position.set(0, -0.05, 0.03);
  grip.rotation.x = -0.38;
  group.add(grip);

  const mag = new THREE.Mesh(new THREE.BoxGeometry(0.026, 0.13, 0.05), steel);
  mag.position.set(0, -0.085, -0.09);
  mag.rotation.x = 0.16;
  group.add(mag);

  return { group, materials: [steel, polymer] };
}

function edged(machete: boolean): { group: THREE.Group; materials: THREE.Material[] } {
  const group = new THREE.Group();
  const wood = woodMaterial();
  const steel = new THREE.MeshStandardMaterial({
    color: 0x9aa0a4,
    roughness: 0.22,
    metalness: 0.95,
    envMapIntensity: 1.1,
  });
  const dark = steelMaterial();

  const handle = new THREE.Mesh(
    new THREE.CylinderGeometry(0.019, 0.022, machete ? 0.15 : 0.115, 8),
    wood,
  );
  handle.rotation.x = Math.PI / 2;
  handle.position.set(0, -0.02, 0.02);
  group.add(handle);

  const pommel = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.024, 0.012, 8), dark);
  pommel.rotation.x = Math.PI / 2;
  pommel.position.set(0, -0.02, 0.09);
  group.add(pommel);

  const guard = new THREE.Mesh(
    new THREE.BoxGeometry(machete ? 0.03 : 0.02, machete ? 0.012 : 0.014, 0.012),
    dark,
  );
  guard.position.set(0, -0.012, -0.055);
  group.add(guard);

  const bladeMesh = blade(
    machete ? 0.52 : 0.27,
    machete ? 0.075 : 0.038,
    machete ? 0.005 : 0.004,
    steel,
    machete ? 0.03 : 0,
  );
  bladeMesh.position.set(0, -0.018, machete ? -0.06 : -0.048);
  bladeMesh.rotation.x = machete ? 0.12 : 0.06;
  group.add(bladeMesh);

  return { group, materials: [wood, steel, dark] };
}

function spear(): { group: THREE.Group; materials: THREE.Material[] } {
  const group = new THREE.Group();
  const wood = woodMaterial();
  const steel = steelMaterial(0x777d80);
  const bindingMaterial = steelMaterial(0x3b2a18);

  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.014, 1.9, 8), wood);
  shaft.rotation.x = Math.PI / 2;
  shaft.position.set(0, -0.01, -0.62);
  group.add(shaft);

  const head = new THREE.Mesh(new THREE.ConeGeometry(0.024, 0.16, 8), steel);
  head.rotation.x = -Math.PI / 2;
  head.position.set(0, -0.01, -1.66);
  group.add(head);

  const binding = new THREE.Mesh(new THREE.CylinderGeometry(0.019, 0.019, 0.06, 8), bindingMaterial);
  binding.rotation.x = Math.PI / 2;
  binding.position.set(0, -0.01, -1.55);
  group.add(binding);

  return { group, materials: [wood, steel, bindingMaterial] };
}

const BUILDERS: Record<WeaponId, () => { group: THREE.Group; materials: THREE.Material[] }> = {
  pistolet: pistol,
  m16,
  couteau: () => edged(false),
  machette: () => edged(true),
  lance: spear,
};

const GRIPS: Record<WeaponId, { muzzle: THREE.Vector3Tuple; grip: THREE.Vector3Tuple; fore: THREE.Vector3Tuple | null }> = {
  pistolet: {
    muzzle: [0, 0.028, -0.18],
    grip: [0, -0.045, 0.03],
    fore: [-0.03, -0.052, 0.015],
  },
  m16: {
    muzzle: [0, 0.012, -0.66],
    grip: [0, -0.05, 0.03],
    fore: [0, 0.0, -0.26],
  },
  couteau: {
    muzzle: [0, -0.02, -0.32],
    grip: [0, -0.02, 0.03],
    fore: null,
  },
  machette: {
    muzzle: [0, -0.02, -0.58],
    grip: [0, -0.02, 0.03],
    fore: null,
  },
  lance: {
    muzzle: [0, -0.01, -1.74],
    grip: [0, -0.01, 0.0],
    fore: [0, -0.01, -0.44],
  },
};

/**
 * Construit une arme détachée de toute main.
 *
 * Les matériaux et géométries sont rendus à l'appelant : une arme de la vue
 * subjective et l'arme du personnage sont deux objets distincts, mais elles
 * se libèrent de la même façon.
 */
export function createWeaponModel(id: WeaponId): WeaponModel {
  const { group, materials } = BUILDERS[id]();
  const grip = GRIPS[id];

  const geometries: THREE.BufferGeometry[] = [];
  group.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      geometries.push(child.geometry);
      child.castShadow = false;
      child.receiveShadow = false;
    }
  });

  return {
    id,
    group,
    muzzle: new THREE.Vector3(...grip.muzzle),
    grip: new THREE.Vector3(...grip.grip),
    fore: grip.fore ? new THREE.Vector3(...grip.fore) : null,
    materials,
    geometries,
  };
}

export function disposeWeaponModel(model: WeaponModel): void {
  for (const geometry of model.geometries) geometry.dispose();
  for (const material of model.materials) material.dispose();
  model.group.removeFromParent();
}
