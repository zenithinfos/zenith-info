/**
 * Eau : rivière Ivindo, ruisseau tributaire, baï et marais.
 *
 * Chaque plan d'eau est décrit par sa **ligne d'eau** — une polyligne pour un
 * cours d'eau, un point pour une étendue — et non par un rectangle. Un seul
 * champ de distance sert partout :
 *   · le relief creuse le lit et remonte la berge (terrain.ts) ;
 *   · la végétation s'arrête au bord (forest.ts) ;
 *   · la géométrie de la surface est extrudée le long de la même ligne
 *     (waterRibbon / waterDisc) ;
 *   · la nage, les crocodiles et la carte GPS lisent la même fonction.
 *
 * C'est ce qui évite le défaut classique du plan d'eau rectangulaire posé sur
 * un terrain : des rives qui coupent la forêt au cordeau.
 */

export type WaterKind = "riviere" | "ruisseau" | "mare" | "marais";

export interface WaterBody {
  id: string;
  name: string;
  kind: WaterKind;
  /** Ligne d'eau. Plusieurs points = cours d'eau, un point = étendue. */
  path: [number, number][];
  /** Demi-largeur nominale, ou rayon pour une étendue. */
  halfWidth: number;
  /** Variation organique de la largeur (0-1). */
  widthJitter: number;
  /** Profondeur du lit au plus profond, en unités. */
  bedDepth: number;
  level: number;
  /** Force du courant : 0 = eau dormante. */
  current: number;
  color: number;
  opacity: number;
  /** Couleur en eau peu profonde (vase, sable) et en eau profonde (tanin). */
  shallow: number;
  deep: number;
  /** Graine de forme (berges irrégulières). */
  seed: number;
}

/**
 * L'Ivindo descend vers le nord en décrivant trois boucles. Les points sont
 * volontairement serrés dans les courbes : une polyligne de quatre points
 * donnerait des berges en accordéon.
 */
export const WATER_BODIES: WaterBody[] = [
  {
    id: "ivindo",
    name: "Rivière Ivindo",
    kind: "riviere",
    path: [
      [-118, -60],
      [-110, -14],
      [-100, 26],
      [-92, 62],
      [-86, 98],
      [-84, 132],
      [-92, 166],
      [-104, 196],
      [-110, 228],
      [-102, 264],
    ],
    halfWidth: 19,
    widthJitter: 0.26,
    bedDepth: 2.8,
    level: -0.35,
    current: 1.6,
    color: 0x16302f,
    opacity: 0.88,
    shallow: 0x3d3a25,
    deep: 0x0a1512,
    seed: 3.1,
  },
  {
    id: "ruisseau",
    name: "Ruisseau des pisteurs",
    kind: "ruisseau",
    path: [
      [22, 156],
      [6, 146],
      [-14, 138],
      [-34, 131],
      [-54, 126],
      [-72, 121],
    ],
    halfWidth: 3.1,
    widthJitter: 0.4,
    bedDepth: 0.62,
    level: -0.3,
    current: 0.8,
    color: 0x1d2a22,
    opacity: 0.8,
    shallow: 0x43402c,
    deep: 0x121b14,
    seed: 7.4,
  },
  {
    id: "bai-clairiere",
    name: "Mare du baï",
    kind: "mare",
    path: [[45, 158]],
    halfWidth: 30,
    widthJitter: 0.24,
    bedDepth: 1.5,
    level: -0.22,
    current: 0.05,
    color: 0x2a3b2a,
    opacity: 0.82,
    shallow: 0x4f5133,
    deep: 0x111c10,
    seed: 1.7,
  },
  {
    id: "marais",
    name: "Marais aux papyrus",
    kind: "marais",
    path: [[-38, 212]],
    halfWidth: 44,
    widthJitter: 0.32,
    bedDepth: 0.95,
    level: -0.12,
    current: 0.18,
    color: 0x23301f,
    opacity: 0.9,
    shallow: 0x42472a,
    deep: 0x0e170d,
    seed: 5.3,
  },
];

export function getWaterBody(id: string): WaterBody | undefined {
  return WATER_BODIES.find((w) => w.id === id);
}

const isPond = (body: WaterBody) => body.path.length < 2;

