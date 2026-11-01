/**
 * Eau : rivière Ivindo, marais et clairière noyée.
 * Les fonctions de vague sont pures afin d'être réutilisées côté serveur
 * (détection de nage) et côté rendu (déplacement des sommets).
 */

import { SCENE_CONFIG } from "./sceneConfig";

export interface WaterBody {
  id: string;
  name: string;
  /** Centre du plan d'eau. */
  center: [number, number];
  width: number;
  depth: number;
  /** Hauteur de la surface (y). */
  level: number;
  /** Axe d'écoulement en radians (rivière). */
  flow: number;
  /** Force du courant : 0 = eau dormante. */
  current: number;
  color: number;
  opacity: number;
}

export const WATER_BODIES: WaterBody[] = [
  {
    id: "ivindo",
    name: "Rivière Ivindo",
    center: [-90, 110],
    width: 42,
    depth: 220,
    level: -0.35,
    flow: Math.PI / 2,
    current: 1.6,
    color: 0x16302f,
    opacity: 0.88,
  },
  {
    id: "bai-clairiere",
    name: "Mare du baï",
    center: [45, 160],
    width: 70,
    depth: 52,
    level: -0.22,
    flow: 0,
    current: 0.05,
    color: 0x2a3b2a,
    opacity: 0.82,
  },
  {
    id: "marais",
    name: "Marais aux papyrus",
    center: [-40, 210],
    width: 110,
    depth: 80,
    level: -0.12,
    flow: 0.4,
    current: 0.25,
    color: 0x23301f,
    opacity: 0.9,
  },
];

export function getWaterBody(id: string): WaterBody | undefined {
  return WATER_BODIES.find((w) => w.id === id);
}

/** Hauteur de la surface à une position donnée (vagues + clapot). */
export function surfaceHeight(body: WaterBody, x: number, z: number, time: number): number {
  const waveA = Math.sin(x * 0.18 + time * 0.9) * 0.045;
  const waveB = Math.cos(z * 0.23 - time * 1.3) * 0.035;
  const waveC = Math.sin((x + z) * 0.09 + time * 0.45) * 0.06;
  const amplitude = 0.4 + body.current * 0.5;
  return body.level + (waveA + waveB + waveC) * amplitude;
}

export function isInWater(body: WaterBody, x: number, z: number): boolean {
  return (
    Math.abs(x - body.center[0]) <= body.width / 2 &&
    Math.abs(z - body.center[1]) <= body.depth / 2
  );
}

/** Profondeur estimée : 0 au bord, maximale au centre. */
export function depthAt(body: WaterBody, x: number, z: number): number {
  const nx = Math.abs(x - body.center[0]) / (body.width / 2);
  const nz = Math.abs(z - body.center[1]) / (body.depth / 2);
  if (nx > 1 || nz > 1) return 0;
  const edge = Math.min(1 - nx, 1 - nz);
  return Math.min(3.2, edge * 4.2);
}

export interface SwimState {
  inWater: boolean;
  depth: number;
  /** Vitesse du courant appliquée au joueur. */
  drift: [number, number];
  /** Facteur de vitesse de nage (0-1). */
  speedFactor: number;
  /** Risque de crocodile : 0-1 selon la zone et la profondeur. */
  risk: number;
}

export function swimState(
  x: number,
  z: number,
  time: number,
  hour: number,
): SwimState {
  for (const body of WATER_BODIES) {
    if (!isInWater(body, x, z)) continue;
    const depth = depthAt(body, x, z);
    const driftX = Math.sin(body.flow + time * 0.1) * body.current * 0.12;
    const driftZ = Math.cos(body.flow + time * 0.1) * body.current * 0.12;
    const night = hour < 6 || hour > 18.5;
    return {
      inWater: true,
      depth,
      drift: [driftX, driftZ],
      speedFactor: depth > 1.4 ? 0.45 : 0.72,
      risk: Math.min(1, (body.id === "ivindo" ? 0.6 : 0.3) * (night ? 1.5 : 1) * (depth > 1 ? 1 : 0.4)),
    };
  }
  return { inWater: false, depth: 0, drift: [0, 0], speedFactor: 1, risk: 0 };
}

/** Uniformes du shader d'eau (compatibles MeshStandardMaterial + onBeforeCompile). */
export interface WaterUniforms {
  uTime: number;
  uFlow: number;
  uColor: number;
  uOpacity: number;
  uNormalMap: string;
  uFogDensity: number;
}

export function waterUniforms(body: WaterBody): WaterUniforms {
  return {
    uTime: 0,
    uFlow: body.current,
    uColor: body.color,
    uOpacity: body.opacity,
    uNormalMap: "/textures/water_normal.jpg",
    uFogDensity: SCENE_CONFIG.fog.density,
  };
}

/** Pluie : nombre de gouttes et vitesse, suivant l'intensité météo. */
export function rainParams(intensity: number): { count: number; speed: number; opacity: number } {
  if (intensity <= 0.01) return { count: 0, speed: 0, opacity: 0 };
  return {
    count: Math.round(400 + intensity * 3600),
    speed: 18 + intensity * 22,
    opacity: Math.min(0.65, 0.15 + intensity * 0.55),
  };
}
