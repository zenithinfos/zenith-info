"use client";

/**
 * Bandeau de boussole : ruban horizontal avec les points cardinaux, l'azimut
 * courant et les waypoints de la zone.
 */

const CARDINALS: { angle: number; label: string }[] = [
  { angle: 0, label: "N" },
  { angle: 45, label: "NE" },
  { angle: 90, label: "E" },
  { angle: 135, label: "SE" },
  { angle: 180, label: "S" },
  { angle: 225, label: "SO" },
  { angle: 270, label: "O" },
  { angle: 315, label: "NO" },
];

export interface Waypoint {
  label: string;
  bearing: number;
  distance: number;
  kind?: "zone" | "camp" | "eau" | "danger";
}

function toDegrees(heading: number): number {
  // heading : 0 = nord (-Z), sens horaire.
  const deg = ((-heading * 180) / Math.PI + 360) % 360;
  return deg;
}

function cardinal(deg: number): string {
  const index = Math.round(deg / 45) % 8;
  return CARDINALS[index].label;
}

export default function CompassBar({
  heading,
  waypoints = [],
  className = "",
}: {
  heading: number;
  waypoints?: Waypoint[];
  className?: string;
}) {
  const bearing = toDegrees(heading);
  const span = 120; // degrés visibles de part et d'autre
  const marks = Array.from({ length: 25 }, (_, i) => {
    const angle = (bearing - span + (i * span * 2) / 24 + 360) % 360;
    const isMajor = Math.round(angle) % 45 === 0 || Math.round(angle) % 45 === 44;
    return { angle, isMajor, key: i };
  });

  return (
    <div className={`pointer-events-none select-none ${className}`}>
      <div className="panel-tight relative overflow-hidden px-3 py-2">
        <div className="flex items-center justify-between text-[0.62rem] uppercase tracking-[0.22em] text-mist/60">
          <span>{Math.round(bearing).toString().padStart(3, "0")}°</span>
          <span className="text-amber-glow">{cardinal(bearing)}</span>
        </div>

        <div className="relative mt-1 h-7">
          {marks.map(({ angle, isMajor, key }) => {
            const offset = (angle - bearing + 540) % 360 - 180;
            const left = 50 + (offset / span) * 50;
            if (left < 0 || left > 100) return null;
            const label = isMajor
              ? CARDINALS.find((c) => Math.abs(c.angle - angle) < 3)?.label ?? "·"
              : "·";
            return (
              <div
                key={key}
                className="absolute top-0 -translate-x-1/2 text-center"
                style={{ left: `${left}%` }}
              >
                <div
                  className={`mx-auto w-px ${
                    isMajor ? "h-3 bg-mist/60" : "h-1.5 bg-mist/25"
                  }`}
                />
                {isMajor && (
                  <span className="mt-0.5 block text-[0.6rem] font-semibold text-mist/80">
                    {label}
                  </span>
                )}
              </div>
            );
          })}

          {waypoints.map((waypoint) => {
            const offset = (waypoint.bearing - bearing + 540) % 360 - 180;
            const left = 50 + (offset / span) * 50;
            if (left < 1 || left > 99) return null;
            const colour =
              waypoint.kind === "danger"
                ? "bg-laterite-400"
                : waypoint.kind === "eau"
                  ? "bg-sky-400"
                  : waypoint.kind === "camp"
                    ? "bg-amber-glow"
                    : "bg-moss-300";
            return (
              <div
                key={waypoint.label}
                className="absolute top-4 -translate-x-1/2"
                style={{ left: `${left}%` }}
                title={`${waypoint.label} — ${Math.round(waypoint.distance)} m`}
              >
                <div className={`h-1.5 w-1.5 rounded-full ${colour}`} />
                <span className="mt-0.5 block max-w-14 truncate text-[0.55rem] text-mist/60">
                  {Math.round(waypoint.distance)} m
                </span>
              </div>
            );
          })}
        </div>

        <div className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-amber-glow/70" />
      </div>
    </div>
  );
}
