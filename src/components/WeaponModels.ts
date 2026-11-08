/**
 * Les armes, seules — sans bras.
 *
 * Elles servent à deux endroits : la vue subjective (WeaponView), où deux
 * avant-bras les tiennent devant la caméra, et le personnage en pied
 * (HumanModel), où c'est le squelette du corps qui les tient. Une arme ne doit
 * donc pas embarquer ses propres mains.
 *
 * Chaque modèle expose ses points de prise, en coordonnées locales :
 *
 *   · `grip`  — la main droite, sur la poignée ;
 *   · `fore`  — la main gauche, sur le garde-main (null pour une arme à une
 *               main) ;
 *   · `muzzle` — la bouche du canon, pour l'éclair et le point d'émission.
 *
 * Le canon pointe vers -Z, comme la caméra : une arme posée droite regarde
 * devant elle.
 */

import * as THREE from "three";
import { type WeaponId } from "@/game/hunting";

export interface WeaponModel {
  id: WeaponId;
  group: THREE.Group;
  /** Bouche du canon, en coordonnées locales. */
  muzzle: THREE.Vector3;
  /** Main droite. */
  grip: THREE.Vector3;
  /** Main gauche, quand l'arme se tient à deux mains. */
  fore: THREE.Vector3 | null;
  materials: THREE.Material[];
  geometries: THREE.BufferGeometry[];
}

export function steelMaterial(dark = 0x2a2c2e): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: dark,
    roughness: 0.36,
    metalness: 0.92,
    envMapIntensity: 0.9,
  });
}

function polymerMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: 0x1a1c1b,
    roughness: 0.72,
    metalness: 0.12,
  });
}

function woodMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: 0x5a3a20,
    roughness: 0.78,
    metalness: 0.02,
  });
}

/**
 * Une lame n'est pas une feuille de saule.
 *
 * Le profil précédent était symétrique — deux courbes en miroir, larges au
 * milieu, pointues aux deux bouts. Vue de profil, il donnait exactement une
 * feuille : aucune arête de dos, aucun tranchant, aucune pointe. Une lame a
 * trois lignes et elles ne se ressemblent pas :
 *
 *   · le **dos**, droit ou à peine convexe, qui porte toute la rigidité ;
 *   · le **tranchant**, qui part du ricasso et se relève vers la pointe ;
 *   · la **pointe**, dans l'axe, qui est le point de percement.
 *
 * On construit donc le contour par points, dans un repère où Z va vers la
 * pointe. Le dos est à +Y, le tranchant à −Y, l'épaisseur en X.
 */
