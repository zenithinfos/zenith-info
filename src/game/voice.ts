/**
 * Voix : narration du tutoriel, annonces de découverte et repères audio.
 * S'appuie sur la synthèse vocale du navigateur (aucun fichier à télécharger),
 * avec repli silencieux si l'API n'est pas disponible.
 */

export type VoiceLocale = "fr-FR" | "en-GB";

export interface VoiceLine {
  id: string;
  /** Texte affiché et prononcé. */
  text: string;
  /** Moment du jeu où la ligne est jouée. */
  trigger:
    | "intro"
    | "zone"
    | "species"
    | "danger"
    | "objectif"
    | "nuit"
    | "sauvegarde";
  /** Priorité : une ligne de priorité supérieure interrompt la précédente. */
  priority: 1 | 2 | 3;
}

export const VOICE_LINES: VoiceLine[] = [
  {
    id: "intro-1",
    text: "Bienvenue à Minkébé. Ici, la forêt décide du rythme.",
    trigger: "intro",
    priority: 3,
  },
  {
    id: "intro-2",
    text: "Votre objectif : documenter la faune sans la déranger, et cartographier les sentiers.",
    trigger: "intro",
    priority: 3,
  },
  {
    id: "zone-camp",
    text: "Camp de base. Ravitaillement et sauvegarde disponibles.",
    trigger: "zone",
    priority: 2,
  },
  {
    id: "zone-foret",
    text: "Forêt profonde. Restez sur le sentier, la canopée masque le GPS.",
    trigger: "zone",
    priority: 2,
  },
  {
    id: "zone-riviere",
    text: "Rivière Ivindo. Le courant est plus fort qu'il n'y paraît.",
    trigger: "zone",
    priority: 2,
  },
  {
    id: "danger-panthere",
    text: "Panthère à proximité. Reculez sans courir.",
    trigger: "danger",
    priority: 3,
  },
  {
    id: "danger-eau",
    text: "Crocodiles possibles. Ne restez pas au bord de l'eau.",
    trigger: "danger",
    priority: 3,
  },
  {
    id: "nuit",
    text: "La nuit tombe. Les lucioles sortent, les yeux brillent dans le noir.",
    trigger: "nuit",
    priority: 2,
  },
  {
    id: "sauvegarde",
    text: "Expédition sauvegardée.",
    trigger: "sauvegarde",
    priority: 1,
  },
];

export function linesFor(trigger: VoiceLine["trigger"]): VoiceLine[] {
  return VOICE_LINES.filter((line) => line.trigger === trigger);
}

export function lineById(id: string): VoiceLine | undefined {
  return VOICE_LINES.find((line) => line.id === id);
}

export interface SpeakOptions {
  locale?: VoiceLocale;
  rate?: number;
  pitch?: number;
  volume?: number;
  /** Annule les énoncés en cours. */
  interrupt?: boolean;
}

let currentPriority = 0;

/** Prononce une ligne si la synthèse vocale est disponible. */
export function speak(text: string, options: SpeakOptions = {}): boolean {
  if (typeof window === "undefined") return false;
  const synth = window.speechSynthesis;
  if (!synth || typeof SpeechSynthesisUtterance === "undefined") return false;

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = options.locale ?? "fr-FR";
  utterance.rate = options.rate ?? 0.98;
  utterance.pitch = options.pitch ?? 0.95;
  utterance.volume = options.volume ?? 0.8;

  const voices = synth.getVoices();
  const match =
    voices.find((v) => v.lang === utterance.lang) ??
    voices.find((v) => v.lang.startsWith("fr"));
  if (match) utterance.voice = match;

  if (options.interrupt) synth.cancel();
  synth.speak(utterance);
  return true;
}

export function speakLine(line: VoiceLine, options: SpeakOptions = {}): boolean {
  if (line.priority < currentPriority) return false;
  currentPriority = line.priority;
  const ok = speak(line.text, options);
  // La priorité retombe après la durée approximative de la phrase.
  window.setTimeout(() => {
    currentPriority = 0;
  }, Math.min(9000, line.text.length * 65));
  return ok;
}

export function stopSpeaking(): void {
  if (typeof window === "undefined") return;
  window.speechSynthesis?.cancel();
  currentPriority = 0;
}

export function voiceAvailable(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.speechSynthesis !== "undefined" &&
    typeof SpeechSynthesisUtterance !== "undefined"
  );
}

/** Budget de voix : limite les annonces pour ne pas saturer le joueur. */
export class VoiceScheduler {
  private lastSpokenAt = 0;

  constructor(private minIntervalMs = 6500) {}

  canSpeak(now: number, priority: 1 | 2 | 3): boolean {
    if (priority === 3) return true;
    return now - this.lastSpokenAt >= this.minIntervalMs;
  }

  mark(now: number): void {
    this.lastSpokenAt = now;
  }
}
