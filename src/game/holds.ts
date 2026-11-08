/**
 * Points de prise des armes.
 *
 * Module pur : ni three, ni DOM. Il est partagé par le corps procédural, par le
 * maillage importé et par les outils d'aperçu — une seule table de prises, donc
 * une seule vérité sur l'endroit où les mains se posent.
 */
import { type WeaponId } from "./hunting";

export interface Hold {
  grip: [number, number, number];
  fore: [number, number, number] | null;
  aim: { position: [number, number, number]; yaw: number; roll?: number };
  carry: { position: [number, number, number]; rotation: [number, number, number] };
}

export const HUMAN_HOLD: Record<WeaponId, Hold> = {
  pistolet: {
    grip: [0, -0.045, 0.03],
    fore: [-0.035, -0.05, 0.012],
    aim: { position: [0.055, 1.335, -0.44], yaw: 0 },
    carry: { position: [0.235, 1.0, 0.02], rotation: [-1.44, 0.16, 0.08] },
  },
  fusil: {
    grip: [0, -0.05, 0.03],
    fore: [0, -0.016, -0.3],
    aim: { position: [0.155, 1.32, -0.3], yaw: -0.08 },
    carry: { position: [0.26, 1.0, 0.02], rotation: [-1.42, 0.14, 0.06] },
  },
  m16: {
    grip: [0, -0.05, 0.03],
    fore: [0, 0, -0.18],
    aim: { position: [0.16, 1.325, -0.28], yaw: -0.1 },
    carry: { position: [0.255, 1.02, 0.02], rotation: [-1.46, 0.14, 0.06] },
  },
  couteau: {
    grip: [0, -0.02, 0.03],
    fore: null,
    aim: { position: [0.24, 1.28, -0.34], yaw: 0.12, roll: 0.3 },
    carry: { position: [0.24, 1.04, 0.0], rotation: [-1.5, 0.18, 0.08] },
  },
  machette: {
    grip: [0, -0.02, 0.03],
    fore: null,
    aim: { position: [0.24, 1.3, -0.34], yaw: 0.12, roll: 0.3 },
    carry: { position: [0.24, 1.04, 0.0], rotation: [-1.5, 0.18, 0.08] },
  },
  lance: {
    grip: [0, -0.01, 0],
    fore: [0, -0.01, -0.22],
    // En joue, la lance est couchée sous l'aisselle, pointe devant.
    aim: { position: [0.12, 1.26, -0.14], yaw: 0.04 },
    // **Au portage, elle est horizontale.** La rotation était de +1,5 rad :
    // la hampe montait droit comme un drapeau, pointe à 2,58 m et talon à
    // 0,63 m. Personne ne porte un épieu ainsi. Pointe vers −Z, donc rotation
    // nulle, et la main tient le bois au tiers arrière.
    carry: { position: [0.2, 1.03, -0.18], rotation: [-0.12, 0.14, 0.06] },
  },
};
