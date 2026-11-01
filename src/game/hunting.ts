/**
 * Armes et tir — module pur.
 *
 * Il y a deux familles : les lames (silencieuses, il faut toucher) et les
 * armes à feu (portée, bruit, munitions). Le calcul de tir se fait ici, sur
 * les mêmes volumes que ceux dessinés par le rendu : un tir ne touche que ce
 * que l'œil voit.
 *
 * Rien ne dépend de Three.js : on peut tester une arme sans ouvrir un
 * navigateur (voir scripts/check-hunt.mjs).
 */

import { type Animal, ANIMAL_BUILDS, applyDamage, bodyCenterY, headCenterY } from "./animals";

export type WeaponId = "couteau" | "machette" | "lance" | "pistolet" | "m16";

export interface Weapon {
  id: WeaponId;
  name: string;
  /** Libellé court pour la barre d'armes. */
  short: string;
  kind: "lame" | "feu";
  /** Dégâts par touche (une tête multiplie par la précision). */
  damage: number;
  /** Portée effective, en unités. */
  range: number;
  /** Délai minimal entre deux tirs, en secondes. */
  cooldown: number;
  /** Balles par chargeur (0 pour une lame). */
  magazine: number;
  /** Temps de rechargement, en secondes. */
  reload: number;
  /** Réserve initiale. */
  reserve: number;
  /** Dispersion en radians (0 = précision parfaite). */
  spread: number;
  /** Bruit produit : attire ou fait fuir la faune. */
  noise: number;
  /** Tir automatique en maintenant la gâchette. */
  automatic: boolean;
  /** Multiplicateur de dégâts à la tête. */
  headshot: number;
  description: string;
}

export const WEAPONS: Weapon[] = [
  {
    id: "couteau",
    name: "Couteau de camp",
    short: "Couteau",
    kind: "lame",
    damage: 55,
    range: 1.9,
    cooldown: 0.45,
    magazine: 0,
    reload: 0,
    reserve: 0,
    spread: 0.18,
    noise: 0.5,
    automatic: true,
    headshot: 2,
    description:
      "Silencieux et toujours disponible. Il faut arriver au contact : sur un animal qui fuit, c'est presque impossible.",
  },
  {
    id: "machette",
    name: "Machette",
    short: "Machette",
    kind: "lame",
    damage: 80,
    range: 2.2,
    cooldown: 0.75,
    magazine: 0,
    reload: 0,
    reserve: 0,
    spread: 0.12,
    noise: 1,
    automatic: true,
    headshot: 1.8,
    description: "L'outil de défrichement : large, lourd, redoutable à bout portant.",
  },
  {
    id: "lance",
    name: "Lance de chasse",
    short: "Lance",
    kind: "lame",
    damage: 70,
    range: 3.1,
    cooldown: 1.1,
    magazine: 0,
    reload: 0,
    reserve: 0,
    spread: 0.1,
    noise: 0.6,
    automatic: true,
    headshot: 1.6,
    description: "Portée d'estoc plus longue que la machette, cadence plus lente.",
  },
  {
    id: "pistolet",
    name: "Pistolet 9 mm",
    short: "Pistolet",
    kind: "feu",
    damage: 58,
    range: 55,
    cooldown: 0.26,
    magazine: 12,
    reload: 1.7,
    reserve: 36,
    spread: 0.014,
    noise: 6,
    automatic: false,
    headshot: 2.4,
    description: "Léger, rapide à épauler. Suffisant pour un céphalophe, pas pour un éléphant.",
  },
  {
    id: "m16",
    name: "Carabine M16",
    short: "M16",
    kind: "feu",
    damage: 96,
    range: 150,
    cooldown: 0.095,
    magazine: 30,
    reload: 2.4,
    reserve: 90,
    spread: 0.006,
    noise: 10,
    automatic: true,
    headshot: 2.2,
    description: "Tir en rafale, portée longue. Le bruit porte à des kilomètres.",
  },
];

export function getWeapon(id: WeaponId): Weapon {
  return WEAPONS.find((weapon) => weapon.id === id) ?? WEAPONS[0];
}

