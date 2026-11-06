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
  SKY_GRADIENT_EXPONENT,
  SCENE_CONFIG,
  TEXTURES,
  lightForDaylight,
  qualityBudget,
} from "@/game/sceneConfig";
import { WATER_BODIES, rainParams, waterDepthAt, waterLevelAt } from "@/game/water";
import { canopySheets } from "@/game/canopy";
import { DEFAULT_START, SPAWN_CLEARING, ZONES } from "@/game/levels";
import { cameraClearance, configureCollision, stepOverAt } from "@/game/collision";
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
import { type Animal } from "@/game/animals";
import { type MewaState } from "@/game/mewas";
import { type Shelter } from "@/game/engine";
import { type WeaponId } from "@/game/hunting";
import {
  createWaterSurface,
  setWaterCanopy,
  setWaterNormal,
  type WaterSurface,
} from "./WaterSurface";
import { createViewModel, type ViewModel } from "./WeaponView";
import { createAnimalRig, disposeAnimalRig, poseAnimal, type AnimalRig } from "./AnimalModel";
import {
  HUMAN_EYE_Y,
  createHumanRig,
  disposeHumanRig,
  humanKick,
  humanSlash,
  poseHuman,
  setHumanWeapon,
  type HumanMotion,
  type HumanPose,
  type HumanRig,
} from "./HumanModel";
import {
  equipAvatarWeapon,
  kickAvatarRig,
  poseAvatar,
  slashAvatarRig,
  type AvatarRig,
} from "./AvatarModel";

/**
 * Pose un personnage, quel que soit son corps.
 *
 * Le maillage importé et le corps procédural partagent la même interface, mais
 * pas le même code d'animation : l'un tourne les os d'un squelette glTF,
 * l'autre ceux d'un squelette construit à la main. Ce petit aiguillage évite
 * de dupliquer tout le bloc de rendu pour deux implémentations.
 */
function poseAny(rig: HumanRig, pose: HumanPose): void {
  if ((rig as AvatarRig).source === "gltf") poseAvatar(rig as AvatarRig, pose);
  else poseHuman(rig, pose);
}

function equipAny(rig: HumanRig, id: WeaponId): void {
  if ((rig as AvatarRig).source === "gltf") equipAvatarWeapon(rig as AvatarRig, id);
  else setHumanWeapon(rig, id);
}

function kickAny(rig: HumanRig, strength: number): void {
  if ((rig as AvatarRig).source === "gltf") kickAvatarRig(rig as AvatarRig, strength);
  else humanKick(rig, strength);
}

function slashAny(rig: HumanRig): void {
  if ((rig as AvatarRig).source === "gltf") slashAvatarRig(rig as AvatarRig);
  else humanSlash(rig);
}

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

export type SceneView = "premier" | "troisieme";

export interface SceneController {
  /**
   * Position du joueur, orientation, allure — et hauteur au-dessus du sol, qui
   * porte le saut. Sans elle, sauter ne se verrait pas : la caméra resterait
   * collée au terrain pendant que la simulation, elle, décolle.
   */
  setPlayer: (
    position: [number, number, number],
    heading: number,
    motion: string,
    height?: number,
  ) => void;
  /** Abris bâtis : lit, feu de camp, drapeau du Gabon. */
  setShelters: (shelters: Shelter[]) => void;
  /** Lunettes infrarouges : amplification de lumière et image verte. */
  setGoggles: (on: boolean) => void;
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
  /** Instantané de la faune : le rendu se contente de le dessiner. */
  setAnimals: (animals: Animal[]) => void;
  /** Les esprits de la forêt : un instantané suffit, ils flottent seuls. */
  setMewas: (mewas: MewaState[]) => void;
  /** Arme tenue en main. */
  setWeapon: (id: WeaponId) => void;
  /** Visée (arme épaulée). */
  setAiming: (aiming: boolean) => void;
  /** Retour visuel d'un tir : recul, éclair de bouche, coup de lame. */
  fireFeedback: (id: WeaponId) => void;
  /**
   * Point de vue : à l'épaule (le personnage est visible) ou subjectif.
   * La vue subjective garde les mains devant la caméra ; la vue à l'épaule
   * montre le corps entier et sert de référence pour juger les animations.
   */
  setView: (view: SceneView) => void;
  getView: () => SceneView;
  /** Rayon de visée depuis l'œil, en coordonnées monde. */
  getAim: () => { origin: [number, number, number]; direction: [number, number, number] };
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

/**
 * Halo des Mewas : un dégradé radial bleu, dessiné à la volée.
 * Additif et sans écriture dans le tampon de profondeur, pour qu'il brille
 * à travers les feuilles sans les découper.
 */
function makeGlowTexture(): THREE.Texture {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    gradient.addColorStop(0, "rgba(236, 250, 255, 1)");
    gradient.addColorStop(0.28, "rgba(150, 220, 255, 0.72)");
    gradient.addColorStop(0.62, "rgba(80, 170, 255, 0.22)");
    gradient.addColorStop(1, "rgba(40, 120, 255, 0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 128, 128);
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

    // Ciel en dôme : bleu au zénith, pâle à l'horizon, jamais uniforme. Un fond
    // uni laissait une bande de ciel claire entre les troncs, à hauteur
    // d'homme — ce qui trahit immédiatement le décor.
    //
    // Le bleu ne doit pas commencer à 60° : sous une canopée, on n'aperçoit le
    // ciel que par des trouées de 10 à 40°. La pente du dégradé est donc
    // calculée pour que la trouée médiane — 20° au-dessus de l'horizon — soit
    // déjà franchement bleue.
    const skyGeometry = new THREE.SphereGeometry(320, 24, 16);
    const skyMaterial = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        uTop: { value: new THREE.Color(FOREST_PALETTE.skyDay) },
        // L'horizon du ciel n'est **pas** la couleur de la brume : la brume est
        // verte (elle vient des feuilles), l'air au-dessus de la canopée est
        // bleu. Les avoir confondus faisait un ciel de marécage.
        uHorizon: { value: new THREE.Color(FOREST_PALETTE.skyHaze) },
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
          // Pente partagée avec scripts/check-sky.mjs : le bleu gagne vite
          // en montant, parce qu'on ne voit le ciel que par des trouées.
          vec3 colour = h > 0.0
            ? mix(uHorizon, uTop, pow(clamp(h, 0.0, 1.0), ${SKY_GRADIENT_EXPONENT.toFixed(2)}))
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
      gradient.addColorStop(0, "#8babbe"); // zénith, brumeux
      gradient.addColorStop(0.42, "#b3c2bd");
      gradient.addColorStop(0.5, "#e6dcb8"); // horizon chaud
      gradient.addColorStop(0.56, "#5e6f47");
      // Le bas de la sphère éclaire tous les dessous de feuilles : presque noir,
      // il éteint la moitié de la forêt. Un vert de sol de forêt, lui, renvoie
      // la lumière que la canopée ne laisse pas passer.
      gradient.addColorStop(1, "#38412b"); // sol de forêt
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      const equirect = new THREE.CanvasTexture(canvas);
      equirect.mapping = THREE.EquirectangularReflectionMapping;
      equirect.colorSpace = THREE.SRGBColorSpace;
      const pmrem = new THREE.PMREMGenerator(renderer);
      const envMap = pmrem.fromEquirectangular(equirect).texture;
      pmrem.dispose();
      // L'équirectangulaire est conservée : l'eau l'échantillonne directement
      // pour ses reflets, sans passer par la carte préfiltrée.
      return { envMap, equirect };
    })();
    if (environment) {
      scene.environment = environment.envMap;
      // Valeur de départ ; `setEnvironment` la recale sur le moment du jour.
      scene.environmentIntensity = 0.9;
    }
    const environmentEquirect = environment?.equirect ?? null;

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

