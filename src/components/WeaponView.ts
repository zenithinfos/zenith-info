/**
 * Vue subjective : les mains du personnage et son arme.
 *
 * Un jeu de tir sans arme visible ne ressemble à rien — on déclenche un effet
 * et il ne se passe rien. Ici chaque arme est un vrai modèle tenu par deux
 * avant-bras : canon, crosse, chargeur, garde-main, lame et poignée sont
 * modélisés, et le recul est une animation, pas un simple écran qui tremble.
 *
 * Les armes sont des enfants de la caméra : elles ne peuvent donc pas passer
 * derrière la végétation. C'est le compromis classique de la vue subjective,
 * et il est invisible à l'œil.
 */

import * as THREE from "three";
import { type WeaponId } from "@/game/hunting";

export interface ViewModel {
  group: THREE.Group;
  /** Lumière de la lampe frontale (intensité pilotée par la nuit). */
  setLamp: (intensity: number) => void;
  setWeapon: (id: WeaponId) => void;
  setAiming: (aiming: boolean) => void;
  /** Recul (tir) : déplace l'arme et la fait tourner. */
  kick: (strength?: number) => void;
  /** Coup de lame : animation de tranche. */
  slash: () => void;
  update: (dt: number, moving: boolean, aiming: boolean) => void;
  dispose: () => void;
}

function skinMaterial() {
  return new THREE.MeshPhysicalMaterial({
    color: 0x8a5b3f,
    roughness: 0.58,
    metalness: 0,
    sheen: 0.35,
    sheenColor: new THREE.Color(0xffd2b0),
    clearcoat: 0.12,
    clearcoatRoughness: 0.6,
  });
}

function sleeveMaterial() {
  return new THREE.MeshStandardMaterial({
    color: 0x39442f,
    roughness: 0.92,
    metalness: 0,
  });
}

function steelMaterial(dark = 0x2a2c2e) {
  return new THREE.MeshStandardMaterial({
    color: dark,
    roughness: 0.36,
    metalness: 0.92,
    envMapIntensity: 0.9,
  });
}

function polymerMaterial() {
  return new THREE.MeshStandardMaterial({
    color: 0x1a1c1b,
    roughness: 0.72,
    metalness: 0.12,
  });
}

function woodMaterial() {
  return new THREE.MeshStandardMaterial({
    color: 0x5a3a20,
    roughness: 0.78,
    metalness: 0.02,
  });
}

/**
 * Avant-bras + main. `grip` indique si la main serre une poignée verticale
 * (pistolet) ou horizontale (fusil).
 */
function makeArm(skin: THREE.Material, sleeve: THREE.Material, mirror: boolean): THREE.Group {
  const arm = new THREE.Group();
  const sign = mirror ? -1 : 1;

  const forearmGeometry = new THREE.CapsuleGeometry(0.036, 0.2, 3, 8);
  forearmGeometry.rotateX(Math.PI / 2);
  const forearm = new THREE.Mesh(forearmGeometry, skin);
  forearm.position.set(0, -0.03, 0.15);
  arm.add(forearm);

  const sleeveGeometry = new THREE.CapsuleGeometry(0.045, 0.16, 3, 8);
  sleeveGeometry.rotateX(Math.PI / 2);
  const cuff = new THREE.Mesh(sleeveGeometry, sleeve);
  cuff.position.set(0, -0.028, 0.3);
  cuff.scale.set(1, 1, 1);
  arm.add(cuff);

  const palmGeometry = new THREE.BoxGeometry(0.058, 0.075, 0.03);
  const palm = new THREE.Mesh(palmGeometry, skin);
  palm.position.set(0, -0.005, -0.015);
  palm.rotation.z = sign * 0.12;
  arm.add(palm);

  // Doigts enroulés : quatre capsules courtes qui font le tour de la poignée.
  for (let i = 0; i < 4; i++) {
    const finger = new THREE.Mesh(new THREE.CapsuleGeometry(0.0085, 0.032, 2, 6), skin);
    finger.rotation.x = Math.PI / 2;
    finger.rotation.z = sign * -0.5;
    finger.position.set(-sign * 0.016, 0.024 - i * 0.019, -0.045);
    arm.add(finger);
  }
  const thumb = new THREE.Mesh(new THREE.CapsuleGeometry(0.0095, 0.036, 2, 6), skin);
  thumb.rotation.x = Math.PI / 2.6;
  thumb.rotation.z = sign * 0.7;
  thumb.position.set(sign * 0.026, 0.012, -0.02);
  arm.add(thumb);

  return arm;
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
  geometry.translate(0, 0, 0);
  return new THREE.Mesh(geometry, material);
}

