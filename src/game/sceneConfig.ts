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
  canopy: 0x2a3520,
  moss: 0x3f4a2c,
  bark: 0x4a3a2a,
  earth: 0x6b4a2f,
  laterite: 0x9a4f2b,
  river: 0x1e3b3a,
  // Le ciel, mesuré à l'écran et non choisi sur un nuancier.
  //
  // La version grise — 0xa6bcc2 — n'était pas « un bleu pâle » : à l'exposition
  // de la scène, la courbe d'affichage la saturait jusqu'au **blanc-gris
  // #e5e9e4, 2 % de saturation**. Autrement dit, il n'y avait pas de ciel : il
  // y avait un trou blanc entre les arbres. Ces valeurs-ci sortent de la chaîne
  // inverse (dôme → exposition → ACES → sRGB → étalonnage) :
  //
  //   zénith  → #4684c5, teinte 211°, saturation 64 %
  //   horizon → #b1d2e2, teinte 200°, saturation 22 %
  //
  // `scripts/check-sky.mjs` les remesure et échoue si le bleu se perd.
  skyDay: 0x385888,
  // L'horizon du ciel n'est pas la brume du sol : le premier est bleu, la
  // seconde est verte. Les confondre donnait un ciel de marécage.
  skyHaze: 0x7098c0,
  // Au couchant, le zénith reste bleu et seule la bande d'horizon est orange.
  // Un zénith rose donne un ciel de carte postale, pas un ciel tropical.
  skyDusk: 0x2a3c5e,
  skyHazeDusk: 0xd98a56,
  skyNight: 0x070c14,
  skyHazeNight: 0x121e2c,
  // La brume du **sol** : verte, parce qu'elle vient des feuilles. Elle n'a rien
  // à voir avec l'horizon du ciel, qui est bleu.
  fogDay: 0x6e7c72,
  fogNight: 0x0b1512,
  // Couleur de l'éclairage par le ciel : pâle, parce que c'est une lumière qui
  // a traversé toute l'atmosphère avant d'atteindre le sous-bois. Elle reste
  // distincte du bleu du dôme : une lumière bleue franche repeint la forêt en
  // bleu, ce qui n'arrive jamais sous une canopée.
  skyFill: 0xa6bcc2,
  sun: 0xffe9c4,
  moon: 0x9fb4d0,
} as const;

/**
 * Pente du dégradé du dôme : la hauteur relative du ciel est élevée à cette
 * puissance avant le mélange horizon → zénith.
 *
 * Elle est ici, et non dans le shader, pour que `scripts/check-sky.mjs` mesure
 * exactement ce que le dôme dessine. À 0,42, une trouée à 20° au-dessus de
 * l'horizon est déjà au bleu du zénith à 62 % — c'est là qu'on regarde, sous
 * une canopée, pas à la verticale.
 */
export const SKY_GRADIENT_EXPONENT = 0.42;

export const SCENE_CONFIG: SceneConfig = {
  background: FOREST_PALETTE.skyDay,
  fog: { color: FOREST_PALETTE.fogDay, density: 0.0125 },
  lighting: {
    ambient: { color: 0xffffff, intensity: 0.42 },
    sun: { color: FOREST_PALETTE.sun, intensity: 2.1, position: { x: 60, y: 110, z: 40 } },
    hemisphere: { sky: FOREST_PALETTE.skyFill, ground: 0x2c3a24, intensity: 0.55 },
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
  // Le remplissage du ciel suit une courbe plus douce que le soleil : au
  // crépuscule, le soleil bas a presque disparu mais le ciel éclaire encore.
  // Sans cela, 19 h tombait d'un coup dans le noir.
  const fill = Math.pow(d, 0.72);
  return {
    sun: 0.05 + d * 2.5,
    // Le plancher d'ombre : c'est lui qui décide si la forêt est lisible.
    // Un sous-bois éclairé par le ciel seul reste lisible ; l'œil s'adapte, pas
    // une caméra. Ces valeurs sont mesurées par `scripts/check-light.mjs`.
    //
    // Elles ont été remontées une fois de trop bas : à 43 % de vert, une
    // feuille d'ombre « lisait sa couleur » sur le papier mais la forêt
    // paraissait noire, parce que le regard ne voit pas une feuille isolée —
    // il voit un mur de feuilles à 40 m, derrière la brume. Le plancher compte
    // donc pour la scène entière, pas pour la surface témoin.
    ambient: 0.6 + fill * 1.34,
    hemisphere: 0.58 + fill * 1.72,
    moon: (1 - d) * 0.5,
    exposure: 1.12 + fill * 0.5,
    environment: 0.82 + fill * 0.92,
    // Moins de brume de jour : 0,0065 laisse voir à cent mètres. Au-delà, le
    // fond vert mangeait toute la lumière qui venait du ciel.
    fogDensity: (0.014 - d * 0.0075) * weatherFactor,
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
