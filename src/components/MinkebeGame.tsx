"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Scene, { type SceneController, type SceneView } from "./Scene";
import CompassBar, { type Waypoint } from "./CompassBar";
import GpsMap, { type MapMarker } from "./GpsMap";
import TouchControls, { type TouchVector } from "./TouchControls";
import LoadingScreen from "./LoadingScreen";
import Dressing from "./Dressing";
import {
  type GameState,
  type HuntState,
  type InputState,
  deserialize,
  drinkWater,
  eatFruit,
  grillMeat,
  initialHunt,
  newGame,
  restartExpedition,
  serialize,
  step,
  atCamp,
  buildShelter,
  recordHarvest,
  recordKill,
  nearestShelter,
  SHELTER_WOOD,
  sleepAtShelter,
  toggleGoggles,
  waterWithin,
  weatherLabel,
  weaveOutfit,
} from "@/game/engine";
import { SURVIVAL_PRIZE_XP, levelProgress } from "@/game/xp";
import { MEWA_COUNT, mewasFound, wildMewas } from "@/game/mewas";
import { outfitAvailable, getOutfit } from "@/game/outfits";
import { LEVELS, levelStatus } from "@/game/progression";
import { CHARACTERS, getCharacter } from "@/game/characters";
import { useI18n } from "@/i18n/LocaleProvider";
import type { DictionaryKey } from "@/i18n/dictionary";
import { getZone } from "@/game/levels";
import { worldClock } from "@/game/realism";
import { faunaScore, getSpecies } from "@/game/fauna";
import {
  type Animal,
  ANIMAL_BUILDS,
  harvest,
  nearestCarcass,
  stepHerd,
} from "@/game/animals";
import {
  WEAPONS,
  type WeaponId,
  fireWeapon,
  getWeapon,
  reloadWeapon,
  weaponStateOf,
  aimTarget,
} from "@/game/hunting";
import { MinkebeNet, type RemotePlayer, type RoomInfo } from "@/game/net";
import { speakLine, linesFor, voiceAvailable } from "@/game/voice";
import { ambientLine } from "@/game/whimsy";
import { formatPrice, PLANS } from "@/lib/plans";

type Phase = "accueil" | "chargement" | "jeu" | "pause" | "fin";

interface BoardRow {
  id: string;
  name: string;
  score: number;
  cause: "soif" | "faim" | "blessure";
  mewas: number;
  level: number;
  seconds: number;
}

interface Toast {
  id: number;
  title: string;
  detail?: string;
  tone: "info" | "succes" | "alerte";
}

const DEVICE_KEY = "minkebe.device";

function getDeviceId(): string {
  if (typeof window === "undefined") return "serveur";
  let id = window.localStorage.getItem(DEVICE_KEY);
  if (!id) {
    id = crypto.randomUUID();
    window.localStorage.setItem(DEVICE_KEY, id);
  }
  return id;
}

function bearingTo(from: [number, number, number], to: [number, number]): number {
  const dx = to[0] - from[0];
  const dz = to[1] - from[2];
  return ((Math.atan2(dx, -dz) * 180) / Math.PI + 360) % 360;
}

