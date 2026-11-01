"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import type { Weather } from "@/game/realism";
import { FOREST_PALETTE, SCENE_CONFIG, TEXTURES, qualityBudget } from "@/game/sceneConfig";
import { WATER_BODIES, rainParams } from "@/game/water";
import { ZONES } from "@/game/levels";

/**
 * Scène 3D de la réserve.
 *
 * Le composant crée le monde une seule fois puis expose un contrôleur
 * impératif : le moteur de jeu (MinkebeGame) met à jour la position et
 * l'environnement à 60 Hz sans provoquer de rendu React.
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
  dispose: () => void;
}

export interface SceneProps {
  onReady?: (controller: SceneController) => void;
  onError?: (message: string) => void;
  /** Qualité de rendu ; "auto" détecte mobile et prefers-reduced-motion. */
  quality?: "auto" | "basse" | "haute";
  className?: string;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
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
      setUnsupported(true);
      onError?.("WebGL n'est pas disponible sur cet appareil.");
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
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
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
    scene.background = new THREE.Color(SCENE_CONFIG.background);
    scene.fog = new THREE.Fog(
      SCENE_CONFIG.fog.color,
      SCENE_CONFIG.fog.near,
      SCENE_CONFIG.fog.far,
    );

    const camera = new THREE.PerspectiveCamera(
      SCENE_CONFIG.camera.fov,
      1,
      SCENE_CONFIG.camera.near,
      SCENE_CONFIG.camera.far,
    );
    camera.position.set(0, SCENE_CONFIG.camera.height, 6);

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
    sun.position.set(
      SCENE_CONFIG.lighting.sun.position.x,
      SCENE_CONFIG.lighting.sun.position.y,
      SCENE_CONFIG.lighting.sun.position.z,
    );
    sun.castShadow = renderer.shadowMap.enabled;
    sun.shadow.mapSize.set(budget.shadowMapSize, budget.shadowMapSize);
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 320;
    sun.shadow.camera.left = -90;
    sun.shadow.camera.right = 90;
    sun.shadow.camera.top = 90;
    sun.shadow.camera.bottom = -90;
    sun.shadow.bias = SCENE_CONFIG.shadows.bias;
    scene.add(sun);
    scene.add(sun.target);

    const moon = new THREE.DirectionalLight(
      SCENE_CONFIG.lighting.moon.color,
      0,
    );
    moon.position.set(-50, 80, -30);
    scene.add(moon);

    // ------------------------------------------------------------------
    // Sol
    // ------------------------------------------------------------------
    const textureLoader = new THREE.TextureLoader();
    const textures: THREE.Texture[] = [];

    const loadTexture = (path: string, onLoad: (t: THREE.Texture) => void) => {
      textureLoader.load(
        path,
        (texture) => {
          texture.colorSpace = THREE.SRGBColorSpace;
          texture.wrapS = THREE.RepeatWrapping;
          texture.wrapT = THREE.RepeatWrapping;
          textures.push(texture);
          onLoad(texture);
        },
        undefined,
        () => {
          /* texture absente : on garde la couleur unie */
        },
      );
    };

    const groundGeometry = new THREE.PlaneGeometry(
      SCENE_CONFIG.ground.size,
      SCENE_CONFIG.ground.size,
      SCENE_CONFIG.ground.segments,
      SCENE_CONFIG.ground.segments,
    );
    groundGeometry.rotateX(-Math.PI / 2);

    // Relief léger : quelques ondulations déterministes.
    const position = groundGeometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < position.count; i++) {
      const x = position.getX(i);
      const z = position.getZ(i);
      const height =
        Math.sin(x * 0.031) * Math.cos(z * 0.027) * 2.4 +
        Math.sin((x + z) * 0.011) * 3.2;
      position.setY(i, height - 0.15);
    }
    groundGeometry.computeVertexNormals();

    const groundMaterial = new THREE.MeshStandardMaterial({
      color: FOREST_PALETTE.earth,
      roughness: 0.96,
      metalness: 0,
    });
    loadTexture(TEXTURES.ground, (texture) => {
      texture.repeat.set(48, 48);
      groundMaterial.map = texture;
      groundMaterial.color.set(0xffffff);
      groundMaterial.needsUpdate = true;
    });

    const ground = new THREE.Mesh(groundGeometry, groundMaterial);
    ground.receiveShadow = true;
    scene.add(ground);

    // ------------------------------------------------------------------
    // Végétation instanciée
    // ------------------------------------------------------------------
    const trunkGeometry = new THREE.CylinderGeometry(0.32, 0.52, 9, 6, 1);
    trunkGeometry.translate(0, 4.5, 0);
    const trunkMaterial = new THREE.MeshStandardMaterial({
      color: FOREST_PALETTE.bark,
      roughness: 0.94,
    });
    loadTexture(TEXTURES.bark, (texture) => {
      texture.repeat.set(1, 3);
      trunkMaterial.map = texture;
      trunkMaterial.needsUpdate = true;
    });

    const canopyGeometry = new THREE.IcosahedronGeometry(3.1, 1);
    const canopyMaterial = new THREE.MeshStandardMaterial({
      color: FOREST_PALETTE.canopy,
      roughness: 0.9,
      flatShading: true,
    });

    const trunks = new THREE.InstancedMesh(trunkGeometry, trunkMaterial, budget.trees);
    const canopies = new THREE.InstancedMesh(canopyGeometry, canopyMaterial, budget.trees * 2);
    trunks.castShadow = true;
    canopies.castShadow = true;
    canopies.receiveShadow = false;

    const dummy = new THREE.Object3D();
    let canopyIndex = 0;
    const treePositions: [number, number][] = [];

    for (let i = 0; i < budget.trees; i++) {
      const angle = random() * Math.PI * 2;
      const distance = 8 + Math.sqrt(random()) * 210;
      const x = Math.cos(angle) * distance;
      const z = Math.sin(angle) * distance;
      // On dégage les zones d'eau et les clairières.
      const inWater = WATER_BODIES.some(
        (body) =>
          Math.abs(x - body.center[0]) < body.width / 2 + 4 &&
          Math.abs(z - body.center[1]) < body.depth / 2 + 4,
      );
      if (inWater) continue;

      const scale = 0.7 + random() * 1.5;
      dummy.position.set(x, 0, z);
      dummy.rotation.set(0, random() * Math.PI * 2, 0);
      dummy.scale.set(scale * 0.9, scale, scale * 0.9);
      dummy.updateMatrix();
      trunks.setMatrixAt(i, dummy.matrix);
      treePositions.push([x, z]);

      for (let c = 0; c < 2; c++) {
        dummy.position.set(
          x + (random() - 0.5) * 2.4,
          7.2 * scale + random() * 2.6,
          z + (random() - 0.5) * 2.4,
        );
        dummy.rotation.set(random() * Math.PI, random() * Math.PI, random() * Math.PI);
        dummy.scale.setScalar(scale * (0.7 + random() * 0.55));
        dummy.updateMatrix();
        if (canopyIndex < canopies.count) canopies.setMatrixAt(canopyIndex++, dummy.matrix);
      }
    }
    trunks.instanceMatrix.needsUpdate = true;
    canopies.instanceMatrix.needsUpdate = true;
    scene.add(trunks, canopies);

    // Fougères : plans croisés avec texture alpha.
    const fernGeometry = new THREE.PlaneGeometry(1.6, 1.2);
    fernGeometry.translate(0, 0.55, 0);
    const fernMaterial = new THREE.MeshStandardMaterial({
      color: 0x4e7a3d,
      roughness: 0.9,
      transparent: true,
      alphaTest: 0.35,
      side: THREE.DoubleSide,
    });
    loadTexture(TEXTURES.fern, (texture) => {
      fernMaterial.map = texture;
      fernMaterial.alphaMap = texture;
      fernMaterial.needsUpdate = true;
    });

    const fernCount = budget.ferns;
    const ferns = new THREE.InstancedMesh(fernGeometry, fernMaterial, fernCount);
    for (let i = 0; i < fernCount; i++) {
      const angle = random() * Math.PI * 2;
      const distance = 3 + Math.sqrt(random()) * 150;
      dummy.position.set(Math.cos(angle) * distance, 0, Math.sin(angle) * distance);
      dummy.rotation.set(0, random() * Math.PI * 2, 0);
      dummy.scale.setScalar(0.6 + random() * 1.1);
      dummy.updateMatrix();
      ferns.setMatrixAt(i, dummy.matrix);
    }
    ferns.instanceMatrix.needsUpdate = true;
    scene.add(ferns);

    // Rochers des inselbergs.
    const rockGeometry = new THREE.DodecahedronGeometry(1.1, 0);
    const rockMaterial = new THREE.MeshStandardMaterial({
      color: 0x6a6a62,
      roughness: 0.95,
      flatShading: true,
    });
    const rocks = new THREE.InstancedMesh(rockGeometry, rockMaterial, budget.rocks);
    for (let i = 0; i < budget.rocks; i++) {
      const angle = random() * Math.PI * 2;
      const distance = 12 + Math.sqrt(random()) * 190;
      dummy.position.set(Math.cos(angle) * distance, random() * 0.6, Math.sin(angle) * distance);
      dummy.rotation.set(random() * Math.PI, random() * Math.PI, random() * Math.PI);
      dummy.scale.setScalar(0.5 + random() * 1.8);
      dummy.updateMatrix();
      rocks.setMatrixAt(i, dummy.matrix);
    }
    rocks.instanceMatrix.needsUpdate = true;
    rocks.castShadow = true;
    rocks.receiveShadow = true;
    scene.add(rocks);

    // ------------------------------------------------------------------
    // Eau
    // ------------------------------------------------------------------
    const waterMeshes: { mesh: THREE.Mesh; body: (typeof WATER_BODIES)[number] }[] = [];
    for (const body of WATER_BODIES) {
      const geometry = new THREE.PlaneGeometry(body.width, body.depth, 24, 24);
      geometry.rotateX(-Math.PI / 2);
      const material = new THREE.MeshStandardMaterial({
        color: body.color,
        transparent: true,
        opacity: body.opacity,
        roughness: 0.15,
        metalness: 0.35,
        envMapIntensity: 0.8,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(body.center[0], body.level, body.center[1]);
      mesh.receiveShadow = true;
      scene.add(mesh);
      waterMeshes.push({ mesh, body });
    }

    // ------------------------------------------------------------------
    // Pluie et lucioles (Points)
    // ------------------------------------------------------------------
    const rainCount = 2600;
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
      size: 0.09,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    const rain = new THREE.Points(rainGeometry, rainMaterial);
    rain.visible = false;
    scene.add(rain);

    const fireflyCount = 320;
    const fireflyPositions = new Float32Array(fireflyCount * 3);
    for (let i = 0; i < fireflyCount; i++) {
      fireflyPositions[i * 3] = (random() - 0.5) * 80;
      fireflyPositions[i * 3 + 1] = 0.4 + random() * 3.4;
      fireflyPositions[i * 3 + 2] = (random() - 0.5) * 80;
    }
    const fireflyGeometry = new THREE.BufferGeometry();
    fireflyGeometry.setAttribute("position", new THREE.BufferAttribute(fireflyPositions, 3));
    const fireflyMaterial = new THREE.PointsMaterial({
      color: 0xd8ff8a,
      size: 0.16,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const fireflies = new THREE.Points(fireflyGeometry, fireflyMaterial);
    scene.add(fireflies);

    // ------------------------------------------------------------------
    // Marqueurs des zones (balises lumineuses)
    // ------------------------------------------------------------------
    const zoneMarkers: THREE.Mesh[] = [];
    for (const zone of ZONES) {
      const marker = new THREE.Mesh(
        new THREE.CylinderGeometry(0.35, 0.35, 5, 6, 1, true),
        new THREE.MeshBasicMaterial({
          color: zone.id === "camp" ? 0xf2b544 : 0x6f9f5e,
          transparent: true,
          opacity: 0.35,
          side: THREE.DoubleSide,
        }),
      );
      marker.position.set(zone.center[0], 2.5, zone.center[1]);
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

    // ------------------------------------------------------------------
    // Caméra libre à la souris
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
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(mount);

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

    const animate = () => {
      raf = requestAnimationFrame(animate);
      const now = performance.now();
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (paused) return;
      elapsed += dt;

      // Position de la caméra (avec léger balancement à la marche).
      const moving = currentMotion === "walk" || currentMotion === "run" || currentMotion === "sneak";
      bob += dt * (currentMotion === "run" ? 11 : 6);
      const bobAmplitude = moving ? (currentMotion === "run" ? 0.075 : 0.035) : 0;
      const sway = moving ? Math.sin(bob * 0.5) * 0.012 : 0;

      camera.position.set(
        playerPosition.x + sway,
        SCENE_CONFIG.camera.height + Math.abs(Math.sin(bob)) * bobAmplitude,
        playerPosition.z,
      );

      // La caméra suit le cap du joueur, modulé par la souris.
      const targetYaw = targetHeading + yaw - Math.PI;
      camera.rotation.order = "YXZ";
      camera.rotation.y = THREE.MathUtils.lerp(camera.rotation.y, targetYaw, 0.18);
      camera.rotation.x = pitch;
      camera.rotation.z = Math.sin(bob * 0.5) * 0.004;

      // Vagues de l'eau.
      for (const { mesh, body } of waterMeshes) {
        const positions = mesh.geometry.attributes.position as THREE.BufferAttribute;
        for (let i = 0; i < positions.count; i++) {
          const x = positions.getX(i);
          const z = positions.getZ(i);
          const wave =
            Math.sin(x * 0.22 + elapsed * 1.1 + body.current) * 0.05 +
            Math.cos(z * 0.3 - elapsed * 0.9) * 0.04;
          positions.setY(i, wave);
        }
        positions.needsUpdate = true;
      }

      // Pluie : chute verticale autour de la caméra.
      if (rain.visible) {
        const positions = rain.geometry.attributes.position as THREE.BufferAttribute;
        const speed = 24 * dt;
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

      // Lucioles : scintillement et dérive.
      if (fireflies.visible) {
        fireflyMaterial.opacity = 0.55 + Math.sin(elapsed * 1.6) * 0.18;
        fireflies.rotation.y = elapsed * 0.006;
      }

      // Les joueurs distants flottent légèrement (respiration).
      for (const group of remoteMeshes.values()) {
        group.position.y = Math.sin(elapsed * 1.6 + group.position.x) * 0.02;
      }

      // Le soleil suit le joueur pour garder des ombres nettes.
      sun.position.set(
        camera.position.x + SCENE_CONFIG.lighting.sun.position.x,
        SCENE_CONFIG.lighting.sun.position.y,
        camera.position.z + SCENE_CONFIG.lighting.sun.position.z,
      );
      sun.target.position.set(camera.position.x, 0, camera.position.z);
      sun.target.updateMatrixWorld();

      renderer.render(scene, camera);
    };
    animate();

    const controller: SceneController = {
      setPlayer(position, heading, motion) {
        playerPosition.set(position[0], 0, position[2]);
        targetHeading = heading;
        currentMotion = motion;
      },
      setEnvironment({ hour, daylight, weather, intensity = 0.6 }) {
        const night = daylight < 0.25;
        const fogColour = new THREE.Color(
          night ? FOREST_PALETTE.fogNight : FOREST_PALETTE.fogDay,
        );
        (scene.fog as THREE.Fog).color.lerp(fogColour, 0.1);
        (scene.fog as THREE.Fog).near = 14 + daylight * 22;
        (scene.fog as THREE.Fog).far = 90 + daylight * 190;

        const sky = new THREE.Color(
          daylight > 0.55
            ? FOREST_PALETTE.skyDay
            : daylight > 0.15
              ? FOREST_PALETTE.skyDusk
              : FOREST_PALETTE.skyNight,
        );
        if (scene.background instanceof THREE.Color) {
          scene.background.lerp(sky, 0.08);
        }

        sun.intensity = 0.08 + daylight * 2.0;
        ambient.intensity = 0.12 + daylight * 0.4;
        hemisphere.intensity = 0.2 + daylight * 0.5;
        moon.intensity = (1 - daylight) * 0.45;
        renderer.toneMappingExposure = 0.8 + daylight * 0.35;

        const wet = weather === "pluie" || weather === "orage";
        rain.visible = wet && intensity > 0.05;
        const params = rainParams(intensity);
        rainMaterial.opacity = params.opacity;

        fireflyMaterial.opacity = night && !wet ? 0.6 : 0;
        fireflies.visible = night;

        // Les balises de zone s'allument la nuit.
        for (const marker of zoneMarkers) {
          const material = marker.material as THREE.MeshBasicMaterial;
          material.opacity = night ? 0.55 : 0.25;
        }

        // Brouillard dense : on rapproche le plan lointain.
        if (weather === "brume") {
          (scene.fog as THREE.Fog).far *= 0.6;
        }
        if (hour >= 0) {
          /* l'heure est déjà reflétée par daylight */
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
      dispose() {
        cancelAnimationFrame(raf);
        observer.disconnect();
        renderer.domElement.removeEventListener("pointerdown", onPointerDown);
        document.removeEventListener("pointermove", onPointerMove);
        document.removeEventListener("pointerlockchange", onPointerLockChange);
        scene.traverse((object) => {
          if (object instanceof THREE.Mesh || object instanceof THREE.Points) {
            object.geometry?.dispose();
            const material = object.material;
            if (Array.isArray(material)) material.forEach((m) => m.dispose());
            else material?.dispose();
          }
        });
        textures.forEach((texture) => texture.dispose());
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
