"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Bande-son de Minkébé : ambiances de forêt et thèmes traditionnels.
 * Lecture HTML5 simple, avec fondu, boucle et repli silencieux si un fichier
 * manque sur le serveur.
 */

interface Track {
  id: string;
  title: string;
  artist: string;
  src: string;
  duration: string;
  mood: string;
  emoji: string;
}

const TRACKS: Track[] = [
  {
    id: "mougongo",
    title: "Le Mougongo",
    artist: "Ensemble de Minkébé",
    src: "/audio/le-mougongo.wav",
    duration: "3:12",
    mood: "Chant de rivière",
    emoji: "🪘",
  },
  {
    id: "reveil",
    title: "Réveil dans la forêt",
    artist: "Ambiance de l'aube",
    src: "/audio/reveil-dans-la-foret.wav",
    duration: "1:00",
    mood: "Aube · calaos",
    emoji: "🌅",
  },
  {
    id: "canopee",
    title: "Sous la canopée",
    artist: "Ambiance de jour",
    src: "/audio/ambiance-canopee.wav",
    duration: "1:00",
    mood: "Jour · insectes",
    emoji: "🌿",
  },
];

export default function MusicPlayer() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [volume, setVolume] = useState(0.55);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);

  const track = TRACKS[index];

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = volume;
  }, [volume]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onError = () => {
      setError("Piste indisponible sur ce serveur.");
      setPlaying(false);
    };
    const onTime = () => {
      if (audio.duration > 0) setProgress(audio.currentTime / audio.duration);
    };
    const onEnded = () => setIndex((i) => (i + 1) % TRACKS.length);

    audio.addEventListener("error", onError);
    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("ended", onEnded);
    return () => {
      audio.removeEventListener("error", onError);
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("ended", onEnded);
    };
  }, []);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    setError(null);
    audio.load();
    if (playing) {
      void audio.play().catch(() => {
        setPlaying(false);
        setError("Lecture bloquée par le navigateur — cliquez à nouveau.");
      });
    }
  }, [index]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = useCallback(async () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) {
      audio.pause();
      setPlaying(false);
      return;
    }
    try {
      audio.volume = volume;
      await audio.play();
      setPlaying(true);
      setError(null);
    } catch {
      setError("Lecture impossible : vérifiez le fichier audio.");
      setPlaying(false);
    }
  }, [playing, volume]);

  const next = () => setIndex((i) => (i + 1) % TRACKS.length);
  const previous = () => setIndex((i) => (i - 1 + TRACKS.length) % TRACKS.length);

  return (
    <section className="panel space-y-3 p-5" aria-labelledby="musique-titre">
      <header className="flex items-center justify-between gap-2">
        <div>
          <p className="eyebrow">Bande-son</p>
          <h2 id="musique-titre" className="display text-xl">
            Écouter la forêt
          </h2>
        </div>
        <span className="chip">{playing ? "en lecture" : "en pause"}</span>
      </header>

      <audio ref={audioRef} src={track.src} preload="none" loop={false} />

      <div className="flex items-center gap-3 rounded-xl border border-mist/12 bg-canopy-950/50 p-3">
        <span className="grid h-11 w-11 place-items-center rounded-lg bg-moss-400/15 text-xl">
          {track.emoji}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-parchment">{track.title}</p>
          <p className="truncate text-[0.65rem] text-mist/55">
            {track.artist} · {track.mood}
          </p>
        </div>
        <span className="text-[0.65rem] tabular-nums text-mist/40">{track.duration}</span>
      </div>

      <div className="h-1 overflow-hidden rounded-full bg-canopy-700">
        <div
          className="h-full rounded-full bg-gradient-to-r from-moss-300 to-amber-glow transition-[width]"
          style={{ width: `${Math.round(progress * 100)}%` }}
        />
      </div>

      <div className="flex items-center gap-2">
        <button type="button" className="btn btn-ghost !px-3 !py-1.5 !text-xs" onClick={previous} aria-label="Piste précédente">
          ⏮
        </button>
        <button
          type="button"
          className="btn btn-primary !px-4 !py-2 !text-xs"
          onClick={() => void toggle()}
          aria-pressed={playing}
        >
          {playing ? "⏸ Pause" : "▶ Écouter"}
        </button>
        <button type="button" className="btn btn-ghost !px-3 !py-1.5 !text-xs" onClick={next} aria-label="Piste suivante">
          ⏭
        </button>

        <label className="ml-auto flex items-center gap-2 text-[0.65rem] text-mist/50">
          🔊
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={volume}
            onChange={(event) => setVolume(Number(event.target.value))}
            className="h-1 w-20 accent-amber-glow"
            aria-label="Volume"
          />
        </label>
      </div>

      <ul className="space-y-1">
        {TRACKS.map((item, itemIndex) => (
          <li key={item.id}>
            <button
              type="button"
              onClick={() => setIndex(itemIndex)}
              className={`flex w-full items-center justify-between rounded-lg px-2 py-1 text-left text-[0.7rem] transition ${
                itemIndex === index ? "bg-moss-400/10 text-parchment" : "text-mist/60 hover:bg-canopy-800"
              }`}
            >
              <span className="truncate">
                {itemIndex === index && playing ? "▶ " : ""}
                {item.title}
              </span>
              <span className="text-mist/35">{item.duration}</span>
            </button>
          </li>
        ))}
      </ul>

      {error && <p className="text-[0.65rem] text-laterite-400">{error}</p>}
    </section>
  );
}
