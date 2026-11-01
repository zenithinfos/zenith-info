"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import type { Weather } from "@/game/realism";
import {
  FOREST_PALETTE,
  SCENE_CONFIG,
  TEXTURES,
  qualityBudget,
} from "@/game/sceneConfig";
import { WATER_BODIES, rainParams } from "@/game/water";
import { ZONES } from "@/game/levels";
import {
  buildTile,
  plantCards,
  crownCards,
  densityAt,
  mulberry32,
  tileKey,
  tileOf,
  tileSeed,
  tilesAround,
  type TileOptions,
} from "@/game/forest";
import { terrainHeight } from "@/game/terrain";

/**
 * Scène 3D de la réserve.
 *
 * Le monde est bâti une seule fois puis piloté par un contrôleur impératif :
 * le moteur de jeu (MinkebeGame) met à jour position et environnement à 60 Hz
 * sans provoquer de rendu React.
 *
 * Rendu de la forêt :
 *   · trois strates instanciées (canopée, sous-bois, sol) ;
 *   · feuillages en cartes alpha-testées, ce qui permet des silhouettes
 *     découpées et de vraies ombres feuillues (Three gère alphaTest dans le
 *     depth material des ombres) ;
 *   · plafond de canopée + brouillard : on ne voit jamais le ciel depuis le
 *     sentier, sauf dans les bais.
 */

export interface SceneController {
  setPlayer: (position: [number, number, number], heading: number, motion: string) => void;
  setEnvironment: (opts: {
    hour: number;
    daylight: number;
    weather: Weather;
    intensity?: number;
  }) => void;
  setRemotePlayers: (players: {
    id: string;
    name: string;
    position: [number, number, number];
    heading: number;
    motion: string;
  }[]) => void;
  setPaused: (paused: boolean) => void;
  getYaw: () => number;
  requestLook: () => void;
  /** Nombre d'arbres effectivement générés (diagnostic / HUD). */
  getStats: () => { trees: number; understory: number; logs: number };
  dispose: () => void;
}

export interface SceneProps {
  onReady?: (controller: SceneController) => void;
  onError?: (message: string) => void;
  /** Qualité de rendu ; "auto" détecte mobile et prefers-reduced-motion. */
  quality?: "auto" | "basse" | "haute";
  className?: string;
}

/**
 * Rayon de chargement, en tuiles. Trois tuiles de 48 unités couvrent 144
 * unités : de quoi voir plusieurs plans de troncs s'enfoncer dans la brume,
 * ce qui est exactement ce qui donne la profondeur d'une forêt.
 */
/**
 * Direction du soleil, en décalage par rapport au joueur. Hauteur modérée et
 * azimut marqué : lumière rasante d'avant la pluie, typique du bassin du Congo.
 */
const SUN_OFFSET = { x: 52, y: 62, z: 30 };

/** Rayon de la trouée laissée autour du point de départ (camp). */
const SPAWN_CLEARING = 7;

const TILE_RADIUS_DESKTOP = 3;
const TILE_RADIUS_MOBILE = 2;

/**
 * Texture de rai de lumière : dégradé doux, transparent sur les bords.
 * Dessinée à la volée pour éviter un fichier supplémentaire.
 */