function buildPistol(skin: THREE.Material, sleeve: THREE.Material): THREE.Group {
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

  const right = makeArm(skin, sleeve, false);
  right.position.set(0.012, -0.05, 0.045);
  right.rotation.set(0.1, -0.25, 0.2);
  group.add(right);

  const left = makeArm(skin, sleeve, true);
  left.position.set(-0.038, -0.062, 0.02);
  left.rotation.set(0.15, 0.5, -0.35);
  group.add(left);

  return group;
}

function buildM16(skin: THREE.Material, sleeve: THREE.Material): THREE.Group {
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

  const right = makeArm(skin, sleeve, false);
  right.position.set(0.016, -0.06, 0.04);
  right.rotation.set(0.08, -0.2, 0.18);
  group.add(right);

  const left = makeArm(skin, sleeve, true);
  left.position.set(-0.03, -0.069, -0.2);
  left.rotation.set(0.24, 0.42, -0.34);
  group.add(left);

  return group;
}

function buildKnife(skin: THREE.Material, sleeve: THREE.Material, machete: boolean): THREE.Group {
  const group = new THREE.Group();
  const wood = woodMaterial();
  const steel = new THREE.MeshStandardMaterial({
    color: 0x9aa0a4,
    roughness: 0.22,
    metalness: 0.95,
    envMapIntensity: 1.1,
  });

  const handle = new THREE.Mesh(
    new THREE.CylinderGeometry(0.019, 0.022, machete ? 0.15 : 0.115, 8),
    wood,
  );
  handle.rotation.x = Math.PI / 2;
  handle.position.set(0, -0.02, 0.02);
  group.add(handle);

  const pommel = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.024, 0.012, 8), steelMaterial());
  pommel.rotation.x = Math.PI / 2;
  pommel.position.set(0, -0.02, 0.09);
  group.add(pommel);

  const guard = new THREE.Mesh(
    new THREE.BoxGeometry(machete ? 0.03 : 0.02, machete ? 0.012 : 0.014, 0.012),
    steelMaterial(),
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

  const right = makeArm(skin, sleeve, false);
  right.position.set(0.01, -0.055, 0.06);
  right.rotation.set(0.2, -0.2, 0.16);
  group.add(right);

  return group;
}

function buildSpear(skin: THREE.Material, sleeve: THREE.Material): THREE.Group {
  const group = new THREE.Group();
  const wood = woodMaterial();
  const steel = steelMaterial(0x777d80);

  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.014, 1.9, 8), wood);
  shaft.rotation.x = Math.PI / 2;
  shaft.position.set(0, -0.01, -0.62);
  group.add(shaft);

  const head = new THREE.Mesh(new THREE.ConeGeometry(0.024, 0.16, 8), steel);
  head.rotation.x = -Math.PI / 2;
  head.position.set(0, -0.01, -1.66);
  group.add(head);

  const binding = new THREE.Mesh(new THREE.CylinderGeometry(0.019, 0.019, 0.06, 8), steelMaterial(0x3b2a18));
  binding.rotation.x = Math.PI / 2;
  binding.position.set(0, -0.01, -1.55);
  group.add(binding);

  const right = makeArm(skin, sleeve, false);
  right.position.set(0.02, -0.06, 0.05);
  right.rotation.set(0.12, -0.24, 0.2);
  group.add(right);

  const left = makeArm(skin, sleeve, true);
  left.position.set(-0.03, -0.075, -0.24);
  left.rotation.set(0.18, 0.35, -0.28);
  group.add(left);

  return group;
}

const REST = new THREE.Vector3(0.17, -0.19, -0.42);
const AIM = new THREE.Vector3(0.0, -0.115, -0.34);

