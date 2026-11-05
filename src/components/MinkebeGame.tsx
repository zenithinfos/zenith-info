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
  const { t, locale } = useI18n();
  const [phase, setPhase] = useState<Phase>("accueil");
  const [characterId, setCharacterId] = useState("mbadinga");
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
  const [showControls, setShowControls] = useState(false);
  // Miroir synchrone de `showControls` : le gestionnaire clavier est monté une
  // seule fois et ne voit pas l'état React. Sans ce ref, Échap mettrait le jeu
  // en pause au lieu de refermer l'aide.
  const controlsOpenRef = useRef(false);
  useEffect(() => {
    controlsOpenRef.current = showControls;
  }, [showControls]);
  const openControls = (open: boolean) => {
    controlsOpenRef.current = open;
    // La souris est capturée pendant le jeu : sans ceci, impossible d'aller
    // cliquer sur la croix du panneau qu'on vient d'ouvrir.
    if (open) document.exitPointerLock?.();
    setShowControls(open);
  };
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
      if (voiceOn && voiceAvailable()) {
        const intro = linesFor("intro")[0];
        if (intro) speakLine(intro);
      }
    }, 1500);

    return () => {
      window.clearInterval(timer);
      window.clearTimeout(finish);
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
          name: getCharacter(state.player.characterId).name,
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

      // Le cap de la caméra commande le déplacement : « avant » veut dire
      // « là où je regarde ». On le relit à chaque image, sinon la caméra et
      // les touches se désynchronisent dès le premier mouvement de souris.
      inputRef.current.cameraYaw = sceneRef.current?.getYaw() ?? stateRef.current.player.heading;
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
      // H : le bloc de commandes. Une seule touche, un seul endroit.
      if (event.code === "KeyH") openControls(!controlsOpenRef.current);
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
        // Échap ferme d'abord l'aide, ensuite seulement il met en pause : une
        // touche qui fait deux choses d'un coup surprend toujours.
        if (controlsOpenRef.current) {
          openControls(false);
        } else {
          setPhase((current) => (current === "jeu" ? "pause" : current === "pause" ? "jeu" : current));
        }
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
  const character = getCharacter(characterId);
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
                <div className="space-y-1.5">
                  {/* Une seule carte : lieu, heure, jauges, expérience, paquetage */}
                  <div className="pointer-events-auto panel-tight w-[15.5rem] divide-y divide-mist/10 overflow-hidden">
                    <div className="px-3 py-1.5">
                      <p className="text-[0.55rem] uppercase tracking-[0.24em] text-moss-300">
                        {clock.phase} · {t("game.day")} {clock.day}
                      </p>
                      <p className="mt-0.5 flex items-baseline justify-between gap-2">
                        <span className="display truncate text-sm leading-tight text-parchment">
                          {zone?.name}
                        </span>
                        <span className="shrink-0 text-[0.55rem] tabular-nums text-mist/45">
                          {String(Math.floor(clock.hour)).padStart(2, "0")}:
                          {String(Math.floor((clock.hour % 1) * 60)).padStart(2, "0")} ·{" "}
                          {weatherLabel(hud.weather.current)} · {Math.round(hud.vitals.temperature)} °C
                        </span>
                      </p>
                    </div>
                    <Vitals vitals={hud.vitals} xp={hud.xp} level={hud.level} label={(key) => t(key)} />
                    <FieldKit
                      state={hud}
                      label={(key) => t(key)}
                      onBuild={shelterUp}
                      onSleep={sleep}
                      onGoggles={goggles}
                      nearShelter={Boolean(nearestShelter(hud, 3.5))}
                    />
                  </div>
                  <Objectives state={hud} label={(key) => t(key)} />
                </div>

                <div className="flex flex-col items-end gap-1.5">
                  <CompassBar heading={hud.player.heading} waypoints={waypoints} className="w-52 md:w-64" />
                  {/* Un seul bandeau de chiffres, au lieu de trois cartes */}
                  <div className="rounded-lg bg-canopy-950/40 px-2.5 py-1 text-right text-[0.6rem] leading-relaxed text-mist/60">
                    <p className="tabular-nums">
                      <span className="text-sky-300">🐾 {mewasFound(hud.mewas)}/{MEWA_COUNT}</span>
                      <span className="mx-1.5 text-mist/25">·</span>🧵 {hud.threads}
                      <span className="mx-1.5 text-mist/25">·</span>⭐ {hud.level}
                    </p>
                    <p className="tabular-nums text-[0.55rem] text-mist/40">
                      {hud.score} pts · {Math.round(hud.hunt.meat)} kg · {totalKills} bête
                      {totalKills > 1 ? "s" : ""}
                    </p>
                  </div>
                </div>
              </div>

              {/* Barre d'armes */}
              <div className="absolute left-1/2 top-3 z-10 -translate-x-1/2 md:top-4">
                <div className="flex items-center gap-0.5 rounded-full border border-mist/10 bg-canopy-950/55 px-1 py-0.5 backdrop-blur-sm">
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
                            ? "bg-parchment/15 text-parchment"
                            : "text-mist/55 hover:text-parchment"
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
                {ambient && (
                  <p className="max-w-xl rounded-full bg-canopy-950/50 px-4 py-1 text-center text-[0.68rem] italic text-mist/65 backdrop-blur-sm">
                    {ambient}
                  </p>
                )}
                <div className="pointer-events-auto flex flex-wrap items-center justify-center gap-1.5">
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
                  {/* Le reste en icônes : six boutons pleine largeur, c'était
                      un ruban de formulaires en travers de la forêt. */}
                  <button
                    type="button"
                    className="grid h-8 w-8 place-items-center rounded-full border border-mist/15 bg-canopy-950/55 text-xs text-parchment/80 backdrop-blur-sm transition hover:bg-canopy-800/80"
                    onClick={() => {
                      document.exitPointerLock?.();
                      setShowDressing(true);
                    }}
                    aria-label={t("game.dress")}
                    title={`${t("game.dress")} · ⇧O`}
                  >
                    🪡
                  </button>
                  <button
                    type="button"
                    className={`grid h-8 w-8 place-items-center rounded-full border text-xs backdrop-blur-sm transition ${
                      showControls
                        ? "border-parchment/40 bg-parchment/15 text-parchment"
                        : "border-mist/15 bg-canopy-950/55 text-parchment/80 hover:bg-canopy-800/80"
                    }`}
                    onClick={() => openControls(!showControls)}
                    aria-expanded={showControls}
                    aria-label={t("controls.open")}
                    title={`${t("controls.open")} · H`}
                  >
                    ⌨
                  </button>
                  <button
                    type="button"
                    className="grid h-8 w-8 place-items-center rounded-full border border-mist/15 bg-canopy-950/55 text-xs text-parchment/80 backdrop-blur-sm transition hover:bg-canopy-800/80"
                    onClick={() => setShowMap((v) => !v)}
                    aria-label={t("game.map")}
                    title={`${t("game.map")} · M`}
                  >
                    🗺️
                  </button>
                  <button
                    type="button"
                    className="grid h-8 w-8 place-items-center rounded-full border border-mist/15 bg-canopy-950/55 text-xs text-parchment/80 backdrop-blur-sm transition hover:bg-canopy-800/80"
                    onClick={() => setView((v) => (v === "premier" ? "troisieme" : "premier"))}
                    aria-pressed={view === "troisieme"}
                    aria-label={view === "troisieme" ? t("game.viewShoulder") : t("game.viewFirst")}
                    title={`${t("game.hints.view")} · V`}
                  >
                    {view === "troisieme" ? "🎥" : "👁️"}
                  </button>
                  <button
                    type="button"
                    className="grid h-8 w-8 place-items-center rounded-full border border-mist/15 bg-canopy-950/55 text-xs text-parchment/80 backdrop-blur-sm transition hover:bg-canopy-800/80"
                    onClick={() => void saveGame()}
                    aria-label={t("game.save")}
                    title={t("game.save")}
                  >
                    💾
                  </button>
                  <button
                    type="button"
                    className={`grid h-8 w-8 place-items-center rounded-full border text-xs backdrop-blur-sm transition ${
                      voiceOn
                        ? "border-amber-glow/60 bg-amber-glow/25 text-parchment"
                        : "border-mist/15 bg-canopy-950/55 text-parchment/80 hover:bg-canopy-800/80"
                    }`}
                    onClick={() => setVoiceOn((v) => !v)}
                    aria-pressed={voiceOn}
                    aria-label={t("game.voice")}
                    title={t("game.voice")}
                  >
                    🔊
                  </button>
                  <button
                    type="button"
                    className="grid h-8 w-8 place-items-center rounded-full border border-mist/25 bg-canopy-950/70 text-xs text-parchment backdrop-blur-sm transition hover:bg-canopy-800/80"
                    onClick={() => setPhase("pause")}
                    aria-label={t("game.pause")}
                    title={`${t("game.pause")} · Échap`}
                  >
                    ⏸
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

              {showControls && (
                <ControlsPanel
                  label={(key) => t(key)}
                  locale={locale}
                  onClose={() => openControls(false)}
                />
              )}

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
                      <span>{candidate.id === "chercheuse" ? "🧑🏾‍🔬" : "🧑🏾‍🌾"}</span>
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
                  <kbd className="rounded bg-canopy-800 px-1 text-parchment/80">H</kbd>{" "}
                  {t("controls.open")} · {t("game.mobile")}
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
                <details className="rounded-xl border border-mist/10 bg-canopy-900/50 p-3 text-xs text-mist/70">
                  <summary className="cursor-pointer select-none font-semibold text-parchment">
                    ⌨ {t("controls.open")}
                  </summary>
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    {CONTROL_GROUPS.map((group) => (
                      <section key={group.key}>
                        <p className="mb-1 text-[0.55rem] uppercase tracking-[0.2em] text-moss-300">
                          {t(group.key)}
                        </p>
                        <ul className="space-y-0.5">
                          {group.rows.map((row) => (
                            <li key={row.label} className="flex items-baseline gap-1.5 text-[0.62rem]">
                              <kbd className="shrink-0 rounded bg-canopy-800 px-1 py-0.5 font-sans text-[0.55rem] text-parchment/85">
                                {localiseKeys(row.keys, locale)}
                              </kbd>
                              <span>{t(row.label)}</span>
                            </li>
                          ))}
                        </ul>
                      </section>
                    ))}
                  </div>
                </details>
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

  // Un seul filet de texte, sans fond : le joueur doit pouvoir le lire d'un
  // coup d'œil sans que l'objectif lui mange un quart de l'écran. Le détail
  // (brief, compteurs) reste accessible en pause.
  if (!status.level) {
    return (
      <p className="max-w-[15.5rem] rounded-full bg-canopy-950/45 px-2.5 py-1 text-[0.62rem] text-mist/70 backdrop-blur-sm">
        {label("game.expeditionDone")} · {state.progress.completed.length}/{LEVELS.length}
      </p>
    );
  }

  return (
    <div className="max-w-[15.5rem] rounded-full bg-canopy-950/45 px-2.5 py-1 text-[0.62rem] leading-tight text-mist/70 backdrop-blur-sm">
      <span className="tabular-nums text-mist/45">
        {index + 1}/{LEVELS.length}
      </span>{" "}
      <span className="text-parchment">{label(status.level.title as DictionaryKey)}</span>
      <span className="mx-1 text-mist/30">·</span>
      {status.objectives.map((entry) => (
        <span key={entry.objective.id} className={entry.done ? "text-moss-300" : ""}>
          {entry.done ? "✓" : "○"}{" "}
          <span className="tabular-nums">
            {entry.current}/{entry.target}
          </span>
          {entry !== status.objectives[status.objectives.length - 1] && (
            <span className="mx-1 text-mist/25">·</span>
          )}
        </span>
      ))}
    </div>
  );
}