function makeShaftTexture(): THREE.Texture {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const gradient = ctx.createLinearGradient(0, 0, 0, 256);
    gradient.addColorStop(0, "rgba(255, 240, 200, 0.55)");
    gradient.addColorStop(0.45, "rgba(255, 232, 170, 0.22)");
    gradient.addColorStop(1, "rgba(255, 226, 160, 0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 64, 256);

    // Bords fondus horizontalement.
    const side = ctx.createLinearGradient(0, 0, 64, 0);
    side.addColorStop(0, "rgba(0,0,0,1)");
    side.addColorStop(0.5, "rgba(0,0,0,0)");
    side.addColorStop(1, "rgba(0,0,0,1)");
    ctx.globalCompositeOperation = "destination-out";
    ctx.fillStyle = side;
    ctx.fillRect(0, 0, 64, 256);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export default function Scene({ onReady, onError, quality = "auto", className = "" }: SceneProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const controllerRef = useRef<SceneController | null>(null);
  const [unsupported, setUnsupported] = useState(false);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: SCENE_CONFIG.antialias,
        powerPreference: "high-performance",
      });
    } catch {
      // Hors du corps de l'effet : évite un rendu en cascade pendant le montage.
      queueMicrotask(() => {
        setUnsupported(true);
        onError?.("WebGL n'est pas disponible sur cet appareil.");
      });
      return;
    }

    const isMobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
    const reduced =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const budget = qualityBudget(isMobile || quality === "basse", reduced);
    const random = mulberry32(20261101);

    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, budget.pixelRatio));
    renderer.shadowMap.enabled = SCENE_CONFIG.shadows.enabled && !reduced;
    // PCFSoftShadowMap a été retiré de Three r0.18x.
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = SCENE_CONFIG.exposure;
    renderer.domElement.style.display = "block";
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    renderer.domElement.setAttribute("aria-label", "Vue 3D de la forêt de Minkébé");
    renderer.domElement.setAttribute("role", "img");
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    // Brouillard exponentiel : la densité est réaliste (la brume s'accumule
    // avec la distance, elle ne commence pas net à 8 unités).
    scene.fog = new THREE.FogExp2(SCENE_CONFIG.fog.color, 0.0125);

    // Ciel en dôme : bleu au zénith, mais lavé par la brume à l'horizon. Un
    // fond uni laissait une bande de ciel claire entre les troncs, à hauteur
    // d'homme — ce qui trahit immédiatement le décor.
    const skyGeometry = new THREE.SphereGeometry(320, 24, 16);
    const skyMaterial = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        uTop: { value: new THREE.Color(SCENE_CONFIG.background) },
        uHorizon: { value: new THREE.Color(SCENE_CONFIG.fog.color) },
        uBottom: { value: new THREE.Color(FOREST_PALETTE.canopy) },
      },
      vertexShader: `
        varying float vHeight;
        void main() {
          vHeight = normalize(position).y;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 uTop;
        uniform vec3 uHorizon;
        uniform vec3 uBottom;
        varying float vHeight;
        void main() {
          float h = vHeight;
          vec3 colour = h > 0.0
            ? mix(uHorizon, uTop, pow(clamp(h, 0.0, 1.0), 0.65))
            : mix(uHorizon, uBottom, clamp(-h * 3.0, 0.0, 1.0));
          gl_FragColor = vec4(colour, 1.0);
        }
      `,
    });
    const skyDome = new THREE.Mesh(skyGeometry, skyMaterial);
    skyDome.frustumCulled = false;
    skyDome.renderOrder = -1;
    scene.add(skyDome);

    const camera = new THREE.PerspectiveCamera(
      SCENE_CONFIG.camera.fov,
      1,
      SCENE_CONFIG.camera.near,
      SCENE_CONFIG.camera.far,
    );
    camera.position.set(0, SCENE_CONFIG.camera.height, 6);

    /**
     * Uniformes partagés par tous les shaders animés (vent, eau). On garde une
     * seule référence par uniforme : la date de compilation du programme est
     * mise en cache via customProgramCacheKey, sinon Three réutilise le premier
     * programme compilé et les autres feuillages cessent de bouger.
     */
    const sharedTime = { value: 0 };
    /** Direction du soleil dans l'espace caméra (pour la transluminescence). */
    const sharedSunDirView = { value: new THREE.Vector3(0, 1, 0) };
    /** Couleur et intensité de la lumière transmise par les feuilles. */
    const sharedSunColor = { value: new THREE.Color(0xffe0a8) };

    // ------------------------------------------------------------------
    // Chargement des textures
    // ------------------------------------------------------------------
    const textureLoader = new THREE.TextureLoader();
    const textures: THREE.Texture[] = [];

    const loadTexture = (
      path: string,
      onLoad: (texture: THREE.Texture) => void,
      repeat?: [number, number],
      linear = false,
    ) => {
      textureLoader.load(
        path,
        (texture) => {
          // Les cartes de normales sont des données, pas des couleurs : les
          // passer en sRGB fausse l'orientation des surfaces.
          texture.colorSpace = linear ? THREE.NoColorSpace : THREE.SRGBColorSpace;
          texture.wrapS = THREE.RepeatWrapping;
          texture.wrapT = THREE.RepeatWrapping;
          texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
          if (repeat) texture.repeat.set(repeat[0], repeat[1]);
          textures.push(texture);
          onLoad(texture);
        },
        undefined,
        () => {
          /* texture absente : on garde la couleur unie, la scène reste jouable */
        },
      );
    };

    // ------------------------------------------------------------------
    // Lumières
    // ------------------------------------------------------------------
    const hemisphere = new THREE.HemisphereLight(
      SCENE_CONFIG.lighting.hemisphere.sky,
      SCENE_CONFIG.lighting.hemisphere.ground,
      SCENE_CONFIG.lighting.hemisphere.intensity,
    );
    scene.add(hemisphere);

    const ambient = new THREE.AmbientLight(
      SCENE_CONFIG.lighting.ambient.color,
      SCENE_CONFIG.lighting.ambient.intensity,
    );
    scene.add(ambient);

    const sun = new THREE.DirectionalLight(
      SCENE_CONFIG.lighting.sun.color,
      SCENE_CONFIG.lighting.sun.intensity,
    );
    sun.position.set(46, 96, 34);
    sun.castShadow = renderer.shadowMap.enabled;
    sun.shadow.mapSize.set(budget.shadowMapSize, budget.shadowMapSize);
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 220;
    sun.shadow.camera.left = -46;
    sun.shadow.camera.right = 46;
    sun.shadow.camera.top = 46;
    sun.shadow.camera.bottom = -46;
    sun.shadow.bias = SCENE_CONFIG.shadows.bias;
    sun.shadow.normalBias = 0.04;
    scene.add(sun);
    scene.add(sun.target);

    // Environnement : une sphère de ciel dégradée, convertie en carte de
    // préfiltrage. C'est cette lumière d'ambiance, et non une lumière
    // ambiante uniforme, qui donne du volume aux feuillages.
    const environment = (() => {
      const size = 256;
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size / 2;
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
      gradient.addColorStop(0, "#7fa8c4"); // zénith
      gradient.addColorStop(0.42, "#a8c0c4");
      gradient.addColorStop(0.5, "#e6dcb8"); // horizon chaud
      gradient.addColorStop(0.56, "#5c7048");
      gradient.addColorStop(1, "#1a2416"); // sol de forêt
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      const equirect = new THREE.CanvasTexture(canvas);
      equirect.mapping = THREE.EquirectangularReflectionMapping;
      equirect.colorSpace = THREE.SRGBColorSpace;
      const pmrem = new THREE.PMREMGenerator(renderer);
      const envMap = pmrem.fromEquirectangular(equirect).texture;
      pmrem.dispose();
      equirect.dispose();
      return envMap;
    })();
    if (environment) {
      scene.environment = environment;
      scene.environmentIntensity = 0.45;
    }

    const moon = new THREE.DirectionalLight(SCENE_CONFIG.lighting.moon.color, 0);
    moon.position.set(-50, 80, -30);
    scene.add(moon);

    // ------------------------------------------------------------------
    // Sol
    // ------------------------------------------------------------------
    const groundGeometry = new THREE.PlaneGeometry(
      SCENE_CONFIG.ground.size,
      SCENE_CONFIG.ground.size,
      SCENE_CONFIG.ground.segments * 2,
      SCENE_CONFIG.ground.segments * 2,
    );
    groundGeometry.rotateX(-Math.PI / 2);

    const groundPositions = groundGeometry.attributes.position as THREE.BufferAttribute;
    const groundColours = new Float32Array(groundPositions.count * 3);
    const colour = new THREE.Color();

    for (let i = 0; i < groundPositions.count; i++) {
      const x = groundPositions.getX(i);
      const z = groundPositions.getZ(i);
      groundPositions.setY(i, terrainHeight(x, z));

      // Ombre de canopée : plus la forêt est dense, plus le sol est sombre.
      const density = densityAt(x, z);
      const exposure = 0.45 + (1 - density) * 0.85;
      // Légère variation pour éviter un aplat.
      const grain = 0.92 + random() * 0.16;
      colour.setRGB(0.34 * exposure * grain, 0.3 * exposure * grain, 0.22 * exposure * grain);
      groundColours[i * 3] = colour.r;
      groundColours[i * 3 + 1] = colour.g;
      groundColours[i * 3 + 2] = colour.b;
    }
    groundGeometry.setAttribute("color", new THREE.BufferAttribute(groundColours, 3));
    groundGeometry.computeVertexNormals();

    const groundMaterial = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.96,
      metalness: 0,
      vertexColors: true,
      normalScale: new THREE.Vector2(1.15, 1.15),
    });
    loadTexture(TEXTURES.ground, (texture) => {
      // Une tuile de texture tous les 4 mètres : à l'échelle d'une litière de
      // feuilles mortes (10-30 cm), c'est ce qui donne du détail au premier plan.
      texture.repeat.set(130, 130);
      groundMaterial.map = texture;
      groundMaterial.needsUpdate = true;
    });
    loadTexture(
      TEXTURES.groundNormal,
      (texture) => {
        texture.repeat.set(130, 130);
        groundMaterial.normalMap = texture;
        groundMaterial.needsUpdate = true;
      },
      undefined,
      true,
    );

    const ground = new THREE.Mesh(groundGeometry, groundMaterial);
    ground.receiveShadow = true;
    scene.add(ground);

    // ------------------------------------------------------------------
    // Matériaux partagés
    // ------------------------------------------------------------------

    /**
     * Matériau de feuillage : carte alpha-testée, double face, et léger
     * balancement dans le vent injecté dans le vertex shader.
     */
    const foliageMaterial = (
      map: string | null,
      options: {
        tint?: number;
        sway?: number;
        alphaTest?: number;
        normal?: string;
        normalScale?: number;
      } = {},
    ) => {
      const sway = options.sway ?? 0.08;
      const material = new THREE.MeshStandardMaterial({
        color: options.tint ?? 0xffffff,
        roughness: 0.92,
        metalness: 0,
        side: THREE.DoubleSide,
        alphaTest: options.alphaTest ?? 0.42,
        transparent: false,
      });
      if (map) {
        loadTexture(map, (texture) => {
          material.map = texture;
          material.needsUpdate = true;
        });
      }
      if (options.normal) {
        loadTexture(
          options.normal,
          (texture) => {
            material.normalMap = texture;
            material.needsUpdate = true;
          },
          undefined,
          true,
        );
        material.normalScale = new THREE.Vector2(
          options.normalScale ?? 1,
          options.normalScale ?? 1,
        );
      }

      material.onBeforeCompile = (shader) => {
        shader.uniforms.uTime = sharedTime;
        shader.uniforms.uSway = { value: sway };
        shader.uniforms.uSunDirView = sharedSunDirView;
        shader.uniforms.uSunColor = sharedSunColor;
        shader.vertexShader = shader.vertexShader
          .replace("#include <common>", "#include <common>\nuniform float uTime;\nuniform float uSway;")
          .replace(
            "#include <begin_vertex>",
            `#include <begin_vertex>
             #ifdef USE_INSTANCING
               float phase = instanceMatrix[3].x * 0.31 + instanceMatrix[3].z * 0.23;
               float amount = uSway * clamp(transformed.y + 0.5, 0.0, 1.6);
               transformed.x += sin(uTime * 1.15 + phase) * amount;
               transformed.z += cos(uTime * 0.93 + phase * 1.7) * amount * 0.8;
             #endif`,
          );
      };
      // Clé distincte par matériau : sinon Three réutilise le programme du
      // premier matériau compilé et les uniformes de vent divergent.
      material.customProgramCacheKey = () => `minkebe-foliage-${sway}-${material.alphaTest}`;
      // Transluminescence : une feuille est mince, la lumière la traverse quand
      // le soleil est derrière elle. Sans ce terme, le feuillage reste mat et
      // « plastique », même avec de bonnes textures.
      const previousFragment = material.onBeforeCompile;
      material.onBeforeCompile = (shader, rendererInstance) => {
        previousFragment.call(material, shader, rendererInstance);
        shader.fragmentShader = shader.fragmentShader
          .replace(
            "#include <common>",
            `#include <common>
             uniform vec3 uSunDirView;
             uniform vec3 uSunColor;`,
          )
          .replace(
            "#include <lights_fragment_end>",
            `#include <lights_fragment_end>
             {
               // Face arrière éclairée : le soleil traverse la feuille, qui
               // filtre la lumière. On multiplie donc par son albédo.
               float back = clamp(-dot(normal, uSunDirView), 0.0, 1.0);
               float glancing = pow(back, 1.4);
               totalEmissiveRadiance += diffuseColor.rgb * uSunColor * glancing * 0.8;
             }`,
          );
      };
      material.customProgramCacheKey = () => `minkebe-foliage-${sway}-${material.alphaTest}-trans`;
      return material;
    };

    // ------------------------------------------------------------------
    // Forêt — chargée par tuiles autour du joueur
    // ------------------------------------------------------------------
    const TILE_RADIUS = isMobile || reduced ? TILE_RADIUS_MOBILE : TILE_RADIUS_DESKTOP;
    const TILE_OPTIONS: TileOptions = {
      treeDensity: isMobile || reduced ? 0.042 : 0.058,
      understoryDensity: isMobile || reduced ? 0.3 : 0.46,
      logDensity: 0.0025,
      clearing: { x: 0, z: 6, radius: SPAWN_CLEARING },
    };

    // Géométries et matériaux partagés par toutes les tuiles.
    // Cylindre effilé, ouvert : le fût s'affine vers le haut et les branches
    // s'y raccordent sans capuchon visible.
    const trunkGeometry = new THREE.CylinderGeometry(0.62, 1, 1, 8, 1, true);
    trunkGeometry.translate(0, 0.5, 0);
    const trunkMaterial = new THREE.MeshStandardMaterial({
      color: FOREST_PALETTE.bark,
      roughness: 0.94,
      metalness: 0,
      normalScale: new THREE.Vector2(1.4, 1.4),
    });
    loadTexture(TEXTURES.bark, (texture) => {
      texture.repeat.set(2, 6);
      trunkMaterial.map = texture;
      trunkMaterial.needsUpdate = true;
    });
    loadTexture(
      TEXTURES.barkNormal,
      (texture) => {
        texture.repeat.set(2, 6);
        trunkMaterial.normalMap = texture;
        trunkMaterial.needsUpdate = true;
      },
      undefined,
      true,
    );

    const cardGeometry = new THREE.PlaneGeometry(1, 1);
    const logGeometry = new THREE.CylinderGeometry(1, 1, 1, 6, 1);
    const logMaterial = new THREE.MeshStandardMaterial({
      color: 0x6b5540,
      roughness: 0.95,
      normalScale: new THREE.Vector2(1.2, 1.2),
    });
    loadTexture(TEXTURES.bark, (texture) => {
      texture.repeat.set(2, 4);
      logMaterial.map = texture;
      logMaterial.needsUpdate = true;
    });
    loadTexture(
      TEXTURES.barkNormal,
      (texture) => {
        texture.repeat.set(2, 4);
        logMaterial.normalMap = texture;
        logMaterial.needsUpdate = true;
      },
      undefined,
      true,
    );

    // Litière : feuilles mortes à plat, très légèrement inclinées sur la pente.
    const litterMaterial = foliageMaterial(TEXTURES.foliagePale, {
      tint: 0x8c7a5e,
      sway: 0.01,
      alphaTest: 0.5,
      normal: TEXTURES.foliageDeepNormal,
      normalScale: 0.6,
    });

    const sprayMaterial = foliageMaterial(TEXTURES.spray, {
      tint: 0xf2f6ee,
      sway: 0.1,
      normal: TEXTURES.foliageNormal,
      normalScale: 0.9,
    });

    const foliageMaterials = [
      foliageMaterial(TEXTURES.foliage, {
        tint: 0xf2f6ee,
        sway: 0.07,
        normal: TEXTURES.foliageNormal,
        normalScale: 0.85,
      }),
      foliageMaterial(TEXTURES.foliageDeep, {
        tint: 0xc8d4c0,
        sway: 0.05,
        normal: TEXTURES.foliageDeepNormal,
        normalScale: 0.8,
      }),
      foliageMaterial(TEXTURES.foliagePale, {
        tint: 0xffffff,
        sway: 0.09,
        normal: TEXTURES.foliagePaleNormal,
        normalScale: 0.9,
      }),
    ];

    const understoryMaterials = {
      fern: foliageMaterial(TEXTURES.fern, {
        sway: 0.04,
        alphaTest: 0.38,
        normal: TEXTURES.fernNormal,
        normalScale: 0.9,
      }),
      bigleaf: foliageMaterial(TEXTURES.bigleaf, {
        sway: 0.05,
        alphaTest: 0.4,
        normal: TEXTURES.bigleafNormal,
        normalScale: 0.95,
      }),
      bush: foliageMaterial(TEXTURES.foliage, {
        tint: 0xd6e0cc,
        sway: 0.1,
        alphaTest: 0.44,
        normal: TEXTURES.foliageNormal,
        normalScale: 0.8,
      }),
      cover: foliageMaterial(TEXTURES.foliageDeep, {
        tint: 0xa8b89c,
        sway: 0.06,
        alphaTest: 0.46,
        normal: TEXTURES.foliagePaleNormal,
        normalScale: 0.7,
      }),
      grass: foliageMaterial(TEXTURES.grass, {
        sway: 0.16,
        alphaTest: 0.36,
        normal: TEXTURES.grassNormal,
        normalScale: 0.8,
      }),
    };

    // ------------------------------------------------------------------
    // Ombres de contact
    // ------------------------------------------------------------------
    // Une tache sombre au pied de chaque tronc et de chaque plant : c'est ce
    // qui « pose » les objets sur le sol. Sans elle, tout paraît flotter.
    const contactTexture = (() => {
      const size = 64;
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
        gradient.addColorStop(0, "rgba(0,0,0,0.85)");
        gradient.addColorStop(0.45, "rgba(0,0,0,0.35)");
        gradient.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, size, size);
      }
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      return texture;
    })();
    const contactMaterial = new THREE.MeshBasicMaterial({
      map: contactTexture,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      color: 0x0b1a10,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    });
    const contactGeometry = new THREE.PlaneGeometry(1, 1);
    contactGeometry.rotateX(-Math.PI / 2);

    const dummy = new THREE.Object3D();
    // Repères réutilisés pour coucher les dalles de couvre-sol sur la pente.
    const flatNormal = new THREE.Vector3();
    const flatRight = new THREE.Vector3();
    const flatUp = new THREE.Vector3();
    const flatBasis = new THREE.Matrix4();
    const tintColor = new THREE.Color();
    // Multiplicateurs de teinte appliqués aux photos : ils ne doivent pas les
    // assombrir, seulement varier légèrement d'un arbre à l'autre.
    const FOLIAGE_PALETTE = [0xa8bda2, 0x96ae90, 0x8aa286, 0xb4c6ac, 0x80927c, 0xc0d0b6];

    /** Construit les maillages d'une tuile (géométries partagées, instances propres). */
    const buildTileMeshes = (tileX: number, tileZ: number): THREE.Group => {
      const group = new THREE.Group();
      const tile = buildTile(tileX, tileZ, TILE_OPTIONS);
      const tileRand = mulberry32(tileSeed(tileX, tileZ));

      // --- charpente : fût, contreforts, branches, rameaux
      // Chaque segment est un cylindre effilé orienté dans l'espace : c'est
      // cette charpente, et non un mât, qui donne sa silhouette à l'arbre.
      const segments = tile.trees.flatMap((tree) =>
        tree.segments.map((segment) => ({ tree, segment })),
      );
      if (segments.length > 0) {
        const mesh = new THREE.InstancedMesh(trunkGeometry, trunkMaterial, segments.length);
        const from = new THREE.Vector3();
        const to = new THREE.Vector3();
        const axis = new THREE.Vector3();
        const up = new THREE.Vector3(0, 1, 0);
        const quaternion = new THREE.Quaternion();

        segments.forEach(({ tree, segment }, index) => {
          from.set(tree.x + segment.from[0], tree.y + segment.from[1], tree.z + segment.from[2]);
          to.set(tree.x + segment.to[0], tree.y + segment.to[1], tree.z + segment.to[2]);
          axis.subVectors(to, from);
          const length = axis.length();
          // Le cylindre unitaire monte le long de +Y : on l'aligne sur le
          // segment par un quaternion.
          quaternion.setFromUnitVectors(up, axis.normalize());
          dummy.position.copy(from);
          dummy.quaternion.copy(quaternion);
          // Le rayon moyen entre les deux extrémités approche l'effilement
          // (un cylindre instancié ne peut pas varier sur sa longueur).
          dummy.scale.set(
            (segment.radiusFrom + segment.radiusTo) * 0.5,
            length,
            (segment.radiusFrom + segment.radiusTo) * 0.5,
          );
          dummy.updateMatrix();
          mesh.setMatrixAt(index, dummy.matrix);

          // Le bois est plus sombre en bas et sur les rameaux fins.
          const shade =
            segment.kind === 0
              ? tree.kind === "emergent"
                ? 0.72
                : tree.kind === "mid"
                  ? 0.84
                  : 1
              : segment.kind === 1
                ? 0.66
                : segment.kind === 2
                  ? 0.9
                  : 1.05;
          tintColor.setHex(0xffffff).multiplyScalar(shade);
          mesh.setColorAt(index, tintColor);
        });

        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        group.add(mesh);
      }

      // --- ombres de contact (troncs et plants)
      const contactCount = tile.trees.length + Math.ceil(tile.understory.length / 3);
      if (contactCount > 0) {
        const mesh = new THREE.InstancedMesh(contactGeometry, contactMaterial, contactCount);
        let index = 0;
        for (const tree of tile.trees) {
          const radius = (tree.trunkRadius * 5 + 1.4) * (tree.kind === "sapling" ? 0.55 : 1);
          dummy.position.set(tree.x, terrainHeight(tree.x, tree.z) + 0.05, tree.z);
          dummy.rotation.set(0, tree.rotation, 0);
          dummy.scale.set(radius, 1, radius);
          dummy.updateMatrix();
          mesh.setMatrixAt(index++, dummy.matrix);
        }
        for (let i = 0; i < tile.understory.length; i += 3) {
          const plant = tile.understory[i];
          const radius = 0.9 + plant.scale * 1.5;
          dummy.position.set(plant.x, plant.y + 0.04, plant.z);
          dummy.rotation.set(0, plant.rotation, 0);
          dummy.scale.set(radius, 1, radius);
          dummy.updateMatrix();
          mesh.setMatrixAt(index++, dummy.matrix);
        }
        mesh.count = index;
        mesh.instanceMatrix.needsUpdate = true;
        mesh.frustumCulled = false;
        group.add(mesh);
      }

      // --- cartes de feuillage, réparties en trois familles
      const families: { matrix: THREE.Matrix4; colour: THREE.Color }[][] = [[], [], []];
      const sparseCards: { matrix: THREE.Matrix4; colour: THREE.Color }[] = [];
      for (const tree of tile.trees) {
        for (const card of crownCards(tree, tileRand)) {
          dummy.position.set(
            tree.x + card.offset[0],
            tree.y + card.offset[1],
            tree.z + card.offset[2],
          );
          if (card.horizontal) {
            dummy.rotation.set(
              -Math.PI / 2 + (tileRand() - 0.5) * card.tilt,
              card.angle,
              0,
              "YXZ",
            );
          } else {
            dummy.rotation.set(
              (tileRand() - 0.5) * card.tilt,
              card.angle,
              (tileRand() - 0.5) * card.tilt,
              "YXZ",
            );
          }
          dummy.scale.set(card.width, card.height, 1);
          dummy.updateMatrix();
          // Occlusion verticale : plus on est bas, plus on est à l'ombre du
          // couvert. C'est ce dégradé qui donne la profondeur d'une forêt.
          const ao = 0.55 + 0.45 * Math.min(1, (card.offset[1] + tree.trunkHeight * 0.4) / 14);
          // Répartition pondérée : 48 % feuillage moyen, 34 % sombre des
          // profondeurs, 18 % feuillage de lumière. À parts égales, la forêt
          // paraît délavée.
          const roll = tileRand();
          const family = card.sparse ? -1 : roll < 0.48 ? 0 : roll < 0.82 ? 1 : 2;
          const bucket = family < 0 ? sparseCards : families[family];
          bucket.push({
            matrix: dummy.matrix.clone(),
            colour: new THREE.Color(
              FOLIAGE_PALETTE[Math.floor(tileRand() * FOLIAGE_PALETTE.length)],
            ).multiplyScalar((0.85 + tileRand() * 0.3) * ao),
          });
        }
      }

      if (sparseCards.length > 0) {
        const mesh = new THREE.InstancedMesh(cardGeometry, sprayMaterial, sparseCards.length);
        sparseCards.forEach((item, index) => {
          mesh.setMatrixAt(index, item.matrix);
          mesh.setColorAt(index, item.colour);
        });
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        group.add(mesh);
      }

      families.forEach((items, family) => {
        if (items.length === 0) return;
        const mesh = new THREE.InstancedMesh(cardGeometry, foliageMaterials[family], items.length);
        items.forEach((item, index) => {
          mesh.setMatrixAt(index, item.matrix);
          mesh.setColorAt(index, item.colour);
        });
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        group.add(mesh);
      });

      // --- sous-bois
      const plantGroups: Record<string, { matrix: THREE.Matrix4; colour: THREE.Color }[]> = {
        fern: [],
        bigleaf: [],
        bush: [],
        cover: [],
        grass: [],
      };
      for (const plant of tile.understory) {
        const key =
          plant.variant === 1
            ? "bigleaf"
            : plant.variant === 2
              ? "bush"
              : plant.variant === 3
                ? "cover"
                : plant.variant === 4
                  ? "grass"
                  : "fern";
        for (const card of plantCards(plant)) {
          dummy.position.set(card.x, card.y, card.z);
          if (card.flat && card.slope) {
            // On couche la dalle sur le versant : base orthonormée construite
            // à partir de la normale du terrain.
            const [gx, gz] = card.slope;
            flatNormal.set(-gx, 1, -gz).normalize();
            flatRight.set(Math.cos(card.angle), 0, -Math.sin(card.angle));
            flatRight.addScaledVector(flatNormal, -flatRight.dot(flatNormal)).normalize();
            flatUp.crossVectors(flatNormal, flatRight).normalize();
            flatBasis.makeBasis(flatRight, flatUp, flatNormal);
            dummy.quaternion.setFromRotationMatrix(flatBasis);
          } else {
            dummy.rotation.set(0, card.angle, 0, "YXZ");
          }
          dummy.scale.set(card.width, card.height, 1);
          dummy.updateMatrix();
          // Le couvre-sol est une litière : plus sombre, moins saturé.
          const shade = card.flat ? 0.42 + tileRand() * 0.22 : 0.6 + tileRand() * 0.3;
          plantGroups[key].push({
            matrix: dummy.matrix.clone(),
            colour: new THREE.Color(
              FOLIAGE_PALETTE[Math.floor(tileRand() * FOLIAGE_PALETTE.length)],
            ).multiplyScalar(shade),
          });
        }
      }

      for (const [key, items] of Object.entries(plantGroups)) {
        if (items.length === 0) continue;
        const mesh = new THREE.InstancedMesh(
          cardGeometry,
          understoryMaterials[key as keyof typeof understoryMaterials],
          items.length,
        );
        items.forEach((item, index) => {
          mesh.setMatrixAt(index, item.matrix);
          mesh.setColorAt(index, item.colour);
        });
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        mesh.receiveShadow = true;
        group.add(mesh);
      }

      // --- litière
      if (tile.litter.length > 0) {
        const mesh = new THREE.InstancedMesh(cardGeometry, litterMaterial, tile.litter.length);
        const TONES = [0x9c8258, 0x5e4c34, 0x77784a];
        tile.litter.forEach((leaf, index) => {
          dummy.position.set(leaf.x, leaf.y, leaf.z);
          dummy.rotation.set(-Math.PI / 2, leaf.rotation, 0, "YXZ");
          dummy.scale.set(leaf.scale, leaf.scale * 0.8, 1);
          dummy.updateMatrix();
          mesh.setMatrixAt(index, dummy.matrix);
          tintColor.setHex(TONES[leaf.tone]).multiplyScalar(0.75 + tileRand() * 0.4);
          mesh.setColorAt(index, tintColor);
        });
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        mesh.receiveShadow = true;
        mesh.castShadow = false;
        group.add(mesh);
      }

      // --- troncs tombés
      if (tile.logs.length > 0) {
        const logs = new THREE.InstancedMesh(logGeometry, logMaterial, tile.logs.length);
        tile.logs.forEach((log, index) => {
          dummy.position.set(log.x, log.y, log.z);
          dummy.rotation.set(Math.PI / 2 + log.tilt, log.rotation, 0, "YXZ");
          dummy.scale.set(log.radius, log.length, log.radius);
          dummy.updateMatrix();
          logs.setMatrixAt(index, dummy.matrix);
        });
        logs.instanceMatrix.needsUpdate = true;
        logs.castShadow = true;
        logs.receiveShadow = true;
        group.add(logs);
      }

      return group;
    };

    const tileGroup = new THREE.Group();
    scene.add(tileGroup);
    const loadedTiles = new Map<string, THREE.Group>();
    let currentTile: [number, number] | null = null;

    /** Tuiles en attente de construction (étalées sur plusieurs images). */
    let pendingTiles: [number, number][] = [];

    /** Charge les tuiles proches, libère les lointaines. */
    const updateTiles = (x: number, z: number, force = false) => {
      const [cx, cz] = tileOf(x, z);
      if (!force && currentTile && currentTile[0] === cx && currentTile[1] === cz) return;
      currentTile = [cx, cz];

      const wanted = new Set<string>();
      const list = tilesAround(x, z, TILE_RADIUS);
      for (const [tx, tz] of list) wanted.add(tileKey(tx, tz));

      for (const [key, group] of loadedTiles) {
        if (wanted.has(key)) continue;
        tileGroup.remove(group);
        group.traverse((child) => {
          if (child instanceof THREE.InstancedMesh) child.dispose();
        });
        loadedTiles.delete(key);
      }

      // Les plus proches d'abord : le joueur voit vite son entourage immédiat.
      pendingTiles = list
        .filter(([tx, tz]) => !loadedTiles.has(tileKey(tx, tz)))
        .sort(
          (a, b) =>
            Math.hypot(a[0] - cx, a[1] - cz) - Math.hypot(b[0] - cx, b[1] - cz),
        );
    };

    /** Construit au plus une tuile par image : pas de saccade en marchant. */
    const buildPendingTile = () => {
      const next = pendingTiles.shift();
      if (!next) return;
      const [tx, tz] = next;
      const key = tileKey(tx, tz);
      if (loadedTiles.has(key)) return;
      const group = buildTileMeshes(tx, tz);
      tileGroup.add(group);
      loadedTiles.set(key, group);
    };

    updateTiles(0, 6, true);
    // Les premières tuiles sont construites tout de suite : la scène doit être
    // pleine dès la première image, pas se remplir sous les yeux du joueur.
    while (pendingTiles.length > 0) buildPendingTile();

    // --- Plafond de canopée -------------------------------------------
    // Grandes nappes suspendues au-dessus du joueur : elles bouchent le ciel
    // et donnent ce vert « sous la tente » propre aux forêts de terre ferme.
    const ceilingGroup = new THREE.Group();
    const ceilingMaterial = foliageMaterial(TEXTURES.canopy, {
      tint: 0x9fb28e,
      sway: 0.12,
      alphaTest: 0.36,
    });
    const ceilingGeometry = new THREE.PlaneGeometry(1, 1);
    const ceilingCount = isMobile || reduced ? 26 : 56;
    const ceilingMesh = new THREE.InstancedMesh(ceilingGeometry, ceilingMaterial, ceilingCount);
    ceilingMesh.frustumCulled = false;
    for (let i = 0; i < ceilingCount; i++) {
      const angle = random() * Math.PI * 2;
      const distance = Math.sqrt(random()) * 105;
      const x = Math.cos(angle) * distance;
      const z = Math.sin(angle) * distance;
      dummy.position.set(x, 24 + random() * 14, z);
      dummy.rotation.set(
        -Math.PI / 2 + (random() - 0.5) * 0.14,
        random() * Math.PI,
        0,
        "YXZ",
      );
      dummy.scale.setScalar(44 + random() * 40);
      dummy.updateMatrix();
      ceilingMesh.setMatrixAt(i, dummy.matrix);
      tintColor.setRGB(0.62 + random() * 0.18, 0.72 + random() * 0.16, 0.55 + random() * 0.16);
      ceilingMesh.setColorAt(i, tintColor);
    }
    ceilingMesh.instanceMatrix.needsUpdate = true;
    if (ceilingMesh.instanceColor) ceilingMesh.instanceColor.needsUpdate = true;
    ceilingMesh.receiveShadow = true;
    ceilingGroup.add(ceilingMesh);
    scene.add(ceilingGroup);


    // --- Rochers -------------------------------------------------------
    const rockGeometry = new THREE.DodecahedronGeometry(1.1, 0);
    const rockMaterial = new THREE.MeshStandardMaterial({
      color: 0x6a6a62,
      roughness: 0.95,
      flatShading: true,
    });
    loadTexture(TEXTURES.rock, (texture) => {
      texture.repeat.set(2, 2);
      rockMaterial.map = texture;
      rockMaterial.color.set(0xffffff);
      rockMaterial.needsUpdate = true;
    });
    const rockMesh = new THREE.InstancedMesh(rockGeometry, rockMaterial, budget.rocks);
    let rockIndex = 0;
    for (let i = 0; i < budget.rocks * 3 && rockIndex < budget.rocks; i++) {
      const angle = random() * Math.PI * 2;
      const distance = 8 + Math.sqrt(random()) * 190;
      const x = Math.cos(angle) * distance;
      const z = Math.sin(angle) * distance;
      if (random() > 0.35) continue;
      dummy.position.set(x, terrainHeight(x, z) + random() * 0.2, z);
      dummy.rotation.set(random() * Math.PI, random() * Math.PI, random() * Math.PI);
      dummy.scale.setScalar(0.4 + random() * 1.5);
      dummy.updateMatrix();
      rockMesh.setMatrixAt(rockIndex++, dummy.matrix);
    }
    rockMesh.count = rockIndex;
    rockMesh.instanceMatrix.needsUpdate = true;
    rockMesh.castShadow = true;
    rockMesh.receiveShadow = true;
    scene.add(rockMesh);

    // ------------------------------------------------------------------
    // Rais de lumière
    // ------------------------------------------------------------------
    const shaftTexture = makeShaftTexture();
    const shafts: THREE.Sprite[] = [];
    for (let i = 0; i < budget.shafts; i++) {
      const material = new THREE.SpriteMaterial({
        map: shaftTexture,
        transparent: true,
        opacity: 0.28,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        color: 0xffe9b0,
      });
      const sprite = new THREE.Sprite(material);
      const angle = (i / budget.shafts) * Math.PI * 2 + random();
      const distance = 6 + random() * 34;
      sprite.userData.offset = [Math.cos(angle) * distance, Math.sin(angle) * distance];
      sprite.userData.baseOpacity = 0.12 + random() * 0.22;
      sprite.position.set(0, 16, 0);
      sprite.scale.set(3 + random() * 5, 26 + random() * 10, 1);
      shafts.push(sprite);
      scene.add(sprite);
    }

    // ------------------------------------------------------------------
    // Brume de sous-bois
    // ------------------------------------------------------------------
    // Quelques nappes larges, accrochées à la caméra : elles séparent les plans
    // de troncs et empêchent la forêt de ressembler à un décor de carton.
    const mistGroup = new THREE.Group();
    const mistSprites: THREE.Sprite[] = [];
    const mistCount = isMobile || reduced ? 5 : 12;
    for (let i = 0; i < mistCount; i++) {
      const material = new THREE.SpriteMaterial({
        transparent: true,
        depthWrite: false,
        opacity: 0.0,
        color: 0xdfe8dc,
      });
      const sprite = new THREE.Sprite(material);
      const angle = (i / mistCount) * Math.PI * 2 + random() * 0.9;
      const distance = 16 + random() * 46;
      sprite.userData.offset = [Math.cos(angle) * distance, Math.sin(angle) * distance];
      sprite.userData.baseOpacity = 0.1 + random() * 0.12;
      sprite.scale.set(34 + random() * 30, 12 + random() * 10, 1);
      mistSprites.push(sprite);
      mistGroup.add(sprite);
    }
    loadTexture(TEXTURES.mist, (texture) => {
      for (const sprite of mistSprites) {
        (sprite.material as THREE.SpriteMaterial).map = texture;
        (sprite.material as THREE.SpriteMaterial).needsUpdate = true;
      }
    });
    scene.add(mistGroup);

    // ------------------------------------------------------------------
    // Eau
    // ------------------------------------------------------------------
    const waterMeshes: { mesh: THREE.Mesh; body: (typeof WATER_BODIES)[number] }[] = [];
    for (const body of WATER_BODIES) {
      const geometry = new THREE.PlaneGeometry(body.width, body.depth, 20, 20);
      geometry.rotateX(-Math.PI / 2);
      const material = new THREE.MeshStandardMaterial({
        color: body.color,
        transparent: true,
        opacity: body.opacity,
        roughness: 0.12,
        metalness: 0.4,
      });
      loadTexture(TEXTURES.waterNormal, (texture) => {
        texture.repeat.set(body.width / 8, body.depth / 8);
        material.normalMap = texture;
        material.normalScale.set(0.5, 0.5);
        material.needsUpdate = true;
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(body.center[0], body.level, body.center[1]);
      mesh.receiveShadow = true;
      scene.add(mesh);
      waterMeshes.push({ mesh, body });
    }

    // ------------------------------------------------------------------
    // Pluie et lucioles
    // ------------------------------------------------------------------
    const rainCount = isMobile ? 1400 : 2600;
    const rainPositions = new Float32Array(rainCount * 3);
    for (let i = 0; i < rainCount; i++) {
      rainPositions[i * 3] = (random() - 0.5) * 90;
      rainPositions[i * 3 + 1] = random() * 40;
      rainPositions[i * 3 + 2] = (random() - 0.5) * 90;
    }
    const rainGeometry = new THREE.BufferGeometry();
    rainGeometry.setAttribute("position", new THREE.BufferAttribute(rainPositions, 3));
    const rainMaterial = new THREE.PointsMaterial({
      color: 0xb8d6e0,
      size: 0.08,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    const rain = new THREE.Points(rainGeometry, rainMaterial);
    rain.visible = false;
    scene.add(rain);

    const fireflyCount = isMobile ? 160 : 320;
    const fireflyPositions = new Float32Array(fireflyCount * 3);
    for (let i = 0; i < fireflyCount; i++) {
      fireflyPositions[i * 3] = (random() - 0.5) * 80;
      fireflyPositions[i * 3 + 1] = 0.4 + random() * 2.6;
      fireflyPositions[i * 3 + 2] = (random() - 0.5) * 80;
    }
    const fireflyGeometry = new THREE.BufferGeometry();
    fireflyGeometry.setAttribute("position", new THREE.BufferAttribute(fireflyPositions, 3));
    const fireflyMaterial = new THREE.PointsMaterial({
      color: 0xd8ff8a,
      size: 0.14,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const fireflies = new THREE.Points(fireflyGeometry, fireflyMaterial);
    scene.add(fireflies);

    // ------------------------------------------------------------------
    // Balises de zone (repères de navigation)
    // ------------------------------------------------------------------
    const zoneMarkers: THREE.Mesh[] = [];
    for (const zone of ZONES) {
      const marker = new THREE.Mesh(
        new THREE.CylinderGeometry(0.3, 0.3, 4.5, 6, 1, true),
        new THREE.MeshBasicMaterial({
          color: zone.id === "camp" ? 0xf2b544 : 0x8fc47a,
          transparent: true,
          opacity: 0.22,
          side: THREE.DoubleSide,
          depthWrite: false,
        }),
      );
      marker.position.set(zone.center[0], 2.2, zone.center[1]);
      marker.visible = zone.unlockedByDefault;
      scene.add(marker);
      zoneMarkers.push(marker);
    }

    // ------------------------------------------------------------------
    // Joueurs distants
    // ------------------------------------------------------------------
    const remoteGroup = new THREE.Group();
    scene.add(remoteGroup);
    const remoteMeshes = new Map<string, THREE.Group>();

    const makeLabel = (text: string) => {
      const canvas = document.createElement("canvas");
      canvas.width = 256;
      canvas.height = 64;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.fillStyle = "rgba(6,13,9,0.65)";
        ctx.fillRect(0, 0, 256, 64);
        ctx.fillStyle = "#f3ead7";
        ctx.font = "600 30px system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(text.slice(0, 16), 128, 34);
      }
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      const sprite = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }),
      );
      sprite.scale.set(1.9, 0.48, 1);
      return sprite;
    };

    const makeRemoteAvatar = (name: string) => {
      const group = new THREE.Group();
      const body = new THREE.Mesh(
        new THREE.CapsuleGeometry(0.32, 1.05, 4, 8),
        new THREE.MeshStandardMaterial({ color: 0x8fd0c2, roughness: 0.7 }),
      );
      body.position.y = 0.95;
      body.castShadow = true;
      group.add(body);
      const head = new THREE.Mesh(
        new THREE.SphereGeometry(0.22, 12, 10),
        new THREE.MeshStandardMaterial({ color: 0xe8d3ae, roughness: 0.8 }),
      );
      head.position.y = 1.78;
      group.add(head);
      const label = makeLabel(name);
      label.position.y = 2.25;
      group.add(label);
      return group;
    };

    // ------------------------------------------------------------------
    // Caméra libre
    // ------------------------------------------------------------------
    let yaw = Math.PI;
    let pitch = 0;
    let pointerLocked = false;

    const onPointerMove = (event: PointerEvent) => {
      if (pointerLocked) {
        yaw -= event.movementX * 0.0022;
        pitch = Math.max(-1.1, Math.min(1.0, pitch - event.movementY * 0.0018));
        return;
      }
      if (event.buttons === 1 && event.target === renderer.domElement) {
        yaw -= event.movementX * 0.004;
        pitch = Math.max(-1.1, Math.min(1.0, pitch - event.movementY * 0.003));
      }
    };
    const onPointerDown = () => {
      if (!pointerLocked && renderer.domElement.requestPointerLock) {
        renderer.domElement.requestPointerLock();
      }
    };
    const onPointerLockChange = () => {
      pointerLocked = document.pointerLockElement === renderer.domElement;
    };

    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("pointermove", onPointerMove);
    document.addEventListener("pointerlockchange", onPointerLockChange);

    // ------------------------------------------------------------------
    // Redimensionnement
    // ------------------------------------------------------------------
    const resize = () => {
      const width = mount.clientWidth || 1;
      const height = mount.clientHeight || 1;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      composer?.setSize(width, height);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(mount);

    // ------------------------------------------------------------------
    // Post-traitement
    // ------------------------------------------------------------------
    // Sans cette chaîne, l'image sort « en aplats » : pas d'occlusion, pas de
    // halo sur les trouées de lumière, pas de grain. C'est ce qui sépare un
    // rendu de jeu d'une photographie de forêt.
    const useComposer = !isMobile && !reduced;
    let composer: EffectComposer | null = null;
    let gradePass: ShaderPass | null = null;
    let bloomPass: UnrealBloomPass | null = null;

    if (useComposer) {
      const target = new THREE.WebGLRenderTarget(1, 1, {
        type: THREE.HalfFloatType,
        samples: 4,
      });
      composer = new EffectComposer(renderer, target);
      composer.addPass(new RenderPass(scene, camera));

      bloomPass = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.28, 0.75, 0.82);
      composer.addPass(bloomPass);

      // Étalonnage : vignettage, grain fin, désaturation des verts et léger
      // réchauffement des hautes lumières. Tout ce qu'un appareil photo fait.
      gradePass = new ShaderPass({
        uniforms: {
          tDiffuse: { value: null },
          uTime: { value: 0 },
          uVignette: { value: 0.55 },
          uGrain: { value: 0.035 },
        },
        vertexShader: `
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          uniform sampler2D tDiffuse;
          uniform float uTime;
          uniform float uVignette;
          uniform float uGrain;
          varying vec2 vUv;

          float rand(vec2 co) {
            return fract(sin(dot(co, vec2(12.9898, 78.233))) * 43758.5453);
          }

          void main() {
            vec3 colour = texture2D(tDiffuse, vUv).rgb;

            // Légère désaturation : une forêt filmée n'est jamais aussi
            // saturée qu'un dessin.
            float luma = dot(colour, vec3(0.299, 0.587, 0.114));
            colour = mix(vec3(luma), colour, 0.86);

            // Réchauffement des lumières, refroidissement des ombres.
            colour += vec3(0.035, 0.018, -0.012) * smoothstep(0.45, 1.0, luma);
            colour += vec3(-0.012, 0.0, 0.02) * (1.0 - smoothstep(0.0, 0.45, luma));

            // Contraste en S, très léger.
            colour = clamp((colour - 0.5) * 1.06 + 0.5, 0.0, 1.0);

            // Vignettage.
            vec2 d = vUv - 0.5;
            float vig = 1.0 - dot(d, d) * uVignette * 2.2;
            colour *= clamp(vig, 0.0, 1.0);

            // Grain : casse les dégradés du brouillard.
            float grain = (rand(vUv * 1024.0 + uTime * 60.0) - 0.5) * uGrain;
            colour += grain;

            gl_FragColor = vec4(colour, 1.0);
          }
        `,
      });
      composer.addPass(gradePass);
      composer.addPass(new OutputPass());
      composer.setSize(mount.clientWidth || 1, mount.clientHeight || 1);
    }

    // ------------------------------------------------------------------
    // Boucle de rendu
    // ------------------------------------------------------------------
    let raf = 0;
    let paused = false;
    let elapsed = 0;
    let last = performance.now();
    const playerPosition = new THREE.Vector3(0, SCENE_CONFIG.camera.height, 6);
    let targetHeading = Math.PI;
    let bob = 0;
    let currentMotion = "idle";
    let daylight = 1;

    const animate = () => {
      raf = requestAnimationFrame(animate);
      const now = performance.now();
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (paused) return;
      elapsed += dt;
      sharedTime.value = elapsed;

      skyDome.position.set(camera.position.x, camera.position.y, camera.position.z);

      // Tuiles de forêt : rechargées seulement au changement de tuile.
      updateTiles(playerPosition.x, playerPosition.z);
      buildPendingTile();
      buildPendingTile();
      ceilingGroup.position.set(playerPosition.x, 0, playerPosition.z);

      // Caméra : hauteur d'œil + ressenti de marche.
      const moving = currentMotion === "walk" || currentMotion === "run" || currentMotion === "sneak";
      bob += dt * (currentMotion === "run" ? 11 : 6);
      const bobAmplitude = moving ? (currentMotion === "run" ? 0.075 : 0.035) : 0;
      const sway = moving ? Math.sin(bob * 0.5) * 0.012 : 0;

      const eyeHeight = 1.62;
      const groundUnderPlayer = terrainHeight(playerPosition.x, playerPosition.z);
      camera.position.set(
        playerPosition.x + sway,
        groundUnderPlayer + eyeHeight + Math.abs(Math.sin(bob)) * bobAmplitude,
        playerPosition.z,
      );

      const targetYaw = targetHeading + yaw - Math.PI;
      camera.rotation.order = "YXZ";
      camera.rotation.y = THREE.MathUtils.lerp(camera.rotation.y, targetYaw, 0.18);
      camera.rotation.x = pitch;
      camera.rotation.z = Math.sin(bob * 0.5) * 0.004;

      // Vagues.
      for (const { mesh } of waterMeshes) {
        const positions = mesh.geometry.attributes.position as THREE.BufferAttribute;
        for (let i = 0; i < positions.count; i++) {
          const x = positions.getX(i);
          const z = positions.getZ(i);
          positions.setY(
            i,
            Math.sin(x * 0.22 + elapsed * 1.1) * 0.05 + Math.cos(z * 0.3 - elapsed * 0.9) * 0.04,
          );
        }
        positions.needsUpdate = true;
      }

      // Pluie.
      if (rain.visible) {
        const positions = rain.geometry.attributes.position as THREE.BufferAttribute;
        const speed = 26 * dt;
        for (let i = 0; i < positions.count; i++) {
          let y = positions.getY(i) - speed;
          if (y < 0) {
            y = 34 + Math.random() * 6;
            positions.setX(i, camera.position.x + (Math.random() - 0.5) * 70);
            positions.setZ(i, camera.position.z + (Math.random() - 0.5) * 70);
          }
          positions.setY(i, y);
        }
        positions.needsUpdate = true;
      }

      // Lucioles.
      if (fireflies.visible) {
        fireflyMaterial.opacity = 0.55 + Math.sin(elapsed * 1.6) * 0.18;
        fireflies.rotation.y = elapsed * 0.006;
      }

      // Brume : elle suit le joueur, dérive lentement et s'épaissit à l'aube.
      for (const sprite of mistSprites) {
        const [ox, oz] = sprite.userData.offset as [number, number];
        const drift = Math.sin(elapsed * 0.05 + ox) * 3;
        sprite.position.set(camera.position.x + ox + drift, 1.5 + Math.sin(ox) * 1.2, camera.position.z + oz);
        const material = sprite.material as THREE.SpriteMaterial;
        material.opacity =
          (sprite.userData.baseOpacity as number) *
          (0.45 + (1 - daylight) * 0.55) *
          (0.8 + Math.sin(elapsed * 0.11 + oz) * 0.2);
      }

      // Rais de lumière : ils suivent le joueur et respirent doucement.
      for (const shaft of shafts) {
        const [ox, oz] = shaft.userData.offset as [number, number];
        const drift = Math.sin(elapsed * 0.15 + ox) * 0.6;
        shaft.position.set(camera.position.x + ox + drift, 15, camera.position.z + oz);
        const material = shaft.material as THREE.SpriteMaterial;
        material.opacity =
          (shaft.userData.baseOpacity as number) *
          daylight *
          (0.75 + Math.sin(elapsed * 0.6 + oz) * 0.25);
        shaft.visible = daylight > 0.35;
      }

      // Le soleil suit le joueur (ombres nettes autour de la caméra). Il reste
      // bas : une lumière rasante traverse la futaie et sculpte les troncs,
      // alors qu'un soleil au zénith aplatit tout.
      sun.position.set(
        camera.position.x + SUN_OFFSET.x,
        SUN_OFFSET.y,
        camera.position.z + SUN_OFFSET.z,
      );
      sun.target.position.set(camera.position.x, 0, camera.position.z);
      sun.target.updateMatrixWorld();

      // Direction du soleil dans l'espace caméra, pour la transluminescence.
      camera.updateMatrixWorld();
      sharedSunDirView.value
        .set(SUN_OFFSET.x, SUN_OFFSET.y, SUN_OFFSET.z)
        .normalize()
        .transformDirection(camera.matrixWorldInverse);
      sharedSunColor.value
        .copy(sun.color)
        .multiplyScalar(Math.min(1.4, 0.25 + daylight * 1.1));

      if (composer) {
        gradePass!.uniforms.uTime.value = elapsed;
        // Le bloom ne doit exister qu'en plein jour : la nuit, il baverait.
        bloomPass!.strength = 0.06 + daylight * 0.24;
        composer.render();
      } else {
        renderer.render(scene, camera);
      }
    };
    animate();

    const controller: SceneController = {
      setPlayer(position, heading, motion) {
        playerPosition.set(position[0], 0, position[2]);
        targetHeading = heading;
        currentMotion = motion;
      },
      setEnvironment({ daylight: value, weather, intensity = 0.6 }) {
        daylight = value;
        const night = value < 0.25;
        const wet = weather === "pluie" || weather === "orage";

        // Brouillard : court et vert au sol, il donne la profondeur de la forêt.
        const fog = scene.fog as THREE.FogExp2;
        const fogColour = new THREE.Color(night ? FOREST_PALETTE.fogNight : FOREST_PALETTE.fogDay);
        if (wet) fogColour.lerp(new THREE.Color(0x6b7d6d), 0.4);
        fog.color.lerp(fogColour, 0.1);

        // Densité : 0,030 dans la brume épaisse, 0,009 en plein jour dégagé.
        const weatherFactor = weather === "brume" ? 1.9 : wet ? 1.35 : 1;
        const density = (0.019 - value * 0.008) * weatherFactor;
        fog.density = THREE.MathUtils.lerp(fog.density, density, 0.08);

        const sky = new THREE.Color(
          value > 0.55 ? FOREST_PALETTE.skyDay : value > 0.15 ? FOREST_PALETTE.skyDusk : FOREST_PALETTE.skyNight,
        );
        (skyMaterial.uniforms.uTop.value as THREE.Color).lerp(sky, 0.08);
        (skyMaterial.uniforms.uHorizon.value as THREE.Color).lerp(fog.color, 0.5);

        sun.intensity = 0.04 + value * 1.6;
        ambient.intensity = 0.18 + value * 0.32;
        hemisphere.intensity = 0.25 + value * 0.5;
        moon.intensity = (1 - value) * 0.5;
        renderer.toneMappingExposure = 0.82 + value * 0.3;

        rain.visible = wet && intensity > 0.05;
        rainMaterial.opacity = rainParams(intensity).opacity;

        fireflyMaterial.opacity = night && !wet ? 0.6 : 0;
        fireflies.visible = night;

        // Le plafond de canopée s'assombrit avec la nuit.
        ceilingMaterial.color.setRGB(0.55 + value * 0.35, 0.6 + value * 0.35, 0.48 + value * 0.3);

        for (const marker of zoneMarkers) {
          const material = marker.material as THREE.MeshBasicMaterial;
          material.opacity = night ? 0.5 : 0.2;
        }
      },
      setRemotePlayers(players) {
        const seen = new Set<string>();
        for (const player of players) {
          seen.add(player.id);
          let group = remoteMeshes.get(player.id);
          if (!group) {
            group = makeRemoteAvatar(player.name);
            remoteMeshes.set(player.id, group);
            remoteGroup.add(group);
          }
          group.position.x = player.position[0];
          group.position.z = player.position[2];
          group.rotation.y = player.heading;
        }
        for (const [id, group] of remoteMeshes) {
          if (!seen.has(id)) {
            remoteGroup.remove(group);
            remoteMeshes.delete(id);
            group.traverse((child) => {
              if (child instanceof THREE.Mesh) {
                child.geometry.dispose();
                (child.material as THREE.Material).dispose();
              }
            });
          }
        }
      },
      setPaused(value) {
        paused = value;
        if (value && document.pointerLockElement) document.exitPointerLock();
      },
      getYaw() {
        return yaw;
      },
      requestLook() {
        renderer.domElement.requestPointerLock?.();
      },
      getStats() {
        let trees = 0;
        let understory = 0;
        let logs = 0;
        const plants = new Set<THREE.Material>(Object.values(understoryMaterials));
        for (const group of loadedTiles.values()) {
          group.traverse((child) => {
            if (!(child instanceof THREE.InstancedMesh)) return;
            if (child.geometry === trunkGeometry) trees += child.count;
            else if (child.geometry === logGeometry) logs += child.count;
            else if (plants.has(child.material as THREE.Material)) understory += child.count;
          });
        }
        return { trees, understory, logs };
      },
      dispose() {
        cancelAnimationFrame(raf);
        observer.disconnect();
        renderer.domElement.removeEventListener("pointerdown", onPointerDown);
        document.removeEventListener("pointermove", onPointerMove);
        document.removeEventListener("pointerlockchange", onPointerLockChange);
        scene.traverse((object) => {
          if (object instanceof THREE.Mesh || object instanceof THREE.Points || object instanceof THREE.Sprite) {
            object.geometry?.dispose();
            const material = object.material;
            if (Array.isArray(material)) material.forEach((m) => m.dispose());
            else material?.dispose();
          }
        });
        textures.forEach((texture) => texture.dispose());
        shaftTexture.dispose();
        contactTexture.dispose();
        composer?.dispose();
        renderer.dispose();
        if (renderer.domElement.parentElement === mount) {
          mount.removeChild(renderer.domElement);
        }
      },
    };

    controllerRef.current = controller;
    onReady?.(controller);

    return () => {
      controller.dispose();
      controllerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className={`relative h-full w-full overflow-hidden ${className}`}>
      <div ref={mountRef} className="absolute inset-0" />

      {/* Vignettage : concentre le regard, renforce l'ambiance sous-bois. */}
      {!unsupported && (
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(ellipse at 50% 46%, transparent 42%, rgba(4,12,8,0.34) 78%, rgba(3,9,6,0.62) 100%)",
          }}
        />
      )}

      {unsupported && (
        <div className="absolute inset-0 grid place-items-center bg-canopy-900/90 p-6 text-center">
          <div className="max-w-sm space-y-2">
            <p className="text-3xl">🌳</p>
            <p className="display text-xl">Vue 3D indisponible</p>
            <p className="text-sm text-mist/70">
              Votre navigateur ne prend pas en charge WebGL. Le carnet de terrain et la
              carte GPS restent utilisables.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