export const smoothstep = (edge0: number, edge1: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

/**
 * Demi-largeur locale du cours d'eau à l'abscisse curviligne `s` (unités).
 * La même fonction sert au relief et au maillage : la rive du shader est
 * exactement la rive du terrain.
 */
export function halfWidthAt(body: WaterBody, s: number): number {
  if (isPond(body)) return body.halfWidth;
  const wobble =
    Math.sin(s * 0.043 + body.seed) * 0.58 +
    Math.sin(s * 0.117 + body.seed * 2.3) * 0.3 +
    Math.sin(s * 0.029 + body.seed * 0.7) * 0.12;
  return body.halfWidth * (1 + body.widthJitter * wobble);
}

/** Rayon d'une étendue selon l'angle (berges organiques). */
function radiusAt(body: WaterBody, angle: number): number {
  const wobble =
    Math.sin(angle * 3 + body.seed) * 0.44 +
    Math.sin(angle * 5 + body.seed * 1.9) * 0.26 +
    Math.sin(angle * 8 + body.seed * 3.3) * 0.14;
  return body.halfWidth * (1 + body.widthJitter * wobble);
}

export interface BodySample {
  /** Distance signée à la rive, en unités. Négative dans l'eau. */
  edge: number;
  /** Demi-largeur locale. */
  width: number;
  /** Profondeur d'eau (0 sur la rive). */
  depth: number;
  /** Direction du courant (vecteur normalisé, x/z). */
  flow: [number, number];
}

/**
 * Segments précalculés : `terrainHeight` est appelé des dizaines de milliers de
 * fois pendant la construction d'une tuile, on ne refait donc ni les racines
 * ni les longueurs à chaque échantillon.
 */
interface Segment {
  ax: number;
  az: number;
  vx: number;
  vz: number;
  length: number;
  cum: number;
}

interface Prepared {
  body: WaterBody;
  segments: Segment[];
  /** Boîte englobante élargie : rejet immédiat des points lointains. */
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

const PREPARED: Prepared[] = WATER_BODIES.map((body) => {
  const segments: Segment[] = [];
  let cum = 0;
  for (let i = 0; i < body.path.length - 1; i++) {
    const [ax, az] = body.path[i];
    const [bx, bz] = body.path[i + 1];
    const vx = bx - ax;
    const vz = bz - az;
    const length = Math.hypot(vx, vz);
    if (length < 1e-4) continue;
    segments.push({ ax, az, vx, vz, length, cum });
    cum += length;
  }
  const margin = body.halfWidth * (1 + body.widthJitter) + 14;
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const [x, z] of body.path) {
    minX = Math.min(minX, x - margin);
    maxX = Math.max(maxX, x + margin);
    minZ = Math.min(minZ, z - margin);
    maxZ = Math.max(maxZ, z + margin);
  }
  return { body, segments, minX, maxX, minZ, maxZ };
});

/**
 * Échantillonne un plan d'eau en (x, z). Renvoie `null` au-delà de la berge
 * immédiate : au-delà, le plan d'eau n'a plus aucune influence.
 */
export function sampleBody(body: WaterBody, x: number, z: number): BodySample | null {
  if (isPond(body)) {
    const [cx, cz] = body.path[0];
    const dx = x - cx;
    const dz = z - cz;
    const dist = Math.hypot(dx, dz);
    const angle = Math.atan2(dz, dx);
    const radius = radiusAt(body, angle);
    if (dist > radius + 12) return null;
    const edge = dist - radius;
    const u = Math.min(1, Math.max(0, -edge / Math.max(0.001, radius)));
    return {
      edge,
      width: radius,
      depth: edge < 0 ? body.bedDepth * (1 - (1 - u) * (1 - u)) : 0,
      flow: [0, 0],
    };
  }

  let bestDist = Infinity;
  let bestS = 0;
  let bestTangent: [number, number] = [0, 1];
  const prepared = PREPARED.find((p) => p.body === body);

  const segments =
    prepared?.segments ??
    body.path.slice(0, -1).map((point, i) => {
      const [bx, bz] = body.path[i + 1];
      const vx = bx - point[0];
      const vz = bz - point[1];
      return { ax: point[0], az: point[1], vx, vz, length: Math.hypot(vx, vz), cum: 0 };
    });

  for (const segment of segments) {
    const { ax, az, vx, vz, length, cum } = segment;
    if (length < 1e-4) continue;
    const t = Math.min(1, Math.max(0, ((x - ax) * vx + (z - az) * vz) / (length * length)));
    const px = ax + vx * t;
    const pz = az + vz * t;
    const dist = Math.hypot(x - px, z - pz);
    if (dist < bestDist) {
      bestDist = dist;
      bestS = cum + length * t;
      bestTangent = [vx / length, vz / length];
    }
  }

  const width = halfWidthAt(body, bestS);
  if (bestDist > width + 12) return null;
  const edge = bestDist - width;
  const u = Math.min(1, Math.max(0, -edge / Math.max(0.001, width)));
  return {
    edge,
    width,
    depth: edge < 0 ? body.bedDepth * (1 - (1 - u) * (1 - u)) : 0,
    flow: bestTangent,
  };
}

export interface WaterFieldSample extends BodySample {
  body: WaterBody;
}

/**
 * Plan d'eau le plus proche. `edge` est la distance signée à la rive : c'est
 * la seule mesure dont ont besoin le relief, la végétation et la nage.
 */
export function waterField(x: number, z: number): WaterFieldSample | null {
  let best: WaterFieldSample | null = null;
  for (const prepared of PREPARED) {
    if (x < prepared.minX || x > prepared.maxX) continue;
    if (z < prepared.minZ || z > prepared.maxZ) continue;
    const sample = sampleBody(prepared.body, x, z);
    if (!sample) continue;
    if (!best) {
      best = { body: prepared.body, ...sample };
      continue;
    }
    const inside = sample.edge < 0;
    const bestInside = best.edge < 0;
    // Un point immergé appartient toujours au plan d'eau qui le contient.
    // Sans cette priorité, l'embouchure du ruisseau créait un haut-fond au
    // milieu de l'Ivindo : la berge du ruisseau passait devant le lit du
    // fleuve.
    if (inside && !bestInside) {
      best = { body: prepared.body, ...sample };
    } else if (inside && bestInside) {
      if (sample.edge < best.edge) best = { body: prepared.body, ...sample };
    } else if (!inside && !bestInside && sample.edge < best.edge) {
      best = { body: prepared.body, ...sample };
    }
  }
  return best;
}

/** Distance à la rive en unités : négative dans l'eau, +∞ loin de l'eau. */
export function shoreDistance(x: number, z: number): number {
  return waterField(x, z)?.edge ?? 999;
}

export function isInWater(x: number, z: number): boolean {
  return (waterField(x, z)?.edge ?? 1) < 0;
}

export function waterDepthAt(x: number, z: number): number {
  return waterField(x, z)?.depth ?? 0;
}

export function waterLevelAt(x: number, z: number): number {
  return waterField(x, z)?.body.level ?? 0;
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
  const field = waterField(x, z);
  if (!field || field.edge >= 0) {
    return { inWater: false, depth: 0, drift: [0, 0], speedFactor: 1, risk: 0 };
  }
  const { body, depth, flow } = field;
  const night = hour < 6 || hour > 18.5;
  const surge = Math.sin(time * 0.6) * 0.5 + 0.6;
  const driftX = flow[0] * body.current * 0.14 * surge;
  const driftZ = flow[1] * body.current * 0.14 * surge;
  return {
    inWater: true,
    depth,
    drift: [driftX, driftZ],
    speedFactor: depth > 1.4 ? 0.45 : 0.72,
    risk: Math.min(
      1,
      (body.kind === "riviere" ? 0.6 : 0.3) * (night ? 1.5 : 1) * (depth > 1 ? 1 : 0.4),
    ),
  };
}

// ---------------------------------------------------------------------------
// Géométrie de la surface
// ---------------------------------------------------------------------------

export interface SurfaceData {
  positions: number[];
  uvs: number[];
  /** 0 sur la rive, 1 au centre (transparence, absorption). */
  shore: number[];
  /** Distance signée à la rive en unités : négative dans l'eau. */
  edge: number[];
  /** Profondeur d'eau sous le sommet, en unités. */
  depth: number[];
  /** Direction du courant par sommet (x/z), pour advecter les rides. */
  flow: number[];
  indices: number[];
}

/**
 * Surface d'un cours d'eau : ruban extrudé le long de la polyligne.
 * Le maillage déborde de quelques dizaines de centimètres sur la berge, et
 * son opacité tombe à zéro sur ce débord : la jonction avec la terre ne se
 * voit pas.
 */
export function waterRibbon(body: WaterBody, step = 0.8, columns = 28): SurfaceData {
  const data: SurfaceData = {
    positions: [],
    uvs: [],
    shore: [],
    edge: [],
    depth: [],
    flow: [],
    indices: [],
  };
  if (isPond(body)) return waterDisc(body);

  // Échantillonnage de la polyligne par abscisse curviligne régulière.
  const samples: { x: number; z: number; nx: number; nz: number; s: number; tx: number; tz: number }[] = [];
  let travelled = 0;
  for (let i = 0; i < body.path.length - 1; i++) {
    const [ax, az] = body.path[i];
    const [bx, bz] = body.path[i + 1];
    const length = Math.hypot(bx - ax, bz - az);
    if (length < 1e-4) continue;
    const tx = (bx - ax) / length;
    const tz = (bz - az) / length;
    const steps = Math.max(1, Math.ceil(length / step));
    for (let k = 0; k < steps; k++) {
      const t = k / steps;
      samples.push({
        x: ax + (bx - ax) * t,
        z: az + (bz - az) * t,
        nx: -tz,
        nz: tx,
        tx,
        tz,
        s: travelled + length * t,
      });
    }
    travelled += length;
  }
  const [lx, lz] = body.path[body.path.length - 1];
  const [px, pz] = body.path[body.path.length - 2];
  const tailLength = Math.hypot(lx - px, lz - pz) || 1;
  samples.push({
    x: lx,
    z: lz,
    nx: -(lz - pz) / tailLength,
    nz: (lx - px) / tailLength,
    tx: (lx - px) / tailLength,
    tz: (lz - pz) / tailLength,
    s: travelled,
  });

  const overlap = 0.85;
  for (let i = 0; i < samples.length; i++) {
    const sample = samples[i];
    const width = halfWidthAt(body, sample.s) + overlap;
    for (let j = 0; j < columns; j++) {
      const v = j / (columns - 1); // 0 → 1 d'une berge à l'autre
      const offset = (v * 2 - 1) * width;
      const x = sample.x + sample.nx * offset;
      const z = sample.z + sample.nz * offset;
      const edge = Math.abs(offset) - halfWidthAt(body, sample.s);
      // Le débord (edge > 0) reste transparent : `shore` y vaut 0.
      const inside = Math.min(1, Math.max(0, -edge / Math.max(0.001, halfWidthAt(body, sample.s))));
      data.positions.push(x, 0, z);
      data.uvs.push(sample.s / 7.5, ((v * 2 - 1) * width) / 7.5);
      data.shore.push(inside);
      data.edge.push(edge);
      data.depth.push(body.bedDepth * (1 - (1 - inside) * (1 - inside)));
      data.flow.push(sample.tx, sample.tz);
    }
  }

  for (let i = 0; i < samples.length - 1; i++) {
    for (let j = 0; j < columns - 1; j++) {
      const a = i * columns + j;
      const b = a + 1;
      const c = a + columns;
      const d = c + 1;
      data.indices.push(a, c, b, b, c, d);
    }
  }
  return data;
}

/** Surface d'une étendue : disque à anneaux concentriques. */
export function waterDisc(body: WaterBody, rings = 12, segments = 96): SurfaceData {
  const data: SurfaceData = {
    positions: [],
    uvs: [],
    shore: [],
    edge: [],
    depth: [],
    flow: [],
    indices: [],
  };
  const [cx, cz] = body.path[0];
  const overlap = 0.8;

  for (let r = 0; r <= rings; r++) {
    const v = r / rings;
    for (let k = 0; k < segments; k++) {
      const angle = (k / segments) * Math.PI * 2;
      const radius = radiusAt(body, angle) + overlap;
      const dist = radius * v;
      const edge = dist - radiusAt(body, angle);
      const inside = Math.min(1, Math.max(0, -edge / Math.max(0.001, radiusAt(body, angle))));
      const x = cx + Math.cos(angle) * dist;
      const z = cz + Math.sin(angle) * dist;
      data.positions.push(x, 0, z);
      data.uvs.push((x - cx) / 7.5, (z - cz) / 7.5);
      data.shore.push(inside);
      data.edge.push(edge);
      data.depth.push(body.bedDepth * (1 - (1 - inside) * (1 - inside)));
      data.flow.push(Math.cos(angle) * 0.15, Math.sin(angle) * 0.15);
    }
  }

  for (let r = 0; r < rings; r++) {
    for (let k = 0; k < segments; k++) {
      const next = (k + 1) % segments;
      const a = r * segments + k;
      const b = r * segments + next;
      const c = (r + 1) * segments + k;
      const d = (r + 1) * segments + next;
      data.indices.push(a, c, b, b, c, d);
    }
  }
  return data;
}

export function waterSurface(body: WaterBody): SurfaceData {
  return isPond(body) ? waterDisc(body) : waterRibbon(body);
}

/** Hauteur de la surface à une position donnée (clapot, pour la caméra). */
export function surfaceHeight(body: WaterBody, x: number, z: number, time: number): number {
  const waveA = Math.sin(x * 0.18 + time * 0.9) * 0.045;
  const waveB = Math.cos(z * 0.23 - time * 1.3) * 0.035;
  const waveC = Math.sin((x + z) * 0.09 + time * 0.45) * 0.06;
  const amplitude = 0.4 + body.current * 0.5;
  return body.level + (waveA + waveB + waveC) * amplitude;
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
