/**
 * Pose du personnage glTF.
 *
 * Le corps du jeu n'est plus un assemblage de volumes : c'est un maillage
 * humain complet — peau, visage, mains à cinq doigts — livré avec son
 * squelette. Ce module ne contient donc **que** les rotations à appliquer aux
 * os, en fonction de l'allure. Il est pur : ni three, ni DOM. Le jeu l'applique
 * aux os du modèle, les outils d'aperçu l'appliquent au fichier glTF lui-même,
 * ce qui permet de vérifier une démarche sans navigateur.
 *
 * Conventions : le personnage regarde vers -Z, les pieds à y = 0. Les valeurs
 * sont des écarts par rapport à la pose de repos du modèle (qui est en T), pas
 * des orientations absolues : chaque os garde son orientation d'origine, on la
 * multiplie par la rotation calculée ici.
 *
 * Les os du squelette sont orientés le long de leur axe local +Y ; une
 * rotation autour de X fait donc basculer un membre vers l'avant ou vers
 * l'arrière, autour de Y le fait pivoter, autour de Z l'écarte du corps.
 */

export type AvatarMotion = "idle" | "walk" | "run" | "sneak" | "swim";

export interface AvatarPoseInput {
  motion: AvatarMotion;
  /** Vitesse au sol, m/s. */
  speed: number;
  /** Position dans le cycle de marche, en radians. */
  phase: number;
  /** Secondes écoulées, pour la respiration et les micro-mouvements. */
  time: number;
  /** 0 = arme basse, 1 = en joue. */
  aim: number;
  aimYaw: number;
  aimPitch: number;
  /** Recul de l'arme, -1 à 1. */
  recoil: number;
}

export type BoneRotations = Record<string, [number, number, number]>;

export interface AvatarPoseResult {
  /** Rotation de chaque os, en écart par rapport au repos. */
  rotations: BoneRotations;
  /** Abaissement du bassin, en mètres (accroupi, marche). */
  hipsDrop: number;
}

/**
 * Angle qui ramène un bras de la pose en A le long du corps. Le squelette de
 * repos a déjà les bras à 60° sous l'horizontale : il ne reste qu'à les
 * rapprocher du buste. La valeur est la même à gauche et à droite : les deux
 * moitiés du squelette sont en miroir, donc un même angle local donne deux
 * mouvements symétriques.
 */
const ARM_DOWN = 0.42;

/**
 * Rotations des os pour une allure donnée.
 *
 * Les os sont nommés comme dans le squelette Mixamo/Ready Player Me, devenu un
 * standard de fait : Hips, Spine, Spine1, Spine2, Neck, Head, LeftUpLeg,
 * LeftLeg, LeftFoot, LeftArm, LeftForeArm, LeftHand…
 */
