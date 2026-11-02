/**
 * Modèles d'animaux.
 *
 * Ils sont construits à partir de la morphologie décrite dans
 * `game/animals.ts` : même hauteur, même longueur, même épaisseur que la
 * boîte de collision. Ce qui compte ici, c'est la **silhouette** — un bongo se
 * reconnaît à ses rayures et à ses cornes en lyre, un éléphant à ses oreilles,
 * un céphalophe à son dos rond et à ses pattes fines.
 *
 * Tout est animé par articulation de groupes : hanche → genou → pied. Rien
 * n'est skinné, et pourtant la démarche suffit à faire lire l'animal : c'est
 * le mouvement qui vend le vivant, bien plus que le nombre de polygones.
 */

import * as THREE from "three";
import {
  ANIMAL_BUILDS,
  bodyCenterY,
  headCenterY,
  type Animal,
  type SpeciesBuild,
} from "@/game/animals";

export interface AnimalRig {
  speciesId: string;
  build: SpeciesBuild;
  group: THREE.Group;
  /** Corps : porte l'oscillation verticale de la marche. */
  root: THREE.Group;
  hips: THREE.Group[];
  knees: THREE.Group[];
  head: THREE.Group;
  tail: THREE.Object3D | null;
  wings: THREE.Object3D[];
  /** Parties masquées au-delà de la distance de détail. */
  details: THREE.Object3D[];
  materials: THREE.Material[];
  geometries: THREE.BufferGeometry[];
}

/** Cache des matériaux : une seule instance par espèce et par rôle. */
const materialCache = new Map<string, THREE.MeshStandardMaterial>();

/** L'œil est le seul matériau vraiment noir : il a sa propre clé de cache. */
function eyeMaterialFor(speciesId: string) {
  const key = `${speciesId}:oeil`;
  const cached = materialCache.get(key);
  if (cached) return cached;
  const material = new THREE.MeshStandardMaterial({
    color: 0x0a0a0a,
    roughness: 0.22,
    metalness: 0,
    envMapIntensity: 0.8,
  });
  materialCache.set(key, material);
  return material;
}

function coatMaterial(speciesId: string, role: "coat" | "belly" | "accent", color: number) {
  const key = `${speciesId}:${role}`;
  const cached = materialCache.get(key);
  if (cached) return cached;
  const roughness = role === "accent" ? 0.45 : 0.82;
  const material = new THREE.MeshStandardMaterial({
    color,
    roughness,
    metalness: role === "accent" ? 0.25 : 0,
    // Les robes sont mates : une fourrure tropicale n'a aucun reflet spéculaire
    // marqué, sauf mouillée.
    envMapIntensity: 0.35,
  });
  materialCache.set(key, material);
  return material;
}

export function disposeAnimalMaterials() {
  for (const material of materialCache.values()) material.dispose();
  materialCache.clear();
}

function capsule(radius: number, length: number, capSegments = 3, radial = 10) {
  return new THREE.CapsuleGeometry(radius, Math.max(0.02, length - radius * 2), capSegments, radial);
}