function blade(
  length: number,
  width: number,
  thickness: number,
  material: THREE.Material,
  options: {
    /** Hauteur du dos à la garde, en fraction de la largeur. */
    spineRise?: number;
    /** Épaule : largeur maximale, en fraction de la longueur. */
    shoulder?: number;
    /** Courbure du dos : 0 = droit (machette), > 0 = ventru (coupe-coupe). */
    belly?: number;
    /** Le dos reste-t-il haut jusqu'aux trois quarts ? (machette) */
    squareSpine?: boolean;
  } = {},
): THREE.Mesh {
  const { spineRise = 0.55, shoulder = 0.78, belly = 0, squareSpine = false } = options;
  const half = width / 2;

  const shape = new THREE.Shape();
  // Un couteau s'affine sur toute sa longueur ; une machette garde sa hauteur
  // de dos jusqu'aux trois quarts et ne perd tout qu'à la pointe. Sans cette
  // distinction, la machette avait la ligne d'un couteau de cuisine.
  const taper = (t: number) =>
    squareSpine ? Math.max(0, 1 - Math.pow(Math.max(0, t - 0.55) / 0.45, 1.5)) : Math.max(0, 1 - Math.pow(t, 2.4));

  // Dos : de la garde vers la pointe, droit ou ventru, puis il pique vers
  // l'axe sur le dernier cinquième — c'est là que se forme la pointe.
  shape.moveTo(0, half * spineRise);
  const spinePoints = 10;
  for (let i = 1; i <= spinePoints; i += 1) {
    const t = i / spinePoints;
    const z = -length * t;
    const bellyArc = Math.sin(Math.PI * Math.pow(t, 0.85)) * belly * half;
    shape.lineTo(z, half * spineRise * taper(t) + bellyArc * taper(t));
  }

  // Pointe : courte, dans l'axe. Une pointe arrondie sur douze centimètres
  // fait un couteau à beurre ; ici elle se referme sur 3 % de la longueur.
  const tip = -length;
  shape.lineTo(tip, 0);

  // Tranchant : du voisinage de la pointe vers le ricasso. Il part de l'axe,
  // bombe au premier tiers, puis rejoint la garde — c'est cette courbe qui
  // distingue une lame d'un losange.
  //
  // Le sens de la montée compte : la largeur est **nulle à la pointe** et
  // **pleine à la garde**. La première version la faisait croître avec t, donc
  // avec la distance à la garde : la lame s'arrêtait net sur une arête
  // verticale, à la place de la pointe.
  const edgePoints = 12;
  for (let i = edgePoints - 1; i >= 0; i -= 1) {
    const t = i / edgePoints;
    const z = -length * t;
    const rise = 0.04 + 0.96 * Math.pow(Math.min(1, (1 - t) / shoulder), 0.62);
    shape.lineTo(z, -half * rise);
  }
  shape.lineTo(0, half * spineRise);

  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: thickness,
    bevelEnabled: true,
    // Le biseau donne son arête au tranchant ; sans lui la lame est une plaque
    // d'épaisseur constante. Mais il **arrondit aussi la pointe** : réglé à
    // 1,6 fois l'épaisseur, il la tronquait sur six millimètres — un couteau à
    // beurre. À 0,45 fois, il tient l'arête et laisse la pointe percer.
    bevelSize: Math.min(thickness * 0.45, width * 0.06),
    bevelThickness: thickness * 0.45,
    bevelSegments: 2,
    curveSegments: 10,
  });
  // Repère : le contour est dessiné dans le plan XY (x = longueur, négative ;
  // y = largeur) et extrudé sur Z (épaisseur). Il faut donc amener x → −Z et
  // z → X. `rotateY(−π/2)` fait exactement cela : (x, y, z) → (−z, y, x).
  //
  // La rotation précédente était `rotateX(π/2)`, qui envoyait la **largeur**
  // sur Z et l'**épaisseur** sur Y : la lame se retrouvait couchée en travers
  // de son manche, et l'on voyait une aiguille plantée dans une garde.
  geometry.rotateY(-Math.PI / 2);
  geometry.translate(thickness / 2, 0, 0);
  geometry.computeVertexNormals();
  return new THREE.Mesh(geometry, material);
}

function pistol(): { group: THREE.Group; materials: THREE.Material[] } {
  const group = new THREE.Group();
  const steel = steelMaterial();
  const polymer = polymerMaterial();

  const slide = new THREE.Mesh(new THREE.BoxGeometry(0.032, 0.036, 0.19), steel);
  slide.position.set(0, 0.03, -0.06);
  group.add(slide);

  const frame = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.028, 0.14), polymer);
  frame.position.set(0, 0.002, -0.03);
  group.add(frame);

  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.0075, 0.0075, 0.05, 8), steel);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 0.028, -0.155);
  group.add(barrel);

  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.028, 0.105, 0.045), polymer);
  grip.position.set(0, -0.045, 0.03);
  grip.rotation.x = -0.24;
  group.add(grip);

  const mag = new THREE.Mesh(new THREE.BoxGeometry(0.024, 0.012, 0.04), steel);
  mag.position.set(0, -0.098, 0.043);
  mag.rotation.x = -0.24;
  group.add(mag);

  const guard = new THREE.Mesh(new THREE.TorusGeometry(0.022, 0.004, 5, 10, Math.PI), steel);
  guard.rotation.y = Math.PI / 2;
  guard.rotation.x = Math.PI;
  guard.position.set(0, -0.02, -0.03);
  group.add(guard);

  const frontSight = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.008, 0.007), polymer);
  frontSight.position.set(0, 0.052, -0.145);
  group.add(frontSight);
  const rearSight = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.006, 0.006), polymer);
  rearSight.position.set(0, 0.052, 0.026);
  group.add(rearSight);

  return { group, materials: [steel, polymer] };
}