export function createViewModel(): ViewModel {
  const group = new THREE.Group();
  const skin = skinMaterial();
  const sleeve = sleeveMaterial();

  const weapons = new Map<WeaponId, THREE.Group>();
  const builders: Record<WeaponId, () => THREE.Group> = {
    pistolet: () => buildPistol(skin, sleeve),
    m16: () => buildM16(skin, sleeve),
    couteau: () => buildKnife(skin, sleeve, false),
    machette: () => buildKnife(skin, sleeve, true),
    lance: () => buildSpear(skin, sleeve),
  };

  for (const id of Object.keys(builders) as WeaponId[]) {
    const model = builders[id]();
    model.visible = false;
    model.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.castShadow = false;
        child.receiveShadow = false;
        child.frustumCulled = false;
      }
    });
    group.add(model);
    weapons.set(id, model);
  }

  // Éclair de bouche.
  const flashCanvas = document.createElement("canvas");
  flashCanvas.width = 64;
  flashCanvas.height = 64;
  const ctx = flashCanvas.getContext("2d");
  if (ctx) {
    const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    gradient.addColorStop(0, "rgba(255,245,214,1)");
    gradient.addColorStop(0.35, "rgba(255,196,92,0.85)");
    gradient.addColorStop(1, "rgba(255,150,40,0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 64, 64);
  }
  const flashTexture = new THREE.CanvasTexture(flashCanvas);
  const flashMaterial = new THREE.SpriteMaterial({
    map: flashTexture,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: false,
  });
  const flash = new THREE.Sprite(flashMaterial);
  flash.scale.setScalar(0.34);
  flash.visible = false;
  group.add(flash);

  const lamp = new THREE.PointLight(0xffe4bc, 0.35, 4.2, 2);
  lamp.position.set(0.05, -0.12, -0.3);
  group.add(lamp);

  let current: WeaponId = "machette";
  let recoil = 0;
  let recoilVelocity = 0;
  let slashPhase = 0;
  let flashTimer = 0;
  let sway = 0;
  let aimingAmount = 0;
  let aimingTarget = 0;
  let lampIntensity = 0.35;
  let clock = 0;

  const setWeapon = (id: WeaponId) => {
    current = id;
    for (const [key, model] of weapons) model.visible = key === id;
    weaponBarrelTip();
  };

  /** Position de la bouche du canon, dans l'espace du groupe. */
  const weaponBarrelTip = () => {
    switch (current) {
      case "pistolet":
        flash.position.set(0, 0.028, -0.18);
        flash.scale.setScalar(0.26);
        break;
      case "m16":
        flash.position.set(0, 0.012, -0.7);
        flash.scale.setScalar(0.4);
        break;
      case "lance":
        flash.position.set(0, -0.01, -1.75);
        flash.scale.setScalar(0.12);
        break;
      default:
        flash.position.set(0, -0.02, -0.4);
        flash.scale.setScalar(0.2);
    }
  };

  setWeapon("machette");

  return {
    group,
    setLamp(intensity: number) {
      lampIntensity = intensity;
    },
    setWeapon,
    setAiming(aiming: boolean) {
      aimingTarget = aiming ? 1 : 0;
    },
    kick(strength = 1) {
      recoilVelocity += 2.6 * strength;
      if (current === "pistolet" || current === "m16") {
        flashTimer = 0.055;
        flash.visible = true;
      }
    },
    slash() {
      slashPhase = 1;
    },
    update(dt: number, moving: boolean, aiming: boolean) {
      clock += dt;
      aimingTarget = aiming ? 1 : aimingTarget;
      aimingAmount += (aimingTarget - aimingAmount) * Math.min(1, dt * 9);

      // Ressort de recul : oscillateur amorti, pas une simple décroissance.
      recoilVelocity -= recoil * 90 * dt;
      recoilVelocity *= Math.exp(-9 * dt);
      recoil += recoilVelocity * dt;

      if (slashPhase > 0) slashPhase = Math.max(0, slashPhase - dt * 4.2);

      sway += dt * (moving ? 7 : 2.2);
      const bobX = Math.sin(sway) * (moving ? 0.011 : 0.0025);
      const bobY = Math.abs(Math.cos(sway)) * (moving ? 0.009 : 0.0018);
      const swayX = Math.sin(clock * 0.7) * 0.004;

      const target = REST.clone().lerp(AIM, aimingAmount);
      group.position.set(
        target.x + bobX + swayX,
        target.y + bobY - recoil * 0.02,
        target.z + recoil * 0.07,
      );
      group.rotation.set(
        recoil * 0.22 + Math.sin(clock * 0.9) * 0.004,
        0.06 + Math.sin(clock * 0.55) * 0.008,
        -slashPhase * 0.9 - recoil * 0.05,
      );

      if (flashTimer > 0) {
        flashTimer -= dt;
        if (flashTimer <= 0) flash.visible = false;
      }
      lamp.intensity = lampIntensity;
      // L'éclair allume brièvement le sous-bois.
      if (flash.visible) lamp.intensity = lampIntensity + 4.5;
    },
    dispose() {
      flashTexture.dispose();
      flashMaterial.dispose();
      group.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose();
          const material = child.material;
          if (Array.isArray(material)) material.forEach((m) => m.dispose());
          else material.dispose();
        }
      });
      group.removeFromParent();
    },
  };
}
