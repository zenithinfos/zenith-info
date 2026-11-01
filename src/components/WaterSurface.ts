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
  uniform vec2 uNormalBias;
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
    // Les rides vivent dans le monde, pas dans les UV : mêler un vecteur UV
    // (le long de la bande) et une direction de courant (x/z monde) orientait
    // les vaguelettes n'importe comment selon la forme du maillage.
    float along = dot(vWorldPos.xz, dir);
    float across = dot(vWorldPos.xz, side);
    float advect = uTime * (0.45 + uCurrent * 0.55);

    // Trois échelles : houle de quelques mètres, clapot de cinquante
    // centimètres, et clapot fin. Les deux premières sont étirées le long du
    // courant — une rivière fait des traînées, pas des ronds dans l'eau.
    vec2 uvA = vec2(across * 0.33, along * 0.11 - advect * 0.35);
    vec2 uvB = vec2(across * 0.95 + 0.37, along * 0.48 - advect * 0.9 + 7.3);
    // La carte de normales n'est pas centrée sur 128 : mesurée, elle porte une
    // pente moyenne de 18° en travers et 29° dans l'axe. Sans corriger ce
    // biais, la rivière entière est un miroir incliné et les rides, qui ne
    // font que ±0,25, disparaissent dessous.
    vec2 nA = (texture2D(uNormal, uvA).xy - uNormalBias) * 2.0;
    vec2 nB = (texture2D(uNormal, uvB).xy - uNormalBias) * 2.0;

    // Clapot fin, presque isotrope : il casse le reflet en facettes.
    vec2 uvC = vec2(along * 2.4 - advect * 2.2, across * 3.1 + uTime * 0.32);
    vec2 nC = (texture2D(uNormal, uvC).xy - uNormalBias) * 2.0;

    // Les rides s'atténuent avec la distance : au loin, elles ne feraient que
    // scintiller et laisser voir la répétition de la carte de normales.
    float detail = mix(1.0, 0.34, smoothstep(18.0, 85.0, vViewDepth));
    vec2 ripple = (nA * 0.26 + nB * 0.16 + nC * 0.1) * detail;

    // Houle analytique : trois trains de vagues orientés par le courant. La
    // carte de normales seule donne une surface molle — des ondulations
    // calculées, dont on connaît exactement la pente, donnent le clapot qui
    // accroche le soleil. Les rafales de vent les regroupent par plaques.
    float gust = 0.55 + 0.45 * valueNoise(vec2(along, across) * 0.045 + uTime * 0.02);
    float dhAlong = 0.0;
    float dhAcross = 0.0;
    float p1 = along * 0.35 + across * 0.22 - uTime * 0.9;
    dhAlong += 0.05 * 0.35 * cos(p1);
    dhAcross += 0.05 * 0.22 * cos(p1);
    float p2 = along * 1.1 - across * 0.45 - uTime * 1.6;
    dhAlong += 0.022 * 1.1 * cos(p2);
    dhAcross -= 0.022 * 0.45 * cos(p2);
    float p3 = along * 2.6 + across * 1.5 - uTime * 2.3;
    dhAlong += 0.006 * 2.6 * cos(p3);
    dhAcross += 0.006 * 1.5 * cos(p3);
    ripple += vec2(dhAcross, dhAlong) * gust * 0.9 * detail;

    // Retour de l'espace (travers, courant) vers le monde x/z.
    vec2 slope = vec2(
      ripple.x * side.x + ripple.y * dir.x,
      ripple.x * side.y + ripple.y * dir.y
    );
    vec3 N = normalize(vec3(slope.x, 1.0, slope.y));

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
    envColour *= mix(0.38, 1.8, smoothstep(0.03, 0.4, shade));
    // Le couvert n'est pas un gris uniforme : ses trous de lumière sont ce
    // qui met des taches claires au milieu des reflets sombres.
    vec3 sky = mix(uCanopy, envColour, 0.68);

    // Éclat solaire. Le lobe serré seul donne une tache lisse : on le module
    // par un bruit fin pour obtenir des éclairs — ce pétillement est ce qui
    // distingue une eau vivante d'un plastique noir.
    vec3 H = normalize(uSunDir + V);
    float ndh = max(dot(N, H), 0.0);
    float glitter = smoothstep(0.55, 1.0, valueNoise(vUv * 90.0 - dir * uTime * 0.8));
    float glint =
      pow(ndh, 900.0) * (1.6 + glitter * 5.5) +
      pow(ndh, 48.0) * 0.09 * (1.0 - detail * 0.5);

    // Écume : un liseré de quelques dizaines de centimètres, pas une plage.
    // vEdge est en unités, ce qui rend la largeur indépendante de la taille
    // du plan d'eau (un ruisseau et l'Ivindo n'ont pas la même écume).
    float shoreBand = 1.0 - smoothstep(0.0, 0.42, -vEdge);
    float foam = 0.0;
    if (shoreBand > 0.001) {
      // Écume cassée : de larges plaques lentes, puis un grain serré qui
      // décide où la mousse tient. Sans le second terme, la rive blanchit
      // d'un trait continu — un liseré de savon.
      float patches = valueNoise(vWorldPos.xz * 0.55 + dir * uTime * 0.22);
      float bands = valueNoise(vWorldPos.xz * 2.1 + dir * uTime * 0.32);
      bands += valueNoise(vWorldPos.xz * 5.3 - dir * uTime * 0.5) * 0.5;
      float threshold = mix(0.95, 0.6, smoothstep(0.25, 0.85, patches));
      // Une eau noire ne mousse presque pas : un liseré clairsemé, pas une
      // plage. Le terme au carré concentre tout contre la rive.
      foam = shoreBand * shoreBand * smoothstep(threshold, threshold + 0.32, bands) * 0.55;
    }
    // Liseré sombre de vase mouillée, juste à la ligne d'eau.
    float wetEdge = 1.0 - smoothstep(0.0, 0.55, abs(vEdge));

    vec3 color = mix(body, sky, fresnel);
    color += uSunColor * glint * uSunIntensity;
    // La lumière traverse la lame d'eau au bord : un vert chaud dans les
    // premiers centimètres.
    color += uShallow * 0.13 * (1.0 - absorb) * uSunIntensity;
    color = mix(color, uSunColor * 0.8, foam * 0.55);
    color *= 1.0 - wetEdge * 0.3;

    // Eau noire : opaque à un mètre de la rive, translucide seulement sur la
    // lame d'eau qui mouille la vase.
    // Eau claire sur les vingt premiers centimètres — on voit la vase — puis
    // opaque dès qu'il y a de la profondeur. Un plan uniformément translucide
    // donnait un voile de plastique vert sur toute la rivière.
    float alpha = mix(0.4, uOpacity, smoothstep(0.0, 1.3, vDepth));
    alpha = clamp(alpha + fresnel * 0.5 + foam * 0.2, 0.0, 1.0);
    // Le débord du maillage sur la berge s'efface en 25 cm (vEdge devient
    // positif hors de l'eau).
    // vEdge est négatif dans l'eau : le facteur vaut 1 à l'intérieur et
    // s'éteint sur la berge, là où le maillage déborde.
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
    uNormalBias: { value: new THREE.Vector2(0.5, 0.5) },
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
/**
 * Mesure la valeur moyenne d'une carte de normales.
 *
 * Une carte correcte est centrée sur (0,5 ; 0,5) : sa moyenne vaut le neutre.
 * Celle du projet a été générée avec une pente résiduelle, et un miroir incliné
 * ne scintille pas — il réfléchit le ciel d'un seul bloc. On mesure le biais au
 * chargement plutôt que de retoucher l'image : la correction reste juste même
 * si la texture est regénérée.
 */
