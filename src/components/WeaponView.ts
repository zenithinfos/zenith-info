/**
 * Vue subjective : les avant-bras du personnage et l'arme qu'ils tiennent.
 *
 * Un jeu de tir sans arme visible ne ressemble à rien — on déclenche un effet
 * et il ne se passe rien. Ici chaque arme est un vrai modèle tenu par deux
 * avant-bras : canon, crosse, chargeur, garde-main, lame et poignée sont
 * modélisés, et le recul est une animation, pas un simple écran qui tremble.
 *
 * Les armes viennent de `WeaponModels.ts` : ce sont les mêmes objets que le
 * personnage en pied tient dans la main (HumanModel), simplement posés devant
 * la caméra avec des bras autour.
 *
 * Les armes sont des enfants de la caméra : elles ne peuvent donc pas passer
 * derrière la végétation. C'est le compromis classique de la vue subjective,
 * et il est invisible à l'œil.
 */

import * as THREE from "three";
import { type WeaponId } from "@/game/hunting";
import { createWeaponModel, disposeWeaponModel, type WeaponModel } from "./WeaponModels";

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

/**
 * Position et orientation de chaque avant-bras autour de son arme — reprises
 * du modèle d'origine, elles sont réglées à l'œil et ne se déduisent pas.
 */
type Placement = [[number, number, number], [number, number, number]];

const ARMS: Record<WeaponId, { right: Placement; left?: Placement }> = {
  pistolet: {
    right: [[0.012, -0.05, 0.045], [0.1, -0.25, 0.2]],
    left: [[-0.038, -0.062, 0.02], [0.15, 0.5, -0.35]],
  },
  fusil: {
    right: [[0.016, -0.06, 0.04], [0.08, -0.2, 0.18]],
    left: [[-0.03, -0.069, -0.3], [0.24, 0.42, -0.34]],
  },
  m16: {
    right: [[0.016, -0.06, 0.04], [0.08, -0.2, 0.18]],
    left: [[-0.03, -0.069, -0.2], [0.24, 0.42, -0.34]],
  },
  couteau: {
    right: [[0.01, -0.055, 0.06], [0.2, -0.2, 0.16]],
  },
  machette: {
    right: [[0.01, -0.055, 0.06], [0.2, -0.2, 0.16]],
  },
  lance: {
    right: [[0.02, -0.06, 0.05], [0.12, -0.24, 0.2]],
    left: [[-0.03, -0.075, -0.24], [0.18, 0.35, -0.28]],
  },
};

const REST = new THREE.Vector3(0.17, -0.19, -0.42);
const AIM = new THREE.Vector3(0.0, -0.115, -0.34);

/**
 * Le coup de lame, dans l'espace de la caméra.
 *
 * La vue subjective ne montrait qu'une rotation de 0,9 rad : la machette
 * s'inclinait sur place. Un coup, c'est trois temps — la lame recule et monte
 * (armé), elle part en diagonale vers le bas et la gauche (frappe), elle
 * revient. Ces deux poses sont les deux extrémités du trajet ; la courbe
 * partagée avec le corps (`strikeWeight`) les relie.
 *
 * `wind` et `cut` sont des **décalages** par rapport à la pose de repos, pas
 * des positions absolues : le balancement de marche continue de s'appliquer
 * par-dessus.
 */
interface ViewStrike {
  wind: { p: [number, number, number]; r: [number, number, number] };
  cut: { p: [number, number, number]; r: [number, number, number] };
  /** Durée du coup en secondes, accordée à celle du personnage en pied. */
  duration: number;
}

export const VIEW_STRIKES: Record<string, ViewStrike> = {
  // Machette : armé au-dessus de l'épaule droite, taille descendante vers la
  // gauche. Débattement de 34 cm sur la garde, 1,6 rad en travers.
  machette: {
    wind: { p: [0.05, 0.07, 0.1], r: [0.55, 0.38, 0.5] },
    cut: { p: [-0.19, -0.17, -0.24], r: [-0.75, -0.62, -0.55] },
    duration: 0.66,
  },
  // Couteau : plus court, plus direct. L'armé reste près du buste.
  couteau: {
    wind: { p: [0.04, 0.05, 0.08], r: [0.45, 0.32, 0.42] },
    cut: { p: [-0.14, -0.13, -0.2], r: [-0.6, -0.5, -0.45] },
    duration: 0.56,
  },
  // Lance : pas de taille, un estoc. Recul de 18 cm, poussée de 46 cm en
  // avant, presque sans rotation.
  lance: {
    wind: { p: [0.03, 0.02, 0.18], r: [0.12, 0.14, 0.06] },
    cut: { p: [-0.06, -0.05, -0.46], r: [-0.1, -0.1, -0.04] },
    duration: 0.72,
  },
};

