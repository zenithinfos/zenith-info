/**
 * Les plants à fruits : la géométrie, séparée du rendu.
 *
 * Ce module ne connaît ni la scène ni le vent : il reçoit les matières et
 * rend un groupe. C'est ce qui permet à `Scene.tsx` de les poser dans la
 * forêt et à `scripts/preview-fruits.mjs` de les dessiner hors navigateur avec
 * **exactement** la même géométrie — sans quoi l'aperçu finit toujours par
 * montrer autre chose que le jeu.
 */

import * as THREE from "three";
import { FRUIT_KINDS, type FruitPlant } from "@/game/forage";

export interface FruitPlantMaterials {
  /** Écorce des tiges et des rameaux. */
  bark: THREE.Material;
  /** Feuillage : les mêmes cartes que le sous-bois. */
  leaf: THREE.Material;
  /** Carte partagée par toutes les feuilles. */
  leafGeometry: THREE.BufferGeometry;
}

export interface FruitPlantMesh {
  group: THREE.Group;
  /** Fruits dans l'ordre d'affichage : on montre les `ripe` premiers. */
  fruits: THREE.Mesh[];
}

/** Générateur local, déterministe : deux plants ne sont pas des clones. */
function randomiser(seed: number): () => number {
  let state = (seed * 2654435761) >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

const fruitMaterials = new Map<string, THREE.MeshPhysicalMaterial>();

/**
 * Matière d'un fruit.
 *
 * Un fruit n'est pas mat : sa peau est lisse et renvoie la tache de ciel qui
 * passe entre les feuilles. C'est ce reflet qui le fait repérer dans la
 * pénombre, plus sûrement que sa couleur — et c'est aussi ce qui le sépare
 * d'une baie en plastique.
 */
export function fruitMaterial(colour: string): THREE.MeshPhysicalMaterial {
  let material = fruitMaterials.get(colour);
  if (!material) {
    material = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(colour),
      roughness: 0.38,
      metalness: 0,
      clearcoat: 0.55,
      clearcoatRoughness: 0.22,
      sheen: 0.25,
      sheenColor: new THREE.Color(colour).lerp(new THREE.Color(0xffffff), 0.5),
    });
    // Pastille lisible par les aperçus, qui ne peuvent pas relire une couleur
    // de matière sans son éclairage.
    material.userData.swatch = new THREE.Color(colour);
    fruitMaterials.set(colour, material);
  }
  return material;
}

/**
 * Construit un plant.
 *
 * Une tige grêle qui penche — chercher la lumière est ce que fait une plante de
 * sous-bois —, trois à quatre rameaux vers l'extérieur, des feuilles larges, et
 * des fruits en grappes **à hauteur de main**. Un fruit qu'on ne peut pas
 * atteindre n'est pas une ressource, c'est un décor.
 */
export function buildFruitPlant(
  plant: FruitPlant,
  materials: FruitPlantMaterials,
  groundY: number,
): FruitPlantMesh {
  const kind = FRUIT_KINDS[plant.species];
  const random = randomiser(plant.id * 7919 + 13);
  const group = new THREE.Group();
  group.name = `fruit-${plant.id}-${plant.species}`;
  group.position.set(plant.x, groundY, plant.z);
  group.rotation.y = plant.turn;

  const height = kind.height + 0.34;
  const lean = (random() - 0.5) * 0.3;
  const stem = new THREE.Mesh(
    new THREE.CylinderGeometry(0.012, 0.026, height, 7, 1),
    materials.bark,
  );
  stem.position.set(lean * 0.4, height / 2, 0);
  stem.rotation.z = -lean;
  stem.castShadow = true;
  group.add(stem);

  const branchCount = 3 + Math.floor(random() * 2);
  const tips: THREE.Vector3[] = [];

  for (let index = 0; index < branchCount; index += 1) {
    const angle = (index / branchCount) * Math.PI * 2 + random() * 0.7;
    const at = height * (0.52 + random() * 0.34);
    const reach = 0.3 + random() * 0.26;

    const branch = new THREE.Mesh(
      new THREE.CylinderGeometry(0.007, 0.013, reach, 6, 1),
      materials.bark,
    );
    branch.position.set(
      lean * 0.4 + Math.cos(angle) * reach * 0.5,
      at,
      Math.sin(angle) * reach * 0.5,
    );
    // Le cylindre est vertical : on le couche vers l'extérieur.
    branch.rotation.set(Math.PI / 2 - 0.5, 0, 0);
    branch.rotateOnWorldAxis(new THREE.Vector3(0, 1, 0), -angle);
    branch.castShadow = true;
    group.add(branch);
    tips.push(new THREE.Vector3(Math.cos(angle) * reach, at - 0.02, Math.sin(angle) * reach));

    for (let leaf = 0; leaf < 3; leaf += 1) {
      const card = new THREE.Mesh(materials.leafGeometry, materials.leaf);
      const size = 0.34 + random() * 0.22;
      card.scale.set(size, size * (0.7 + random() * 0.3), 1);
      card.position.set(
        Math.cos(angle) * (reach * 0.6 + leaf * 0.09),
        at + (leaf - 1) * 0.12,
        Math.sin(angle) * (reach * 0.6 + leaf * 0.09),
      );
      card.rotation.set(
        -0.5 + random() * 0.5,
        angle + (leaf - 1) * 0.9 + Math.PI / 2,
        (random() - 0.5) * 0.5,
      );
      group.add(card);
    }
  }

  const material = fruitMaterial(kind.colour);
  const fruits: THREE.Mesh[] = [];
  for (let index = 0; index < kind.load[1]; index += 1) {
    const tip = tips[index % tips.length];
    const cluster = Math.floor(index / tips.length);
    const geometry =
      kind.shape === "sphere"
        ? new THREE.SphereGeometry(kind.radius, 14, 10)
        : new THREE.SphereGeometry(kind.radius, 14, 10);
    const fruit = new THREE.Mesh(geometry, material);
    // Drupe : allongée sur son axe. Une sphère parfaite lit comme une bille.
    fruit.scale.set(1, kind.shape === "sphere" ? 1 : 1.24, kind.shape === "sphere" ? 1 : 0.96);
    const jitter = (random() - 0.5) * 0.06;
    fruit.position.set(
      tip.x * 0.92 + jitter,
      tip.y - 0.06 - cluster * 0.075 - random() * 0.03,
      tip.z * 0.92 - jitter,
    );
    fruit.castShadow = true;

    // Le rattachement : une tige de quelques millimètres. Sans elle, les
    // fruits flottent à côté du rameau.
    const stalk = new THREE.Mesh(
      new THREE.CylinderGeometry(0.0035, 0.0045, 0.055, 5, 1),
      materials.bark,
    );
    stalk.position.set(fruit.position.x, fruit.position.y + 0.045, fruit.position.z);
    group.add(stalk);
    group.add(fruit);
    fruits.push(fruit);
  }

  return { group, fruits };
}
