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
  fogDay: 0x6f8c6a,
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
  rock: "/textures/rock.jpg",
  waterNormal: "/textures/water_normal.jpg",
} as const;

/** Budgets de rendu selon la plateforme détectée. */
export function qualityBudget(
  isMobile: boolean,
  reducedMotion: boolean,
): {
  trees: number;
  ferns: number;
  rocks: number;
  birds: number;
  shadowMapSize: number;
  pixelRatio: number;
} {
  if (reducedMotion) {
    return { trees: 120, ferns: 200, rocks: 30, birds: 4, shadowMapSize: 512, pixelRatio: 1 };
  }
  if (isMobile) {
    return { trees: 260, ferns: 420, rocks: 55, birds: 6, shadowMapSize: 1024, pixelRatio: 1.5 };
  }
  return { trees: 620, ferns: 900, rocks: 110, birds: 12, shadowMapSize: 2048, pixelRatio: 1.75 };
}