/** Courbe du geste, identique à celle de `HumanModel` — les deux corps bougent ensemble. */
export function strikeWeight(p: number): number {
  const climb = THREE.MathUtils.smoothstep(p, 0, 0.26);
  const fall = 1 - THREE.MathUtils.smoothstep(p, 0.8, 1);
  return climb * fall;
}

export function strikeEase(p: number): number {
  const t = THREE.MathUtils.clamp((p - 0.26) / (0.72 - 0.26), 0, 1);
  return Math.pow(THREE.MathUtils.smoothstep(t, 0, 1), 0.95);
}

export function createViewModel(): ViewModel {
  const group = new THREE.Group();
  const skin = skinMaterial();
  const sleeve = sleeveMaterial();

  const weapons = new Map<WeaponId, THREE.Group>();
  const models: WeaponModel[] = [];
  const armGeometries: THREE.BufferGeometry[] = [];

  for (const id of Object.keys(ARMS) as WeaponId[]) {
    const holder = new THREE.Group();
    const model = createWeaponModel(id);
    models.push(model);
    holder.add(model.group);

    model.group.traverse((child) => {
      if (child instanceof THREE.Mesh) child.frustumCulled = false;
    });

    const layout = ARMS[id];
    const right = makeArm(skin, sleeve, false);
    right.position.set(...layout.right[0]);
    right.rotation.set(...layout.right[1]);
    holder.add(right);

    for (const child of right.children) {
      if (child instanceof THREE.Mesh) armGeometries.push(child.geometry);
    }

    if (layout.left) {
      const left = makeArm(skin, sleeve, true);
      left.position.set(...layout.left[0]);
      left.rotation.set(...layout.left[1]);
      holder.add(left);
      for (const child of left.children) {
        if (child instanceof THREE.Mesh) armGeometries.push(child.geometry);
      }
    }

    holder.visible = false;
    holder.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.castShadow = false;
        child.receiveShadow = false;
        child.frustumCulled = false;
      }
    });
    group.add(holder);
    weapons.set(id, holder);
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

  /** Place l'éclair et rentre l'arme au repos : léger décalage vers le bas. */
  const placeFlash = () => {
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

  const setWeapon = (id: WeaponId) => {
    current = id;
    for (const [key, model] of weapons) model.visible = key === id;
    placeFlash();
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

      // Le coup dure le temps de l'arme : le même timing que le personnage en
      // pied, sans quoi la vue subjective et le corps se désynchronisent.
      const strike = VIEW_STRIKES[current];
      const slashDuration = strike?.duration ?? 0.5;
      if (slashPhase > 0) slashPhase = Math.max(0, slashPhase - dt / slashDuration);

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
        -recoil * 0.05,
      );

      // Superposition du coup : le holdeur avance/reste, la main suit l'arme.
      if (strike && slashPhase > 0) {
        const progress = 1 - slashPhase;
        const weight = strikeWeight(progress);
        const eased = strikeEase(progress);
        group.position.x += THREE.MathUtils.lerp(strike.wind.p[0], strike.cut.p[0], eased) * weight;
        group.position.y += THREE.MathUtils.lerp(strike.wind.p[1], strike.cut.p[1], eased) * weight;
        group.position.z += THREE.MathUtils.lerp(strike.wind.p[2], strike.cut.p[2], eased) * weight;
        group.rotation.x += THREE.MathUtils.lerp(strike.wind.r[0], strike.cut.r[0], eased) * weight;
        group.rotation.y += THREE.MathUtils.lerp(strike.wind.r[1], strike.cut.r[1], eased) * weight;
        group.rotation.z += THREE.MathUtils.lerp(strike.wind.r[2], strike.cut.r[2], eased) * weight;
      }

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
      for (const model of models) disposeWeaponModel(model);
      for (const geometry of armGeometries) geometry.dispose();
      skin.dispose();
      sleeve.dispose();
      group.removeFromParent();
    },
  };
}
