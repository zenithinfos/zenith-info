/**
 * Configuration de la scène Three.js : palette, brouillard, lumières,
 * textures procédurales et budgets de rendu.
 */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface FogConfig {
  color: number;
  near: number;
  far: number;
}

export interface LightingConfig {
  ambient: { color: number; intensity: number };
  sun: { color: number; intensity: number; position: Vec3 };
  hemisphere: { sky: number; ground: number; intensity: number };
  /** Couleur de lumière de nuit (lune). */
  moon: { color: number; intensity: number };
}

export interface SceneConfig {
  background: number;
  fog: FogConfig;
  lighting: LightingConfig;
  ground: { size: number; segments: number; texture: string };
  shadows: { enabled: boolean; mapSize: number; bias: number };
  /** Budget de pixels par frame (0-1) pour tenir 60 fps sur mobile. */
  pixelRatioCap: number;
  antialias: boolean;
  toneMapping: "aces" | "reinhard" | "linear";
  exposure: number;
  camera: { fov: number; near: number; far: number; height: number };
}

export const FOREST_PALETTE = {
  canopy: 0x1f3d24,
  moss: 0x35502c,
  bark: 0x4a3a2a,
  earth: 0x6b4a2f,
  laterite: 0x9a4f2b,
  river: 0x1e3b3a,
  skyDay: 0x9fc4d8,
  skyDusk: 0xd98a56,
  skyNight: 0x0a1420,
  fogDay: 0x5f7d64,
  fogNight: 0x0b1512,
  sun: 0xffe9c4,
  moon: 0x9fb4d0,
} as const;

export const SCENE_CONFIG: SceneConfig = {
  background: FOREST_PALETTE.skyDay,
  fog: { color: FOREST_PALETTE.fogDay, near: 18, far: 165 },
  lighting: {
    ambient: { color: 0xffffff, intensity: 0.42 },
    sun: { color: FOREST_PALETTE.sun, intensity: 2.1, position: { x: 60, y: 110, z: 40 } },
    hemisphere: { sky: 0x9fc4d8, ground: 0x2c3a24, intensity: 0.55 },
    moon: { color: FOREST_PALETTE.moon, intensity: 0.35 },
  },
  ground: { size: 520, segments: 96, texture: "/textures/ground.jpg" },
  shadows: { enabled: true, mapSize: 2048, bias: -0.0008 },
  pixelRatioCap: 1.75,
  antialias: true,
  toneMapping: "aces",
  exposure: 1.05,
  camera: { fov: 62, near: 0.1, far: 700, height: 2.2 },
};

/** Ajuste brouillard, exposition et lumières selon l'heure du monde. */
export function configForHour(
  base: SceneConfig,
  hour: number,
  weather: "sec" | "pluie" | "orage" | "brume" = "sec",
): SceneConfig {
  const daylight =
    hour < 5 || hour >= 20
      ? 0
      : hour < 7.5
        ? (hour - 5) / 2.5
        : hour < 17.5
          ? 1
          : Math.max(0, 1 - (hour - 17.5) / 2.5);

  const sky =
    daylight > 0.55
      ? FOREST_PALETTE.skyDay
      : daylight > 0.12
        ? FOREST_PALETTE.skyDusk
        : FOREST_PALETTE.skyNight;

  const visibilityFactor =
    weather === "brume" ? 0.45 : weather === "orage" ? 0.6 : weather === "pluie" ? 0.72 : 1;

  return {
    ...base,
    background: sky,
    fog: {
      color: daylight < 0.2 ? FOREST_PALETTE.fogNight : FOREST_PALETTE.fogDay,
      near: base.fog.near * visibilityFactor,
      far: base.fog.far * visibilityFactor * (0.55 + daylight * 0.45),
    },
    lighting: {
      ...base.lighting,
      ambient: { ...base.lighting.ambient, intensity: 0.12 + daylight * 0.35 },
      sun: { ...base.lighting.sun, intensity: 0.05 + daylight * 2.1 },
      moon: { ...base.lighting.moon, intensity: (1 - daylight) * 0.4 },
    },
    exposure: 0.75 + daylight * 0.4,
  };
}

/** Textures utilisées par la végétation instanciée. */
export const TEXTURES = {
  ground: "/textures/ground.jpg",
  bark: "/textures/bark.jpg",
  bigleaf: "/textures/bigleaf.png",
  fern: "/textures/fern.png",
  foliage: "/textures/foliage.png",
  foliageDeep: "/textures/foliage-deep.png",
  foliagePale: "/textures/foliage-pale.png",
  canopy: "/textures/canopy.png",
  mist: "/textures/mist.png",
  rock: "/textures/rock.jpg",
  waterNormal: "/textures/water_normal.jpg",
} as const;

/**
 * Budgets de rendu.
 *
 * `trees` compte les arbres de canopée (chacun porte plusieurs cartes de
 * feuillage) ; `understory` les bouquets de sous-bois. La densité visée est
 * celle d'une forêt de terre ferme du bassin du Congo : on ne voit jamais le
 * ciel depuis le sentier, sauf dans les bais.
 */
export function qualityBudget(
  isMobile: boolean,
  reducedMotion: boolean,
): {
  trees: number;
  understory: number;
  ferns: number;
  rocks: number;
  logs: number;
  birds: number;
  shafts: number;
  shadowMapSize: number;
  pixelRatio: number;
} {
  if (reducedMotion) {
    return {
      trees: 900,
      understory: 2600,
      ferns: 600,
      rocks: 40,
      logs: 20,
      birds: 4,
      shafts: 6,
      shadowMapSize: 512,
      pixelRatio: 1,
    };
  }
  if (isMobile) {
    return {
      trees: 1700,
      understory: 5000,
      ferns: 1000,
      rocks: 70,
      logs: 40,
      birds: 6,
      shafts: 12,
      shadowMapSize: 1024,
      pixelRatio: 1.5,
    };
  }
  return {
    trees: 4200,
    understory: 11000,
    ferns: 1800,
    rocks: 160,
    logs: 90,
    birds: 12,
    shafts: 22,
    shadowMapSize: 2048,
    pixelRatio: 1.75,
  };
}

/** Teintes des cartes de feuillage, pour varier la forêt sans nouvelles textures. */
export const FOLIAGE_TINTS = [
  0x6f9a58, 0x5c8a4c, 0x4e7a44, 0x7aa35f, 0x466e3e, 0x8ab06a,
] as const;
