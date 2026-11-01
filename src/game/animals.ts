/**
 * Faune vivante — module pur.
 *
 * `fauna.ts` décrit les espèces (rareté, habitat, comportement). Ici on
 * simule les individus : ils se déplacent, ils paissent, ils fuient, ils
 * chargent, ils meurent et ils se dépecent. Aucune dépendance à Three.js : le
 * rendu reçoit un instantané et se contente de le dessiner.
 *
 * Chaque espèce porte aussi sa **morphologie** (`ANIMAL_BUILDS`) : hauteur au
 * garrot, longueur, pattes, cou, cornes, robe. C'est la source unique partagée
 * par le modèle 3D et par la boîte de collision — un éléphant qu'on vise doit
 * occuper exactement le volume de l'éléphant qu'on voit.
 */

import { terrainHeight } from "./terrain";
import { SPECIES, getSpecies, spawnFor, type Species } from "./fauna";
import { waterField } from "./water";

export type BuildKind = "quadrupede" | "primate" | "oiseau";
export type HornKind = "aucune" | "droite" | "lyre" | "defense";
export type CoatPattern = "uni" | "rayures" | "taches" | "ecailles";

export interface SpeciesBuild {
  kind: BuildKind;
  /** Hauteur du garrot (haut du dos), en unités (1 = 1 m). */
  shoulder: number;
  /** Longueur du tronc. */
  length: number;
  /** Demi-hauteur du tronc (rayon). */
  girth: number;
  neck: number;
  head: number;
  muzzle: number;
  ears: number;
  horn: HornKind;
  hornLength: number;
  tail: number;
  /** Robe principale, ventre, extrémités (couleurs Three). */
  coat: number;
  belly: number;
  accent: number;
  pattern: CoatPattern;
  /** Résistance : dégâts cumulés nécessaires pour tuer. */
  health: number;
  /** Vitesse de fuite (unités/s). */
  fleeSpeed: number;
  /** Viande récupérable au dépeçage (kg). */
  meat: number;
  /** Rayon de la sphère de collision du tronc. */
  hitRadius: number;
  /** Masse : détermine l'inertie et le recul ressenti. */
  mass: number;
}

/**
 * Morphologies. Les proportions comptent plus que les détails : c'est la
 * silhouette qui fait reconnaître un céphalophe d'un bongo à trente mètres.
 */
