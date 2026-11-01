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
  /** Densité du brouillard exponentiel (0,01 = brume légère à 100 unités). */
  density: number;
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
  fog: { color: FOREST_PALETTE.fogDay, density: 0.0125 },
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

/**
 * Ajuste brouillard, exposition et lumières selon l'heure du monde.
 *
 * Deuxième entrée dans les mêmes réglages — utile aux outils (bande-annonce,
 * aperçus) qui n'ont pas de scène three.js. Le jeu, lui, passe par
 * `lightForDaylight` pour que le direct et cet outil ne divergent pas.
 */
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

  const weatherFactor = weather === "brume" ? 1.9 : weather === "orage" ? 1.45 : weather === "pluie" ? 1.25 : 1;
  const light = lightForDaylight(daylight, weatherFactor);

  return {
    ...base,
    background: sky,
    fog: {
      color: daylight < 0.2 ? FOREST_PALETTE.fogNight : FOREST_PALETTE.fogDay,
      density: light.fogDensity,
    },
    lighting: {
      ...base.lighting,
      ambient: { ...base.lighting.ambient, intensity: light.ambient },
      sun: { ...base.lighting.sun, intensity: light.sun },
      hemisphere: { ...base.lighting.hemisphere, intensity: light.hemisphere },
      moon: { ...base.lighting.moon, intensity: light.moon },
    },
    exposure: light.exposure,
  };
}

/**
 * Budget lumineux pour un moment de la journée.
 *
 * Une forêt dense pose un problème d'exposition : le soleil est presque
 * entièrement intercepté par la canopée, et un sous-bois réel n'est éclairé que
 * par le ciel — 2 à 5 % de la lumière du plein air. Rendu tel quel, un jeu
 * paraît noir : l'œil s'adapte, pas une caméra.
 *
 * D'où une règle : le soleil garde la vedette sur les trouées, mais le plancher
 * d'ombre (ciel + ambiance + environnement) est remonté jusqu'à ce qu'une
 * feuille à l'ombre lise encore sa couleur. Ces valeurs sont vérifiables sans
 * GPU : `scripts/check-light.mjs` calcule la luminance estimée d'une feuille et
 * d'un tronc pour un moment donné.
 */
export interface LightBudget {
  sun: number;
  ambient: number;
  hemisphere: number;
  moon: number;
  exposure: number;
  environment: number;
  fogDensity: number;
}

export function lightForDaylight(daylight: number, weatherFactor = 1): LightBudget {
  const d = Math.max(0, Math.min(1, daylight));
  return {
    sun: 0.05 + d * 2.3,
    // Le plancher d'ombre : c'est lui qui décide si la forêt est lisible.
    ambient: 0.4 + d * 0.86,
    hemisphere: 0.44 + d * 1.22,
    moon: (1 - d) * 0.55,
    exposure: 1.02 + d * 0.43,
    environment: 0.62 + d * 0.6,
    fogDensity: (0.016 - d * 0.007) * weatherFactor,
  };
}

/** Textures utilisées par la végétation instanciée. */
export const TEXTURES = {
  ground: "/textures/ground.jpg",
  groundNormal: "/textures/ground_normal.jpg",
  bark: "/textures/bark.jpg",
  barkNormal: "/textures/bark_normal.jpg",
  bigleaf: "/textures/bigleaf.png",
  fern: "/textures/fern.png",
  grass: "/textures/grass.png",
  spray: "/textures/spray.png",
  foliage: "/textures/foliage.png",
  foliageDeep: "/textures/foliage-deep.png",
  foliagePale: "/textures/foliage-pale.png",
  canopy: "/textures/canopy.png",
  mist: "/textures/mist.png",
  rock: "/textures/rock.jpg",
  waterNormal: "/textures/water_normal.jpg",
  foliageNormal: "/textures/foliage_normal.jpg",
  foliageDeepNormal: "/textures/foliage-deep_normal.jpg",
  foliagePaleNormal: "/textures/foliage-pale_normal.jpg",
  bigleafNormal: "/textures/bigleaf_normal.jpg",
  fernNormal: "/textures/fern_normal.jpg",
  grassNormal: "/textures/grass_normal.jpg",
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
