"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Scene, { type SceneController } from "./Scene";
import CompassBar, { type Waypoint } from "./CompassBar";
import GpsMap, { type MapMarker } from "./GpsMap";
import TouchControls, { type TouchVector } from "./TouchControls";
import LoadingScreen from "./LoadingScreen";
import {
  type GameState,
  type HuntState,
  type InputState,
  deserialize,
  initialHunt,
  newGame,
  serialize,
  step,
  weatherLabel,
} from "@/game/engine";
import { CHARACTERS, getCharacter } from "@/game/characters";
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

type Phase = "accueil" | "chargement" | "jeu" | "pause";

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

  const sceneRef = useRef<SceneController | null>(null);
  const stateRef = useRef<GameState>(newGame(characterId));
  const inputRef = useRef<InputState>({
    forward: false,
    backward: false,
    left: false,
    right: false,
    run: false,
    sneak: false,
    joystick: { x: 0, y: 0 },
  });
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
        const kills = { ...huntRef.current.kills };
        kills[report.hit.speciesId] = (kills[report.hit.speciesId] ?? 0) + 1;
        commitHunt({ ...huntRef.current, kills });
        pushToast({
          title: `${species?.emoji ?? "🎯"} ${species?.name ?? "Animal"} abattu`,
          detail: `${report.hit.headshot ? "Tir à la tête · " : ""}${build?.meat ?? 0} kg à dépecer`,
          tone: "succes",
        });
      }
    }
  }, [commitHunt, pushToast]);

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
    commitHunt({ ...huntRef.current, meat: huntRef.current.meat + result.meat });
    setCarcassNear(null);
    pushToast({
      title: `Dépeçage · +${result.meat} kg`,
      detail: `${result.name} — viande au sac : ${Math.round(huntRef.current.meat + result.meat)} kg`,
      tone: "succes",
    });
  }, [commitHunt, pushToast]);

  const actionsRef = useRef({
    equip: (id: WeaponId) => {
      void id;
    },
    reload: () => {},
    skin: () => {},
  });
  useEffect(() => {
    actionsRef.current = { equip, reload, skin: skinCarcass };
  }, [equip, reload, skinCarcass]);

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
      if (event.button === 2) sceneRef.current?.setAiming(true);
    };
    const onUp = (event: MouseEvent) => {
      if (event.button === 0) firingRef.current = false;
      if (event.button === 2) sceneRef.current?.setAiming(false);
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

      const controller = sceneRef.current;
      const clockNow = worldClock(result.state.elapsed, result.state.settings);
      if (controller) {
        const player = result.state.player;
        controller.setPlayer(player.position, player.heading, player.motion);
        controller.setEnvironment({
          hour: clockNow.hour,
          daylight: clockNow.daylight,
          weather: result.state.weather.current,
          intensity: result.state.weather.intensity,
        });
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
        },
        dt,
      );
      animalsRef.current = herd.animals;
      controller?.setAnimals(herd.animals);

      // Une panthère qui charge et vous atteint entame la santé.
      for (const animal of herd.animals) {
        if (animal.state !== "charge") continue;
        const dx = animal.x - result.state.player.position[0];
        const dz = animal.z - result.state.player.position[2];
        if (Math.hypot(dx, dz) < 2.2) {
          result.state.vitals.health = Math.max(0, result.state.vitals.health - dt * 14);
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
          setCarcassNear(carcassSpecies ? carcassSpecies.name : null);
        }
      }
      if (nowMs - lastAmbientRef.current > 14000) {
        lastAmbientRef.current = nowMs;
        setAmbient(ambientLine(result.state.elapsed + result.state.seed));
      }
    };

    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [phase, pushToast]);

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
      ControlLeft: "sneak",
      ControlRight: "sneak",
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
      if (event.code === "KeyE") actionsRef.current.skin();
      if (event.code === "Space") {
        firingRef.current = true;
        fireRef.current();
        event.preventDefault();
      }
      if (event.code === "Escape") {
        setPhase((current) => (current === "jeu" ? "pause" : current === "pause" ? "jeu" : current));
      }
      if (event.code === "KeyF" && document.pointerLockElement === null) {
        sceneRef.current?.requestLook();
      }
    };

    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code === "Space") firingRef.current = false;
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
        stateRef.current = deserialize(first.state);
        pushToast({ title: "Expédition restaurée", tone: "info" });
        return true;
      }
    } catch {
      const local = window.localStorage.getItem("minkebe.save");
      if (local) {
        stateRef.current = deserialize(JSON.parse(local) as Record<string, unknown>);
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
                  <div className="panel-tight px-3 py-2">
                    <p className="eyebrow">{clock.phase} · jour {clock.day}</p>
                    <p className="display text-lg leading-tight text-parchment">{zone?.name}</p>
                    <p className="text-[0.65rem] text-mist/60">
                      {String(Math.floor(clock.hour)).padStart(2, "0")}:
                      {String(Math.floor((clock.hour % 1) * 60)).padStart(2, "0")} ·{" "}
                      {weatherLabel(hud.weather.current)} · {Math.round(hud.vitals.temperature)} °C
                    </p>
                  </div>
                  <Vitals vitals={hud.vitals} />
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
              </div>

              <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex flex-col items-center gap-2 p-3 md:p-4">
                {carcassNear && (
                  <button
                    type="button"
                    onClick={skinCarcass}
                    className="pointer-events-auto flex items-center gap-2 rounded-full border border-amber-glow/50 bg-canopy-950/80 px-3 py-1.5 text-xs text-parchment backdrop-blur"
                  >
                    🔪 Dépecer · {carcassNear}
                    <kbd className="rounded bg-canopy-700 px-1.5 py-0.5 font-sans">E</kbd>
                  </button>
                )}
                {showHints && (
                  <div className="pointer-events-none flex flex-wrap items-center justify-center gap-1.5 rounded-full bg-canopy-950/70 px-3 py-1.5 text-[0.62rem] text-mist/75 backdrop-blur">
                    <kbd className="rounded bg-canopy-700 px-1.5 py-0.5 font-sans text-parchment">ZQSD</kbd>
                    <span>marcher</span>
                    <span className="text-mist/30">·</span>
                    <kbd className="rounded bg-canopy-700 px-1.5 py-0.5 font-sans text-parchment">Maj</kbd>
                    <span>courir</span>
                    <span className="text-mist/30">·</span>
                    <kbd className="rounded bg-canopy-700 px-1.5 py-0.5 font-sans text-parchment">Ctrl</kbd>
                    <span>s&apos;accroupir</span>
                    <span className="text-mist/30">·</span>
                    <span>clic droit : épauler</span>
                    <span className="text-mist/30">·</span>
                    <kbd className="rounded bg-canopy-700 px-1.5 py-0.5 font-sans text-parchment">clic</kbd>
                    <span>tirer</span>
                    <span className="text-mist/30">·</span>
                    <kbd className="rounded bg-canopy-700 px-1.5 py-0.5 font-sans text-parchment">1-5</kbd>
                    <span>armes</span>
                    <span className="text-mist/30">·</span>
                    <kbd className="rounded bg-canopy-700 px-1.5 py-0.5 font-sans text-parchment">R</kbd>
                    <span>recharger</span>
                    <span className="text-mist/30">·</span>
                    <kbd className="rounded bg-canopy-700 px-1.5 py-0.5 font-sans text-parchment">Échap</kbd>
                    <span>pause</span>
                  </div>
                )}
                {ambient && (
                  <p className="max-w-xl rounded-full bg-canopy-950/55 px-4 py-1.5 text-center text-[0.7rem] italic text-mist/70 backdrop-blur">
                    {ambient}
                  </p>
                )}
                <div className="pointer-events-auto flex flex-wrap items-center justify-center gap-2">
                  <button type="button" className="btn btn-ghost !px-3 !py-1.5 !text-xs" onClick={() => setShowMap((v) => !v)}>
                    🗺️ Carte <kbd className="opacity-50">M</kbd>
                  </button>
                  <button type="button" className="btn btn-ghost !px-3 !py-1.5 !text-xs" onClick={() => void saveGame()}>
                    💾 Sauvegarder
                  </button>
                  <button type="button" className="btn btn-ghost !px-3 !py-1.5 !text-xs" onClick={() => setPhase("pause")}>
                    ⏸️ Pause
                  </button>
                  <button
                    type="button"
                    className={`btn !px-3 !py-1.5 !text-xs ${voiceOn ? "btn-primary" : "btn-ghost"}`}
                    onClick={() => setVoiceOn((v) => !v)}
                    aria-pressed={voiceOn}
                  >
                    🔊 Voix
                  </button>
                </div>
              </div>

              <TouchControls
                onMove={onTouchMove}
                onAction={(action) => {
                  if (action === "carte") setShowMap((v) => !v);
                  if (action === "courir") inputRef.current.run = !inputRef.current.run;
                  if (action === "interagir") {
                    pushToast({ title: "Observation", detail: "Restez immobile pour laisser venir la faune.", tone: "info" });
                  }
                }}
              />

              {/* Boutons de tir (tactile) */}
              <div className="absolute bottom-44 right-4 z-20 flex flex-col items-end gap-2 md:hidden">
                <button
                  type="button"
                  onClick={reload}
                  className="grid h-11 w-11 place-items-center rounded-full border border-mist/25 bg-canopy-900/70 text-sm backdrop-blur active:scale-95"
                  aria-label="Recharger"
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
                  aria-label="Tirer"
                >
                  Tirer
                </button>
              </div>

              {showMap && hud && (
                <div className="absolute right-3 top-32 z-20 w-64 md:right-5 md:w-80">
                  <GpsMap
                    position={hud.player.position}
                    heading={hud.player.heading}
                    discovered={hud.visitedZones}
                    markers={markers}
                    onClose={() => setShowMap(false)}
                  />
                </div>
              )}
            </>
          )}

          {/* Accueil */}
          {phase === "accueil" && (
            <div className="absolute inset-0 z-20 flex flex-col justify-end bg-gradient-to-t from-canopy-950 via-canopy-950/70 to-transparent p-5 md:p-8">
              <div className="max-w-2xl space-y-4">
                <p className="eyebrow">Expédition 01 · Réserve de Minkébé</p>
                <h2 className="display text-3xl text-parchment md:text-5xl">
                  Entrez dans l&apos;une des dernières forêts intactes du Gabon.
                </h2>
                <p className="max-w-xl text-sm text-mist/75">
                  Suivez la faune dans la futaie, épaules une arme, abattez, dépecez.
                  La viande se rapporte au camp ; le carnet garde la trace du reste.
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
                    ▶ Commencer l&apos;expédition
                  </button>
                  <button type="button" className="btn btn-ghost" onClick={() => void startGame("reprendre")}>
                    ⟲ Reprendre
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => {
                      sceneRef.current?.requestLook();
                      pushToast({ title: "Caméra libre", detail: "Cliquez pour capturer la souris, Échap pour libérer.", tone: "info" });
                    }}
                  >
                    🖱️ Regarder
                  </button>
                </div>

                <p className="text-[0.7rem] text-mist/45">
                  Clavier : ZQSD / WASD · Maj courir · Ctrl s&apos;accroupir · M carte · Échap pause.
                  Sur mobile, utilisez le joystick.
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
                    💾 Sauvegarder maintenant
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
                Salon <strong className="text-parchment">{room.code}</strong> ·{" "}
                {remotePlayers.length + 1}/{room.maxPlayers} explorateurs
              </span>
            ) : (
              <span>Mode solo — créez un salon pour jouer à plusieurs.</span>
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

function Vitals({ vitals }: { vitals: GameState["vitals"] }) {
  const bars = [
    { label: "Endurance", value: vitals.stamina, colour: "bg-moss-300" },
    { label: "Eau", value: vitals.hydration, colour: "bg-sky-400" },
    { label: "Santé", value: vitals.health, colour: "bg-laterite-400" },
  ];
  return (
    <div className="panel-tight w-40 space-y-1.5 px-3 py-2">
      {bars.map((bar) => (
        <div key={bar.label}>
          <div className="flex justify-between text-[0.58rem] uppercase tracking-wider text-mist/55">
            <span>{bar.label}</span>
            <span className="tabular-nums">{Math.round(bar.value)}</span>
          </div>
          <div className="mt-0.5 h-1 overflow-hidden rounded-full bg-canopy-700">
            <div
              className={`h-full rounded-full ${bar.colour} transition-[width] duration-300`}
              style={{ width: `${Math.max(0, Math.min(100, bar.value))}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
