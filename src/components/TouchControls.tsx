"use client";

import { useCallback, useRef, useState } from "react";

/**
 * Contrôles tactiles : joystick virtuel à gauche, boutons d'action à droite.
 * Le joystick renvoie un vecteur normalisé (-1..1) consommé par le moteur.
 */

export interface TouchVector {
  x: number;
  y: number;
}

export interface TouchControlsProps {
  onMove: (vector: TouchVector) => void;
  onAction?: (action: "interagir" | "gadget" | "carte" | "courir") => void;
  visible?: boolean;
}

const RADIUS = 52;

export default function TouchControls({ onMove, onAction, visible = true }: TouchControlsProps) {
  const padRef = useRef<HTMLDivElement>(null);
  const [knob, setKnob] = useState<TouchVector>({ x: 0, y: 0 });
  const activeId = useRef<number | null>(null);
  const [running, setRunning] = useState(false);

  const handleStart = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    activeId.current = event.pointerId;
    event.currentTarget.setPointerCapture(event.pointerId);
    update(event);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const update = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const pad = padRef.current;
      if (!pad || activeId.current !== event.pointerId) return;
      const rect = pad.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      let dx = event.clientX - cx;
      let dy = event.clientY - cy;
      const distance = Math.hypot(dx, dy);
      if (distance > RADIUS) {
        dx = (dx / distance) * RADIUS;
        dy = (dy / distance) * RADIUS;
      }
      setKnob({ x: dx / RADIUS, y: dy / RADIUS });
      onMove({ x: dx / RADIUS, y: dy / RADIUS });
    },
    [onMove],
  );

  const handleEnd = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (activeId.current !== event.pointerId) return;
      activeId.current = null;
      setKnob({ x: 0, y: 0 });
      setRunning(false);
      onMove({ x: 0, y: 0 });
    },
    [onMove],
  );

  if (!visible) return null;

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 select-none pb-4 md:hidden">
      <div className="flex items-end justify-between px-4">
        <div
          ref={padRef}
          onPointerDown={handleStart}
          onPointerMove={update}
          onPointerUp={handleEnd}
          onPointerCancel={handleEnd}
          className="pointer-events-auto relative grid h-32 w-32 touch-none place-items-center rounded-full border border-mist/20 bg-canopy-900/60 backdrop-blur"
          aria-label="Joystick de déplacement"
          role="application"
        >
          <div className="absolute inset-3 rounded-full border border-mist/10" />
          <div
            className="h-12 w-12 rounded-full border border-amber-glow/50 bg-amber-glow/25 shadow-lg transition-transform duration-75"
            style={{ transform: `translate(${knob.x * RADIUS * 0.62}px, ${knob.y * RADIUS * 0.62}px)` }}
          />
        </div>

        <div className="pointer-events-auto flex flex-col items-end gap-2">
          <button
            type="button"
            onClick={() => onAction?.("carte")}
            className="grid h-11 w-11 place-items-center rounded-full border border-mist/25 bg-canopy-900/70 text-base backdrop-blur active:scale-95"
            aria-label="Ouvrir la carte"
          >
            🗺️
          </button>
          <button
            type="button"
            onClick={() => onAction?.("gadget")}
            className="grid h-11 w-11 place-items-center rounded-full border border-mist/25 bg-canopy-900/70 text-base backdrop-blur active:scale-95"
            aria-label="Utiliser un gadget"
          >
            🎒
          </button>
          <button
            type="button"
            onClick={() => onAction?.("interagir")}
            className="grid h-16 w-16 place-items-center rounded-full border border-amber-glow/50 bg-amber-glow/25 text-lg font-semibold backdrop-blur active:scale-95"
            aria-label="Interagir"
          >
            ✋
          </button>
          <button
            type="button"
            onClick={() => {
              const next = !running;
              setRunning(next);
              onAction?.("courir");
            }}
            className={`grid h-11 w-11 place-items-center rounded-full border text-xs backdrop-blur active:scale-95 ${
              running
                ? "border-laterite-400 bg-laterite-500/40 text-parchment"
                : "border-mist/25 bg-canopy-900/70 text-mist/80"
            }`}
            aria-pressed={running}
            aria-label="Courir"
          >
            🏃
          </button>
        </div>
      </div>
    </div>
  );
}