function m16(): { group: THREE.Group; materials: THREE.Material[] } {
  const group = new THREE.Group();
  const steel = steelMaterial(0x24262a);
  const polymer = polymerMaterial();

  const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.055, 0.24), steel);
  receiver.position.set(0, 0.01, -0.06);
  group.add(receiver);

  const handle = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.018, 0.16), polymer);
  handle.position.set(0, 0.046, -0.05);
  group.add(handle);

  const guard = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.2, 8), polymer);
  guard.rotation.x = Math.PI / 2;
  guard.position.set(0, 0.005, -0.28);
  group.add(guard);

  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.3, 8), steel);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 0.012, -0.5);
  group.add(barrel);

  const flashHider = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.012, 0.05, 8), steel);
  flashHider.rotation.x = Math.PI / 2;
  flashHider.position.set(0, 0.012, -0.66);
  group.add(flashHider);

  const frontSight = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.05, 0.012), steel);
  frontSight.position.set(0, 0.042, -0.36);
  group.add(frontSight);

  const stock = new THREE.Mesh(new THREE.BoxGeometry(0.036, 0.065, 0.22), polymer);
  stock.position.set(0, 0.008, 0.17);
  stock.rotation.x = -0.05;
  group.add(stock);

  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.09, 0.042), polymer);
  grip.position.set(0, -0.05, 0.03);
  grip.rotation.x = -0.38;
  group.add(grip);

  const mag = new THREE.Mesh(new THREE.BoxGeometry(0.026, 0.13, 0.05), steel);
  mag.position.set(0, -0.085, -0.09);
  mag.rotation.x = 0.16;
  group.add(mag);

  return { group, materials: [steel, polymer] };
}

/**
 * Couteau de camp et machette.
 *
 * Les proportions venaient d'un tube en bois prolongé par une aiguille. Un
 * couteau de camp tient dans une main : manche de **11 cm**, lame de **16 cm**
 * pour 3,8 de large, garde courte et pommeau large pour que la main bute en
 * frappant. Une machette ne se tient pas de la même façon : manche de 15 cm,
 * lame de 43 cm, **dos de 4 mm** mais une largeur qui va chercher 7,5 cm —
 * c'est sa masse en bout qui coupe, pas son tranchant seul.
 */
function edged(machete: boolean): { group: THREE.Group; materials: THREE.Material[] } {
  const group = new THREE.Group();

  // Le bois de poignée : veiné, mat, jamais noir. Un manche noir sous un
  // éclairage de forêt devient une silhouette pleine.
  const wood = new THREE.MeshStandardMaterial({
    color: machete ? 0x6b4526 : 0x4a2f1c,
    roughness: 0.68,
    metalness: 0.02,
  });
  // L'acier : clair, très métallique, et surtout **usé** — la patine par sommet
  // n'existe pas sur les armes, on la simule donc par deux teintes : l'acier
  // du corps et celui, plus sombre, du plat de lame.
  const steel = new THREE.MeshStandardMaterial({
    color: 0xb9c0c4,
    roughness: 0.3,
    metalness: 0.88,
    envMapIntensity: 1.15,
  });
  const dull = new THREE.MeshStandardMaterial({
    color: 0x6e767a,
    roughness: 0.52,
    metalness: 0.7,
  });
  const brass = new THREE.MeshStandardMaterial({
    color: 0x8a6a34,
    roughness: 0.42,
    metalness: 0.85,
  });

  const handleLength = machete ? 0.15 : 0.11;
  const handleRadius = machete ? 0.0165 : 0.0145;

  // Manche : fuselé, plus large au pommeau qu'à la garde. Un manche cylindrique
  // glisse dans une main qui frappe ; un manche qui s'évase tient tout seul.
  const handle = new THREE.Mesh(
    new THREE.CylinderGeometry(handleRadius * 0.92, handleRadius * 1.18, handleLength, 10),
    wood,
  );
  handle.rotation.x = Math.PI / 2;
  handle.position.set(0, -0.018, handleLength / 2);
  group.add(handle);

  // Trois rainures d'adhérence. Fines : un tore de 2,2 mm de rayon sur un
  // manche de 14 faisait des perles enfilées. À 1,1 mm, c'est une rayure.
  for (let i = 0; i < 3; i += 1) {
    const groove = new THREE.Mesh(
      new THREE.TorusGeometry(handleRadius * 1.0, 0.0011, 4, 14),
      new THREE.MeshStandardMaterial({ color: 0x2e1c10, roughness: 0.88, metalness: 0.04 }),
    );
    groove.position.set(0, -0.018, 0.03 + i * (handleLength * 0.26));
    group.add(groove);
  }

  // Pommeau : plus large que le manche, il empêche la main de glisser.
  const pommel = new THREE.Mesh(
    new THREE.CylinderGeometry(handleRadius * 1.35, handleRadius * 1.1, 0.014, 10),
    brass,
  );
  pommel.rotation.x = Math.PI / 2;
  pommel.position.set(0, -0.018, handleLength + 0.004);
  group.add(pommel);

  // Garde : une platine qui affleure la largeur de la lame, pas une barre
  // transversale. Réglée plus large que la lame, elle dépassait sous le
  // ricasso et se lisait comme une cale grise collée au manche.
  // Après la rotation de la lame, l'**épaisseur** est sur X et la **largeur**
  // sur Y. Une garde taillée en largeur sur X se lisait comme une cale grise
  // dix fois plus épaisse que la lame.
  const bladeWidth = machete ? 0.075 : 0.038;
  const guard = new THREE.Mesh(new THREE.BoxGeometry(0.0085, bladeWidth * 0.9, 0.01), dull);
  guard.position.set(0, -0.018 + (machete ? 0.006 : 0.003), -0.008);
  group.add(guard);

  const bladeMesh = blade(
    machete ? 0.43 : 0.16,
    machete ? 0.075 : 0.038,
    machete ? 0.0042 : 0.0036,
    steel,
    machete
      ? { spineRise: 0.72, shoulder: 0.9, belly: 0.06, squareSpine: true }
      : { spineRise: 0.5, shoulder: 0.72, belly: 0.05 },
  );
  bladeMesh.position.set(0, -0.018, -0.012);
  group.add(bladeMesh);

  return { group, materials: [wood, steel, dull, brass] };
}