function Vitals({
  vitals,
  xp,
  level,
  label,
}: {
  vitals: GameState["vitals"];
  xp: number;
  level: number;
  label: (key: DictionaryKey) => string;
}) {
  const bars = [
    { icon: "❤", key: "game.health", value: vitals.health, colour: "bg-laterite-400" },
    { icon: "🍈", key: "game.hunger", value: vitals.hunger, colour: "bg-amber-glow" },
    { icon: "💧", key: "game.thirst", value: vitals.hydration, colour: "bg-sky-400" },
    { icon: "⚡", key: "game.stamina", value: vitals.stamina, colour: "bg-moss-300" },
  ] as const;
  const progress = levelProgress(xp);
  return (
    <div className="space-y-1 px-3 py-2">
      {bars.map((bar) => {
        const value = Math.max(0, Math.min(100, bar.value));
        const low = value < 20;
        return (
          <div key={bar.key} className="flex items-center gap-1.5">
            <span aria-hidden className="w-3 text-center text-[0.6rem] leading-none">
              {bar.icon}
            </span>
            <div
              className="h-[3px] flex-1 overflow-hidden rounded-full bg-canopy-800"
              role="meter"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(value)}
              aria-label={label(bar.key as DictionaryKey)}
            >
              <div
                className={`h-full rounded-full ${bar.colour} transition-[width] duration-300 ${
                  low ? "animate-pulse" : ""
                }`}
                style={{ width: `${value}%` }}
              />
            </div>
            <span
              className={`w-6 text-right text-[0.55rem] tabular-nums ${
                low ? "text-laterite-400" : "text-mist/45"
              }`}
            >
              {Math.round(value)}
            </span>
          </div>
        );
      })}
      <div className="flex items-center gap-1.5 pt-0.5">
        <span aria-hidden className="w-3 text-center text-[0.6rem] leading-none">
          ⭐
        </span>
        <div
          className="h-[3px] flex-1 overflow-hidden rounded-full bg-canopy-800"
          role="meter"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progress.ratio * 100)}
          aria-label={`${label("game.level")} ${level}`}
        >
          <div
            className={`h-full rounded-full ${progress.prize ? "bg-sky-300" : "bg-moss-300"} transition-[width] duration-500`}
            style={{ width: `${Math.round(progress.ratio * 100)}%` }}
          />
        </div>
        <span className="w-6 text-right text-[0.55rem] tabular-nums text-mist/45">{level}</span>
      </div>
    </div>
  );
}