export const ANIMAL_BUILDS: Record<string, SpeciesBuild> = {
  elephant: {
    kind: "quadrupede",
    shoulder: 2.35,
    length: 3.4,
    girth: 0.8,
    neck: 0.45,
    head: 0.85,
    muzzle: 0.95,
    ears: 1.0,
    horn: "defense",
    hornLength: 1.5,
    tail: 1.1,
    coat: 0x54524c,
    belly: 0x6b6960,
    accent: 0x3a3934,
    pattern: "uni",
    health: 620,
    fleeSpeed: 3.4,
    meat: 420,
    hitRadius: 1.35,
    mass: 3200,
  },
  gorille: {
    kind: "primate",
    shoulder: 1.1,
    length: 1.0,
    girth: 0.42,
    neck: 0.12,
    head: 0.42,
    muzzle: 0.24,
    ears: 0.08,
    horn: "aucune",
    hornLength: 0,
    tail: 0,
    coat: 0x2c2a26,
    belly: 0x3a3833,
    accent: 0x1d1c1a,
    pattern: "uni",
    health: 190,
    fleeSpeed: 2.6,
    meat: 70,
    hitRadius: 0.72,
    mass: 160,
  },
  chimpanze: {
    kind: "primate",
    shoulder: 0.72,
    length: 0.62,
    girth: 0.27,
    neck: 0.08,
    head: 0.26,
    muzzle: 0.16,
    ears: 0.06,
    horn: "aucune",
    hornLength: 0,
    tail: 0,
    coat: 0x312a22,
    belly: 0x4a4034,
    accent: 0x1b1713,
    pattern: "uni",
    health: 110,
    fleeSpeed: 4.2,
    meat: 28,
    hitRadius: 0.45,
    mass: 55,
  },
  panthere: {
    kind: "quadrupede",
    shoulder: 0.6,
    length: 1.05,
    girth: 0.24,
    neck: 0.22,
    head: 0.24,
    muzzle: 0.2,
    ears: 0.1,
    horn: "aucune",
    hornLength: 0,
    tail: 0.95,
    coat: 0x8a6a34,
    belly: 0xb59a62,
    accent: 0x241a0e,
    pattern: "taches",
    health: 130,
    fleeSpeed: 7.2,
    meat: 38,
    hitRadius: 0.4,
    mass: 60,
  },
  bongo: {
    kind: "quadrupede",
    shoulder: 1.2,
    length: 1.5,
    girth: 0.36,
    neck: 0.6,
    head: 0.28,
    muzzle: 0.3,
    ears: 0.24,
    horn: "lyre",
    hornLength: 0.7,
    tail: 0.45,
    coat: 0x8c4a22,
    belly: 0x2c2018,
    accent: 0xf0e6d2,
    pattern: "rayures",
    health: 105,
    fleeSpeed: 5.4,
    meat: 95,
    hitRadius: 0.62,
    mass: 220,
  },
  sitatunga: {
    kind: "quadrupede",
    shoulder: 0.95,
    length: 1.35,
    girth: 0.3,
    neck: 0.55,
    head: 0.24,
    muzzle: 0.28,
    ears: 0.2,
    horn: "lyre",
    hornLength: 0.55,
    tail: 0.4,
    coat: 0x6b4a30,
    belly: 0x8a6a4a,
    accent: 0x241a12,
    pattern: "rayures",
    health: 85,
    fleeSpeed: 3.8,
    meat: 62,
    hitRadius: 0.5,
    mass: 90,
  },
  hingebe: {
    kind: "quadrupede",
    shoulder: 0.4,
    length: 0.62,
    girth: 0.15,
    neck: 0.18,
    head: 0.15,
    muzzle: 0.16,
    ears: 0.11,
    horn: "droite",
    hornLength: 0.08,
    tail: 0.18,
    coat: 0x5b5448,
    belly: 0x7d7566,
    accent: 0x2e2a24,
    pattern: "uni",
    health: 42,
    fleeSpeed: 4.8,
    meat: 13,
    hitRadius: 0.26,
    mass: 5,
  },
  crocodile: {
    kind: "quadrupede",
    shoulder: 0.3,
    length: 1.7,
    girth: 0.2,
    neck: 0.1,
    head: 0.34,
    muzzle: 0.5,
    ears: 0,
    horn: "aucune",
    hornLength: 0,
    tail: 1.4,
    coat: 0x3c4432,
    belly: 0x555c42,
    accent: 0x22281c,
    pattern: "ecailles",
    health: 150,
    fleeSpeed: 2.2,
    meat: 48,
    hitRadius: 0.42,
    mass: 120,
  },
  calao: {
    kind: "oiseau",
    shoulder: 0.46,
    length: 0.42,
    girth: 0.11,
    neck: 0.08,
    head: 0.13,
    muzzle: 0.22,
    ears: 0,
    horn: "aucune",
    hornLength: 0,
    tail: 0.3,
    coat: 0x14161a,
    belly: 0x2a2d33,
    accent: 0xd8d2b4,
    pattern: "uni",
    health: 18,
    fleeSpeed: 6.5,
    meat: 2.5,
    hitRadius: 0.2,
    mass: 1,
  },
  "perroquet-gris": {
    kind: "oiseau",
    shoulder: 0.28,
    length: 0.26,
    girth: 0.07,
    neck: 0.04,
    head: 0.1,
    muzzle: 0.06,
    ears: 0,
    horn: "aucune",
    hornLength: 0,
    tail: 0.22,
    coat: 0xa8a6a0,
    belly: 0xc4c2bb,
    accent: 0xd94a3a,
    pattern: "uni",
    health: 10,
    fleeSpeed: 7,
    meat: 1,
    hitRadius: 0.13,
    mass: 0.4,
  },
};

