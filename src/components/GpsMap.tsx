"use client";

import { useMemo } from "react";
import { ZONES, zoneAt } from "@/game/levels";
import { WATER_BODIES } from "@/game/water";

/**
 * Carte GPS : plan de la réserve, position du joueur, zones connues et
 * joueurs distants. Rendu SVG pour rester net à toutes les tailles.
 */

const WORLD = 520; // taille du monde Three.js
const VIEW = 260; // demi-étendue affichée

function project(x: number, z: number): { x: number; y: number } {
  return {
    x: ((x + VIEW) / (VIEW * 2)) * 100,
    y: ((z + VIEW) / (VIEW * 2)) * 100,
  };
}

export interface MapMarker {
  id: string;
  label: string;
  position: [number, number, number];
  kind: "joueur" | "équipe" | "camp" | "danger";
}

export default function GpsMap({
  position,
  heading,
  discovered = [],
  markers = [],
  compact = false,
  onClose,
}: {
  position: [number, number, number];
  heading: number;
  discovered?: string[];
  markers?: MapMarker[];
  compact?: boolean;
  onClose?: () => void;
}) {
  const player = project(position[0], position[2]);
  const currentZone = zoneAt(position[0], position[2]);

  const zones = useMemo(
    () =>
      ZONES.map((zone) => {
        const centre = project(zone.center[0], zone.center[1]);
        const radius = (zone.radius / (VIEW * 2)) * 100;
        const known = zone.unlockedByDefault || discovered.includes(zone.id);
        return { zone, centre, radius, known };
      }),
    [discovered],
  );

  // Les plans d'eau sont tracés depuis leur ligne d'eau : une rivière qui
  // serpente doit serpenter aussi sur la carte.
  const waters = useMemo(
    () =>
      WATER_BODIES.map((body) => {
        const points = body.path.map(([x, z]) => project(x, z));
        const width = (body.halfWidth * 2 * 100) / (VIEW * 2);
        const d = points
          .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
          .join(" ");
        return {
          body,
          d,
          width,
          pond: body.path.length < 2,
          centre: points[0],
          radius: (body.halfWidth * 100) / (VIEW * 2),
        };
      }),
    [],
  );

  return (
    <div
      className={`panel relative overflow-hidden ${compact ? "p-2" : "p-4"}`}
      aria-label="Carte GPS de la réserve"
    >
      <header className="mb-2 flex items-center justify-between gap-3">
        <div>
          <p className="eyebrow">GPS</p>
          <p className="text-sm font-semibold text-parchment">{currentZone.name}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="chip">
            {Math.round(position[0])} · {Math.round(position[2])}
          </span>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="rounded-full border border-mist/20 px-2 py-0.5 text-xs text-mist/70 hover:border-moss-300 hover:text-parchment"
              aria-label="Fermer la carte"
            >
              ✕
            </button>
          )}
        </div>
      </header>

      <div className="relative aspect-square w-full overflow-hidden rounded-xl border border-mist/10 bg-[#08170f]">
        <svg
          viewBox="0 0 100 100"
          className="absolute inset-0 h-full w-full"
          role="img"
          aria-label={`Position ${Math.round(position[0])}, ${Math.round(position[2])} — zone ${currentZone.name}`}
        >
          <defs>
            <pattern id="grid" width="10" height="10" patternUnits="userSpaceOnUse">
              <path d="M 10 0 L 0 0 0 10" fill="none" stroke="#1f4229" strokeWidth="0.25" />
            </pattern>
            <radialGradient id="known" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#4b7f4a" stopOpacity="0.35" />
              <stop offset="100%" stopColor="#4b7f4a" stopOpacity="0.05" />
            </radialGradient>
          </defs>

          <rect width="100" height="100" fill="#08170f" />
          <rect width="100" height="100" fill="url(#grid)" />

          {waters.map(({ body, d, width, pond, centre, radius }) =>
            pond ? (
              <circle
                key={body.id}
                cx={centre.x}
                cy={centre.y}
                r={radius}
                fill="#12333a"
                stroke="#1e5a63"
                strokeWidth="0.3"
                opacity={0.85}
              />
            ) : (
              <path
                key={body.id}
                d={d}
                fill="none"
                stroke="#12333a"
                strokeWidth={Math.max(1.2, width)}
                strokeLinecap="round"
                strokeLinejoin="round"
                opacity={0.9}
              />
            ),
          )}

          {zones.map(({ zone, centre, radius, known }) => (
            <g key={zone.id} opacity={known ? 1 : 0.32}>
              <circle
                cx={centre.x}
                cy={centre.y}
                r={Math.max(1.5, radius)}
                fill={known ? "url(#known)" : "none"}
                stroke={known ? "#6f9f5e" : "#3a5442"}
                strokeWidth="0.35"
                strokeDasharray={known ? undefined : "1.2 1.2"}
              />
              {!compact && (
                <text
                  x={centre.x}
                  y={centre.y + radius + 2.4}
                  textAnchor="middle"
                  fill={known ? "#c9d8cc" : "#5d7364"}
                  fontSize="2.4"
                  fontFamily="system-ui, sans-serif"
                >
                  {known ? zone.name : "Zone inexplorée"}
                </text>
              )}
            </g>
          ))}

          {markers.map((marker) => {
            const point = project(marker.position[0], marker.position[2]);
            const colour =
              marker.kind === "joueur"
                ? "#f2b544"
                : marker.kind === "danger"
                  ? "#d17340"
                  : marker.kind === "camp"
                    ? "#e0c07a"
                    : "#8fd0c2";
            return (
              <g key={marker.id}>
                <circle cx={point.x} cy={point.y} r={marker.kind === "joueur" ? 1.8 : 1.3} fill={colour} />
                {!compact && (
                  <text
                    x={point.x + 2.4}
                    y={point.y + 0.9}
                    fill={colour}
                    fontSize="2.1"
                    fontFamily="system-ui, sans-serif"
                  >
                    {marker.label}
                  </text>
                )}
              </g>
            );
          })}

          <g transform={`translate(${player.x} ${player.y}) rotate(${(-heading * 180) / Math.PI})`}>
            <path d="M0,-3 L1.7,2.2 L0,1.1 L-1.7,2.2 Z" fill="#f2b544" stroke="#0a1610" strokeWidth="0.3" />
          </g>
        </svg>

        <div className="absolute bottom-1.5 right-2 text-[0.55rem] uppercase tracking-widest text-mist/40">
          échelle 1:{Math.round(WORLD / 5)}
        </div>
      </div>

      {!compact && (
        <footer className="mt-2 flex flex-wrap gap-1.5 text-[0.62rem] text-mist/60">
          <span className="chip">🟡 Vous</span>
          <span className="chip">🟢 Équipe</span>
          <span className="chip">🔵 Eau</span>
          <span className="chip">
            {zones.filter((z) => z.known).length}/{zones.length} zones reconnues
          </span>
        </footer>
      )}
    </div>
  );
}