export interface WeaponState {
  id: WeaponId;
  /** Balles engagées dans l'arme. */
  loaded: number;
  /** Munitions de réserve. */
  reserve: number;
}

export function initialArsenal(): WeaponState[] {
  return WEAPONS.map((weapon) => ({
    id: weapon.id,
    loaded: weapon.magazine,
    reserve: weapon.reserve,
  }));
}

export interface ArsenalState {
  weapons: WeaponState[];
  current: WeaponId;
}

export function initialArsenalState(): ArsenalState {
  return { weapons: initialArsenal(), current: "machette" };
}

export function weaponStateOf(arsenal: ArsenalState, id: WeaponId): WeaponState {
  return arsenal.weapons.find((w) => w.id === id) ?? { id, loaded: 0, reserve: 0 };
}

/** Recharge : transfère depuis la réserve, jamais au-delà du chargeur. */
export function reloadWeapon(arsenal: ArsenalState, id: WeaponId): ArsenalState {
  const weapon = getWeapon(id);
  if (weapon.magazine === 0) return arsenal;
  return {
    ...arsenal,
    weapons: arsenal.weapons.map((state) => {
      if (state.id !== id) return state;
      const missing = weapon.magazine - state.loaded;
      const moved = Math.min(missing, state.reserve);
      return { ...state, loaded: state.loaded + moved, reserve: state.reserve - moved };
    }),
  };
}

export interface Ray {
  origin: [number, number, number];
  direction: [number, number, number];
}

export interface ShotHit {
  animalId: number;
  speciesId: string;
  distance: number;
  headshot: boolean;
  damage: number;
  killed: boolean;
}

export interface ShotReport {
  /** Le coup est-il parti ? (false = pas de balle, arme en recharge…) */
  fired: boolean;
  reason?: "munitions" | "recharge" | "cadence" | "lame";
  weapon: Weapon;
  /** Munitions après le coup. */
  loaded: number;
  reserve: number;
  hit: ShotHit | null;
  /** Bruit émis : la forêt sait où vous êtes. */
  noise: number;
}

/** Intersection rayon/sphère : distance t, ou null. */
function raySphere(ray: Ray, center: [number, number, number], radius: number): number | null {
  const ox = ray.origin[0] - center[0];
  const oy = ray.origin[1] - center[1];
  const oz = ray.origin[2] - center[2];
  const dx = ray.direction[0];
  const dy = ray.direction[1];
  const dz = ray.direction[2];
  const b = ox * dx + oy * dy + oz * dz;
  const c = ox * ox + oy * oy + oz * oz - radius * radius;
  const discriminant = b * b - c;
  if (discriminant < 0) return null;
  const root = Math.sqrt(discriminant);
  const t1 = -b - root;
  const t2 = -b + root;
  if (t1 > 0.05) return t1;
  if (t2 > 0.05) return t2;
  return null;
}

function normalize(vector: [number, number, number]): [number, number, number] {
  const length = Math.hypot(vector[0], vector[1], vector[2]) || 1;
  return [vector[0] / length, vector[1] / length, vector[2] / length];
}