export default function MinkebeGame() {
  const { t } = useI18n();
  const [phase, setPhase] = useState<Phase>("accueil");
  const [characterId, setCharacterId] = useState("michelle");
  const [hud, setHud] = useState<GameState | null>(null);
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [showMap, setShowMap] = useState(false);
  const [ambient, setAmbient] = useState("");
  const [room, setRoom] = useState<RoomInfo | null>(null);
  const [remotePlayers, setRemotePlayers] = useState<RemotePlayer[]>([]);
  const [netError, setNetError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);
  const [joinCode, setJoinCode] = useState("");
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  const [voiceOn, setVoiceOn] = useState(false);
  const [showHints, setShowHints] = useState(false);
  const [showDressing, setShowDressing] = useState(false);
  const [board, setBoard] = useState<BoardRow[]>([]);
  const [boardRank, setBoardRank] = useState(0);
  const [boardState, setBoardState] = useState<"idle" | "envoi" | "ok" | "hors-ligne">("idle");

  const sceneRef = useRef<SceneController | null>(null);
  const stateRef = useRef<GameState>(newGame(characterId));
  const inputRef = useRef<InputState>({
    forward: false,
    backward: false,
    left: false,
    right: false,
    run: false,
    sneak: false,
    jump: false,
    block: false,
    joystick: { x: 0, y: 0 },
  });
  /** Délai avant qu'une même bête puisse infliger un deuxième coup. */
  const chargeHitRef = useRef(new Map<number, number>());
  const netRef = useRef<MinkebeNet | null>(null);
  const rafRef = useRef(0);
  const lastHudRef = useRef(0);
  const lastAmbientRef = useRef(0);
  const runningRef = useRef(false);

  // --- chasse
  const animalsRef = useRef<Animal[]>([]);
  const huntRef = useRef<HuntState>(initialHunt());
  const lastShotRef = useRef(0);
  const firingRef = useRef(false);
  const fireRef = useRef<() => void>(() => {});
  const [hitMarker, setHitMarker] = useState<"none" | "hit" | "kill">("none");
  const [targetLabel, setTargetLabel] = useState<string | null>(null);
  const [carcassNear, setCarcassNear] = useState<string | null>(null);
  const carcassNearRef = useRef<string | null>(null);

  const pushToast = useCallback((toast: Omit<Toast, "id">) => {
    const id = Date.now() + Math.random();
    setToasts((current) => [...current.slice(-3), { ...toast, id }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((t) => t.id !== id));
    }, 6200);
  }, []);

  // ------------------------------------------------------------------
  // Chargement initial (scène + sauvegarde)
  // ------------------------------------------------------------------
  useEffect(() => {
    if (phase !== "chargement") return;
    let progress = 0;
    const timer = window.setInterval(() => {
      progress = Math.min(96, progress + 9 + Math.random() * 12);
      setLoadingProgress(progress);
    }, 160);

    const finish = window.setTimeout(() => {
      window.clearInterval(timer);
      setLoadingProgress(100);
      setPhase("jeu");
      setShowHints(true);
      if (voiceOn && voiceAvailable()) {
        const intro = linesFor("intro")[0];
        if (intro) speakLine(intro);
      }
    }, 1500);

    const hideHints = window.setTimeout(() => setShowHints(false), 16000);

    return () => {
      window.clearInterval(timer);
      window.clearTimeout(finish);
      window.clearTimeout(hideHints);
    };
  }, [phase, voiceOn]);

  // ------------------------------------------------------------------
  // Chasse : arme en main, tir, rechargement, dépeçage
  // ------------------------------------------------------------------
  const commitHunt = useCallback((next: HuntState) => {
    huntRef.current = next;
    stateRef.current = { ...stateRef.current, hunt: next };
  }, []);

  /**
   * Applique un état complet — utilisé quand une action change l'XP et pas
   * seulement le tableau de chasse. C'est ici que se joue la montée de niveau,
   * donc ici qu'on l'annonce.
   */
  const commitState = useCallback(
    (next: GameState) => {
      const before = stateRef.current;
      stateRef.current = next;
      huntRef.current = next.hunt;
      setHud(next);
      if (next.level > before.level) {
        const prize = next.xp >= SURVIVAL_PRIZE_XP;
        pushToast({
          title: `${t("game.level")} ${next.level}`,
          detail: prize
            ? `${t("game.prizeWon")} · ${Math.round(next.xp)} XP`
            : `${Math.round(next.xp)} XP · ${t("game.survivalPrize")}`,
          tone: "succes",
        });
      }
    },
    [pushToast, t],
  );

  const equip = useCallback(
    (id: WeaponId) => {
      const arsenal = { ...huntRef.current.arsenal, current: id };
      commitHunt({ ...huntRef.current, arsenal });
      sceneRef.current?.setWeapon(id);
    },
    [commitHunt],
  );

  const fire = useCallback(() => {
    const controller = sceneRef.current;
    if (!controller) return;
    const arsenal = huntRef.current.arsenal;
    const weapon = getWeapon(arsenal.current);

    // Chargeur vide : on recharge plutôt que de laisser cliquer dans le vide.
    if (weapon.kind === "feu" && weaponStateOf(arsenal, weapon.id).loaded === 0) {
      const reloaded = reloadWeapon(arsenal, weapon.id);
      if (reloaded !== arsenal && weaponStateOf(reloaded, weapon.id).loaded > 0) {
        commitHunt({ ...huntRef.current, arsenal: reloaded });
        pushToast({
          title: "Rechargement",
          detail: `${weapon.short} · ${weaponStateOf(reloaded, weapon.id).loaded} balles`,
          tone: "info",
        });
      }
      return;
    }

    const { report, arsenal: nextArsenal, lastShotAt } = fireWeapon(
      weapon.id,
      arsenal,
      animalsRef.current,
      controller.getAim(),
      performance.now(),
      lastShotRef.current,
    );
    lastShotRef.current = lastShotAt;
    if (!report.fired) return;

    controller.fireFeedback(weapon.id);
    commitHunt({ ...huntRef.current, arsenal: nextArsenal, shots: huntRef.current.shots + 1 });

    if (report.hit) {
      const species = getSpecies(report.hit.speciesId);
      setHitMarker(report.hit.killed ? "kill" : "hit");
      window.setTimeout(() => setHitMarker("none"), report.hit?.killed ? 420 : 180);
      if (report.hit.killed) {
        const build = ANIMAL_BUILDS[report.hit.speciesId];
        // Le compteur de chasse et l'XP se mettent à jour ensemble : deux
        // chemins séparés finissaient toujours par diverger.
        commitState(
          recordKill(
            { ...stateRef.current, hunt: huntRef.current },
            report.hit.speciesId,
            species?.points ?? 10,
          ),
        );
        pushToast({
          title: `${species?.emoji ?? "🎯"} ${species?.name ?? "Animal"} abattu`,
          detail: `${report.hit.headshot ? "Tir à la tête · " : ""}${build?.meat ?? 0} kg à dépecer`,
          tone: "succes",
        });
      }
    }
  }, [commitHunt, commitState, pushToast]);

  useEffect(() => {
    fireRef.current = fire;
  }, [fire]);

  const reload = useCallback(() => {
    const arsenal = huntRef.current.arsenal;
    const next = reloadWeapon(arsenal, arsenal.current);
    if (next === arsenal) return;
    commitHunt({ ...huntRef.current, arsenal: next });
    const weapon = getWeapon(arsenal.current);
    pushToast({ title: `${weapon.short} rechargé`, tone: "info" });
  }, [commitHunt, pushToast]);

  const skinCarcass = useCallback(() => {
    const player = stateRef.current.player.position;
    const carcass = nearestCarcass(animalsRef.current, player[0], player[2], 3.6);
    if (!carcass) return;
    const result = harvest(carcass);
    if (!result) return;
    commitState(recordHarvest({ ...stateRef.current, hunt: huntRef.current }, result.meat));
    carcassNearRef.current = null;
    setCarcassNear(null);
    pushToast({
      title: `Dépeçage · +${result.meat} kg`,
      detail: `${result.name} — viande au sac : ${Math.round(huntRef.current.meat + result.meat)} kg`,
      tone: "succes",
    });
  }, [commitState, pushToast]);

  // ------------------------------------------------------------------
  // Survie : boire, manger, griller, tisser
  // ------------------------------------------------------------------
  const drink = useCallback(() => {
    const result = drinkWater(stateRef.current);
    stateRef.current = result.state;
    setHud(result.state);
    if (result.code === "drink.ok") {
      pushToast({
        title: t("game.drinkOk"),
        detail: `💧 ${Math.round(result.state.vitals.hydration)} / 100`,
        tone: "succes",
      });
    } else {
      pushToast({ title: t("game.drinkNone"), tone: "alerte" });
    }
  }, [pushToast, t]);

  const eat = useCallback(() => {
    const result = eatFruit(stateRef.current);
    stateRef.current = result.state;
    setHud(result.state);
    if (result.code === "eat.ok") {
      pushToast({
        title: t("game.eatOk"),
        detail: `🍈 ${result.state.fruits} ${t("game.fruits")} · 🍽 ${Math.round(result.state.vitals.hunger)} / 100`,
        tone: "succes",
      });
    } else {
      pushToast({ title: t("game.eatNone"), tone: "alerte" });
    }
  }, [pushToast, t]);

  const grill = useCallback(() => {
    const result = grillMeat(stateRef.current);
    stateRef.current = result.state;
    setHud(result.state);
    if (result.code === "grill.ok") {
      pushToast({
        title: t("game.grillOk"),
        detail: `🔥 ${Math.round(result.state.hunt.meat)} kg · 🍽 ${Math.round(result.state.vitals.hunger)} / 100`,
        tone: "succes",
      });
    } else if (result.code === "grill.far") {
      pushToast({ title: t("game.grillFar"), tone: "info" });
    } else {
      pushToast({ title: t("game.grillNone"), tone: "alerte" });
    }
  }, [pushToast, t]);

  // ------------------------------------------------------------------
  // Abri, repos, lunettes
  // ------------------------------------------------------------------
  const shelterUp = useCallback(() => {
    const result = buildShelter(stateRef.current);
    stateRef.current = result.state;
    setHud(result.state);
    if (result.code === "shelter.ok") {
      pushToast({
        title: t("game.shelterBuilt"),
        detail: `${SHELTER_WOOD} 🪵 · ${t("game.shelterLeft")} ${result.state.wood} 🪵`,
        tone: "succes",
      });
    } else if (result.code === "shelter.wood") {
      pushToast({
        title: t("game.shelterWood"),
        detail: `${result.state.wood} / ${SHELTER_WOOD} 🪵`,
        tone: "alerte",
      });
    } else {
      pushToast({ title: t("game.shelterSlope"), tone: "alerte" });
    }
  }, [pushToast, t]);

  const sleep = useCallback(() => {
    const result = sleepAtShelter(stateRef.current);
    stateRef.current = result.state;
    setHud(result.state);
    if (result.code === "sleep.ok") {
      pushToast({
        title: t("game.sleepOk"),
        detail: `❤ ${Math.round(result.state.vitals.health)} · ⚡ ${Math.round(result.state.vitals.stamina)}`,
        tone: "succes",
      });
    } else {
      pushToast({ title: t("game.sleepNone"), tone: "info" });
    }
  }, [pushToast, t]);

  const goggles = useCallback(() => {
    const next = toggleGoggles(stateRef.current);
    stateRef.current = next;
    setHud(next);
    sceneRef.current?.setGoggles(next.goggles);
    pushToast({
      title: next.goggles ? t("game.gogglesOn") : t("game.gogglesOff"),
      tone: "info",
    });
  }, [pushToast, t]);

  const weave = useCallback(
    (outfitId: string) => {
      const result = weaveOutfit(stateRef.current, outfitId);
      stateRef.current = result.state;
      setHud(result.state);
      const outfit = getOutfit(outfitId);
      if (result.code === "weave.ok") {
        pushToast({
          title: `${outfit.emoji} ${outfit.name}`,
          detail: `🪡 ${outfit.threads} 🧵 · ${result.state.threads} 🧵 ${t("game.dressHave")}`,
          tone: "succes",
        });
      } else if (result.code === "weave.threads") {
        pushToast({
          title: `${outfit.threads} 🧵 ${t("game.dressNeed")}`,
          detail: `${result.state.threads} 🧵 ${t("game.dressHave")}`,
          tone: "alerte",
        });
      }
    },
    [pushToast, t],
  );

  const wear = useCallback(
    (selection: { characterId: string; outfitId: string }) => {
      const outfit = getOutfit(selection.outfitId);
      const state = stateRef.current;
      if (!outfitAvailable(outfit, state.level, state.woven)) {
        pushToast({
          title: `${outfit.threads} 🧵 ${t("game.dressNeed")}`,
          detail: t("game.dressNone"),
          tone: "alerte",
        });
        return;
      }
      const next: GameState = {
        ...state,
        player: { ...state.player, characterId: selection.characterId, outfit: outfit.id },
      };
      stateRef.current = next;
      setCharacterId(selection.characterId);
      setHud(next);
      sceneRef.current?.setPlayer(next.player.position, next.player.heading, next.player.motion);
      pushToast({ title: `${outfit.emoji} ${outfit.name}`, tone: "info" });
    },
    [pushToast, t],
  );

  // Expédition terminée : le score part au classement.
  const submitDeath = useCallback(async (state: GameState) => {
    if (!state.death) return;
    setBoardState("envoi");
    try {
      const response = await fetch("/api/leaderboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deviceId: getDeviceId(),
          name: getCharacter(state.player.characterId as "michelle").name,
          score: state.death.score,
          cause: state.death.cause,
          mewas: mewasFound(state.mewas),
          level: state.level,
          seconds: Math.round(state.elapsed),
        }),
      });
      if (!response.ok) throw new Error("refus");
      const data = (await response.json()) as { entries?: BoardRow[]; rank?: number };
      setBoard(data.entries ?? []);
      setBoardRank(data.rank ?? 0);
      setBoardState("ok");
    } catch {
      setBoardState("hors-ligne");
      try {
        const response = await fetch("/api/leaderboard", { cache: "no-store" });
        const data = (await response.json()) as { entries?: BoardRow[] };
        setBoard(data.entries ?? []);
      } catch {
        /* le classement reste vide : la fin d'expédition s'affiche quand même */
      }
    }
  }, []);

  const restart = useCallback(() => {
    stateRef.current = restartExpedition(stateRef.current, characterId);
    huntRef.current = stateRef.current.hunt;
    animalsRef.current = [];
    setHud(stateRef.current);
    setBoardState("idle");
    setBoardRank(0);
    setLoadingProgress(0);
    setPhase("chargement");
  }, [characterId]);

  /** Point de vue : à l'épaule par défaut, le personnage doit exister. */
  const [view, setView] = useState<SceneView>("troisieme");
  useEffect(() => {
    sceneRef.current?.setView(view);
  }, [view]);

  const actionsRef = useRef({
    equip: (id: WeaponId) => {
      void id;
    },
    reload: () => {},
    skin: () => {},
    drink: () => {},
    eat: () => {},
    grill: () => {},
    dress: () => {},
    shelter: () => {},
    sleep: () => {},
    goggles: () => {},
  });
  useEffect(() => {
    actionsRef.current = {
      equip,
      reload,
      skin: skinCarcass,
      drink,
      eat,
      grill,
      dress: () => setShowDressing((value) => !value),
      shelter: shelterUp,
      sleep,
      goggles,
    };
  }, [equip, reload, skinCarcass, drink, eat, grill, shelterUp, sleep, goggles]);

  // Tir automatique : on maintient la gâchette, la cadence est gérée par l'arme.
  useEffect(() => {
    if (phase !== "jeu") {
      firingRef.current = false;
      return;
    }
    const onDown = (event: MouseEvent) => {
      if (document.pointerLockElement === null) return;
      if (event.button === 0) {
        firingRef.current = true;
        fireRef.current();
      }
      if (event.button === 2) {
        // Parade : on lève la garde ET on épaule. Tenir une arme à deux mains
        // devant une charge, c'est exactement la même posture.
        inputRef.current.block = true;
        sceneRef.current?.setAiming(true);
      }
    };
    const onUp = (event: MouseEvent) => {
      if (event.button === 0) firingRef.current = false;
      if (event.button === 2) {
        inputRef.current.block = false;
        sceneRef.current?.setAiming(false);
      }
    };
    const onContext = (event: MouseEvent) => event.preventDefault();
    window.addEventListener("mousedown", onDown);
    window.addEventListener("mouseup", onUp);
    window.addEventListener("contextmenu", onContext);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("contextmenu", onContext);
      firingRef.current = false;
      inputRef.current.block = false;
      sceneRef.current?.setAiming(false);
    };
  }, [phase]);

  // ------------------------------------------------------------------
  // Boucle de jeu
  // ------------------------------------------------------------------
  useEffect(() => {
    if (phase !== "jeu") {
      runningRef.current = false;
      sceneRef.current?.setPaused(true);
      return;
    }
    sceneRef.current?.setPaused(false);
    runningRef.current = true;

    let last = performance.now();
    const loop = (now: number) => {
      rafRef.current = requestAnimationFrame(loop);
      if (!runningRef.current) return;
      const dt = Math.min(0.06, (now - last) / 1000);
      last = now;

      const result = step(stateRef.current, inputRef.current, dt);
      stateRef.current = result.state;
      // Le saut est une impulsion : on la consomme, sinon rester appuyé sur
      // Espace ferait sauter à chaque atterrissage.
      inputRef.current.jump = false;

      const controller = sceneRef.current;
      const clockNow = worldClock(result.state.elapsed, result.state.settings);
      if (controller) {
        const player = result.state.player;
        controller.setPlayer(player.position, player.heading, player.motion, result.state.height);
        controller.setShelters(result.state.shelters);
        controller.setGoggles(result.state.goggles);
        controller.setEnvironment({
          hour: clockNow.hour,
          daylight: clockNow.daylight,
          weather: result.state.weather.current,
          intensity: result.state.weather.intensity,
        });
      }

      // Mewas : le rendu reçoit l'instantané des esprits.
      if (controller) controller.setMewas(result.state.mewas);

      for (const reward of result.mewas) {
        pushToast({
          title: `🐾 ${t("game.mewaFound")}`,
          detail: `+${reward.threads} 🧵 · +${reward.xp} ${t("game.xp")} · +${reward.style} ${t("game.style")} — ${mewasFound(result.state.mewas)}/${MEWA_COUNT}`,
          tone: "succes",
        });
      }

      if (result.death) {
        runningRef.current = false;
        setHud(result.state);
        setPhase("fin");
        void submitDeath(result.state);
        return;
      }

      // Faune : la harde vit autour du joueur, que le rendu soit prêt ou non.
      const moving = result.state.player.motion !== "idle";
      const herd = stepHerd(
        animalsRef.current,
        {
          player: [result.state.player.position[0], result.state.player.position[2]],
          noise:
            result.state.player.motion === "run"
              ? 8
              : result.state.player.motion === "sneak"
                ? 1
                : moving
                  ? 3
                  : 0,
          hour: clockNow.hour,
          weather: result.state.weather.current,
          zoneId: result.state.zoneId,
          // Les tenues tissées changent la relation aux bêtes, pas la forêt.
          tame: getOutfit(result.state.player.outfit).power === "tame",
          calm: getOutfit(result.state.player.outfit).power === "calm",
        },
        dt,
      );
      animalsRef.current = herd.animals;
      controller?.setAnimals(herd.animals);

      // Une charge qui atteint le joueur entame la santé — sauf si on l'a
      // parée, ou si on l'a sautée. Chaque bête ne frappe qu'une fois toutes
      // les 1,4 s : sans ce délai, une charge collée vidait 100 PV en trois
      // secondes sans que le joueur ait le temps de comprendre.
      const hitClock = performance.now();
      for (const animal of herd.animals) {
        if (animal.state !== "charge") continue;
        const dx = animal.x - result.state.player.position[0];
        const dz = animal.z - result.state.player.position[2];
        if (Math.hypot(dx, dz) >= 2.2) continue;
        // Sauter par-dessus la charge : le seul geste qui annule les dégâts
        // sans consommer d'endurance.
        if (result.state.height > 0.7) continue;
        const last = chargeHitRef.current.get(animal.id) ?? 0;
        if (hitClock - last < 1400) continue;
        chargeHitRef.current.set(animal.id, hitClock);

        const species = getSpecies(animal.speciesId);
        // Le buffle et le potamochère frappent plus fort que la panthère.
        const base = animal.speciesId === "buffle" ? 34 : animal.speciesId === "potamochere" ? 26 : 22;
        if (result.state.blocking) {
          const cost = 16;
          if (result.state.vitals.stamina >= cost) {
            result.state.vitals.stamina -= cost;
            result.state.vitals.health = Math.max(0, result.state.vitals.health - base * 0.15);
            pushToast({ title: t("game.blocking"), detail: `⚡ −${cost}`, tone: "info" });
          } else {
            result.state.vitals.health = Math.max(0, result.state.vitals.health - base);
            pushToast({ title: t("game.charge"), detail: species?.name, tone: "alerte" });
          }
        } else {
          result.state.vitals.health = Math.max(0, result.state.vitals.health - base);
          pushToast({ title: t("game.charge"), detail: species?.name, tone: "alerte" });
        }
      }

      if (firingRef.current) fireRef.current();

      netRef.current?.send(
        result.state.player.position,
        result.state.player.heading,
        result.state.player.motion,
      );

      for (const species of result.observations) {
        pushToast({
          title: `${species.emoji} ${species.name}`,
          detail: `${species.scientific} · +${species.points} pts`,
          tone: "succes",
        });
      }

      // Étape d'expédition terminée : on annonce la suivante, sinon le joueur
      // ne saurait pas que la forêt vient de s'ouvrir.
      if (result.completedLevel) {
        const next = LEVELS[result.state.progress.levelIndex];
        const opened = result.completedLevel.unlocks
          .map((id) => getZone(id)?.name)
          .filter((name): name is string => Boolean(name));
        pushToast({
          title: `${t("game.levelDone")} · ${t(result.completedLevel.title as DictionaryKey)}`,
          detail:
            (next ? `${t("game.levelNext")} · ${t(next.title as DictionaryKey)}` : t("game.expeditionDone")) +
            (opened.length ? ` — ${opened.join(", ")}` : ""),
          tone: "succes",
        });
      }

      const nowMs = performance.now();
      if (nowMs - lastHudRef.current > 140) {
        lastHudRef.current = nowMs;
        setHud(result.state);
        if (controller) {
          const aimed = aimTarget(herd.animals, controller.getAim(), 70);
          const aimedSpecies = aimed ? getSpecies(aimed.speciesId) : null;
          setTargetLabel(
            aimed && aimedSpecies
              ? `${aimedSpecies.name} · ${Math.round(
                  Math.hypot(
                    aimed.x - result.state.player.position[0],
                    aimed.z - result.state.player.position[2],
                  ),
                )} m`
              : null,
          );
          const carcass = nearestCarcass(
            herd.animals,
            result.state.player.position[0],
            result.state.player.position[2],
            3.6,
          );
          const carcassSpecies = carcass ? getSpecies(carcass.speciesId) : null;
          carcassNearRef.current = carcassSpecies ? carcassSpecies.name : null;
          setCarcassNear(carcassNearRef.current);
        }
      }
      if (nowMs - lastAmbientRef.current > 14000) {
        lastAmbientRef.current = nowMs;
        setAmbient(ambientLine(result.state.elapsed + result.state.seed));
      }
    };

    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [phase, pushToast, t, submitDeath]);

  // ------------------------------------------------------------------
  // Clavier
  // ------------------------------------------------------------------
  useEffect(() => {
    const keyMap: Record<string, keyof InputState> = {
      KeyW: "forward",
      ArrowUp: "forward",
      KeyS: "backward",
      ArrowDown: "backward",
      KeyA: "left",
      ArrowLeft: "left",
      KeyD: "right",
      ArrowRight: "right",
      ShiftLeft: "run",
      ShiftRight: "run",
      // Ctrl n'est plus « s'accroupir » : c'est la parade, la garde levée
      // contre une charge. S'accroupir reste sur C.
      ControlLeft: "block",
      ControlRight: "block",
      KeyC: "sneak",
    };

    const onKeyDown = (event: KeyboardEvent) => {
      const mapped = keyMap[event.code];
      if (mapped) {
        (inputRef.current[mapped] as boolean) = true;
        event.preventDefault();
      }
      if (event.code === "KeyM") setShowMap((value) => !value);
      if (event.code.startsWith("Digit")) {
        const index = Number(event.code.slice(5)) - 1;
        const weapon = WEAPONS[index];
        if (weapon) actionsRef.current.equip(weapon.id);
      }
      if (event.code === "KeyR") actionsRef.current.reload();
      // E est contextuel : dépecer si une carcasse est là, boire sinon.
      if (event.code === "KeyE") {
        if (carcassNearRef.current) actionsRef.current.skin();
        else actionsRef.current.drink();
      }
      if (event.code === "KeyF") actionsRef.current.eat();
      if (event.code === "KeyG") actionsRef.current.grill();
      if (event.code === "KeyB") actionsRef.current.shelter();
      if (event.code === "KeyN") actionsRef.current.sleep();
      if (event.code === "KeyI") actionsRef.current.goggles();
      // ⇧O ouvre le vestiaire ; Maj seule reste la course.
      if (event.code === "KeyO" && event.shiftKey) {
        event.preventDefault();
        document.exitPointerLock?.();
        actionsRef.current.dress();
      }
      // Espace saute. Le tir reste au clic (ou au bouton tactile) : une seule
      // touche ne peut pas faire les deux sans faire sauter le joueur à chaque
      // coup de feu.
      if (event.code === "Space") {
        if (!event.repeat) inputRef.current.jump = true;
        event.preventDefault();
      }
      if (event.code === "Escape") {
        setPhase((current) => (current === "jeu" ? "pause" : current === "pause" ? "jeu" : current));
      }
      if (event.code === "KeyP" && document.pointerLockElement === null) {
        sceneRef.current?.requestLook();
      }
      if (event.code === "KeyV") {
        setView((current) => (current === "premier" ? "troisieme" : "premier"));
      }
    };

    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code === "Space") inputRef.current.jump = false;
      const mapped = keyMap[event.code];
      if (mapped) {
        (inputRef.current[mapped] as boolean) = false;
        event.preventDefault();
      }
    };

    const onBlur = () => {
      firingRef.current = false;
      inputRef.current = {
        forward: false,
        backward: false,
        left: false,
        right: false,
        run: false,
        sneak: false,
        jump: false,
        block: false,
        joystick: { x: 0, y: 0 },
      };
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, []);

  // ------------------------------------------------------------------
  // Nettoyage du réseau
  // ------------------------------------------------------------------
  useEffect(() => {
    return () => {
      void netRef.current?.leave();
      netRef.current?.stop();
    };
  }, []);

  // ------------------------------------------------------------------
  // Sauvegarde
  // ------------------------------------------------------------------
  const saveGame = useCallback(async () => {
    setSaveStatus("Sauvegarde…");
    try {
      const response = await fetch("/api/saves", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deviceId: getDeviceId(),
          playerId: "local",
          slot: 0,
          label: getZone(stateRef.current.zoneId)?.name ?? "Expédition",
          gameVersion: "1.4.0",
          playtimeSeconds: Math.round(stateRef.current.elapsed),
          state: serialize(stateRef.current),
        }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setSaveStatus("Expédition sauvegardée");
      pushToast({ title: "Sauvegarde enregistrée", detail: "Elle apparaîtra au prochain lancement.", tone: "info" });
      if (voiceOn) {
        const line = linesFor("sauvegarde")[0];
        if (line) speakLine(line);
      }
    } catch {
      // Repli local si l'API est indisponible.
      window.localStorage.setItem(
        "minkebe.save",
        JSON.stringify(serialize(stateRef.current)),
      );
      setSaveStatus("Sauvegarde locale");
      pushToast({
        title: "Serveur indisponible",
        detail: "Sauvegarde conservée dans ce navigateur.",
        tone: "alerte",
      });
    } finally {
      window.setTimeout(() => setSaveStatus(null), 4000);
    }
  }, [pushToast, voiceOn]);

  const loadGame = useCallback(async () => {
    try {
      const response = await fetch(`/api/saves?deviceId=${encodeURIComponent(getDeviceId())}`, {
        cache: "no-store",
      });
      if (!response.ok) throw new Error();
      const data = (await response.json()) as {
        saves: { state: Record<string, unknown> }[];
      };
      const first = data.saves?.[0];
      if (first) {
        const restored = deserialize(first.state);
        // Une expédition sauvée morte ne se reprend pas : on repart, en
        // gardant les tenues tissées.
        stateRef.current = restored.death ? restartExpedition(restored) : restored;
        pushToast({
          title: restored.death ? "Nouvelle expédition" : "Expédition restaurée",
          detail: restored.death ? "La précédente s'est terminée sans vous." : undefined,
          tone: "info",
        });
        return true;
      }
    } catch {
      const local = window.localStorage.getItem("minkebe.save");
      if (local) {
        const restored = deserialize(JSON.parse(local) as Record<string, unknown>);
        stateRef.current = restored.death ? restartExpedition(restored) : restored;
        return true;
      }
    }
    return false;
  }, [pushToast]);

  const startGame = useCallback(
    async (mode: "nouveau" | "reprendre") => {
      stateRef.current = newGame(characterId);
      if (mode === "reprendre") {
        const restored = await loadGame();
        if (!restored) {
          pushToast({ title: "Aucune sauvegarde", detail: "Nouvelle expédition lancée.", tone: "info" });
        }
      }
      huntRef.current = stateRef.current.hunt;
      animalsRef.current = [];
      setHud(stateRef.current);
      setLoadingProgress(0);
      setPhase("chargement");
    },
    [characterId, loadGame, pushToast],
  );

  // ------------------------------------------------------------------
  // Multijoueur
  // ------------------------------------------------------------------
  const joinRoom = useCallback(
    async (code: string) => {
      if (!code.trim()) return;
      setJoining(true);
      setNetError(null);
      try {
        netRef.current?.stop();
        const net = netRef.current ?? new MinkebeNet({
          onPlayers: (players) =>
            setRemotePlayers(players.filter((p) => p.id !== netRef.current?.playerId)),
          onError: (error) => setNetError(error.message),
        });
        netRef.current = net;
        net.name = "Explorateur";
        net.outfit = stateRef.current.player.outfit;
        const info = await net.join(code.trim().toUpperCase());
        setRoom(info);
        setPhase("jeu");
        pushToast({ title: `Salon ${info.code}`, detail: `${info.players} explorateur(s) connecté(s)`, tone: "succes" });
      } catch (error) {
        setNetError(error instanceof Error ? error.message : "Connexion impossible");
      } finally {
        setJoining(false);
      }
    },
    [pushToast],
  );

  const createRoom = useCallback(async () => {
    setJoining(true);
    setNetError(null);
    try {
      netRef.current?.stop();
      const net = netRef.current ?? new MinkebeNet({
        onPlayers: (players) =>
          setRemotePlayers(players.filter((p) => p.id !== netRef.current?.playerId)),
        onError: (error) => setNetError(error.message),
      });
      netRef.current = net;
      const info = await net.createRoom({ name: "Expédition partagée", level: stateRef.current.zoneId });
      setRoom(info);
      setPhase("jeu");
      pushToast({ title: `Salon créé : ${info.code}`, detail: "Partagez ce code avec votre équipe.", tone: "succes" });
    } catch (error) {
      setNetError(error instanceof Error ? error.message : "Création impossible");
    } finally {
      setJoining(false);
    }
  }, [pushToast]);

  const leaveRoom = useCallback(async () => {
    await netRef.current?.leave();
    netRef.current = null;
    setRoom(null);
    setRemotePlayers([]);
  }, []);

  // ------------------------------------------------------------------
  // Joueurs distants → scène
  // ------------------------------------------------------------------
  useEffect(() => {
    sceneRef.current?.setRemotePlayers(remotePlayers);
  }, [remotePlayers]);

  const onTouchMove = useCallback((vector: TouchVector) => {
    inputRef.current.joystick = { x: vector.x, y: vector.y };
    inputRef.current.forward = vector.y < -0.25;
    inputRef.current.backward = vector.y > 0.25;
    inputRef.current.left = vector.x < -0.25;
    inputRef.current.right = vector.x > 0.25;
  }, []);

  // ------------------------------------------------------------------
  // Données HUD
  // ------------------------------------------------------------------
  const clock = hud ? worldClock(hud.elapsed, hud.settings) : worldClock(0);
  const zone = hud ? getZone(hud.zoneId) : undefined;
  const character = getCharacter(characterId as "michelle");
  const arsenal = hud?.hunt.arsenal ?? huntRef.current.arsenal;
  const heldWeapon = getWeapon(arsenal.current);
  const heldAmmo = weaponStateOf(arsenal, heldWeapon.id);
  const totalKills = Object.values(hud?.hunt.kills ?? {}).reduce((sum, n) => sum + n, 0);
  const nearWater = hud ? waterWithin(hud.player.position[0], hud.player.position[2]) : false;

  const waypoints: Waypoint[] = useMemo(() => {
    if (!hud) return [];
    const list: Waypoint[] = [];
    for (const id of ["camp", "riviere", "clairiere"]) {
      const target = getZone(id);
      if (!target) continue;
      const distance = Math.hypot(
        target.center[0] - hud.player.position[0],
        target.center[1] - hud.player.position[2],
      );
      list.push({
        label: target.name,
        bearing: bearingTo(hud.player.position, target.center),
        distance,
        kind: id === "camp" ? "camp" : id === "riviere" ? "eau" : "zone",
      });
    }
    return list;
  }, [hud]);

  const markers: MapMarker[] = useMemo(() => {
    if (!hud) return [];
    return [
      {
        id: "self",
        label: "Vous",
        position: hud.player.position,
        kind: "joueur" as const,
      },
      ...remotePlayers.map((player) => ({
        id: player.id,
        label: player.name,
        position: player.position,
        kind: "équipe" as const,
      })),
      // Les Mewas non ramassés sont sur le GPS : c'est la chasse au trésor.
      ...wildMewas(hud.mewas).map((mewa) => ({
        id: `mewa-${mewa.id}`,
        label: "Mewa",
        position: [mewa.x, 1, mewa.z] as [number, number, number],
        kind: "mewa" as const,
      })),
    ];
  }, [hud, remotePlayers]);

  // ------------------------------------------------------------------
  // Rendu
  // ------------------------------------------------------------------
  return (
    <section id="jeu" className="relative">
      <div className="relative overflow-hidden rounded-[1.75rem] border border-mist/12 bg-canopy-950 shadow-jungle">
        <div className="relative aspect-[16/10] w-full md:aspect-[16/9]">
          <Scene
            onReady={(controller) => {
              sceneRef.current = controller;
              controller.setWeapon(huntRef.current.arsenal.current);
              controller.setAnimals(animalsRef.current);
              controller.setMewas(stateRef.current.mewas);
              controller.setView(view);
            }}
            onError={(message) =>
              pushToast({ title: "Rendu 3D limité", detail: message, tone: "alerte" })
            }
            quality="auto"
          />

          {/* HUD en jeu */}
          {phase === "jeu" && hud && (
            <>
              <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-start justify-between gap-3 p-3 md:p-5">
                <div className="space-y-2">
                  <div className="pointer-events-auto panel-tight px-3 py-2">
                    <p className="eyebrow">{clock.phase} · jour {clock.day}</p>
                    <p className="display text-lg leading-tight text-parchment">{zone?.name}</p>
                    <p className="text-[0.65rem] text-mist/60">
                      {String(Math.floor(clock.hour)).padStart(2, "0")}:
                      {String(Math.floor((clock.hour % 1) * 60)).padStart(2, "0")} ·{" "}
                      {weatherLabel(hud.weather.current)} · {Math.round(hud.vitals.temperature)} °C
                    </p>
                  </div>
                  <Vitals vitals={hud.vitals} label={(key) => t(key)} />
                  <LevelBar xp={hud.xp} level={hud.level} label={(key) => t(key)} />
                  <FieldKit
                    className="pointer-events-auto"
                    state={hud}
                    label={(key) => t(key)}
                    onBuild={shelterUp}
                    onSleep={sleep}
                    onGoggles={goggles}
                    nearShelter={Boolean(nearestShelter(hud, 3.5))}
                  />
                  <Objectives state={hud} label={(key) => t(key)} />
                </div>

                <div className="flex flex-col items-end gap-2">
                  <div className="panel-tight px-3 py-2 text-right">
                    <p className="eyebrow">Carnet</p>
                    <p className="text-sm font-semibold">
                      {hud.observedSpecies.length} espèce{hud.observedSpecies.length > 1 ? "s" : ""}
                    </p>
                    <p className="text-[0.65rem] text-mist/60">
                      {hud.score} pts · niveau {hud.level}
                    </p>
                  </div>
                  <div className="panel-tight px-3 py-2 text-right">
                    <p className="eyebrow">{t("game.mewas")}</p>
                    <p className="text-sm font-semibold tabular-nums text-sky-300">
                      🐾 {mewasFound(hud.mewas)}/{MEWA_COUNT}
                    </p>
                    <p className="text-[0.65rem] text-mist/60">
                      🧵 {hud.threads} · {hud.style} {t("game.style")}
                    </p>
                  </div>
                  <div className="panel-tight px-3 py-2 text-right">
                    <p className="eyebrow">Tableau de chasse</p>
                    <p className="text-sm font-semibold text-parchment">
                      {Math.round(hud.hunt.meat)} kg de viande
                    </p>
                    <p className="text-[0.65rem] text-mist/60">
                      {totalKills} bête{totalKills > 1 ? "s" : ""} · {hud.hunt.shots} coups tirés
                    </p>
                  </div>
                  <CompassBar heading={hud.player.heading} waypoints={waypoints} className="w-56 md:w-72" />
                </div>
              </div>

              {/* Barre d'armes */}
              <div className="absolute left-1/2 top-3 z-10 -translate-x-1/2 md:top-4">
                <div className="flex items-center gap-1 rounded-full border border-mist/15 bg-canopy-950/70 px-1.5 py-1 backdrop-blur">
                  {WEAPONS.map((entry, index) => {
                    const active = entry.id === arsenal.current;
                    const ammo = weaponStateOf(arsenal, entry.id);
                    return (
                      <button
                        key={entry.id}
                        type="button"
                        onClick={() => equip(entry.id)}
                        className={`flex items-center gap-1 rounded-full px-2 py-1 text-[0.6rem] transition ${
                          active
                            ? "bg-amber-glow/25 text-parchment"
                            : "text-mist/60 hover:text-parchment"
                        }`}
                        aria-pressed={active}
                      >
                        <span className="opacity-45">{index + 1}</span>
                        <span className="hidden sm:inline">{entry.short}</span>
                        <span className="sm:hidden">{entry.short.slice(0, 3)}</span>
                        {entry.kind === "feu" && (
                          <span className="opacity-50">{ammo.loaded}</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Réticule, cible et munitions */}
              <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center">
                <div className="relative h-7 w-7">
                  <span className="absolute left-1/2 top-1/2 h-[3px] w-[3px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-parchment/85" />
                  <span className="absolute left-1/2 top-0 h-2 w-px -translate-x-1/2 bg-parchment/55" />
                  <span className="absolute bottom-0 left-1/2 h-2 w-px -translate-x-1/2 bg-parchment/55" />
                  <span className="absolute left-0 top-1/2 h-px w-2 -translate-y-1/2 bg-parchment/55" />
                  <span className="absolute right-0 top-1/2 h-px w-2 -translate-y-1/2 bg-parchment/55" />
                  {hitMarker !== "none" && (
                    <span
                      className={`absolute inset-0 grid place-items-center text-lg leading-none ${
                        hitMarker === "kill" ? "text-laterite-400" : "text-parchment"
                      }`}
                    >
                      ✕
                    </span>
                  )}
                </div>
              </div>

              <div className="pointer-events-none absolute inset-x-0 top-[57%] z-10 flex flex-col items-center gap-1">
                {targetLabel && (
                  <p className="rounded-full bg-canopy-950/60 px-2.5 py-0.5 text-[0.65rem] text-parchment/85 backdrop-blur">
                    {targetLabel}
                  </p>
                )}
                <p className="font-mono text-[0.68rem] tracking-wide text-parchment/75">
                  {heldWeapon.kind === "feu"
                    ? `${heldAmmo.loaded} / ${heldAmmo.reserve}`
                    : "lame"}
                </p>
                <div className="flex items-center gap-2 text-[0.6rem] text-parchment/70">
                  {hud.blocking && (
                    <span className="rounded-full bg-sky-400/20 px-2 py-0.5">🛡 {t("game.blocking")}</span>
                  )}
                  {hud.goggles && (
                    <span className="rounded-full bg-sky-300/20 px-2 py-0.5 text-sky-200">🥽 {t("game.goggles")}</span>
                  )}
                  {hud.height > 0.05 && (
                    <span className="rounded-full bg-canopy-950/60 px-2 py-0.5 tabular-nums">
                      {hud.height.toFixed(1)} m
                    </span>
                  )}
                </div>
              </div>

              <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex flex-col items-center gap-2 p-3 md:p-4">
                {carcassNear && (
                  <button
                    type="button"
                    onClick={skinCarcass}
                    className="pointer-events-auto flex items-center gap-2 rounded-full border border-amber-glow/50 bg-canopy-950/80 px-3 py-1.5 text-xs text-parchment backdrop-blur"
                  >
                    🔪 {t("game.skin")} · {carcassNear}
                    <kbd className="rounded bg-canopy-700 px-1.5 py-0.5 font-sans">E</kbd>
                  </button>
                )}
                {showHints && (
                  <div className="pointer-events-none flex flex-wrap items-center justify-center gap-1.5 rounded-full bg-canopy-950/70 px-3 py-1.5 text-[0.62rem] text-mist/75 backdrop-blur">
                    <kbd className="rounded bg-canopy-700 px-1.5 py-0.5 font-sans text-parchment">ZQSD</kbd>
                    <span>{t("game.hints.walk")}</span>
                    <span className="text-mist/30">·</span>
                    <kbd className="rounded bg-canopy-700 px-1.5 py-0.5 font-sans text-parchment">Maj</kbd>
                    <span>{t("game.hints.run")}</span>
                    <span className="text-mist/30">·</span>
                    <kbd className="rounded bg-canopy-700 px-1.5 py-0.5 font-sans text-parchment">C</kbd>
                    <span>{t("game.hints.crouch")}</span>
                    <span className="text-mist/30">·</span>
                    <kbd className="rounded bg-canopy-700 px-1.5 py-0.5 font-sans text-parchment">Espace</kbd>
                    <span>{t("game.hints.jump")}</span>
                    <span className="text-mist/30">·</span>
                    <kbd className="rounded bg-canopy-700 px-1.5 py-0.5 font-sans text-parchment">Ctrl</kbd>
                    <span>{t("game.hints.block")}</span>
                    <span className="text-mist/30">·</span>
                    <kbd className="rounded bg-canopy-700 px-1.5 py-0.5 font-sans text-parchment">B</kbd>
                    <span>{t("game.hints.shelter")}</span>
                    <span className="text-mist/30">·</span>
                    <kbd className="rounded bg-canopy-700 px-1.5 py-0.5 font-sans text-parchment">N</kbd>
                    <span>{t("game.hints.sleep")}</span>
                    <span className="text-mist/30">·</span>
                    <kbd className="rounded bg-canopy-700 px-1.5 py-0.5 font-sans text-parchment">I</kbd>
                    <span>{t("game.hints.goggles")}</span>
                    <span className="text-mist/30">·</span>
                    <span>{t("game.hints.aim")}</span>
                    <span className="text-mist/30">·</span>
                    <kbd className="rounded bg-canopy-700 px-1.5 py-0.5 font-sans text-parchment">clic</kbd>
                    <span>{t("game.hints.fire")}</span>
                    <span className="text-mist/30">·</span>
                    <kbd className="rounded bg-canopy-700 px-1.5 py-0.5 font-sans text-parchment">1-6</kbd>
                    <span>{t("game.hints.weapons")}</span>
                    <span className="text-mist/30">·</span>
                    <kbd className="rounded bg-canopy-700 px-1.5 py-0.5 font-sans text-parchment">R</kbd>
                    <span>{t("game.hints.reload")}</span>
                    <span className="text-mist/30">·</span>
                    <kbd className="rounded bg-canopy-700 px-1.5 py-0.5 font-sans text-parchment">F</kbd>
                    <span>{t("game.hints.eat")}</span>
                    <span className="text-mist/30">·</span>
                    <kbd className="rounded bg-canopy-700 px-1.5 py-0.5 font-sans text-parchment">E</kbd>
                    <span>{t("game.hints.drink")}</span>
                    <span className="text-mist/30">·</span>
                    <kbd className="rounded bg-canopy-700 px-1.5 py-0.5 font-sans text-parchment">G</kbd>
                    <span>{t("game.hints.grill")}</span>
                    <span className="text-mist/30">·</span>
                    <kbd className="rounded bg-canopy-700 px-1.5 py-0.5 font-sans text-parchment">⇧O</kbd>
                    <span>{t("game.hints.dress")}</span>
                    <span className="text-mist/30">·</span>
                    <kbd className="rounded bg-canopy-700 px-1.5 py-0.5 font-sans text-parchment">V</kbd>
                    <span>{t("game.hints.view")}</span>
                    <span className="text-mist/30">·</span>
                    <kbd className="rounded bg-canopy-700 px-1.5 py-0.5 font-sans text-parchment">Échap</kbd>
                    <span>{t("game.hints.pause")}</span>
                  </div>
                )}
                {ambient && (
                  <p className="max-w-xl rounded-full bg-canopy-950/55 px-4 py-1.5 text-center text-[0.7rem] italic text-mist/70 backdrop-blur">
                    {ambient}
                  </p>
                )}
                <div className="pointer-events-auto flex flex-wrap items-center justify-center gap-2">
                  {nearWater && (
                    <button type="button" className="btn btn-primary !px-3 !py-1.5 !text-xs" onClick={drink}>
                      💧 {t("game.drink")} <kbd className="opacity-60">E</kbd>
                    </button>
                  )}
                  {hud.fruits > 0 && (
                    <button type="button" className="btn btn-ghost !px-3 !py-1.5 !text-xs" onClick={eat}>
                      🍈 {t("game.eat")} · {hud.fruits} <kbd className="opacity-50">F</kbd>
                    </button>
                  )}
                  {atCamp(hud) && hud.hunt.meat >= 1 && (
                    <button type="button" className="btn btn-ghost !px-3 !py-1.5 !text-xs" onClick={grill}>
                      🔥 {t("game.grill")} <kbd className="opacity-50">G</kbd>
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn btn-ghost !px-3 !py-1.5 !text-xs"
                    onClick={() => {
                      document.exitPointerLock?.();
                      setShowDressing(true);
                    }}
                  >
                    🪡 {t("game.dress")} · 🧵 {hud.threads}{" "}
                    <kbd className="opacity-50">⇧O</kbd>
                  </button>
                  <button type="button" className="btn btn-ghost !px-3 !py-1.5 !text-xs" onClick={() => setShowMap((v) => !v)}>
                    🗺️ {t("game.map")} <kbd className="opacity-50">M</kbd>
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost !px-3 !py-1.5 !text-xs"
                    onClick={() => setView((v) => (v === "premier" ? "troisieme" : "premier"))}
                    aria-pressed={view === "troisieme"}
                  >
                    {view === "troisieme" ? `🎥 ${t("game.viewShoulder")}` : `👁️ ${t("game.viewFirst")}`}{" "}
                    <kbd className="opacity-50">V</kbd>
                  </button>
                  <button type="button" className="btn btn-ghost !px-3 !py-1.5 !text-xs" onClick={() => void saveGame()}>
                    💾 {t("game.save")}
                  </button>
                  <button type="button" className="btn btn-ghost !px-3 !py-1.5 !text-xs" onClick={() => setPhase("pause")}>
                    ⏸️ {t("game.pause")}
                  </button>
                  <button
                    type="button"
                    className={`btn !px-3 !py-1.5 !text-xs ${voiceOn ? "btn-primary" : "btn-ghost"}`}
                    onClick={() => setVoiceOn((v) => !v)}
                    aria-pressed={voiceOn}
                  >
                    🔊 {t("game.voice")}
                  </button>
                </div>
              </div>

              <TouchControls
                onMove={onTouchMove}
                onAction={(action) => {
                  if (action === "carte") setShowMap((v) => !v);
                  if (action === "courir") inputRef.current.run = !inputRef.current.run;
                  if (action === "interagir") {
                    const [x, , z] = stateRef.current.player.position;
                    if (waterWithin(x, z)) drink();
                    else eat();
                  }
                }}
              />

              {/* Boutons de tir (tactile) */}
              <div className="absolute bottom-44 right-4 z-20 flex flex-col items-end gap-2 md:hidden">
                <button
                  type="button"
                  onPointerDown={(event) => {
                    event.preventDefault();
                    inputRef.current.jump = true;
                  }}
                  onPointerUp={() => {
                    inputRef.current.jump = false;
                  }}
                  className="grid h-14 w-14 place-items-center rounded-full border border-moss-300/50 bg-canopy-900/70 text-lg backdrop-blur active:scale-95"
                  aria-label={t("game.hints.jump")}
                >
                  ⤒
                </button>
                <button
                  type="button"
                  onPointerDown={(event) => {
                    event.preventDefault();
                    inputRef.current.block = true;
                    sceneRef.current?.setAiming(true);
                  }}
                  onPointerUp={() => {
                    inputRef.current.block = false;
                    sceneRef.current?.setAiming(false);
                  }}
                  onPointerLeave={() => {
                    inputRef.current.block = false;
                    sceneRef.current?.setAiming(false);
                  }}
                  className="grid h-11 w-11 place-items-center rounded-full border border-sky-300/40 bg-canopy-900/70 text-sm backdrop-blur active:scale-95"
                  aria-label={t("game.hints.block")}
                >
                  🛡
                </button>
                <button
                  type="button"
                  onClick={reload}
                  className="grid h-11 w-11 place-items-center rounded-full border border-mist/25 bg-canopy-900/70 text-sm backdrop-blur active:scale-95"
                  aria-label={t("game.reload")}
                >
                  🔄
                </button>
                <button
                  type="button"
                  onPointerDown={(event) => {
                    event.preventDefault();
                    firingRef.current = true;
                    fire();
                  }}
                  onPointerUp={() => {
                    firingRef.current = false;
                  }}
                  onPointerLeave={() => {
                    firingRef.current = false;
                  }}
                  className="grid h-20 w-20 place-items-center rounded-full border border-laterite-400/60 bg-laterite-500/30 text-xs font-semibold uppercase tracking-wider text-parchment backdrop-blur active:scale-95"
                  aria-label={t("game.fire")}
                >
                  {t("game.fire")}
                </button>
              </div>

              {showMap && hud && (
                <div className="absolute right-3 top-32 z-20 w-64 md:right-5 md:w-80">
                  <GpsMap
                    position={hud.player.position}
                    heading={hud.player.heading}
                    // Les zones ouvertes par l'expédition s'affichent sur la
                    // carte avant même qu'on y soit allé : c'est la récompense.
                    discovered={[...hud.visitedZones, ...hud.progress.unlocks]}
                    markers={markers}
                    onClose={() => setShowMap(false)}
                  />
                </div>
              )}
            </>
          )}

          {/* Vestiaire (⇧O) : les tenues tissées avec les Fils de Rêve */}
          {showDressing && hud && (
            <div className="absolute inset-0 z-30 overflow-y-auto bg-canopy-950/92 p-3 backdrop-blur md:p-6">
              <div className="mx-auto max-w-3xl space-y-3">
                <div className="flex items-center justify-between">
                  <p className="eyebrow">
                    {t("game.dressOpen")} · 🧵 {hud.threads}
                  </p>
                  <button
                    type="button"
                    className="btn btn-ghost !px-3 !py-1.5 !text-xs"
                    onClick={() => setShowDressing(false)}
                  >
                    ✕ {t("game.pause")}
                  </button>
                </div>
                <Dressing
                  level={hud.level}
                  threads={hud.threads}
                  woven={hud.woven}
                  characterId={hud.player.characterId}
                  outfitId={hud.player.outfit}
                  onChange={wear}
                  onWeave={weave}
                />
              </div>
            </div>
          )}

          {/* Fin d'expédition : la mort, la cause, le score au classement */}
          {phase === "fin" && hud?.death && (
            <div className="absolute inset-0 z-40 overflow-y-auto bg-canopy-950/94 p-3 backdrop-blur md:p-6">
              <div className="mx-auto w-full max-w-2xl space-y-4 py-6">
                <div className="panel space-y-3 p-6">
                  <p className="eyebrow">{t("game.deathTitle")}</p>
                  <h3 className="display text-3xl leading-tight text-laterite-400">
                    {t(
                      (hud.death.cause === "soif"
                        ? "game.deathSoif"
                        : hud.death.cause === "faim"
                          ? "game.deathFaim"
                          : "game.deathBlessure") as DictionaryKey,
                    )}
                  </h3>
                  <p className="text-sm leading-relaxed text-mist/70">
                    {t(
                      (hud.death.cause === "soif"
                        ? "game.deathSoifNote"
                        : hud.death.cause === "faim"
                          ? "game.deathFaimNote"
                          : "game.deathBlessureNote") as DictionaryKey,
                    )}
                  </p>

                  <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
                    {[
                      { label: t("game.deathScore"), value: `${hud.death.score}` },
                      { label: t("game.level"), value: `${hud.level}` },
                      { label: t("game.deathRank"), value: boardRank ? `#${boardRank}` : "—" },
                      { label: t("game.mewas"), value: `${mewasFound(hud.mewas)}/${MEWA_COUNT}` },
                      {
                        label: t("game.survived"),
                        value: `${Math.floor(hud.elapsed / 60)} min ${Math.floor(hud.elapsed % 60)} ${t("game.seconds")}`,
                      },
                    ].map((stat) => (
                      <div
                        key={stat.label}
                        className="rounded-xl border border-mist/12 bg-canopy-900/60 px-3 py-2"
                      >
                        <p className="text-[0.55rem] uppercase tracking-wider text-mist/50">
                          {stat.label}
                        </p>
                        <p className="text-sm font-semibold tabular-nums text-parchment">
                          {stat.value}
                        </p>
                      </div>
                    ))}
                  </div>

                  <p className="text-[0.7rem] text-mist/60">
                    ⭐ {Math.round(hud.xp)} XP
                    {hud.xp >= SURVIVAL_PRIZE_XP
                      ? ` · 🏆 ${t("game.prizeWon")}`
                      : ` · 🏆 ${t("game.survivalPrizeAt")}`}
                  </p>

                  <div className="flex flex-wrap items-center gap-2">
                    <button type="button" className="btn btn-primary" onClick={restart}>
                      ▶ {t("game.deathRestart")}
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={() => {
                        setPhase("accueil");
                        setShowDressing(false);
                      }}
                    >
                      ⌂ {t("game.pause")}
                    </button>
                    {boardState === "envoi" && (
                      <span className="text-[0.65rem] text-mist/50">…</span>
                    )}
                    {boardState === "hors-ligne" && (
                      <span className="text-[0.65rem] text-laterite-400">
                        Classement indisponible
                      </span>
                    )}
                  </div>
                </div>

                <div className="panel space-y-2 p-4">
                  <p className="eyebrow">{t("game.leaderboard")}</p>
                  {board.length === 0 ? (
                    <p className="text-xs text-mist/55">{t("game.leaderboardEmpty")}</p>
                  ) : (
                    <ol className="space-y-1">
                      {board.map((row, index) => (
                        <li
                          key={row.id}
                          className="flex items-baseline justify-between gap-2 rounded-lg px-2 py-1 text-xs odd:bg-canopy-900/40"
                        >
                          <span className="w-6 shrink-0 text-mist/45 tabular-nums">
                            {index + 1}
                          </span>
                          <span className="min-w-0 flex-1 truncate text-parchment/85">
                            {row.name}
                            {row.score === hud.death?.score && index + 1 === boardRank && (
                              <span className="ml-1 text-[0.6rem] text-sky-300">
                                ({t("game.leaderboardYou")})
                              </span>
                            )}
                          </span>
                          <span className="shrink-0 text-mist/50">
                            🐾 {row.mewas} · {Math.floor(row.seconds / 60)} min
                          </span>
                          <span className="w-14 shrink-0 text-right font-semibold tabular-nums text-amber-glow">
                            {row.score}
                          </span>
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Accueil */}
          {phase === "accueil" && (
            <div className="absolute inset-0 z-20 flex flex-col justify-end bg-gradient-to-t from-canopy-950 via-canopy-950/70 to-transparent p-5 md:p-8">
              <div className="max-w-2xl space-y-4">
                {/* Le nom du jeu, en clair. C'est la première chose qu'on
                    doit lire en arrivant : le titre, pas un sous-titre. */}
                <div className="space-y-2">
                  <p className="text-[0.6rem] uppercase tracking-[0.42em] text-moss-300">
                    {t("hero.kicker")}
                  </p>
                  <h2 className="display text-5xl leading-[0.9] tracking-[0.16em] text-parchment md:text-7xl">
                    {t("hero.title")}
                  </h2>
                  <span className="block h-px w-28 bg-gradient-to-r from-amber-glow via-laterite-400/60 to-transparent" />
                </div>
                <p className="eyebrow">{t("hero.place")}</p>
                <h3 className="display text-xl text-parchment/90 md:text-2xl">
                  {t("game.title")}
                </h3>
                <p className="max-w-xl text-sm text-mist/75">
                  Suivez la faune dans la futaie de l&apos;Ogooué-Ivindo : épaulez une arme,
                  abattez, dépecez. La viande se rapporte au camp ; le carnet garde la
                  trace du reste.
                </p>

                <div className="flex flex-wrap gap-2">
                  {CHARACTERS.map((candidate) => (
                    <button
                      key={candidate.id}
                      type="button"
                      onClick={() => setCharacterId(candidate.id)}
                      className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs transition ${
                        characterId === candidate.id
                          ? "border-amber-glow bg-amber-glow/15 text-parchment"
                          : "border-mist/20 text-mist/70 hover:border-moss-300"
                      }`}
                      aria-pressed={characterId === candidate.id}
                    >
                      <span>{candidate.id === "michelle" || candidate.id === "chercheuse" ? "🧑🏾‍🌾" : "🧑🏾‍🚀"}</span>
                      {candidate.name}
                      <span className="text-[0.6rem] text-mist/50">{candidate.role}</span>
                    </button>
                  ))}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button type="button" className="btn btn-primary" onClick={() => void startGame("nouveau")}>
                    ▶ {t("game.start")}
                  </button>
                  <button type="button" className="btn btn-ghost" onClick={() => void startGame("reprendre")}>
                    ⟲ {t("game.resume")}
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => {
                      sceneRef.current?.requestLook();
                      pushToast({ title: "Caméra libre", detail: "Cliquez pour capturer la souris, Échap pour libérer.", tone: "info" });
                    }}
                  >
                    🖱️ {t("game.look")}
                  </button>
                </div>

                <p className="text-[0.7rem] text-mist/45">
                  {t("game.controls")} · {t("game.mobile")}
                </p>
              </div>
            </div>
          )}

          {/* Chargement */}
          {phase === "chargement" && <LoadingScreen progress={loadingProgress} done={loadingProgress >= 100} />}

          {/* Pause */}
          {phase === "pause" && (
            <div className="absolute inset-0 z-30 grid place-items-center bg-canopy-950/85 p-5 backdrop-blur">
              <div className="panel w-full max-w-lg space-y-4 p-6">
                <p className="eyebrow">Pause</p>
                <h3 className="display text-2xl">Reprendre souffle</h3>
                <div className="grid gap-2 text-sm">
                  <button type="button" className="btn btn-primary w-full" onClick={() => setPhase("jeu")}>
                    ▶ Reprendre l&apos;expédition
                  </button>
                  <button type="button" className="btn btn-ghost w-full" onClick={() => void saveGame()}>
                    💾 {t("game.save")} maintenant
                  </button>
                  <button type="button" className="btn btn-ghost w-full" onClick={() => setPhase("accueil")}>
                    ⌂ Retour au menu
                  </button>
                </div>
                <div className="rounded-xl border border-mist/10 bg-canopy-900/50 p-3 text-xs text-mist/70">
                  <p className="mb-1 font-semibold text-parchment">Carnet de terrain</p>
                  <p>
                    {hud?.observedSpecies.length ?? 0} espèce(s) observée(s) ·{" "}
                    {faunaScore(hud?.observedSpecies ?? [])} points ·{" "}
                    {hud?.visitedZones.length ?? 0} zone(s) explorée(s).
                  </p>
                </div>
                {saveStatus && <p className="text-xs text-amber-glow">{saveStatus}</p>}
              </div>
            </div>
          )}

          {/* Toasts */}
          <div className="pointer-events-none absolute right-3 top-3 z-40 flex w-64 flex-col gap-2">
            {toasts.map((toast) => (
              <div
                key={toast.id}
                className={`animate-float-up rounded-xl border px-3 py-2 text-xs backdrop-blur ${
                  toast.tone === "succes"
                    ? "border-moss-300/40 bg-canopy-800/85"
                    : toast.tone === "alerte"
                      ? "border-laterite-400/50 bg-laterite-500/20"
                      : "border-mist/15 bg-canopy-900/85"
                }`}
              >
                <p className="font-semibold text-parchment">{toast.title}</p>
                {toast.detail && <p className="text-mist/65">{toast.detail}</p>}
              </div>
            ))}
          </div>
        </div>

        {/* Barre multijoueur */}
        <div className="flex flex-col gap-3 border-t border-mist/10 bg-canopy-900/60 p-3 md:flex-row md:items-center md:justify-between md:px-5">
          <div className="flex items-center gap-2 text-xs text-mist/70">
            <span className={`h-2 w-2 rounded-full ${room ? "bg-moss-300" : "bg-mist/30"}`} />
            {room ? (
              <span>
                {t("game.room")} <strong className="text-parchment">{room.code}</strong> ·{" "}
                {remotePlayers.length + 1}/{room.maxPlayers} {t("game.explorers")}
              </span>
            ) : (
              <span>{t("game.soloNote")}</span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {!room ? (
              <>
                <input
                  value={joinCode}
                  onChange={(event) => setJoinCode(event.target.value.toUpperCase().slice(0, 6))}
                  placeholder="CODE"
                  className="w-24 rounded-full border border-mist/20 bg-canopy-950/60 px-3 py-1.5 text-center text-xs uppercase tracking-widest text-parchment placeholder:text-mist/30 focus:border-moss-300 focus:outline-none"
                  aria-label="Code du salon"
                />
                <button
                  type="button"
                  className="btn btn-ghost !px-3 !py-1.5 !text-xs"
                  disabled={joining || !joinCode}
                  onClick={() => void joinRoom(joinCode)}
                >
                  Rejoindre
                </button>
                <button
                  type="button"
                  className="btn btn-primary !px-3 !py-1.5 !text-xs"
                  disabled={joining}
                  onClick={() => void createRoom()}
                >
                  + Créer un salon
                </button>
              </>
            ) : (
              <button type="button" className="btn btn-ghost !px-3 !py-1.5 !text-xs" onClick={() => void leaveRoom()}>
                Quitter le salon
              </button>
            )}
          </div>
        </div>

        {netError && (
          <p className="border-t border-laterite-400/30 bg-laterite-500/10 px-5 py-2 text-xs text-laterite-400">
            Multijoueur : {netError}
          </p>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-mist/55">
        <span className="chip">{character.role}</span>
        <span className="chip">🌡️ {formatVitals(hud)}</span>
        <span className="chip">🎒 {hud?.gadgets.length ?? 0} gadgets</span>
        {PLANS[1] && <span className="chip">💳 Multijoueur dès {formatPrice(PLANS[1].amountCents, PLANS[1].currency)}</span>}
      </div>
    </section>
  );
}

function formatVitals(hud: GameState | null): string {
  if (!hud) return "—";
  return `${Math.round(hud.vitals.temperature)} °C · ${Math.round(hud.vitals.wetness * 100)} % humide`;
}

/**
 * Objectifs de l'expédition en cours.
 *
 * Un jeu sans but visible est une promenade. Ce panneau dit toujours où l'on en
 * est : l'étape, ce qu'elle demande, et ce qui reste. Les libellés viennent du
 * dictionnaire, donc la liste change de langue avec le reste de l'interface.
 */
function Objectives({ state, label }: { state: GameState; label: (key: DictionaryKey) => string }) {
  const status = levelStatus(state);
  const index = state.progress.levelIndex;

  if (!status.level) {
    return (
      <div className="panel-tight max-w-[16rem] px-3 py-2">
        <p className="eyebrow">{label("game.expedition")}</p>
        <p className="text-sm font-semibold text-parchment">{label("game.expeditionDone")}</p>
        <p className="text-[0.65rem] text-mist/60">
          {state.progress.completed.length} / {LEVELS.length}
        </p>
      </div>
    );
  }

  return (
    <div className="panel-tight max-w-[16rem] px-3 py-2">
      <p className="eyebrow">
        {label("game.expedition")} · {index + 1}/{LEVELS.length}
      </p>
      <p className="display text-sm leading-tight text-parchment">
        {label(status.level.title as DictionaryKey)}
      </p>
      <p className="mb-1 text-[0.62rem] leading-snug text-mist/50">
        {label(status.level.brief as DictionaryKey)}
      </p>
      <ul className="space-y-0.5">
        {status.objectives.map((entry) => (
          <li
            key={entry.objective.id}
            className={`flex items-baseline gap-1.5 text-[0.68rem] ${
              entry.done ? "text-parchment" : "text-mist/70"
            }`}
          >
            <span className={entry.done ? "text-amber-glow" : "text-mist/40"}>{entry.done ? "✓" : "·"}</span>
            <span className="flex-1 leading-snug">{label(entry.label as DictionaryKey)}</span>
            <span className="tabular-nums text-[0.62rem] text-mist/50">
              {entry.current}/{entry.target}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Les quatre jauges de survie.
 *
 * Elles sont toujours à l'écran : c'est le mode de jeu, pas un panneau
 * optionnel. Sous 20 %, la barre clignote doucement — assez pour alerter,
 * jamais assez pour distraire de la forêt.
 */
function Vitals({
  vitals,
  label,
}: {
  vitals: GameState["vitals"];
  label: (key: DictionaryKey) => string;
}) {
  const bars = [
    { icon: "❤", key: "game.health", value: vitals.health, colour: "bg-laterite-400" },
    { icon: "🍈", key: "game.hunger", value: vitals.hunger, colour: "bg-amber-glow" },
    { icon: "💧", key: "game.thirst", value: vitals.hydration, colour: "bg-sky-400" },
    { icon: "⚡", key: "game.stamina", value: vitals.stamina, colour: "bg-moss-300" },
  ] as const;
  return (
    <div className="panel-tight w-44 space-y-1.5 px-3 py-2">
      {bars.map((bar) => {
        const value = Math.max(0, Math.min(100, bar.value));
        const low = value < 20;
        return (
          <div key={bar.key}>
            <div className="flex justify-between text-[0.58rem] uppercase tracking-wider text-mist/55">
              <span>
                <span aria-hidden className="mr-1">
                  {bar.icon}
                </span>
                {label(bar.key as DictionaryKey)}
              </span>
              <span className={`tabular-nums ${low ? "text-laterite-400" : ""}`}>
                {Math.round(value)}
              </span>
            </div>
            <div className="mt-0.5 h-1 overflow-hidden rounded-full bg-canopy-700">
              <div
                className={`h-full rounded-full ${bar.colour} transition-[width] duration-300 ${
                  low ? "animate-pulse" : ""
                }`}
                style={{ width: `${value}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * La barre de niveau.
 *
 * Cinquante niveaux, 2 500 XP pour le Prix de Survie : c'est la colonne
 * vertébrale du jeu. Elle reste sous les jauges de survie, parce que survivre
 * et progresser sont la même boucle — on ne monte pas en regardant la forêt,
 * on monte en la traversant.
 */
function LevelBar({
  xp,
  level,
  label,
}: {
  xp: number;
  level: number;
  label: (key: DictionaryKey) => string;
}) {
  const progress = levelProgress(xp);
  const prize = progress.prize;
  return (
    <div className="panel-tight w-44 space-y-1 px-3 py-2">
      <div className="flex items-baseline justify-between text-[0.58rem] uppercase tracking-wider text-mist/55">
        <span>
          {label("game.level")} <span className="tabular-nums text-parchment">{level}</span>
        </span>
        <span className="tabular-nums">{Math.round(xp)} XP</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-canopy-700">
        <div
          className={`h-full rounded-full ${prize ? "bg-sky-300" : "bg-moss-300"} transition-[width] duration-500`}
          style={{ width: `${Math.round(progress.ratio * 100)}%` }}
        />
      </div>
      <p className="text-[0.55rem] leading-tight text-mist/45">
        {prize
          ? `${label("game.prizeWon")} · ${label("game.survivalPrize")}`
          : `${progress.span - progress.into} XP ${label("game.nextLevel")} · ${label("game.survivalPrize")}`}
      </p>
    </div>
  );
}

/**
 * Ce que l'on porte sur le dos.
 *
 * Trois chiffres qui changent une partie : le bois (un abri coûte cinq fagots),
 * les fruits, et l'état de la garde. Ils n'ont pas besoin d'un panneau plein
 * écran — un regard suffit.
 */
function FieldKit({
  state,
  label,
  onBuild,
  onSleep,
  onGoggles,
  nearShelter,
  className = "",
}: {
  state: GameState;
  label: (key: DictionaryKey) => string;
  onBuild: () => void;
  onSleep: () => void;
  onGoggles: () => void;
  nearShelter: boolean;
  className?: string;
}) {
  return (
    <div className={`panel-tight w-44 space-y-1 px-3 py-2 text-[0.62rem] text-mist/70 ${className}`}>
      <div className="flex items-center justify-between">
        <span>🪵 {state.wood}</span>
        <span>🍈 {state.fruits}</span>
        <span>🏠 {state.shelters.length}</span>
      </div>
      <div className="flex gap-1">
        <button
          type="button"
          onClick={onBuild}
          className={`flex-1 rounded-full border px-1.5 py-1 text-[0.58rem] transition ${
            state.wood >= SHELTER_WOOD
              ? "border-amber-glow/50 text-parchment hover:bg-amber-glow/10"
              : "border-mist/15 text-mist/40"
          }`}
        >
          🏠 {label("game.shelterBuild")} <kbd className="opacity-50">B</kbd>
        </button>
        <button
          type="button"
          onClick={onGoggles}
          className={`rounded-full border px-1.5 py-1 text-[0.58rem] transition ${
            state.goggles ? "border-sky-300/70 text-sky-200" : "border-mist/15 text-mist/50"
          }`}
          aria-pressed={state.goggles}
          title={label("game.goggles")}
        >
          🥽 <kbd className="opacity-50">I</kbd>
        </button>
      </div>
      {nearShelter && (
        <button
          type="button"
          onClick={onSleep}
          className="w-full rounded-full border border-moss-300/50 px-1.5 py-1 text-[0.58rem] text-parchment transition hover:bg-moss-300/10"
        >
          🌙 {label("game.sleep")} <kbd className="opacity-50">N</kbd>
        </button>
      )}
    </div>
  );
}