export function buildFor(speciesId: string): SpeciesBuild | undefined {
  return ANIMAL_BUILDS[speciesId];
}

/**
 * Hauteur du centre du tronc au-dessus du sol. Le rendu et le calcul de tir
 * lisent la même fonction : on ne touche pas un animal qu'on ne voit pas.
 */
export function bodyCenterY(build: SpeciesBuild): number {
  if (build.kind === "oiseau") return build.shoulder;
  // Le garrot est le point de repère : le dessus du tronc l'atteint, donc le
  // centre du tronc est une demi-hauteur plus bas. Les pattes descendent de
  // là jusqu'au sol — c'est ce qui empêche les animaux de flotter.
  return build.shoulder - build.girth;
}

/** Hauteur du centre de la tête (là où on vise). */
export function headCenterY(build: SpeciesBuild): number {
  if (build.kind === "oiseau") return build.shoulder * 1.62;
  return bodyCenterY(build) + build.girth * 0.5 + build.neck * 0.62;
}

/** Espèces effectivement modélisées et tuables. */
export const HUNTABLE: Species[] = SPECIES.filter((s) => ANIMAL_BUILDS[s.id]);

export type AnimalState = "pature" | "errance" | "fuite" | "charge" | "mort";

export interface Animal {
  id: number;
  speciesId: string;
  x: number;
  z: number;
  /** Hauteur du sol sous l'animal. */
  groundY: number;
  heading: number;
  /** Phase de la démarche (radians) : avance avec la vitesse. */
  gait: number;
  /** Vitesse courante, unités/s. */
  speed: number;
  state: AnimalState;
  health: number;
  maxHealth: number;
  /** Minuterie d'état, en secondes. */
  timer: number;
  /** Niveau d'alerte 0-1 (montre la tête qui se tourne). */
  alert: number;
  /** Cap d'errance. */
  wander: number;
  deadTimer: number;
  harvested: boolean;
  /** Dernier dégât reçu, pour le retour visuel. */
  hitFlash: number;
  /** Échelle individuelle : deux individus ne font pas la même taille. */
  scale: number;
  /** Variation de robe, 0-1. */
  variant: number;
}

export interface HerdContext {
  player: [number, number];
  /** Bruit du joueur (0 immobile, 8 course). */
  noise: number;
  hour: number;
  weather: "sec" | "pluie" | "orage" | "brume";
  zoneId: string;
  /** 0 = forêt vide, 1 = foisonnement. */
  abundance?: number;
  seed?: number;
}

export const MAX_ANIMALS = 14;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let nextId = 1;

/** Un animal est-il à sa place à cet endroit ? */
function placementOk(speciesId: string, x: number, z: number): boolean {
  const field = waterField(x, z);
  const build = ANIMAL_BUILDS[speciesId];
  if (!build) return false;
  const amphibie = speciesId === "crocodile" || speciesId === "sitatunga";
  if (field && field.edge < 0) {
    if (!amphibie) return false;
    if (field.depth > 0.9 && speciesId !== "crocodile") return false;
  }
  // On évite les pentes raides : un animal ne broute pas à flanc de ravin.
  const h = terrainHeight(x, z);
  const hx = terrainHeight(x + 1.2, z);
  const hz = terrainHeight(x, z + 1.2);
  return Math.hypot(hx - h, hz - h) < 0.75;
}

export interface SpawnResult {
  animals: Animal[];
  spawned: Animal[];
}

/**
 * Maintient une population autour du joueur.
 *
 * Les individus apparaissent entre 24 et 46 unités — derrière la brume, jamais
 * sous les yeux — et disparaissent au-delà de 90. Une forêt vierge n'est pas
 * un zoo : on croise une harde tous les cent mètres, pas à chaque pas.
 */