/**
 * Lance de chasse.
 *
 * Deux mètres et sept de long, comme un vrai épieu de chasse : la hampe fait
 * 1,95 m, la pointe 26 cm. La hampe s'affine vers l'avant, le liage est en
 * cuir, et une **vire** — un anneau de métal — empêche le bois de se fendre à
 * l'impact. C'était ce qui manquait : une tige et un cône.
 */
function spear(): { group: THREE.Group; materials: THREE.Material[] } {
  const group = new THREE.Group();

  const wood = new THREE.MeshStandardMaterial({
    color: 0x7a5433,
    roughness: 0.72,
    metalness: 0.02,
  });
  const steel = new THREE.MeshStandardMaterial({
    color: 0x9aa4a8,
    roughness: 0.34,
    metalness: 0.86,
    envMapIntensity: 1.1,
  });
  const leather = new THREE.MeshStandardMaterial({ color: 0x3a2717, roughness: 0.82, metalness: 0.04 });
  const iron = new THREE.MeshStandardMaterial({ color: 0x4a4f52, roughness: 0.5, metalness: 0.8 });

  // Hampe : 1,70 m, dont 35 cm **derrière** la main. Une lance de deux mètres
  // dont le bois part du point de prise vers l'arrière traversait la caméra en
  // vue subjective ; la queue doit rester courte.
  const shaftLength = 1.7;
  const rear = 0.35;
  const shaftFront = -shaftLength + rear;
  const shaft = new THREE.Mesh(
    new THREE.CylinderGeometry(0.0125, 0.0155, shaftLength, 10),
    wood,
  );
  shaft.rotation.x = Math.PI / 2;
  shaft.position.set(0, -0.01, rear - shaftLength / 2);
  group.add(shaft);

  // Pointe : une lame d'estoc à deux tranchants, pas un cône. Un cône ne
  // perce pas, il rebondit — et visuellement il fait « jouet ».
  const head = blade(0.24, 0.05, 0.005, steel, { spineRise: 0.5, shoulder: 0.55, belly: 0 });
  head.position.set(0, -0.01, shaftFront - 0.004);
  group.add(head);

  // Douille : le métal qui enveloppe le bois sur 12 cm.
  const socket = new THREE.Mesh(new THREE.CylinderGeometry(0.0165, 0.0145, 0.12, 10), steel);
  socket.rotation.x = Math.PI / 2;
  socket.position.set(0, -0.01, shaftFront + 0.06);
  group.add(socket);

  // Liage de cuir : sur la douille, et au point de prise.
  for (const [z, length] of [
    [shaftFront + 0.1, 0.07],
    [-0.34, 0.09],
  ] as const) {
    const wrap = new THREE.Mesh(new THREE.CylinderGeometry(0.0165, 0.0165, length, 10), leather);
    wrap.rotation.x = Math.PI / 2;
    wrap.position.set(0, -0.01, z);
    group.add(wrap);
  }

  // Vire : l'anneau de fer qui empêche le bois d'éclater à l'impact.
  const collar = new THREE.Mesh(new THREE.TorusGeometry(0.017, 0.0035, 5, 12), iron);
  collar.position.set(0, -0.01, shaftFront + 0.14);
  group.add(collar);

  // Talon : un embout de fer à l'autre bout, pour la marche et pour frapper.
  const butt = new THREE.Mesh(new THREE.ConeGeometry(0.0165, 0.05, 10), iron);
  butt.rotation.x = -Math.PI / 2;
  butt.position.set(0, -0.01, rear + 0.025);
  group.add(butt);

  return { group, materials: [wood, steel, leather, iron] };
}