/**
 * Le paquetage.
 *
 * Quatre chiffres et deux gestes, sur une seule ligne : le bois (un abri en
 * coûte cinq), les fruits, les abris, la viande au sac — puis les boutons de
 * l'abri et des lunettes. Sans cadre autour : c'est un état, pas un panneau.
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
    <div className={`flex items-center gap-1 px-3 py-1.5 text-[0.6rem] text-mist/65 ${className}`}>
      <span className="tabular-nums" title={label("game.wood")}>
        🪵 {state.wood}
      </span>
      <span className="text-mist/20">·</span>
      <span className="tabular-nums" title={label("game.fruit")}>
        🍈 {state.fruits}
      </span>
      <span className="text-mist/20">·</span>
      <span className="tabular-nums" title={label("game.shelter")}>
        🏠 {state.shelters.length}
      </span>
      <span className="ml-auto flex items-center gap-1">
        <button
          type="button"
          onClick={onBuild}
          className={`grid h-6 w-6 place-items-center rounded-full text-[0.62rem] transition ${
            state.wood >= SHELTER_WOOD
              ? "bg-amber-glow/25 text-parchment hover:bg-amber-glow/40"
              : "bg-canopy-800/60 text-mist/35"
          }`}
          aria-label={label("game.shelterBuild")}
          title={`${label("game.shelterBuild")} · B`}
        >
          B
        </button>
        {nearShelter && (
          <button
            type="button"
            onClick={onSleep}
            className="grid h-6 w-6 place-items-center rounded-full bg-moss-300/25 text-[0.62rem] text-parchment hover:bg-moss-300/40"
            aria-label={label("game.sleep")}
            title={`${label("game.sleep")} · N`}
          >
            N
          </button>
        )}
        <button
          type="button"
          onClick={onGoggles}
          className={`grid h-6 w-6 place-items-center rounded-full text-[0.62rem] transition ${
            state.goggles ? "bg-sky-300/30 text-sky-100" : "bg-canopy-800/60 text-mist/45"
          }`}
          aria-pressed={state.goggles}
          aria-label={label("game.goggles")}
          title={`${label("game.goggles")} · I`}
        >
          I
        </button>
      </span>
    </div>
  );
}

/**
 * Les commandes, en un seul bloc dépliable.
 *
 * Dix-huit raccourcis affichés en permanence ne sont pas une aide : c'est un
 * ruban de texte en travers de la forêt, qu'on ne lit plus au bout de trente
 * secondes. Ils sont donc rangés ici, par geste — se déplacer, chasser,
 * survivre, l'interface — et n'apparaissent qu'à la demande : le bouton
 * « Commandes », ou la touche `H`.
 */