export function stepHerd(
  animals: Animal[],
  ctx: HerdContext,
  dt: number,
  random: () => number = Math.random,
): SpawnResult {
  const abundance = ctx.abundance ?? 1;
  const spawned: Animal[] = [];
  const next: Animal[] = [];

  const [px, pz] = ctx.player;

  for (const animal of animals) {
    const build = ANIMAL_BUILDS[animal.speciesId];
    if (!build) continue;

    const dx = animal.x - px;
    const dz = animal.z - pz;
    const dist = Math.hypot(dx, dz);

    if (animal.state === "mort") {
      animal.deadTimer += dt;
      if (animal.deadTimer > 120 || animal.harvested) continue;
      next.push(animal);
      continue;
    }

    if (dist > 90) continue;

    const species = getSpecies(animal.speciesId);
    const detection = (species?.detectionRadius ?? 24) * (1 + ctx.noise * 0.12);

    // --- perception
    if (dist < detection) {
      animal.alert = Math.min(1, animal.alert + dt * 1.6);
    } else {
      animal.alert = Math.max(0, animal.alert - dt * 0.5);
    }

    const aggressive = species?.behavior === "agressif";
    const canCharge = aggressive && animal.speciesId !== "crocodile";

    if (animal.state !== "charge" && animal.state !== "fuite") {
      if (animal.alert > 0.75 && dist < detection * 0.55) {
        if (canCharge && dist < detection * 0.34 && animal.health > build.health * 0.4) {
          animal.state = "charge";
          animal.timer = 3.5;
        } else {
          animal.state = "fuite";
          animal.timer = 5 + random() * 4;
        }
      }
    }

    animal.timer -= dt;

    switch (animal.state) {
      case "fuite": {
        animal.heading = Math.atan2(dx, dz) + (random() - 0.5) * 0.5;
        animal.speed = build.fleeSpeed;
        if (animal.timer <= 0) {
          animal.state = "errance";
          animal.timer = 3 + random() * 5;
        }
        break;
      }
      case "charge": {
        animal.heading = Math.atan2(-dx, -dz);
        animal.speed = build.fleeSpeed * 1.15;
        if (animal.timer <= 0) {
          animal.state = "fuite";
          animal.timer = 2.5;
        }
        break;
      }
      case "pature": {
        animal.speed = Math.max(0, animal.speed - dt * 1.5);
        if (animal.timer <= 0) {
          animal.state = "errance";
          animal.timer = 2 + random() * 4;
          animal.wander = random() * Math.PI * 2;
        }
        break;
      }
      default: {
        // Err ance : marche lente, changements de cap progressifs.
        if (animal.timer <= 0) {
          animal.state = random() < 0.45 ? "pature" : "errance";
          animal.timer = 1.5 + random() * 3.5;
          animal.wander += (random() - 0.5) * 1.6;
        }
        animal.heading += (animal.wander - animal.heading) * dt * 1.2;
        animal.speed = Math.min(build.fleeSpeed * 0.22, animal.speed + dt * 0.6);
        break;
      }
    }

    // --- déplacement, avec refus des mauvais terrains
    const step = animal.speed * dt;
    if (step > 0) {
      const nx = animal.x + Math.sin(animal.heading) * step;
      const nz = animal.z + Math.cos(animal.heading) * step;
      if (placementOk(animal.speciesId, nx, nz)) {
        animal.x = nx;
        animal.z = nz;
        animal.gait += step * (2.4 + build.mass * 0.0006);
      } else {
        // Obstacle : on tourne franchement plutôt que de pousser dedans.
        animal.heading += (random() < 0.5 ? -1 : 1) * (1.1 + random());
        animal.wander = animal.heading;
        animal.speed *= 0.4;
      }
    }
    animal.groundY = terrainHeight(animal.x, animal.z);

    // --- retour visuel du tir
    if (animal.hitFlash > 0) animal.hitFlash = Math.max(0, animal.hitFlash - dt * 3);

    next.push(animal);
  }

  // --- apparitions
  const population = next.filter((a) => a.state !== "mort").length;
  const target = Math.min(
    MAX_ANIMALS,
    Math.round((2 + abundance * 7) * (ctx.weather === "pluie" ? 1.15 : 1)),
  );

  if (population < target && random() < dt * 0.55) {
    const present = spawnFor({
      zoneId: ctx.zoneId,
      hour: ctx.hour,
      weather: ctx.weather,
      noise: ctx.noise,
      seed: ctx.seed,
    }).filter((s) => ANIMAL_BUILDS[s.id]);

    if (present.length) {
      const species = present[Math.floor(random() * present.length)];
      for (let attempt = 0; attempt < 8; attempt++) {
        const angle = random() * Math.PI * 2;
        const distance = 24 + random() * 22;
        const x = px + Math.cos(angle) * distance;
        const z = pz + Math.sin(angle) * distance;
        if (!placementOk(species.id, x, z)) continue;
        const build = ANIMAL_BUILDS[species.id];
        const animal: Animal = {
          id: nextId++,
          speciesId: species.id,
          x,
          z,
          groundY: terrainHeight(x, z),
          heading: random() * Math.PI * 2,
          gait: random() * 6.28,
          speed: 0,
          state: "pature",
          health: build.health,
          maxHealth: build.health,
          timer: 1 + random() * 3,
          alert: 0,
          wander: random() * Math.PI * 2,
          deadTimer: 0,
          harvested: false,
          hitFlash: 0,
          scale: 0.92 + random() * 0.16,
          variant: random(),
        };
        next.push(animal);
        spawned.push(animal);
        break;
      }
    }
  }

  return { animals: next, spawned };
}