      // Ombre de canopée : plus la forêt est dense, plus le sol est sombre —
      // mais ces couleurs *multiplient* déjà la texture : trop basses, elles
      // éteignent complètement la litière. Elles servent donc à varier, pas à
      // assombrir.
      const density = densityAt(x, z);
      const exposure = 0.62 + (1 - density) * 0.5;
      // Légère variation pour éviter un aplat.
      const grain = 0.94 + random() * 0.12;
      colour.setRGB(0.94 * exposure * grain, 0.86 * exposure * grain, 0.68 * exposure * grain);
      groundColours[i * 3] = colour.r;
      groundColours[i * 3 + 1] = colour.g;
      groundColours[i * 3 + 2] = colour.b;
    }
    groundGeometry.setAttribute("color", new THREE.BufferAttribute(groundColours, 3));
    groundGeometry.computeVertexNormals();

    const groundMaterial = new THREE.MeshStandardMaterial({
      // La carte de litière est une photo sombre (moyenne 47/38/24) : sans ce
      // gain, le sol reste noir quel que soit l'éclairage. Une albédo au-dessus
      // de 1 n'est pas physique, elle compense une photo exposée pour le plein
      // air et non pour un sous-bois.
      color: new THREE.Color(1.8, 1.7, 1.55),
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
      clearing: { ...SPAWN_CLEARING },
    };
    // Les mêmes tuiles, pour la collision : le fût qu'on voit est celui qui
    // arrête. Sur mobile la densité baisse — la collision doit suivre, sinon
    // on bute sur des arbres qui n'existent pas.
    configureCollision(TILE_OPTIONS);

    // Géométries et matériaux partagés par toutes les tuiles.
    // Cylindre effilé, ouvert : le fût s'affine vers le haut et les branches
    // s'y raccordent sans capuchon visible.
    const trunkGeometry = new THREE.CylinderGeometry(0.62, 1, 1, 8, 1, true);
    trunkGeometry.translate(0, 0.5, 0);
    const trunkMaterial = new THREE.MeshStandardMaterial({
      // La carte d'écorce est déjà brune : la teinter d'un brun sombre la
      // rendait noire. On l'éclaircit au contraire.
      color: 0xc9c2b2,
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
      color: 0xbfb49e,
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
      tint: 0xbc8174,
      sway: 0.01,
      alphaTest: 0.5,
      normal: TEXTURES.foliageDeepNormal,
      normalScale: 0.6,
    });

    const sprayMaterial = foliageMaterial(TEXTURES.spray, {
      tint: 0xf6d9c0,
      sway: 0.1,
      normal: TEXTURES.foliageNormal,
      normalScale: 0.9,
    });

    const foliageMaterials = [
      foliageMaterial(TEXTURES.foliage, {
        // Les teintes ci-dessous ne sont pas décoratives : elles corrigent le
        // virage vert d'eau des cartes (bleu aussi fort que rouge) vers le
        // jaune-olive d'un vrai sous-bois. Elles sont calculées à l'envers, à
        // partir de la couleur qu'on veut obtenir — voir scripts/check-palette.
        tint: 0xfbb092,
        sway: 0.07,
        normal: TEXTURES.foliageNormal,
        normalScale: 0.85,
      }),
      foliageMaterial(TEXTURES.foliageDeep, {
        tint: 0xdca788,
        sway: 0.05,
        normal: TEXTURES.foliageDeepNormal,
        normalScale: 0.8,
      }),
      foliageMaterial(TEXTURES.foliagePale, {
        tint: 0xf1c0b4,
        sway: 0.09,
        normal: TEXTURES.foliagePaleNormal,
        normalScale: 0.9,
      }),
    ];

    const understoryMaterials = {
      fern: foliageMaterial(TEXTURES.fern, {
        tint: 0xd9aa92,
        sway: 0.04,
        alphaTest: 0.38,
        normal: TEXTURES.fernNormal,
        normalScale: 0.9,
      }),
      bigleaf: foliageMaterial(TEXTURES.bigleaf, {
        tint: 0xfab29a,
        sway: 0.05,
        alphaTest: 0.4,
        normal: TEXTURES.bigleafNormal,
        normalScale: 0.95,
      }),
      bush: foliageMaterial(TEXTURES.foliage, {
        tint: 0xf3bc9e,
        sway: 0.1,
        alphaTest: 0.44,
        normal: TEXTURES.foliageNormal,
        normalScale: 0.8,
      }),
      cover: foliageMaterial(TEXTURES.foliageDeep, {
        tint: 0xcfa287,
        sway: 0.06,
        alphaTest: 0.46,
        normal: TEXTURES.foliagePaleNormal,
        normalScale: 0.7,
      }),
      grass: foliageMaterial(TEXTURES.grass, {
        tint: 0xdfc4a6,
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
    // Grandes nappes suspendues au-dessus du joueur : elles ferment le ciel
    // sans le boucher. Deux choses comptent ici, et elles ont été fausses :
    //
    //   · la **texture**. `canopy.png` est entièrement opaque — vérifié, alpha
    //     255 partout — donc un `alphaTest` dessus ne découpe rien : le
    //     plafond était un couvercle plein. C'est `foliage.png` qu'il faut,
    //     trouée à 55 % ;
    //   · la **pose**. Une grille régulière sans vides donne une dalle. Les
    //     nappes sont posées par `canopySheets`, qui laisse des trouées —
    //     voir `src/game/canopy.ts`.
    const ceilingGroup = new THREE.Group();
    const ceilingMaterial = foliageMaterial(TEXTURES.foliage, {
      // La canopée vue d'en bas est en contre-jour : plus sombre et plus froide
      // que le sous-bois, mais jamais émeraude.
      tint: 0xb59a86,
      sway: 0.12,
      alphaTest: 0.36,
    });
    const ceilingGeometry = new THREE.PlaneGeometry(1, 1);
    const sheets = canopySheets({ mobile: isMobile || reduced });
    const ceilingMesh = new THREE.InstancedMesh(ceilingGeometry, ceilingMaterial, sheets.length);
    ceilingMesh.frustumCulled = false;
    sheets.forEach((sheet, index) => {
      dummy.position.set(sheet.x, sheet.y, sheet.z);
      dummy.rotation.set(-Math.PI / 2 + sheet.tilt, sheet.yaw, 0, "YXZ");
      dummy.scale.setScalar(sheet.size);
      dummy.updateMatrix();
      ceilingMesh.setMatrixAt(index, dummy.matrix);
      tintColor.setRGB(0.62 + random() * 0.18, 0.72 + random() * 0.16, 0.55 + random() * 0.16);
      ceilingMesh.setColorAt(index, tintColor);
    });
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
    // Chaque plan d'eau est une surface dédiée, extrudée le long de sa ligne
    // d'eau : rivière sinueuse, ruisseau, baï et marais ont chacun leur lit.
    const waterSurfaces: WaterSurface[] = [];
    for (const body of WATER_BODIES) {
      const surface = createWaterSurface(body);
      surface.mesh.name = `eau-${body.id}`;
      scene.add(surface.mesh);
      waterSurfaces.push(surface);
    }
    // Une seule carte de normales partagée : les trois couches de rides du
    // shader la réutilisent à des échelles différentes.
    loadTexture(
      TEXTURES.waterNormal,
      (texture) => {
        for (const surface of waterSurfaces) setWaterNormal(surface, texture);
      },
      undefined,
      true,
    );
    // Le feuillage qui sert de masque de reflet : c'est lui qui donne à l'eau
    // son aspect de sous-bois et non de ciel.
    loadTexture(TEXTURES.foliage, (texture) => {
      for (const surface of waterSurfaces) setWaterCanopy(surface, texture);
    });
    if (environmentEquirect) {
      for (const surface of waterSurfaces) {
        const material = surface.mesh.material as THREE.ShaderMaterial;
        const previous = material.uniforms.uEnv.value as THREE.Texture | null;
        material.uniforms.uEnv.value = environmentEquirect;
        if (previous instanceof THREE.DataTexture) previous.dispose();
      }
    }

    // ------------------------------------------------------------------
    // Faune
    // ------------------------------------------------------------------
    const animalGroup = new THREE.Group();
    animalGroup.name = "faune";
    scene.add(animalGroup);

    const syncAnimals = (animals: Animal[]) => {
      animalSnapshot = animals;
      const seen = new Set<number>();
      for (const animal of animals) {
        seen.add(animal.id);
        if (animalRigs.has(animal.id)) continue;
        const rig = createAnimalRig(animal.speciesId);
        if (!rig) continue;
        // Seuls le tronc et la tête projettent une ombre : 4 pattes par animal
        // multiplieraient par cinq le coût de la carte d'ombres.
        rig.root.children.forEach((child, index) => {
          if (index > 2 || !(child instanceof THREE.Mesh)) return;
          child.castShadow = true;
          child.receiveShadow = true;
        });
        rig.head.children.forEach((child) => {
          if (child instanceof THREE.Mesh) child.castShadow = true;
        });
        animalRigs.set(animal.id, rig);
        animalGroup.add(rig.group);
      }
      for (const [id, rig] of animalRigs) {
        if (seen.has(id)) continue;
        disposeAnimalRig(rig);
        animalRigs.delete(id);
      }
    };

    // ------------------------------------------------------------------
    // Mewas : les esprits de la forêt
    // ------------------------------------------------------------------
    const mewaGroup = new THREE.Group();
    mewaGroup.name = "mewas";
    scene.add(mewaGroup);

    const glowTexture = makeGlowTexture();
    const mewaBodyGeometry = new THREE.SphereGeometry(0.27, 24, 18);
    const mewaEarGeometry = new THREE.ConeGeometry(0.105, 0.22, 14);
    const mewaEyeGeometry = new THREE.SphereGeometry(0.046, 12, 10);
    const mewaEyeMaterial = new THREE.MeshBasicMaterial({ color: 0x05070a });

    interface MewaRig {
      group: THREE.Group;
      halo: THREE.Sprite;
      body: THREE.MeshStandardMaterial;
      earLeft: THREE.Mesh;
      earRight: THREE.Mesh;
      phase: number;
    }
    const mewaRigs = new Map<number, MewaRig>();

    const createMewaRig = (mewa: MewaState): MewaRig => {
      const group = new THREE.Group();
      const body = new THREE.MeshStandardMaterial({
        color: 0xf6fbff,
        emissive: 0xbfe9ff,
        emissiveIntensity: 1.65,
        roughness: 0.38,
        metalness: 0,
      });
      const ball = new THREE.Mesh(mewaBodyGeometry, body);
      group.add(ball);

      const earLeft = new THREE.Mesh(mewaEarGeometry, body);
      earLeft.position.set(-0.13, 0.23, 0);
      earLeft.rotation.z = 0.36;
      group.add(earLeft);
      const earRight = new THREE.Mesh(mewaEarGeometry, body);
      earRight.position.set(0.13, 0.23, 0);
      earRight.rotation.z = -0.36;
      group.add(earRight);

      // Les yeux regardent vers l'avant du Mewa (−Z, comme le personnage).
      for (const side of [-1, 1]) {
        const eye = new THREE.Mesh(mewaEyeGeometry, mewaEyeMaterial);
        eye.position.set(side * 0.085, 0.03, -0.24);
        group.add(eye);
      }

      const halo = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: glowTexture,
          color: 0x9fdcff,
          transparent: true,
          opacity: 0.72,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        }),
      );
      halo.scale.set(2.1, 2.1, 1);
      group.add(halo);

      mewaGroup.add(group);
      return { group, halo, body, earLeft, earRight, phase: mewa.phase };
    };

    // Deux lampes seulement, portées par les deux esprits les plus proches :
    // dix lumières ponctuelles coûteraient plus que tout le reste de la scène.
    const mewaLights = [0, 1].map(() => {
      const light = new THREE.PointLight(0x86ccff, 0, 8, 2);
      light.visible = false;
      scene.add(light);
      return light;
    });

    /** Instantané des Mewas : on crée, on cache, on oublie. */
    let mewaSnapshot: MewaState[] = [];
    const syncMewas = (mewas: MewaState[]) => {
      mewaSnapshot = mewas;
      const seen = new Set<number>();
      for (const mewa of mewas) {
        if (mewa.collected) continue;
        seen.add(mewa.id);
        if (!mewaRigs.has(mewa.id)) mewaRigs.set(mewa.id, createMewaRig(mewa));
      }
      for (const [id, rig] of mewaRigs) {
        if (seen.has(id)) continue;
        mewaGroup.remove(rig.group);
        rig.halo.material.dispose();
        rig.body.dispose();
        mewaRigs.delete(id);
      }
    };

    // ------------------------------------------------------------------
    // Abris : un lit, un feu, un drapeau
    // ------------------------------------------------------------------
    // Un abri n'est pas un décor posé là : c'est le seul endroit de la forêt
    // que le joueur a construit. Il doit donc se lire de loin — le feu surtout,
    // qui est la seule lumière chaude de la nuit.

    const shelterGroup = new THREE.Group();
    shelterGroup.name = "shelters";
    scene.add(shelterGroup);

    const shelterWood = new THREE.MeshStandardMaterial({
      color: 0x5a4130,
      roughness: 0.92,
      metalness: 0,
    });
    const shelterBark = new THREE.MeshStandardMaterial({
      color: 0x6d513c,
      roughness: 0.96,
      metalness: 0,
    });
    // Toiture : des feuilles de marantacées, larges et mates.
    const shelterThatch = new THREE.MeshStandardMaterial({
      color: 0x536030,
      roughness: 0.98,
      metalness: 0,
      side: THREE.DoubleSide,
    });
    const shelterLeaf = new THREE.MeshStandardMaterial({
      color: 0x6f7d3d,
      roughness: 0.95,
      metalness: 0,
      side: THREE.DoubleSide,
    });
    const emberMaterial = new THREE.MeshBasicMaterial({ color: 0xff9a3c });

    // Drapeau du Gabon : trois bandes, vert, or, bleu.
    const flagMaterials = [0x0f8f57, 0xf2c437, 0x2f6bbf].map(
      (color) => new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0, side: THREE.DoubleSide }),
    );

    const poleGeometry = new THREE.CylinderGeometry(0.055, 0.075, 1, 7);
    const shelterLogGeometry = new THREE.CylinderGeometry(0.13, 0.15, 1.15, 8);
    const stoneGeometry = new THREE.DodecahedronGeometry(0.16, 0);
    const stoneMaterial = new THREE.MeshStandardMaterial({ color: 0x6a6a63, roughness: 0.95 });

    interface ShelterRig {
      group: THREE.Group;
      fire: THREE.PointLight;
    }
    const shelterRigs = new Map<number, ShelterRig>();
    let shelterIndexSignature = "";

    /**
     * Un abri : deux perches fourchues, une faîtière, un toit de feuilles, un
     * lit de fougères surélevé — on ne dort pas au sol dans un marais —, un
     * cercle de pierres et de quoi tenir le feu.
     */
    const createShelterRig = (shelter: Shelter): ShelterRig => {
      const group = new THREE.Group();
      const base = terrainHeight(shelter.x, shelter.z);
      group.position.set(shelter.x, base, shelter.z);
      // Chaque abri tourne un peu : trois cabanes identiques, c'est un décor.
      group.rotation.y = shelter.index * 1.7;

      const pole = (x: number, z: number, height: number, radius = 0.07) => {
        const mesh = new THREE.Mesh(poleGeometry, shelterBark);
        mesh.scale.set(radius / 0.065, height, radius / 0.065);
        mesh.position.set(x, height / 2, z);
        mesh.rotation.z = x > 0 ? -0.12 : 0.12;
        group.add(mesh);
      };

      // Deux poteaux plus hauts à l'arrière, deux plus courts devant.
      pole(-1.05, 0.95, 1.75, 0.075);
      pole(1.05, 0.95, 1.75, 0.075);
      pole(-0.95, -1.05, 1.15, 0.065);
      pole(0.95, -1.05, 1.15, 0.065);

      // Faîtière et chevrons.
      const ridge = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.35, 7), shelterWood);
      ridge.rotation.z = Math.PI / 2;
      ridge.position.set(0, 1.72, 0.95);
      group.add(ridge);
      const rafterGeometry = new THREE.CylinderGeometry(0.04, 0.045, 2.3, 6);
      for (let i = 0; i < 4; i += 1) {
        const x = -0.85 + i * 0.57;
        const rafter = new THREE.Mesh(rafterGeometry, shelterWood);
        rafter.position.set(x, 1.44, -0.05);
        rafter.rotation.x = Math.PI / 2 - 0.48;
        group.add(rafter);
      }

      // Toiture : trois rangs de feuilles qui se chevauchent.
      for (let row = 0; row < 3; row += 1) {
        const panel = new THREE.Mesh(new THREE.BoxGeometry(2.45, 0.05, 0.95), shelterThatch);
        panel.position.set(0, 1.63 - row * 0.19, 0.62 - row * 0.42);
        panel.rotation.x = -0.46;
        group.add(panel);
      }

      // Lit de fougères sur un plancher de rondins : le sol est détrempé.
      for (let i = 0; i < 4; i += 1) {
        const plank = new THREE.Mesh(shelterLogGeometry, shelterWood);
        plank.rotation.x = Math.PI / 2;
        plank.scale.y = 0.62;
        plank.position.set(-0.54 + i * 0.36, 0.3, -0.55);
        group.add(plank);
      }
      const mattress = new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.16, 1.9), shelterLeaf);
      mattress.position.set(0, 0.42, -0.5);
      group.add(mattress);

      // Foyer : cercle de pierres, trois rondins croisés, braise.
      const fire = new THREE.Group();
      fire.position.set(0.05, 0, -1.95);
      for (let i = 0; i < 8; i += 1) {
        const angle = (i / 8) * Math.PI * 2;
        const stone = new THREE.Mesh(stoneGeometry, stoneMaterial);
        stone.position.set(Math.cos(angle) * 0.62, 0.08, Math.sin(angle) * 0.62);
        stone.rotation.set(angle, angle * 0.7, angle * 0.3);
        stone.scale.setScalar(0.8 + ((i * 37) % 10) / 40);
        fire.add(stone);
      }
      for (let i = 0; i < 3; i += 1) {
        const log = new THREE.Mesh(shelterLogGeometry, shelterBark);
        log.scale.set(0.7, 0.42, 0.7);
        log.rotation.z = Math.PI / 2;
        log.rotation.y = (i / 3) * Math.PI;
        log.position.set(0, 0.16, 0);
        fire.add(log);
      }
      const embers = new THREE.Mesh(new THREE.SphereGeometry(0.3, 10, 7), emberMaterial);
      embers.scale.set(1, 0.32, 1);
      embers.position.y = 0.12;
      fire.add(embers);
      const glow = new THREE.PointLight(0xffa24a, 5.5, 13, 2);
      glow.position.set(0, 0.65, 0);
      fire.add(glow);
      group.add(fire);

      // Le drapeau : mât, trois bandes, et la hampe inclinée vers l'est.
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.06, 3.1, 7), shelterWood);
      mast.position.set(-1.62, 1.55, 0.35);
      group.add(mast);
      for (let i = 0; i < 3; i += 1) {
        const band = new THREE.Mesh(new THREE.PlaneGeometry(1.05, 0.3, 6, 1), flagMaterials[i]);
        band.position.set(-1.62 + 0.54, 2.55 - i * 0.3, 0.35);
        band.rotation.y = -0.22;
        group.add(band);
      }

      shelterGroup.add(group);
      return { group, fire: glow };
    };

    /** Instantané des abris : on crée les nouveaux, on oublie les anciens. */
    const syncShelters = (shelters: Shelter[]) => {
      const signature = shelters.map((shelter) => `${shelter.x.toFixed(2)}:${shelter.z.toFixed(2)}`).join("|");
      if (signature === shelterIndexSignature) return;
      shelterIndexSignature = signature;
      const seen = new Set<number>();
      for (const shelter of shelters) {
        seen.add(shelter.index);
        if (!shelterRigs.has(shelter.index)) {
          shelterRigs.set(shelter.index, createShelterRig(shelter));
        }
      }
      for (const [index, rig] of shelterRigs) {
        if (seen.has(index)) continue;
        // Les matériaux sont partagés entre abris : les détruire ici casserait
        // les autres. On retire le groupe, c'est tout.
        shelterGroup.remove(rig.group);
        shelterRigs.delete(index);
      }
    };

    // ------------------------------------------------------------------
    // Arme en main
    // ------------------------------------------------------------------
    const viewModel: ViewModel = createViewModel();
    camera.add(viewModel.group);
    // La caméra doit appartenir à la scène pour que ses enfants soient rendus.
    scene.add(camera);

    // ------------------------------------------------------------------
    // Personnage en pied
    // ------------------------------------------------------------------
    // Il n'est visible qu'à l'épaule, mais il est construit dans tous les cas :
    // basculer de vue ne doit jamais provoquer de génération d'uniformes au
    // milieu d'un mouvement.
    // Un seul corps, et c'est celui qu'on a sculpté.
    //
    // Le jeu chargeait auparavant `explorateur.glb` par-dessus : un homme en
    // redingote et chapeau melon, choisi comme bouche-trou faute de maillage
    // libre de droits. Il remplaçait le personnage une seconde après le
    // premier rendu — un Européen du XIXe siècle au milieu de la forêt du
    // Gabon. Le corps procédural est moins détaillé, mais c'est le bon homme,
    // habillé pour le terrain, et il ne dépend d'aucun téléchargement.
    const playerRig: HumanRig = createHumanRig();
    setHumanWeapon(playerRig, "machette");
    playerRig.group.visible = false;
    scene.add(playerRig.group);

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
    // Cap absolu de la caméra (0 = nord, −Z). C'est lui qui commande le
    // déplacement : le personnage va là où l'on regarde, il ne tourne plus la
    // caméra en marchant de travers.
    let yaw = DEFAULT_START.heading;
    let pitch = 0;
    let pointerLocked = false;

    // Le cap est ramené dans ]−π, π] à chaque geste. Sans ça il s'accumule
    // sans fin : au bout de quelques tours, les interpolations angulaires de
    // la caméra se mettent à tourner dans le mauvais sens — le fameux « ça ne
    // tourne pas à 360° ».
    const onPointerMove = (event: PointerEvent) => {
      const sensitivity = pointerLocked ? 0.0022 : 0.004;
      if (pointerLocked || (event.buttons === 1 && event.target === renderer.domElement)) {
        yaw = wrapAngle(yaw - event.movementX * sensitivity);
        pitch = Math.max(-1.1, Math.min(1.0, pitch - event.movementY * (pointerLocked ? 0.0018 : 0.003)));
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
    // Déclarés avant `resize` : la fonction y accède dès le premier appel, et
    // une `let` en zone morte temporelle ferait planter tout le montage.
    let composer: EffectComposer | null = null;
    let gradePass: ShaderPass | null = null;
    let bloomPass: UnrealBloomPass | null = null;

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
          uVignette: { value: 0.18 },
          uGrain: { value: 0.035 },
          uGoggles: { value: 0 },
          uSat: { value: 0.68 },
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
          uniform float uGoggles;
          uniform float uSat;
          varying vec2 vUv;

          float rand(vec2 co) {
            return fract(sin(dot(co, vec2(12.9898, 78.233))) * 43758.5453);
          }

          void main() {
            vec3 colour = texture2D(tDiffuse, vUv).rgb;

            // Désaturation — et pas une petite. Une forêt filmée n'est jamais
            // aussi saturée qu'un rendu 3D : le premier réglage (86 %) suffisait
            // pour une feuille isolée, pas pour un plein écran de feuillage.
            // Trois cents mètres carrés de vert à 45 % de saturation, cela
            // devient une affiche.
            //
            // La désaturation est pondérée : une couleur déjà vive perd
            // davantage qu'une couleur déjà sourde. C'est ainsi que travaille
            // une pellicule — les verts de canopée redescendent, les bruns et
            // les ocres du sol restent.
            float luma = dot(colour, vec3(0.2126, 0.7152, 0.0722));
            float chroma = max(colour.r, max(colour.g, colour.b)) - min(colour.r, min(colour.g, colour.b));
            float vivid = smoothstep(0.02, 0.30, chroma);
            float keep = uSat - (1.0 - uSat) * 0.45 * vivid;

            // Le ciel n'est pas un vert de plus. Cette désaturation sauve trois
            // cents mètres carrés de feuillage ; appliquée au ciel, elle en
            // faisait un gris — et un ciel gris au-dessus d'une forêt verte, ce
            // n'est pas une forêt, c'est un studio. On épargne donc le bleu :
            // plus un pixel tire vers le bleu, moins on le désature. Un
            // feuillage (vert, ocre, brun) n'a jamais de bleu dominant, il
            // n'est donc pas concerné.
            float blueness = clamp((colour.b - max(colour.r, colour.g)) * 8.0, 0.0, 1.0);
            keep = keep + (1.0 - keep) * blueness;
            colour = mix(vec3(luma), colour, clamp(keep, 0.0, 1.0));

            // Réchauffement des lumières, refroidissement des ombres. Le ciel
            // échappe au réchauffement : c'est précisément lui qui doit rester
            // bleu dans une image chaude.
            colour += vec3(0.035, 0.018, -0.012) * smoothstep(0.45, 1.0, luma) * (1.0 - blueness);
            colour += vec3(-0.012, 0.0, 0.02) * (1.0 - smoothstep(0.0, 0.45, luma));

            // Contraste en S, très léger : le contraste ajoute de la saturation
            // perçue, on ne peut donc pas pousser les deux en même temps.
            colour = clamp((colour - 0.5) * 1.04 + 0.5, 0.0, 1.0);

            // Vignettage.
            vec2 d = vUv - 0.5;
            float vig = 1.0 - dot(d, d) * uVignette * 2.2;
            colour *= clamp(vig, 0.0, 1.0);

            // Grain : casse les dégradés du brouillard.
            float grain = (rand(vUv * 1024.0 + uTime * 60.0) - 0.5) * uGrain;
            colour += grain;

            // Lunettes infrarouges : amplification, image verte, balayage. Ce
            // n'est pas un filtre de couleur posé sur l'image — le vert vient
            // d'une luminance remontée, comme sur un vrai tube.
            if (uGoggles > 0.001) {
              vec3 night = colour * (1.0 + uGoggles * 2.1);
              float lum = dot(night, vec3(0.30, 0.59, 0.11));
              night = vec3(lum * 0.36, lum * 1.62, lum * 0.78);
              float scan = 0.93 + 0.07 * sin(vUv.y * 820.0 + uTime * 1.6);
              night *= scan;
              // Le bord de l'oculaire : un masque rond, pas un filtre plein écran.
              vec2 ocular = (vUv - 0.5) * vec2(1.0, 0.94);
              float mask = smoothstep(0.64, 0.28, length(ocular));
              colour = mix(colour, night, clamp(uGoggles * mask, 0.0, 1.0));
            }

            gl_FragColor = vec4(colour, 1.0);
          }
        `,
      });
      // L'étalonnage vient APRÈS la conversion en espace d'affichage. Avant,
      // sa courbe en S s'appliquait à des valeurs linéaires : soustraire 0,5 à
      // une luminance linéaire de sous-bois (0,03) revenait à éteindre l'image,
      // et le vignettage achevait le travail. C'est ce qui rendait la forêt
      // noire alors que les lumières étaient correctes.
      composer.addPass(new OutputPass());
      composer.addPass(gradePass);
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
    let aiming = false;
    /** Hauteur du joueur au-dessus du sol, pilotée par le saut. */
    let playerHeight = 0;
    /** Lunettes infrarouges allumées. */
    let goggles = false;
    /** Lissage de l'effet, pour ne pas basculer d'un coup. */
    let gogglesFade = 0;
    /** Dernier instantané de faune reçu du moteur de jeu. */
    let animalSnapshot: Animal[] = [];
    const animalRigs = new Map<number, AnimalRig>();

    // Points de vue et suivi du personnage.
    let viewMode: SceneView = "troisieme";
    let rigYaw = DEFAULT_START.heading;
    /**
     * Hauteur gagnée en enjambant un tronc tombé, lissée.
     *
     * Le moteur ignore les troncs couchés : ils ne bloquent pas, ils se
     * franchissent. C'est donc au rendu de lever le corps — sans ce lissage,
     * le personnage monterait d'un coup de quarante centimètres.
     */
    let stepUp = 0;
    let previousPlayerX = 0;
    let previousPlayerZ = 6;
    const wrapAngle = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle));

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

      const groundUnderPlayer = terrainHeight(playerPosition.x, playerPosition.z);
      const targetYaw = yaw;

      // Déplacement réel depuis l'image précédente : c'est la seule source
      // fiable pour savoir de quel côté le personnage doit regarder.
      const stepX = playerPosition.x - previousPlayerX;
      const stepZ = playerPosition.z - previousPlayerZ;
      const stepLength = Math.hypot(stepX, stepZ);
      previousPlayerX = playerPosition.x;
      previousPlayerZ = playerPosition.z;

      const inWater = waterDepthAt(playerPosition.x, playerPosition.z) > 0.15;

      // Troncs tombés : on passe dessus. La montée suit le dessus du bois,
      // avec un amorti pour que ce soit une enjambée et non un saut. Dans
      // l'eau, on n'enjambe rien : le tronc est sous la surface.
      const stepTarget = inWater ? 0 : stepOverAt(playerPosition.x, playerPosition.z);
      stepUp += (stepTarget - stepUp) * (1 - Math.exp(-dt * 12));

      const bodyY = inWater
        ? Math.min(
            groundUnderPlayer + 1.1 + playerHeight * 0.4,
            waterLevelAt(playerPosition.x, playerPosition.z) - 0.75,
          )
        : groundUnderPlayer + playerHeight + stepUp;

      if (viewMode === "troisieme") {
        playerRig.group.visible = true;
        playerRig.group.position.set(playerPosition.x, bodyY, playerPosition.z);
        if (stepLength > 0.0015) {
          // Il marche là où il va. Le cap vient du moteur (`targetHeading`),
          // déjà dans le bon repère : c'est la direction réelle du pas, pas
          // une estimation à partir de deux images.
          const desired = targetHeading;
          rigYaw += wrapAngle(desired - rigYaw) * Math.min(1, dt * 9);
        } else {
          // Immobile, il tourne avec le regard. C'est ce qui permet de faire
          // un tour complet sur soi-même : sans cela, on peut balayer la
          // caméra de 360° sans que le corps bouge d'un degré.
          const rate = aiming ? 6 : 3.4;
          rigYaw += wrapAngle(targetYaw - rigYaw) * Math.min(1, dt * rate);
        }
        playerRig.group.rotation.y = rigYaw;
        poseAny(playerRig, {
          dt,
          motion: (inWater ? "swim" : currentMotion) as HumanMotion,
          speed: stepLength / Math.max(dt, 1e-4),
          aiming,
          aimYaw: wrapAngle(targetYaw - rigYaw),
          aimPitch: pitch,
        });
      } else {
        playerRig.group.visible = false;
      }

      camera.rotation.order = "YXZ";
      if (viewMode === "premier") {
        camera.position.set(
          playerPosition.x + sway,
          groundUnderPlayer + playerHeight + stepUp + HUMAN_EYE_Y + Math.abs(Math.sin(bob)) * bobAmplitude,
          playerPosition.z,
        );
        // Le plus court chemin, toujours : une interpolation linéaire entre
        // +179° et −179° fait un demi-tour dans le mauvais sens.
        camera.rotation.y += wrapAngle(targetYaw - camera.rotation.y) * Math.min(1, dt * 14);
        camera.rotation.x = pitch;
        camera.rotation.z = Math.sin(bob * 0.5) * 0.004;
      } else {
        // Caméra à l'épaule : elle regarde le personnage de dos, décalée à
        // droite, et se rapproche quand on épaule.
        const distance = aiming ? 1.5 : 3.1;
        const side = aiming ? 0.4 : 0.18;
        const pivotY = bodyY + 1.42 + Math.abs(Math.sin(bob)) * bobAmplitude * 0.5;
        const cosPitch = Math.cos(pitch);
        const forwardX = -Math.sin(targetYaw) * cosPitch;
        const forwardY = Math.sin(pitch);
        const forwardZ = -Math.cos(targetYaw) * cosPitch;
        const rightX = Math.cos(targetYaw);
        const rightZ = -Math.sin(targetYaw);

        let desiredX = playerPosition.x - forwardX * distance + rightX * side;
        let desiredZ = playerPosition.z - forwardZ * distance + rightZ * side;
        let desiredY = pivotY - forwardY * distance + 0.16;

        // Un tronc entre l'œil et le personnage : le bois est dessiné en faces
        // avant, donc on voit *à travers* lui et le corps paraît transparent,
        // coupé par le décor. On rapproche la caméra avant qu'elle n'y entre.
        const free = cameraClearance(playerPosition.x, playerPosition.z, desiredX, desiredZ);
        if (free < 1) {
          desiredX = playerPosition.x + (desiredX - playerPosition.x) * free;
          desiredZ = playerPosition.z + (desiredZ - playerPosition.z) * free;
          desiredY = pivotY + (desiredY - pivotY) * free;
        }
        // Amorti exponentiel : indépendant de la cadence d'images.
        const ease = 1 - Math.exp(-dt * 18);
        camera.position.x += (desiredX - camera.position.x) * ease;
        camera.position.y += (desiredY - camera.position.y) * ease;
        camera.position.z += (desiredZ - camera.position.z) * ease;

        // Le lissage met quelques images à rejoindre la position voulue : on
        // revérifie après coup, sinon la caméra traverse le bois pendant ce
        // temps-là.
        const stillFree = cameraClearance(
          playerPosition.x,
          playerPosition.z,
          camera.position.x,
          camera.position.z,
        );
        if (stillFree < 1) {
          camera.position.x = playerPosition.x + (camera.position.x - playerPosition.x) * stillFree;
          camera.position.z = playerPosition.z + (camera.position.z - playerPosition.z) * stillFree;
          camera.position.y = pivotY + (camera.position.y - pivotY) * stillFree;
        }

        // Jamais sous le sol, jamais dans la pente.
        const floor = terrainHeight(camera.position.x, camera.position.z) + 0.42;
        if (camera.position.y < floor) camera.position.y = floor;

        camera.rotation.y += wrapAngle(targetYaw - camera.rotation.y) * Math.min(1, dt * 20);
        camera.rotation.x = pitch;
        camera.rotation.z = 0;
      }
      viewModel.group.visible = viewMode === "premier";

      // Eau : le clapot est calculé dans le vertex shader, on ne pousse que les
      // uniformes (soleil, brouillard, reflet du couvert).
      {
        const fog = scene.fog as THREE.FogExp2;
        const night = daylight < 0.3;
        for (const surface of waterSurfaces) {
          surface.uniforms.uTime.value = elapsed;
          surface.uniforms.uSunDir.value
            .set(SUN_OFFSET.x, SUN_OFFSET.y, SUN_OFFSET.z)
            .normalize();
          surface.uniforms.uSunIntensity.value = 0.12 + daylight * 0.95;
          surface.uniforms.uSunColor.value.copy(sun.color);
          surface.uniforms.uFogColor.value.copy(fog.color);
          surface.uniforms.uFogDensity.value = fog.density;
          // Reflet du couvert : sombre sous les feuilles, jamais le ciel nu.
          const canopy = (surface.mesh.material as THREE.ShaderMaterial).uniforms.uCanopy
            .value as THREE.Color;
          canopy.setRGB(
            (night ? 0.03 : 0.09) + daylight * 0.05,
            (night ? 0.045 : 0.15) + daylight * 0.07,
            (night ? 0.04 : 0.11) + daylight * 0.05,
          );
        }
      }

      // Mewas : flottement, pulsation, et la lueur bleue des plus proches.
      const nearMewas: { x: number; z: number; distance: number }[] = [];
      for (const mewa of mewaSnapshot) {
        const rig = mewaRigs.get(mewa.id);
        if (!rig) continue;
        if (mewa.collected) {
          rig.group.visible = false;
          continue;
        }
        const distance = Math.hypot(mewa.x - camera.position.x, mewa.z - camera.position.z);
        if (distance > 78) {
          rig.group.visible = false;
          continue;
        }
        rig.group.visible = true;
        const groundY = terrainHeight(mewa.x, mewa.z);
        const bob = Math.sin(elapsed * 1.7 + rig.phase) * 0.13;
        rig.group.position.set(mewa.x, groundY + 1.12 + bob, mewa.z);
        // Il fait face au joueur : c'est ce qui donne l'impression d'être suivi.
        rig.group.rotation.y =
          Math.atan2(camera.position.x - mewa.x, camera.position.z - mewa.z) + Math.PI;
        const pulse = 0.62 + Math.sin(elapsed * 3.1 + rig.phase) * 0.16;
        (rig.halo.material as THREE.SpriteMaterial).opacity = pulse;
        rig.halo.scale.setScalar(1.9 + pulse * 0.4);
        rig.body.emissiveIntensity = 1.35 + pulse * 0.75;
        rig.earLeft.rotation.z = 0.36 + Math.sin(elapsed * 2.2 + rig.phase) * 0.07;
        rig.earRight.rotation.z = -0.36 - Math.sin(elapsed * 2.2 + rig.phase) * 0.07;
        nearMewas.push({ x: mewa.x, z: mewa.z, distance });
      }
      nearMewas.sort((a, b) => a.distance - b.distance);
      mewaLights.forEach((light, index) => {
        const candidate = nearMewas[index];
        if (!candidate || candidate.distance > 24) {
          light.visible = false;
          return;
        }
        light.visible = true;
        light.position.set(
          candidate.x,
          terrainHeight(candidate.x, candidate.z) + 1.1,
          candidate.z,
        );
        light.intensity = 3.6 * Math.max(0, 1 - candidate.distance / 26);
      });

      // Faune : on repose chaque individu à partir de l'instantané du moteur.
      for (const animal of animalSnapshot) {
        const rig = animalRigs.get(animal.id);
        if (!rig) continue;
        const distance = Math.hypot(animal.x - camera.position.x, animal.z - camera.position.z);
        if (distance > 88) {
          rig.group.visible = false;
          continue;
        }
        rig.group.visible = true;
        poseAnimal(rig, animal, distance);
      }

      // Arme en main : recul, oscillation de marche, visée.
      viewModel.update(dt, moving, aiming);

      // Léger glissement du champ quand on épaule.
      const targetFov = aiming ? SCENE_CONFIG.camera.fov * 0.78 : SCENE_CONFIG.camera.fov;
      if (Math.abs(camera.fov - targetFov) > 0.05) {
        camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 12);
        camera.updateProjectionMatrix();
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
        gogglesFade += ((goggles ? 1 : 0) - gogglesFade) * Math.min(1, dt * 7);
        gradePass!.uniforms.uGoggles.value = gogglesFade;
        // Le bloom ne doit exister qu'en plein jour : la nuit, il baverait.
        bloomPass!.strength = 0.06 + daylight * 0.24;
        composer.render();
      } else {
        renderer.render(scene, camera);
      }
    };
    animate();

    const controller: SceneController = {
      setPlayer(position, heading, motion, height = 0) {
        playerPosition.set(position[0], 0, position[2]);
        targetHeading = heading;
        currentMotion = motion;
        playerHeight = height;
      },
      setShelters(shelters) {
        syncShelters(shelters);
      },
      setGoggles(on) {
        goggles = on;
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

        const weatherFactor = weather === "brume" ? 1.9 : wet ? 1.35 : 1;
        const budget = lightForDaylight(value, weatherFactor);
        fog.density = THREE.MathUtils.lerp(fog.density, budget.fogDensity, 0.08);

        // Le dôme a **deux** couleurs, et elles ne viennent pas de la même
        // chose : le zénith dit le soleil, l'horizon dit l'air. On les fait
        // évoluer ensemble mais séparément de la brume du sol.
        const sky = new THREE.Color(
          value > 0.55 ? FOREST_PALETTE.skyDay : value > 0.15 ? FOREST_PALETTE.skyDusk : FOREST_PALETTE.skyNight,
        );
        const skyHaze = new THREE.Color(
          value > 0.55
            ? FOREST_PALETTE.skyHaze
            : value > 0.15
              ? FOREST_PALETTE.skyHazeDusk
              : FOREST_PALETTE.skyHazeNight,
        );
        (skyMaterial.uniforms.uTop.value as THREE.Color).lerp(sky, 0.08);
        (skyMaterial.uniforms.uHorizon.value as THREE.Color).lerp(skyHaze, 0.08);

        sun.intensity = budget.sun;
        ambient.intensity = budget.ambient;
        hemisphere.intensity = budget.hemisphere;
        moon.intensity = budget.moon;
        // Lunettes : on ouvre l'exposition pour lire le sous-bois de nuit. Le
        // vert et le balayage sont faits par l'étalonnage, pas ici.
        const gogglesGain = goggles ? 1 + (1 - value) * 1.5 : 1;
        renderer.toneMappingExposure = budget.exposure * gogglesGain;
        // La carte d'ambiance est la seule lumière qui atteint le sous-bois :
        // baissée, elle éteint la forêt même en plein jour.
        scene.environmentIntensity = budget.environment;
        // Lampe frontale : elle n'éclaire vraiment que lorsque la nuit tombe.
        viewModel.setLamp(0.08 + (1 - value) * 0.85);

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
      setAnimals(animals) {
        syncAnimals(animals);
      },
      setMewas(mewas) {
        syncMewas(mewas);
      },
      setWeapon(id) {
        viewModel.setWeapon(id);
        equipAny(playerRig, id);
      },
      setAiming(value) {
        aiming = value;
        viewModel.setAiming(value);
      },
      fireFeedback(id) {
        if (id === "couteau" || id === "machette" || id === "lance") {
          viewModel.slash();
          slashAny(playerRig);
        } else {
          const strength = id === "m16" ? 0.8 : 1;
          viewModel.kick(strength);
          kickAny(playerRig, strength);
        }
      },
      getAim() {
        const direction = new THREE.Vector3();
        camera.getWorldDirection(direction);
        // Le rayon garde la ligne du réticule, mais part de l'épaule : sans
        // cela, un coup de couteau porterait à six mètres.
        const behind = Math.hypot(
          playerPosition.x - camera.position.x,
          playerPosition.z - camera.position.z,
        );
        const ahead = viewMode === "troisieme" ? Math.max(0, behind - 0.35) : 0;
        return {
          origin: [
            camera.position.x + direction.x * ahead,
            camera.position.y + direction.y * ahead,
            camera.position.z + direction.z * ahead,
          ],
          direction: [direction.x, direction.y, direction.z],
        };
      },
      setView(view) {
        viewMode = view;
        viewModel.group.visible = view === "premier";
        playerRig.group.visible = view === "troisieme";
      },
      getView() {
        return viewMode;
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
        for (const surface of waterSurfaces) surface.dispose();
        for (const [, rig] of animalRigs) disposeAnimalRig(rig);
        animalRigs.clear();
        disposeHumanRig(playerRig);
        viewModel.dispose();
        for (const rig of mewaRigs.values()) {
          rig.halo.material.dispose();
          rig.body.dispose();
        }
        mewaRigs.clear();
        mewaBodyGeometry.dispose();
        mewaEarGeometry.dispose();
        mewaEyeGeometry.dispose();
        mewaEyeMaterial.dispose();
        glowTexture.dispose();
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