export function measureNormalBias(texture: THREE.Texture): THREE.Vector2 | null {
  if (typeof document === "undefined") return null;
  const image = texture.image as HTMLImageElement | HTMLCanvasElement | undefined;
  if (!image) return null;
  const size = 32;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) return null;
  try {
    context.drawImage(image, 0, 0, size, size);
    const data = context.getImageData(0, 0, size, size).data;
    let x = 0;
    let y = 0;
    for (let i = 0; i < data.length; i += 4) {
      x += data[i];
      y += data[i + 1];
    }
    const count = (size * size) / 255;
    return new THREE.Vector2(x / count, y / count);
  } catch {
    // Canvas souillé (texture venue d'un autre domaine) : on garde le neutre.
    return null;
  }
}

export function setWaterNormal(surface: WaterSurface, texture: THREE.Texture) {
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  const material = surface.mesh.material as THREE.ShaderMaterial;
  const previous = material.uniforms.uNormal.value as THREE.Texture | null;
  material.uniforms.uNormal.value = texture;
  if (texture.image && !texture.userData.biasMeasured) {
    const bias = measureNormalBias(texture);
    if (bias) {
      material.uniforms.uNormalBias.value = bias;
      texture.userData.bias = bias;
      texture.userData.biasMeasured = true;
    }
  } else if (texture.userData.biasMeasured) {
    material.uniforms.uNormalBias.value = texture.userData.bias as THREE.Vector2;
  }
  if (previous instanceof THREE.DataTexture) previous.dispose();
}