function cross(
  a: [number, number, number],
  b: [number, number, number],
): [number, number, number] {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

/** Applique la dispersion : dévie le rayon dans un cône autour de l'axe. */
function spreadRay(ray: Ray, spread: number, random: () => number): Ray {
  if (spread <= 0) return ray;
  const d = normalize(ray.direction);
  const up: [number, number, number] = Math.abs(d[1]) > 0.95 ? [0, 0, 1] : [0, 1, 0];
  const u = normalize(cross(up, d));
  const v = cross(d, u);

  const angle = random() * Math.PI * 2;
  // Racine carrée : répartition uniforme dans le disque, pas au centre.
  const radius = Math.sqrt(random()) * spread;
  const ax = Math.cos(angle) * radius;
  const ay = Math.sin(angle) * radius;
  return {
    origin: ray.origin,
    direction: normalize([
      d[0] + u[0] * ax + v[0] * ay,
      d[1] + u[1] * ax + v[1] * ay,
      d[2] + u[2] * ax + v[2] * ay,
    ]),
  };
}

/**
 * Résout un tir contre la faune.
 *
 * `animals` est modifié en place : les dégâts sont appliqués aux animaux
 * touchés. Le rendu se contente ensuite de lire l'état.
 */
export function fireWeapon(
  weaponId: WeaponId,
  arsenal: ArsenalState,
  animals: Animal[],
  aim: Ray,
  now: number,
  lastShotAt: number,
  random: () => number = Math.random,
): { report: ShotReport; arsenal: ArsenalState; lastShotAt: number } {
  const weapon = getWeapon(weaponId);
  const state = weaponStateOf(arsenal, weaponId);
  const canFire = weapon.kind === "lame" || state.loaded > 0;

  if (!canFire) {
    return {
      report: {
        fired: false,
        reason: "munitions",
        weapon,
        loaded: state.loaded,
        reserve: state.reserve,
        hit: null,
        noise: 0,
      },
      arsenal,
      lastShotAt,
    };
  }
  if (now - lastShotAt < weapon.cooldown * 1000) {
    return {
      report: {
        fired: false,
        reason: "cadence",
        weapon,
        loaded: state.loaded,
        reserve: state.reserve,
        hit: null,
        noise: 0,
      },
      arsenal,
      lastShotAt,
    };
  }

  const direction = normalize(aim.direction);
  const ray = spreadRay({ origin: aim.origin, direction }, weapon.spread, random);

  let best: ShotHit | null = null;
  let bestT = Infinity;

  for (const animal of animals) {
    if (animal.state === "mort") continue;
    const build = ANIMAL_BUILDS[animal.speciesId];
    if (!build) continue;

    const body: [number, number, number] = [
      animal.x,
      animal.groundY + bodyCenterY(build) * animal.scale,
      animal.z,
    ];
    const bodyT = raySphere(ray, body, build.hitRadius * animal.scale);
    const head: [number, number, number] = [
      animal.x,
      animal.groundY + headCenterY(build) * animal.scale,
      animal.z,
    ];
    const headT = raySphere(ray, head, Math.max(0.09, build.hitRadius * 0.45) * animal.scale);

    const isHead = headT !== null && (bodyT === null || headT <= bodyT + 0.15);
    const t = isHead ? headT : bodyT;
    if (t === null || t > weapon.range || t >= bestT) continue;

    bestT = t;
    const falloff = weapon.kind === "feu" ? 1 - 0.3 * Math.min(1, t / weapon.range) : 1;
    const damage = Math.round(
      weapon.damage * (isHead ? weapon.headshot : 1) * falloff * (0.9 + random() * 0.2),
    );
    const result = applyDamage(animal, damage);
    best = {
      animalId: animal.id,
      speciesId: animal.speciesId,
      distance: t,
      headshot: isHead,
      damage: result.damage,
      killed: result.killed,
    };
    if (result.killed) break;
  }

  const nextArsenal: ArsenalState =
    weapon.kind === "feu"
      ? {
          ...arsenal,
          weapons: arsenal.weapons.map((entry) =>
            entry.id === weaponId ? { ...entry, loaded: Math.max(0, entry.loaded - 1) } : entry,
          ),
        }
      : arsenal;

  return {
    report: {
      fired: true,
      weapon,
      loaded: weaponStateOf(nextArsenal, weaponId).loaded,
      reserve: weaponStateOf(nextArsenal, weaponId).reserve,
      hit: best,
      noise: weapon.noise,
    },
    arsenal: nextArsenal,
    lastShotAt: now,
  };
}

/** Champ de vision : sert au HUD pour désigner l'animal visé. */
export function aimTarget(animals: Animal[], aim: Ray, maxDistance = 60): Animal | null {
  const ray = { origin: aim.origin, direction: normalize(aim.direction) };
  let best: Animal | null = null;
  let bestT = maxDistance;
  for (const animal of animals) {
    if (animal.state === "mort") continue;
    const build = ANIMAL_BUILDS[animal.speciesId];
    if (!build) continue;
    const t = raySphere(
      ray,
      [animal.x, animal.groundY + bodyCenterY(build) * animal.scale, animal.z],
      build.hitRadius * animal.scale * 1.1,
    );
    if (t !== null && t < bestT) {
      best = animal;
      bestT = t;
    }
  }
  return best;
}