/**
 * Les noms de touches. Ce sont des noms propres au clavier, pas des phrases :
 * ils ne se traduisent pas mot à mot, mais « Maj » ne veut rien dire pour un
 * joueur anglophone. On les remplace donc jeton par jeton selon la langue.
 */
const KEY_LABELS: Record<string, { fr: string; en: string }> = {
  Maj: { fr: "Maj", en: "Shift" },
  Espace: { fr: "Espace", en: "Space" },
  "Échap": { fr: "Échap", en: "Esc" },
  Clic: { fr: "Clic", en: "Click" },
  "Ctrl / clic droit": { fr: "Ctrl / clic droit", en: "Ctrl / right click" },
};

const localiseKeys = (keys: string, locale: string) =>
  KEY_LABELS[keys]?.[locale === "en" ? "en" : "fr"] ?? keys;

const CONTROL_GROUPS: { key: DictionaryKey; rows: { keys: string; label: DictionaryKey }[] }[] = [
  {
    key: "controls.move",
    rows: [
      { keys: "ZQSD / WASD", label: "game.hints.walk" },
      { keys: "Maj", label: "game.hints.run" },
      { keys: "Espace", label: "controls.jump" },
      { keys: "C", label: "game.hints.crouch" },
      { keys: "Ctrl / clic droit", label: "controls.block" },
    ],
  },
  {
    key: "controls.hunt",
    rows: [
      { keys: "Clic", label: "controls.fire" },
      { keys: "1-6", label: "controls.weapons" },
      { keys: "R", label: "controls.reload" },
      { keys: "E", label: "controls.skin" },
      { keys: "V", label: "controls.view" },
    ],
  },
  {
    key: "controls.survive",
    rows: [
      { keys: "E", label: "controls.drink" },
      { keys: "F", label: "controls.eat" },
      { keys: "G", label: "controls.grill" },
      { keys: "B", label: "controls.shelter" },
      { keys: "N", label: "controls.sleep" },
      { keys: "I", label: "controls.goggles" },
      { keys: "⇧O", label: "controls.dress" },
    ],
  },
  {
    key: "controls.interface",
    rows: [
      { keys: "M", label: "controls.map" },
      { keys: "P", label: "controls.mouseLook" },
      { keys: "Échap", label: "controls.pause" },
      { keys: "H", label: "controls.open" },
    ],
  },
];