export interface DamageResult {
  killed: boolean;
  /** Dégâts réellement appliqués. */
  damage: number;
  /** L'animal a-t-il fui sous le coup ? */
  fled: boolean;
}

/**
 * Applique un tir. Un animal touché sans être tué panique : c'est ce qui rend
 * la chasse lisible — on voit l'animal réagir au lieu de disparaître.
 */
export function applyDamage(animal: Animal, damage: number): DamageResult {
  const build = ANIMAL_BUILDS[animal.speciesId];
  if (!build || animal.state === "mort") {
    return { killed: false, damage: 0, fled: false };
  }
  animal.health -= damage;
  animal.hitFlash = 1;
  animal.alert = 1;
  if (animal.health <= 0) {
    animal.health = 0;
    animal.state = "mort";
    animal.deadTimer = 0;
    animal.speed = 0;
    return { killed: true, damage, fled: false };
  }
  animal.state = "fuite";
  animal.timer = 6 + Math.random() * 4;
  return { killed: false, damage, fled: true };
}

/** Animal le plus proche d'une position, dans un rayon donné. */
export function nearestCarcass(
  animals: Animal[],
  x: number,
  z: number,
  range = 3.2,
): Animal | null {
  let best: Animal | null = null;
  let bestDistance = range;
  for (const animal of animals) {
    if (animal.state !== "mort" || animal.harvested) continue;
    const distance = Math.hypot(animal.x - x, animal.z - z);
    if (distance < bestDistance) {
      best = animal;
      bestDistance = distance;
    }
  }
  return best;
}

export interface HarvestResult {
  meat: number;
  speciesId: string;
  name: string;
}

/** Dépeçage : transforme une carcasse en viande. */
export function harvest(animal: Animal): HarvestResult | null {
  const build = ANIMAL_BUILDS[animal.speciesId];
  const species = getSpecies(animal.speciesId);
  if (!build || animal.harvested || animal.state !== "mort") return null;
  animal.harvested = true;
  return {
    meat: Math.round(build.meat * animal.scale),
    speciesId: animal.speciesId,
    name: species?.name ?? animal.speciesId,
  };
}

/** Nombre de bêtes abattues, par espèce. */
export function tallyKills(animals: Animal[]): Record<string, number> {
  const tally: Record<string, number> = {};
  for (const animal of animals) {
    if (animal.state !== "mort") continue;
    tally[animal.speciesId] = (tally[animal.speciesId] ?? 0) + 1;
  }
  return tally;
}

export function resetAnimalIds() {
  nextId = 1;
}

export { mulberry32 };