export function avatarPose(input: AvatarPoseInput): AvatarPoseResult {
  const { motion, speed, phase, time, aim, aimYaw, aimPitch, recoil } = input;

  const amp = motion === "run" ? 0.66 : motion === "sneak" ? 0.24 : motion === "swim" ? 0.2 : 0.38;
  const lean = motion === "run" ? 0.18 : motion === "sneak" ? 0.34 : motion === "walk" ? 0.06 : 0.02;

  // Accroupissement : la cuisse part vers l'avant, le genou se plie, et le
  // bassin descend exactement de ce que la jambe pliée fait perdre — sinon le
  // personnage flotte au-dessus du sol ou le traverse.
  const crouch = motion === "sneak" ? 0.8 : motion === "swim" ? 0.4 : 0;
  const squatThigh = 0.9 * crouch;
  const squatKnee = 1.8 * crouch;
  const SQUAT_DROP = 0.9; // longueur cuisse + jambe, en mètres
  const swing = Math.sin(phase);
  const breath = Math.sin(time * 1.3);

  // Jambes. Le modèle de repos a les pieds joints ; un pas écarte les cuisses
  // de quelques degrés et plie le genou opposé.
  const thighLeft = swing * amp;
  const thighRight = -swing * amp;
  const kneeLeft = Math.max(0, Math.sin(phase + 0.9)) * amp * 1.9;
  const kneeRight = Math.max(0, Math.sin(phase + Math.PI + 0.9)) * amp * 1.9;

  // Le bassin descend quand le genou porte : c'est ce qui distingue une marche
  // d'un glissement.
  const bob = motion === "walk" || motion === "run" ? Math.abs(Math.cos(phase)) * 0.02 : 0;
  const squatDrop = SQUAT_DROP * (1 - Math.cos(squatThigh));

  // Une rotation positive autour de X bascule le buste vers l'arrière : le
  // penché volontaire se fait donc en négatif.
  const rotations: BoneRotations = {
    Hips: [-lean * 0.3 - squatThigh * 0.25, Math.sin(phase) * 0.05, Math.sin(phase) * 0.025],
    Spine: [-lean * 0.35 + breath * 0.006, -Math.sin(phase) * 0.07, 0],
    Spine1: [-lean * 0.3 + breath * 0.008, -Math.sin(phase) * 0.05, 0],
    Spine2: [-lean * 0.25 - recoil * 0.05 + squatThigh * 0.2, aimYaw * 0.3, 0],
    Neck: [lean * 0.55 + aimPitch * 0.3, aimYaw * 0.25, 0],
    Head: [lean * 0.7 + aimPitch * 0.45 + Math.sin(time * 0.5) * 0.012, aimYaw * 0.35, 0],

    // Cuisse positive = jambe vers l'arrière ; genou positif = talon au fessier.
    LeftUpLeg: [thighLeft - squatThigh, 0, 0.03],
    RightUpLeg: [thighRight - squatThigh, 0, -0.03],
    LeftLeg: [kneeLeft + squatKnee, 0, 0],
    RightLeg: [kneeRight + squatKnee, 0, 0],
    // Le pied reste à plat quand le tibia s'incline vers l'arrière.
    LeftFoot: [-kneeLeft * 0.55 - (squatKnee - squatThigh), 0, 0],
    RightFoot: [-kneeRight * 0.55 - (squatKnee - squatThigh), 0, 0],
  };

  // Bras. En position de repos ils pendent le long du corps (le modèle est en
  // T, d'où l'angle mort de 72°) ; en joue, ils se lèvent et l'IK du jeu prend
  // le relais pour amener les mains sur la prise.
  // L'axe X des bras sert de charnière d'abduction, l'axe Z de va-et-vient.
  const armDown = ARM_DOWN * (1 - aim * 0.75) + aim * 0.12;
  const swingArm = swing * amp * (0.55 - aim * 0.45);
  rotations.LeftArm = [armDown, 0, swingArm];
  rotations.RightArm = [armDown, 0, -swingArm];
  rotations.LeftForeArm = [0, 0, -0.12 - Math.max(0, -swing) * amp * 0.45 - aim * 0.2];
  rotations.RightForeArm = [0, 0, -0.12 - Math.max(0, swing) * amp * 0.35 - aim * 0.2];

  // Quand on vise, un léger déhanchement accompagne la vitesse de déplacement.
  if (aim > 0.01) {
    const sway = Math.min(0.4, speed * 0.03) * aim;
    rotations.Hips = [rotations.Hips[0], rotations.Hips[1] + sway, rotations.Hips[2]];
  }

  // Doigts. Une main ne reste jamais ouverte : au repos les doigts se
  // replient à peine, quand elle tient une poignée ils se referment. Sans
  // cela, les mains du modèle restent en éventail et trahissent le mannequin.
  const grip = (prefix: string, curl: number) => {
    (["Index", "Middle", "Ring", "Pinky"] as const).forEach((finger) => {
      rotations[`${prefix}${finger}1`] = [curl, 0, 0];
      rotations[`${prefix}${finger}2`] = [curl * 1.1, 0, 0];
      rotations[`${prefix}${finger}3`] = [curl * 0.85, 0, 0];
    });
    rotations[`${prefix}Thumb1`] = [curl * 0.35, 0, -curl * 0.55];
    rotations[`${prefix}Thumb2`] = [curl * 0.45, 0, -curl * 0.5];
    rotations[`${prefix}Thumb3`] = [curl * 0.35, 0, 0];
  };
  grip("RightHand", 0.62 + aim * 0.2);
  grip("LeftHand", 0.2 + aim * 0.72);

  return { rotations, hipsDrop: bob + squatDrop };
}
