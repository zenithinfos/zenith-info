/**
 * Surface d'eau.
 *
 * Un MeshStandardMaterial à carte de normales donne une flaque : plate, sans
 * absorption, sans écume, sans éclat solaire. Ici l'eau est un shader dédié :
 *
 *   · trois couches de rides qui dérivent le long du courant — le courant est
 *     porté par le maillage (attribut `aFlow`), donc les rides suivent les
 *     boucles de la rivière ;
 *   · absorption de Beer-Lambert : vase au bord, tanin presque noir au fond ;
 *   · Fresnel : vue rasante = miroir du couvert, vue plongeante = eau ;
 *   · éclat solaire à deux lobes, celui qui fait scintiller une rivière ;
 *   · écume de berge modulée par un bruit animé ;
 *   · brouillard exponentiel identique au reste de la scène.
 *
 * Aucune réfraction écran : elle coûte une passe entière et, dans une eau
 * aussi chargée en tanin, on ne voit de toute façon pas le fond.
 */

import * as THREE from "three";
import {
  type WaterBody,
  waterSurface,
} from "@/game/water";

export interface WaterSurface {
  mesh: THREE.Mesh;
  uniforms: {
    uTime: { value: number };
    uSunDir: { value: THREE.Vector3 };
    uSunColor: { value: THREE.Color };
    uSunIntensity: { value: number };
    uFogColor: { value: THREE.Color };
    uFogDensity: { value: number };
  };
  dispose: () => void;
}