function ControlsPanel({
  label,
  locale,
  onClose,
}: {
  label: (key: DictionaryKey) => string;
  locale: string;
  onClose: () => void;
}) {
  return (
    <div className="pointer-events-auto absolute bottom-14 left-1/2 z-30 w-[min(92vw,46rem)] -translate-x-1/2">
      <div className="panel max-h-[62vh] overflow-y-auto p-3 md:p-4">
        <div className="mb-2 flex items-start justify-between gap-3">
          <div>
            <p className="eyebrow">{label("controls.title")}</p>
            <p className="text-[0.62rem] text-mist/50">{label("controls.hint")}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-mist/20 px-2 py-0.5 text-[0.6rem] text-mist/70 transition hover:text-parchment"
            aria-label={label("controls.close")}
          >
            ✕ <kbd className="opacity-60">H</kbd>
          </button>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {CONTROL_GROUPS.map((group) => (
            <section key={group.key}>
              <p className="mb-1 text-[0.55rem] uppercase tracking-[0.2em] text-moss-300">
                {label(group.key)}
              </p>
              <ul className="space-y-1">
                {group.rows.map((row) => (
                  <li key={row.label} className="flex items-baseline gap-1.5 text-[0.62rem] leading-snug">
                    <kbd className="shrink-0 rounded bg-canopy-800 px-1 py-0.5 font-sans text-[0.55rem] text-parchment/85">
                      {localiseKeys(row.keys, locale)}
                    </kbd>
                    <span className="text-mist/65">{label(row.label)}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
        <p className="mt-2 border-t border-mist/10 pt-1.5 text-[0.58rem] text-mist/45">
          {label("controls.touch")}
        </p>
      </div>
    </div>
  );
}
