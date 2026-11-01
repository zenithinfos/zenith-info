/**
 * Couche « réalisme » : cycle jour/nuit, météo, humidité, fatigue.
 * Tout est déterministe à partir d'une graine pour que le multijoueur reste
 * synchronisé entre les clients.
 */

export type Weather = "sec" | "pluie" | "orage" | "brume";

export interface WeatherState {
  current: Weather;
  /** Intensité 0-1 (pluie plus ou moins forte, brume plus ou moins dense). */
  intensity: number;
  /** Temps restant avant le prochain changement, en secondes. */
  remaining: number;
}

export interface RealismSettings {
  /** Durée d'un cycle complet jour/nuit en minutes réelles. */
  dayLengthMinutes: number;
  weather: boolean;
  wetness: boolean;
  fatigue: boolean;
  /** Le joueur doit boire et manger. */
  survival: boolean;
  /** Nombre d'insectes ambiants affichés. */
  insects: number;
  /** Qualité des ombres : 0 = aucune, 3 = maximale. */
  shadows: 0 | 1 | 2 | 3;
}

export const DEFAULT_REALISM: RealismSettings = {
  dayLengthMinutes: 24,
  weather: true,
  wetness: true,
  fatigue: true,
  survival: true,
  insects: 220,
  shadows: 2,
};

export const PRESETS: Record<"detente" | "equilibre" | "immersion", RealismSettings> = {
  detente: {
    dayLengthMinutes: 48,
    weather: false,
    wetness: false,
    fatigue: false,
    survival: false,
    insects: 60,
    shadows: 1,
  },
  equilibre: DEFAULT_REALISM,
  immersion: {
    dayLengthMinutes: 16,
    weather: true,
    wetness: true,
    fatigue: true,
    survival: true,
    insects: 400,
    shadows: 3,
  },
};

export interface WorldClock {
  /** Heure du monde, 0-24. */
  hour: number;
  /** Jour depuis le début de la partie (commence à 1). */
  day: number;
  /** 0 = aube, 1 = midi, 0 = nuit... (intensité lumineuse). */
  daylight: number;
  phase: "aube" | "jour" | "crépuscule" | "nuit";
}

/** Calcule l'horloge du monde à partir d'une durée écoulée. */
export function worldClock(
  elapsedSeconds: number,
  settings: RealismSettings = DEFAULT_REALISM,
  startHour = 8.2,
): WorldClock {
  const hourPerSecond = 24 / (settings.dayLengthMinutes * 60);
  const raw = startHour + elapsedSeconds * hourPerSecond;
  const day = Math.floor(raw / 24) + 1;
  const hour = raw % 24;

  let daylight: number;
  if (hour < 5 || hour >= 20) daylight = 0;
  else if (hour < 7.5) daylight = (hour - 5) / 2.5;
  else if (hour < 17.5) daylight = 1;
  else daylight = Math.max(0, 1 - (hour - 17.5) / 2.5);

  // Courbe douce entre nuit et plein jour.
  daylight = daylight * daylight * (3 - 2 * daylight);

  const phase: WorldClock["phase"] =
    hour < 6 ? "nuit" : hour < 8 ? "aube" : hour < 17.5 ? "jour" : hour < 19.5 ? "crépuscule" : "nuit";

  return { hour, day, daylight, phase };
}

const WEATHER_ORDER: Weather[] = ["sec", "brume", "pluie", "orage"];

/** Fait évoluer la météo ; base saisonnière : juin-novembre = saison des pluies. */
export function nextWeather(
  current: WeatherState,
  deltaSeconds: number,
  seed = 1,
): WeatherState {
  if (current.remaining > deltaSeconds) {
    return {
      ...current,
      remaining: current.remaining - deltaSeconds,
    };
  }

  // Générateur pseudo-aléatoire simple pour rester synchrone entre clients.
  const mixed = Math.abs(Math.sin(seed * 12.9898 + current.remaining * 78.233)) % 1;
  const candidates = WEATHER_ORDER.filter((w) => w !== current.current);
  const next = candidates[Math.floor(mixed * candidates.length)] ?? "sec";

  const intensity =
    next === "sec" ? 0 : next === "brume" ? 0.35 + mixed * 0.3 : 0.4 + mixed * 0.6;

  return {
    current: next,
    intensity: Number(intensity.toFixed(2)),
    remaining: 180 + Math.floor(mixed * 420),
  };
}

export function initialWeather(month = new Date().getMonth() + 1): WeatherState {
  const rainy = month >= 6 && month <= 11;
  const base = rainy ? "pluie" : "brume";
  return { current: base, intensity: rainy ? 0.55 : 0.3, remaining: 300 };
}

export interface PlayerVitals {
  stamina: number; // 0-100
  hydration: number; // 0-100
  health: number; // 0-100
  /** 0-1 : mouillé jusqu'aux os. */
  wetness: number;
  temperature: number; // ressenti, °C
}

export function initialVitals(): PlayerVitals {
  return { stamina: 100, hydration: 88, health: 100, wetness: 0, temperature: 27 };
}

export interface VitalInput {
  running: boolean;
  sheltered: boolean;
  wetness: number;
  weather: WeatherState;
  hour: number;
  deltaSeconds: number;
}

/** Simulation des constantes vitales, appelée à chaque frame. */
export function tickVitals(
  vitals: PlayerVitals,
  input: VitalInput,
  settings: RealismSettings = DEFAULT_REALISM,
): PlayerVitals {
  const dt = input.deltaSeconds;
  const next = { ...vitals };

  if (settings.fatigue) {
    const drain = input.running ? 6.5 : 1.1;
    const recovery = input.running ? 0 : 2.4;
    next.stamina = clamp(vitals.stamina + (drain > recovery ? -drain : recovery) * dt, 0, 100);
  }

  if (settings.survival) {
    next.hydration = clamp(vitals.hydration - 0.22 * dt, 0, 100);
    if (next.hydration < 15) next.health = clamp(next.health - 0.35 * dt, 0, 100);
    if (next.stamina < 5) next.health = clamp(next.health - 0.1 * dt, 0, 100);
  }

  if (settings.wetness) {
    const rain = input.weather.current === "pluie" || input.weather.current === "orage";
    const wet = rain && !input.sheltered ? input.weather.intensity * dt * 0.12 : -dt * 0.03;
    next.wetness = clamp(vitals.wetness + wet, 0, 1);
    next.temperature = round1(28 - next.wetness * 4 - (input.hour < 6 || input.hour > 19 ? 4.5 : 0));
  }

  return next;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

export function vitalsWarning(vitals: PlayerVitals): string | null {
  if (vitals.health < 30) return "Santé critique : soignez-vous ou rejoignez le camp.";
  if (vitals.hydration < 20) return "Déshydratation : buvez de l'eau filtrée.";
  if (vitals.stamina < 12) return "Épuisement : marchez quelques minutes.";
  if (vitals.wetness > 0.8) return "Trempé : le froid vous ralentit.";
  return null;
}