const vertexShader = /* glsl */ `
  attribute float aShore;
  attribute float aEdge;
  attribute float aDepth;
  attribute vec2 aFlow;

  uniform float uTime;
  uniform float uWave;

  varying vec2 vUv;
  varying float vShore;
  varying float vEdge;
  varying float vDepth;
  varying vec2 vFlow;
  varying vec3 vWorldPos;
  varying float vViewDepth;

  void main() {
    vUv = uv;
    vShore = aShore;
    vEdge = aEdge;
    vDepth = aDepth;
    vFlow = aFlow;

    vec4 world = modelMatrix * vec4(position, 1.0);
    // Clapot : deux ondes croisées de quelques centimètres. Assez pour que la
    // ligne d'eau ne soit jamais parfaitement droite, pas assez pour noyer la
    // berge.
    world.y += (sin(world.x * 0.63 + uTime * 1.35) + cos(world.z * 0.71 - uTime * 1.05)) * 0.022 * uWave;
    vWorldPos = world.xyz;

    vec4 mv = viewMatrix * world;
    vViewDepth = -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;

const fragmentShader = /* glsl */ `
  uniform sampler2D uNormal;
  uniform float uTime;
  uniform float uCurrent;
  uniform float uOpacity;
  uniform float uSunIntensity;
  uniform float uFogDensity;
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform vec3 uDeep;
  uniform vec3 uShallow;
  uniform vec3 uCanopy;
  uniform sampler2D uEnv;
  uniform sampler2D uCanopyTex;
  uniform vec3 uFogColor;

  varying vec2 vUv;
  varying float vShore;
  varying float vEdge;
  varying float vDepth;
  varying vec2 vFlow;
  varying vec3 vWorldPos;
  varying float vViewDepth;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }

  float valueNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
      mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
      u.y
    );
  }

  void main() {
    vec2 dir = normalize(vFlow + vec2(0.0001));
    vec2 side = vec2(-dir.y, dir.x);
    float advect = uTime * (0.045 + uCurrent * 0.055);

    // Rides larges, entraînées par le courant.
    vec2 uvA = vec2(dot(vUv, side) * 0.9, dot(vUv, dir) * 0.55) - dir * advect;
    vec2 uvB = vec2(dot(vUv, side) * 2.6, dot(vUv, dir) * 1.9) - dir * advect * 1.7 + 7.3;
    vec2 nA = texture2D(uNormal, uvA).xy * 2.0 - 1.0;
    vec2 nB = texture2D(uNormal, uvB).xy * 2.0 - 1.0;

    // Rides fines, presque perpendiculaires : elles cassent le reflet en
    // millions de facettes, c'est ce qui distingue une eau vivante d'un miroir.
    vec2 uvC = vec2(dot(vUv, dir) * 5.5, dot(vUv, side) * 9.0 + uTime * 0.32);
    vec2 nC = texture2D(uNormal, uvC).xy * 2.0 - 1.0;

    // Les rides s'atténuent avec la distance : au loin, elles ne feraient que
    // scintiller et laisser voir la répétition de la carte de normales.
    float detail = mix(1.0, 0.28, smoothstep(18.0, 85.0, vViewDepth));
    vec2 ripple = (nA * 0.52 + nB * 0.32 + nC * 0.26) * detail;
    vec3 N = normalize(vec3(ripple.x * 0.62, 1.0, ripple.y * 0.62));

    vec3 V = normalize(cameraPosition - vWorldPos);
    float ndv = clamp(dot(N, V), 0.0, 1.0);
    float fresnel = 0.02 + 0.98 * pow(1.0 - ndv, 5.0);

    // Corps d'eau : vase claire en surface, tanin opaque en profondeur.
    float absorb = 1.0 - exp(-vDepth * 1.5);
    vec3 body = mix(uShallow, uDeep, absorb);

    // Reflet : on échantillonne l'environnement de la scène, puis on le
    // rabat vers le couvert (une eau de sous-bois ne reflète jamais le ciel
    // entier, même quand elle est lisse).
    vec3 R = reflect(-V, N);
    vec2 envUv = vec2(
      atan(R.z, R.x) / 6.2831853 + 0.5,
      acos(clamp(R.y, -1.0, 1.0)) / 3.14159265
    );
    vec3 envColour = texture2D(uEnv, envUv).rgb;
    // Le reflet d'un cours d'eau tropical, c'est d'abord le couvert : une
    // masse sombre trouée de trous de lumière. Le dégradé de ciel seul donne
    // une surface morte ; ce masque de feuillage lui rend son grain.
    vec4 canopyTex = texture2D(uCanopyTex, envUv * vec2(3.0, 2.2));
    vec3 canopy = mix(vec3(0.09, 0.13, 0.08), canopyTex.rgb, canopyTex.a * 0.9);
    float shade = dot(canopy, vec3(0.3333));
    envColour *= mix(0.45, 1.7, smoothstep(0.03, 0.4, shade));
    vec3 sky = mix(uCanopy, envColour, 0.62);

    // Éclat solaire. Le lobe serré seul donne une tache lisse : on le module
    // par un bruit fin pour obtenir des éclairs — ce pétillement est ce qui
    // distingue une eau vivante d'un plastique noir.
    vec3 H = normalize(uSunDir + V);
    float ndh = max(dot(N, H), 0.0);
    float glitter = smoothstep(0.55, 1.0, valueNoise(vUv * 90.0 - dir * uTime * 0.8));
    float glint =
      pow(ndh, 900.0) * (1.6 + glitter * 5.5) +
      pow(ndh, 48.0) * 0.18 * (1.0 - detail * 0.5);

    // Écume : un liseré de quelques dizaines de centimètres, pas une plage.
    // vEdge est en unités, ce qui rend la largeur indépendante de la taille
    // du plan d'eau (un ruisseau et l'Ivindo n'ont pas la même écume).
    float shoreBand = 1.0 - smoothstep(0.0, 0.55, -vEdge);
    float foam = 0.0;
    if (shoreBand > 0.001) {
      float bands = valueNoise(vUv * vec2(9.0, 5.0) + dir * uTime * 0.32);
      bands += valueNoise(vUv * 23.0 - dir * uTime * 0.5) * 0.5;
      // Une eau noire ne mousse presque pas : un liseré clairsemé, pas une
      // plage. Le terme au carré concentre tout contre la rive.
      foam = shoreBand * shoreBand * smoothstep(0.72, 1.05, bands) * 0.5;
    }
    // Liseré sombre de vase mouillée, juste à la ligne d'eau.
    float wetEdge = 1.0 - smoothstep(0.0, 0.3, abs(vEdge));

    vec3 color = mix(body, sky, fresnel);
    color += uSunColor * glint * uSunIntensity;
    // La lumière traverse la lame d'eau au bord : un vert chaud dans les
    // premiers centimètres.
    color += uShallow * 0.22 * (1.0 - absorb) * uSunIntensity;
    color = mix(color, uSunColor * 0.8, foam * 0.55);
    color *= 1.0 - wetEdge * 0.28;

    // Eau noire : opaque à un mètre de la rive, translucide seulement sur la
    // lame d'eau qui mouille la vase.
    float alpha = mix(0.7, uOpacity, smoothstep(0.0, 1.2, -vEdge));
    alpha = clamp(alpha + fresnel * 0.55 + foam * 0.2, 0.0, 1.0);
    // Le débord du maillage sur la berge s'efface en 25 cm (vEdge devient
    // positif hors de l'eau).
    alpha *= 1.0 - smoothstep(0.0, 0.25, vEdge);

    float fogFactor = 1.0 - exp(-pow(vViewDepth * uFogDensity, 2.0));
    color = mix(color, uFogColor, fogFactor);

    gl_FragColor = vec4(color, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/**
 * Construit la surface d'un plan d'eau à partir de sa ligne d'eau.
 * `normalMap` peut arriver après coup (chargement asynchrone) : la surface est
 * créée avec un uniforme nul et accepte la texture plus tard.
 */
export function createWaterSurface(body: WaterBody): WaterSurface {
  const data = waterSurface(body);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(data.positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(data.uvs, 2));
  geometry.setAttribute("aShore", new THREE.Float32BufferAttribute(data.shore, 1));
  geometry.setAttribute("aEdge", new THREE.Float32BufferAttribute(data.edge, 1));
  geometry.setAttribute("aDepth", new THREE.Float32BufferAttribute(data.depth, 1));
  geometry.setAttribute("aFlow", new THREE.Float32BufferAttribute(data.flow, 2));
  geometry.setIndex(data.indices);
  geometry.computeBoundingSphere();

  const uniforms = {
    uTime: { value: 0 },
    uWave: { value: Math.min(1.4, 0.35 + body.current * 0.55) },
    uCurrent: { value: body.current },
    uOpacity: { value: body.opacity },
    uSunDir: { value: new THREE.Vector3(0.4, 0.7, 0.3).normalize() },
    uSunColor: { value: new THREE.Color(0xffe6bc) },
    uSunIntensity: { value: 1 },
    uFogColor: { value: new THREE.Color(0x1d2a22) },
    uFogDensity: { value: 0.0125 },
    uDeep: { value: new THREE.Color(body.deep) },
    uShallow: { value: new THREE.Color(body.shallow) },
    uCanopy: { value: new THREE.Color(0x1c2a1e) },
    uEnv: { value: null as THREE.Texture | null },
    uCanopyTex: { value: null as THREE.Texture | null },
    uNormal: { value: null as THREE.Texture | null },
  };

  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite: true,
    side: THREE.FrontSide,
  });
  // Pas de carte de normales encore : un gris neutre évite un programme
  // « texture nulle » qui rendrait l'eau unie en attendant le chargement.
  material.uniforms.uNormal.value = new THREE.DataTexture(
    new Uint8Array([128, 128, 255, 255]),
    1,
    1,
  );
  (material.uniforms.uNormal.value as THREE.DataTexture).needsUpdate = true;
  // Repli sombre tant que l'environnement de la scène n'est pas branché.
  material.uniforms.uEnv.value = new THREE.DataTexture(
    new Uint8Array([28, 42, 30, 255]),
    1,
    1,
  );
  (material.uniforms.uEnv.value as THREE.DataTexture).needsUpdate = true;
  material.uniforms.uCanopyTex.value = new THREE.DataTexture(
    new Uint8Array([60, 80, 55, 255]),
    1,
    1,
  );
  (material.uniforms.uCanopyTex.value as THREE.DataTexture).needsUpdate = true;

  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.y = body.level;
  mesh.renderOrder = 2;
  mesh.frustumCulled = true;

  return {
    mesh,
    uniforms: uniforms as WaterSurface["uniforms"],
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}

/** Branche la texture de feuillage qui module les reflets. */
export function setWaterCanopy(surface: WaterSurface, texture: THREE.Texture) {
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  const material = surface.mesh.material as THREE.ShaderMaterial;
  const previous = material.uniforms.uCanopyTex.value as THREE.Texture | null;
  material.uniforms.uCanopyTex.value = texture;
  if (previous instanceof THREE.DataTexture) previous.dispose();
}

/** Applique la carte de normales une fois qu'elle est chargée. */
export function setWaterNormal(surface: WaterSurface, texture: THREE.Texture) {
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  const material = surface.mesh.material as THREE.ShaderMaterial;
  const previous = material.uniforms.uNormal.value as THREE.Texture | null;
  material.uniforms.uNormal.value = texture;
  if (previous instanceof THREE.DataTexture) previous.dispose();
}