/** Barre orientée entre deux points (cou, corne, queue…). */
function limb(
  from: THREE.Vector3,
  to: THREE.Vector3,
  radiusFrom: number,
  radiusTo: number,
  material: THREE.Material,
  radial = 7,
): THREE.Mesh {
  const direction = new THREE.Vector3().subVectors(to, from);
  const length = direction.length();
  const geometry = new THREE.CylinderGeometry(radiusTo, radiusFrom, length, radial, 1);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.copy(from).addScaledVector(direction, 0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
  return mesh;
}

/**
 * Segment de patte : renvoie le groupe de hanche et expose le genou.
 * Les longueurs viennent de la morphologie, pas d'une constante : une patte
 * d'éléphant et une patte de céphalophe n'ont rien à voir.
 */
function legSegment(
  length: number,
  radiusTop: number,
  radiusBottom: number,
  material: THREE.Material,
): { group: THREE.Group; knee: THREE.Group; geometry: THREE.BufferGeometry[] } {
  const group = new THREE.Group();
  const upperLength = length * 0.55;
  const lowerLength = length * 0.45;

  const upperGeometry = new THREE.CylinderGeometry(radiusTop * 0.82, radiusTop, upperLength, 8, 1);
  upperGeometry.translate(0, -upperLength / 2, 0);
  const upper = new THREE.Mesh(upperGeometry, material);
  group.add(upper);

  const knee = new THREE.Group();
  knee.position.y = -upperLength;
  const lowerGeometry = new THREE.CylinderGeometry(radiusBottom, radiusTop * 0.8, lowerLength, 8, 1);
  lowerGeometry.translate(0, -lowerLength / 2, 0);
  const lower = new THREE.Mesh(lowerGeometry, material);
  knee.add(lower);

  // Sabot / pied : une petite sphère aplatie qui accroche la lumière.
  const foot = new THREE.Mesh(
    new THREE.SphereGeometry(radiusBottom * 1.25, 8, 6),
    material,
  );
  foot.scale.set(1, 0.55, 1.35);
  foot.position.y = -lowerLength;
  knee.add(foot);

  group.add(knee);
  return { group, knee, geometry: [upperGeometry, lowerGeometry] };
}

function tubeFromPoints(
  points: THREE.Vector3[],
  radius: number,
  material: THREE.Material,
  tubularSegments = 14,
): THREE.Mesh {
  const curve = new THREE.CatmullRomCurve3(points);
  const geometry = new THREE.TubeGeometry(curve, tubularSegments, radius, 6, false);
  return new THREE.Mesh(geometry, material);
}

/** Construit un animal complet. */
export function createAnimalRig(speciesId: string): AnimalRig | null {
  const build = ANIMAL_BUILDS[speciesId];
  if (!build) return null;

  const coat = coatMaterial(speciesId, "coat", build.coat);
  const belly = coatMaterial(speciesId, "belly", build.belly);
  const accent = coatMaterial(speciesId, "accent", build.accent);
  const eyeMaterial = eyeMaterialFor(speciesId);

  const group = new THREE.Group();
  const root = new THREE.Group();
  group.add(root);

  const geometries: THREE.BufferGeometry[] = [];
  const details: THREE.Object3D[] = [];
  const hips: THREE.Group[] = [];
  const knees: THREE.Group[] = [];
  const wings: THREE.Object3D[] = [];
  let head: THREE.Group = new THREE.Group();
  let tail: THREE.Object3D | null = null;

  const bodyY = bodyCenterY(build);

  if (build.kind === "oiseau") {
    const bodyGeometry = new THREE.SphereGeometry(1, 12, 9);
    const body = new THREE.Mesh(bodyGeometry, coat);
    body.scale.set(build.girth * 1.5, build.girth * 2.1, build.length * 1.15);
    body.position.y = build.shoulder;
    root.add(body);
    geometries.push(bodyGeometry);

    const headGeometry = new THREE.SphereGeometry(1, 10, 8);
    const skull = new THREE.Mesh(headGeometry, coat);
    skull.scale.setScalar(build.head * 0.55);
    skull.position.set(0, build.shoulder + build.shoulder * 0.62, build.length * 0.42);
    root.add(skull);
    geometries.push(headGeometry);

    const beakGeometry = new THREE.ConeGeometry(build.muzzle * 0.28, build.muzzle * 1.35, 7);
    const beak = new THREE.Mesh(beakGeometry, accent);
    beak.rotation.x = Math.PI / 2;
    beak.position.set(0, skull.position.y, skull.position.z + build.muzzle * 0.75);
    root.add(beak);
    geometries.push(beakGeometry);

    const tailGeometry = new THREE.ConeGeometry(build.tail * 0.3, build.tail * 1.8, 5);
    const tailMesh = new THREE.Mesh(tailGeometry, accent);
    tailMesh.rotation.x = -Math.PI / 2.35;
    tailMesh.position.set(0, build.shoulder + build.girth, -build.length * 1.1);
    root.add(tailMesh);
    geometries.push(tailGeometry);

    for (const side of [-1, 1]) {
      const wingGeometry = new THREE.PlaneGeometry(build.length * 2.1, build.length * 1.1);
      const wing = new THREE.Mesh(wingGeometry, coat);
      wing.material.side = THREE.DoubleSide;
      wing.position.set(side * build.length * 0.9, build.shoulder + build.girth * 0.6, 0);
      wing.rotation.y = side * 0.4;
      root.add(wing);
      geometries.push(wingGeometry);
      wings.push(wing);
    }

    for (const side of [-1, 1]) {
      const legGeometry = new THREE.CylinderGeometry(0.012, 0.014, build.shoulder, 5);
      legGeometry.translate(0, -build.shoulder / 2, 0);
      const leg = new THREE.Mesh(legGeometry, accent);
      leg.position.set(side * build.girth * 0.6, build.shoulder - build.girth, 0);
      root.add(leg);
      geometries.push(legGeometry);
    }

    return {
      speciesId,
      build,
      group,
      root,
      hips,
      knees,
      head: new THREE.Group(),
      tail: tailMesh,
      wings,
      details,
      materials: [coat, belly, accent, eyeMaterial],
      geometries,
    };
  }

  // --- tronc (quadrupèdes et primates)
  const bodyGeometry = capsule(build.girth, build.length, 4, 12);
  bodyGeometry.rotateX(Math.PI / 2);
  const body = new THREE.Mesh(bodyGeometry, coat);
  body.position.y = bodyY;
  root.add(body);
  geometries.push(bodyGeometry);

  // Poitrail et arrière-train : deux sphères qui cassent la forme « saucisse »
  // et donnent l'épaule et la cuisse.
  const chestGeometry = new THREE.SphereGeometry(build.girth * 1.02, 10, 8);
  const chest = new THREE.Mesh(chestGeometry, coat);
  chest.scale.set(1, 0.95, 1.15);
  chest.position.set(0, bodyY + build.girth * 0.08, build.length * 0.24);
  root.add(chest);
  geometries.push(chestGeometry);

  const rumpGeometry = new THREE.SphereGeometry(build.girth * 1.08, 10, 8);
  const rump = new THREE.Mesh(rumpGeometry, coat);
  rump.scale.set(1, 1, 1.05);
  rump.position.set(0, bodyY + build.girth * 0.12, -build.length * 0.26);
  root.add(rump);
  geometries.push(rumpGeometry);

  // --- tête et cou
  head = new THREE.Group();
  const headY = headCenterY(build);
  const headZ = build.length * 0.42 + build.neck * 0.5;
  head.position.set(0, headY, headZ);
  root.add(head);

  const skullLength = build.head * 1.25;
  const skullGeometry = new THREE.SphereGeometry(build.head * 0.5, 10, 8);
  const skull = new THREE.Mesh(skullGeometry, coat);
  skull.scale.set(0.92, 0.95, 1.15);
  skull.position.z = skullLength * 0.16;
  head.add(skull);
  geometries.push(skullGeometry);

  // Museau : plus ou moins allongé selon l'espèce. L'éléphant n'en a pas —
  // sa trompe remplace tout le museau, y compris en volume.
  if (build.muzzle > 0.02 && build.horn !== "defense") {
    const muzzleGeometry = capsule(build.head * 0.19, build.muzzle * 1.15, 3, 8);
    muzzleGeometry.rotateX(Math.PI / 2);
    const muzzle = new THREE.Mesh(muzzleGeometry, build.kind === "primate" ? accent : belly);
    muzzle.position.set(0, -build.head * 0.1, skullLength * 0.34 + build.muzzle * 0.36);
    head.add(muzzle);
    geometries.push(muzzleGeometry);
  }

  // Yeux : deux points sombres. À trois mètres, c'est ce qui fait basculer la
  // silhouette du côté du vivant.
  for (const side of [-1, 1]) {
    const eyeGeometry = new THREE.SphereGeometry(build.head * 0.085, 6, 5);
    const eye = new THREE.Mesh(eyeGeometry, eyeMaterial);
    eye.position.set(side * build.head * 0.24, build.head * 0.16, skullLength * 0.26);
    head.add(eye);
    geometries.push(eyeGeometry);
    details.push(eye);
  }

  // Oreilles
  if (build.ears > 0.01) {
    for (const side of [-1, 1]) {
      const earGeometry = new THREE.SphereGeometry(build.ears * 0.5, 8, 6);
      const ear = new THREE.Mesh(earGeometry, coat);
      ear.scale.set(0.16, 1, 0.75);
      ear.position.set(side * build.head * 0.42, build.head * 0.22, -build.head * 0.1);
      ear.rotation.z = side * 0.35;
      head.add(ear);
      geometries.push(earGeometry);
      if (build.ears < 0.15) details.push(ear);
    }
  }

  // Cornes
  if (build.horn === "lyre") {
    for (const side of [-1, 1]) {
      const horn = tubeFromPoints(
        [
          new THREE.Vector3(side * build.head * 0.18, build.head * 0.35, -build.head * 0.05),
          new THREE.Vector3(side * build.head * 0.34, build.head * 0.35 + build.hornLength * 0.45, -build.head * 0.22),
          new THREE.Vector3(side * build.head * 0.2, build.head * 0.35 + build.hornLength * 0.9, -build.head * 0.05),
          new THREE.Vector3(side * build.head * 0.07, build.head * 0.35 + build.hornLength, build.head * 0.18),
        ],
        Math.max(0.012, build.head * 0.055),
        accent,
      );
      head.add(horn);
      geometries.push(horn.geometry);
    }
  } else if (build.horn === "droite") {
    for (const side of [-1, 1]) {
      const hornGeometry = new THREE.ConeGeometry(build.head * 0.05, build.hornLength, 6);
      const horn = new THREE.Mesh(hornGeometry, accent);
      horn.position.set(side * build.head * 0.16, build.head * 0.42, -build.head * 0.1);
      horn.rotation.x = -0.35;
      head.add(horn);
      geometries.push(hornGeometry);
    }
  } else if (build.horn === "defense") {
    for (const side of [-1, 1]) {
      const tusk = tubeFromPoints(
        [
          new THREE.Vector3(side * build.head * 0.26, -build.head * 0.1, build.head * 0.3),
          new THREE.Vector3(side * build.head * 0.32, -build.head * 0.5, build.head * 0.9),
          new THREE.Vector3(side * build.head * 0.3, build.head * 0.1, build.head * 1.4),
        ],
        build.head * 0.09,
        belly,
      );
      head.add(tusk);
      geometries.push(tusk.geometry);
    }
    // Trompe : le trait le plus reconnaissable de l'éléphant. Elle descend
    // presque au sol, sinon l'animal a l'air d'un jouet.
    const trunkLength = build.muzzle * 2.2;
    const trunk = tubeFromPoints(
      [
        new THREE.Vector3(0, -build.head * 0.12, build.head * 0.3),
        new THREE.Vector3(0, -trunkLength * 0.3, build.head * 0.66),
        new THREE.Vector3(0, -trunkLength * 0.68, build.head * 0.78),
        new THREE.Vector3(0, -trunkLength * 0.95, build.head * 0.56),
      ],
      build.head * 0.16,
      coat,
      20,
    );
    head.add(trunk);
    geometries.push(trunk.geometry);
    details.push(trunk);
  }

  // Cou : relie le poitrail à la tête.
  const neckMesh = limb(
    new THREE.Vector3(0, bodyY + build.girth * 0.35, build.length * 0.28),
    new THREE.Vector3(0, headY - build.head * 0.18, headZ - build.head * 0.12),
    build.girth * 0.62,
    build.girth * 0.38,
    coat,
  );
  root.add(neckMesh);
  geometries.push(neckMesh.geometry);

  // --- pattes
  const legRadius = build.girth * (build.kind === "primate" ? 0.3 : 0.24);
  // La hanche est au-dessus du ventre : la patte doit donc mesurer la distance
  // hanche→sol, sinon l'animal flotte. (C'était le cas avec `build.leg` seul.)
  const hipY = bodyY - build.girth * 0.32;
  const legLength = hipY;
  for (let index = 0; index < 4; index++) {
    const front = index < 2;
    const side = index % 2 === 0 ? -1 : 1;
    const { group: hip, knee, geometry } = legSegment(
      legLength,
      legRadius * (front ? 1.05 : 1.2),
      legRadius * 0.62,
      coat,
    );
    // Chez les primates, les membres antérieurs sont des bras aussi longs que
    // les jambes : l'animal marche appuyé sur les poings.
    hip.position.set(
      side * build.girth * 0.52,
      hipY,
      front ? build.length * 0.3 : -build.length * 0.3,
    );
    root.add(hip);
    hips.push(hip);
    knees.push(knee);
    geometries.push(...geometry);
  }

  // --- queue
  if (build.tail > 0.05) {
    const tailGeometry = new THREE.CylinderGeometry(build.girth * 0.05, build.girth * 0.11, build.tail, 6);
    tailGeometry.translate(0, -build.tail / 2, 0);
    const tailMesh = new THREE.Mesh(tailGeometry, coat);
    tailMesh.position.set(0, bodyY + build.girth * 0.35, -build.length * 0.52);
    // Une queue de crocodile prolonge le corps, elle ne pend pas ; une queue
    // de félin se relève. Une queue de bongo pend, et c'est normal.
    tailMesh.rotation.x =
      build.pattern === "ecailles" ? -1.32 : build.kind === "quadrupede" && build.length < 1.2 ? -0.95 : -0.55;
    root.add(tailMesh);
    geometries.push(tailGeometry);
    tail = tailMesh;

    const tuftGeometry = new THREE.SphereGeometry(build.girth * 0.12, 6, 5);
    const tuft = new THREE.Mesh(tuftGeometry, accent);
    tuft.position.y = -build.tail;
    tailMesh.add(tuft);
    geometries.push(tuftGeometry);
    details.push(tuft);
  }

  // --- motifs de robe
  if (build.pattern === "rayures") {
    const stripeCount = 9;
    for (let i = 0; i < stripeCount; i++) {
      const stripeGeometry = new THREE.TorusGeometry(build.girth * 0.99, build.girth * 0.055, 4, 14, Math.PI * 1.05);
      const stripe = new THREE.Mesh(stripeGeometry, accent);
      stripe.rotation.y = Math.PI / 2;
      stripe.rotation.z = Math.PI * 0.48;
      stripe.position.set(0, bodyY, build.length * 0.3 - (i / stripeCount) * build.length * 0.62);
      root.add(stripe);
      geometries.push(stripeGeometry);
      details.push(stripe);
    }
  } else if (build.pattern === "taches") {
    const spotCount = 22;
    const spotGeometry = new THREE.CircleGeometry(build.girth * 0.16, 6);
    for (let i = 0; i < spotCount; i++) {
      const spot = new THREE.Mesh(spotGeometry, accent);
      const angle = (i / spotCount) * Math.PI * 2;
      const along = ((i * 0.618) % 1) * 2 - 1;
      spot.position.set(
        Math.cos(angle) * build.girth * 0.98,
        bodyY + Math.sin(angle) * build.girth * 0.98,
        along * build.length * 0.45,
      );
      // La pastille regarde vers l'extérieur du corps : sa normale suit le rayon.
      spot.lookAt(spot.position.x * 2, spot.position.y * 2, spot.position.z);
      root.add(spot);
      details.push(spot);
    }
    geometries.push(spotGeometry);
  }

  return {
    speciesId,
    build,
    group,
    root,
    hips,
    knees,
    head,
    tail,
    wings,
    details,
    materials: [coat, belly, accent, eyeMaterial],
    geometries,
  };
}

/**
 * Anime un animal.
 *
 * La démarche est une simple paire de sinus déphasés — mais avec un genou qui
 * se replie en phase de retour et un corps qui oscille à la fréquence double
 * du pas, l'œil lit immédiatement un animal qui marche.
 */
export function poseAnimal(rig: AnimalRig, animal: Animal, distance: number) {
  const { build, root, hips, knees, head, group } = rig;

  group.position.set(animal.x, animal.groundY, animal.z);
  group.rotation.y = animal.heading;
  group.scale.setScalar(animal.scale);

  const detailVisible = distance < 32;
  for (const detail of rig.details) detail.visible = detailVisible;

  if (animal.state === "mort") {
    // Chute sur le flanc, puis immobilité.
    const fall = Math.min(1, animal.deadTimer * 2.6);
    const ease = 1 - (1 - fall) * (1 - fall);
    root.rotation.z = -ease * Math.PI * 0.48;
    root.position.y = -ease * build.girth * 0.55;
    for (const hip of hips) hip.rotation.x *= 0.9;
    for (const knee of knees) knee.rotation.x *= 0.9;
    return;
  }

  // Longueur de patte effective : hanche → sol.
  const legLength = Math.max(0.12, bodyCenterY(build) - build.girth * 0.32);
  const speedFactor = Math.min(2.4, animal.speed / Math.max(0.6, legLength * 3.2));
  const stride = 0.55 + speedFactor * 0.55;
  root.position.y = Math.abs(Math.sin(animal.gait * 2)) * 0.04 * legLength * (0.4 + speedFactor);
  root.rotation.x = 0;
  root.rotation.z = 0;

  // Quadrupèdes : galop à quatre temps. Les pattes postérieures démarrent avec
  // un léger retard sur les antérieures, ce qui évite le côté « robot ».
  const offsets = [0, 0.35, Math.PI, Math.PI + 0.35];
  hips.forEach((hip, index) => {
    const phase = animal.gait + offsets[index % offsets.length];
    // Les antérieurs ont une moindre amplitude : ils ne portent que le poids.
    const amplitude = (index < 2 ? 0.42 : 0.55) * stride;
    hip.rotation.x = Math.sin(phase) * amplitude;

    const knee = knees[index];
    // Le genou se replie seulement quand la patte remonte (sin > 0).
    knee.rotation.x = Math.max(0, Math.sin(phase + Math.PI * 0.45)) * 0.75 * stride;
  });

  // Tête : elle se tourne vers ce qui inquiète, et broute quand tout va bien.
  const alert = animal.alert;
  head.rotation.y = Math.sin(animal.gait * 0.25) * 0.06 + alert * 0.25 * Math.sin(animal.gait * 0.4);
  head.rotation.x =
    animal.state === "pature" ? 0.55 + Math.sin(animal.gait * 1.7) * 0.08 : alert * -0.12;

  if (rig.tail) {
    const rest = build.pattern === "ecailles" ? -1.32 : -0.55;
    rig.tail.rotation.x = rest + Math.sin(animal.gait * 0.9) * 0.18 * (1 - alert);
    rig.tail.rotation.z = Math.sin(animal.gait * 0.7) * 0.2;
  }

  for (const wing of rig.wings) {
    const flap = animal.speed > 1.5 ? Math.sin(animal.gait * 5) * 0.5 : Math.sin(animal.gait * 0.6) * 0.05;
    wing.rotation.z = flap;
  }
}

/** Libère les géométries propres à un individu. */
export function disposeAnimalRig(rig: AnimalRig) {
  for (const geometry of rig.geometries) geometry.dispose();
  rig.group.removeFromParent();
}