/** Fusil à pompe : canon long, tube sous le canon, bois clair. */
function shotgun(): { group: THREE.Group; materials: THREE.Material[] } {
  const group = new THREE.Group();
  const steel = steelMaterial();
  const wood = woodMaterial();

  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.017, 0.62, 12), steel);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 0.022, -0.46);
  group.add(barrel);

  const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.46, 12), steel);
  tube.rotation.x = Math.PI / 2;
  tube.position.set(0, -0.014, -0.36);
  group.add(tube);

  // Pompe : c'est la forme qui distingue un fusil à pompe d'une carabine.
  const pump = new THREE.Mesh(new THREE.BoxGeometry(0.048, 0.044, 0.16), wood);
  pump.position.set(0, -0.016, -0.3);
  group.add(pump);

  const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.062, 0.19), steel);
  receiver.position.set(0, 0.006, -0.06);
  group.add(receiver);

  const stock = new THREE.Mesh(new THREE.BoxGeometry(0.038, 0.072, 0.26), wood);
  stock.position.set(0, -0.012, 0.14);
  stock.rotation.x = -0.06;
  group.add(stock);

  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.032, 0.075, 0.04), wood);
  grip.position.set(0, -0.05, 0.03);
  grip.rotation.x = -0.32;
  group.add(grip);

  const bead = new THREE.Mesh(new THREE.SphereGeometry(0.006, 8, 6), steel);
  bead.position.set(0, 0.045, -0.72);
  group.add(bead);

  return { group, materials: [steel, wood] };
}

const BUILDERS: Record<WeaponId, () => { group: THREE.Group; materials: THREE.Material[] }> = {
  pistolet: pistol,
  fusil: shotgun,
  m16,
  couteau: () => edged(false),
  machette: () => edged(true),
  lance: spear,
};

const GRIPS: Record<WeaponId, { muzzle: THREE.Vector3Tuple; grip: THREE.Vector3Tuple; fore: THREE.Vector3Tuple | null }> = {
  pistolet: {
    muzzle: [0, 0.028, -0.18],
    grip: [0, -0.045, 0.03],
    fore: [-0.03, -0.052, 0.015],
  },
  fusil: {
    muzzle: [0, 0.022, -0.77],
    grip: [0, -0.05, 0.03],
    fore: [0, -0.016, -0.3],
  },
  m16: {
    muzzle: [0, 0.012, -0.66],
    grip: [0, -0.05, 0.03],
    fore: [0, 0.0, -0.26],
  },
  // Les points de prise suivent la géométrie réelle, et ils sont **mesurés**
  // sur la boîte englobante de chaque arme (voir `scripts/preview-blades.mjs`) :
  // une bouche de canon à 58 cm sur une machette de 43 cm faisait partir
  // l'éclair au-delà de la pointe, et les mains se posaient à côté du manche.
  //
  // La pointe dépasse la longueur demandée à `blade()` : le biseau ajoute son
  // épaisseur en bout. D'où −0,174 et non −0,172, et −1,597 pour la lance.
  couteau: {
    muzzle: [0, -0.018, -0.174],
    grip: [0, -0.018, 0.03],
    fore: null,
  },
  machette: {
    muzzle: [0, -0.018, -0.445],
    grip: [0, -0.018, 0.03],
    fore: null,
  },
  lance: {
    muzzle: [0, -0.01, -1.597],
    grip: [0, -0.01, 0.0],
    fore: [0, -0.01, -0.4],
  },
};

/**
 * Construit une arme détachée de toute main.
 *
 * Les matériaux et géométries sont rendus à l'appelant : une arme de la vue
 * subjective et l'arme du personnage sont deux objets distincts, mais elles
 * se libèrent de la même façon.
 */
export function createWeaponModel(id: WeaponId): WeaponModel {
  const { group, materials } = BUILDERS[id]();
  const grip = GRIPS[id];

  const geometries: THREE.BufferGeometry[] = [];
  group.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      geometries.push(child.geometry);
      child.castShadow = false;
      child.receiveShadow = false;
    }
  });

  return {
    id,
    group,
    muzzle: new THREE.Vector3(...grip.muzzle),
    grip: new THREE.Vector3(...grip.grip),
    fore: grip.fore ? new THREE.Vector3(...grip.fore) : null,
    materials,
    geometries,
  };
}

export function disposeWeaponModel(model: WeaponModel): void {
  for (const geometry of model.geometries) geometry.dispose();
  for (const material of model.materials) material.dispose();
  model.group.removeFromParent();
}
