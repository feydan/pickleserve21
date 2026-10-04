// Scenario data and motion for the server's-eye view. Pure, no DOM.
// Positions mirror the top-down strategy diagrams in index.html (1 unit = 1 ft,
// far baseline at z = 0, server's baseline at z = 44, net at z = 22).

import { lerp, normalize, sub, v, type Vec3 } from './projection';

export const COURT = { width: 20, length: 44, net: 22, kitchen: 7 } as const;
export const NET_HEIGHT = { post: 3, center: 34 / 12 } as const;

/** Fan mat radii (ft), matching `#fan-mat`. */
export const FAN = { size: 9, z5: 3, z3: 5.5, z1: 8 } as const;

export type Handed = 'R' | 'L';

export interface FanTarget {
  kind: 'fan';
  /** World x of the mat's corner (corner sits on the far baseline). */
  cornerX: number;
  /** +1: fan opens toward +x; -1: toward -x. */
  dir: 1 | -1;
}

export interface RectTarget {
  kind: 'rect';
  x: number;
  z: number;
  w: number;
  d: number;
}

export type Target = FanTarget | RectTarget;

export interface Serve {
  /** Server's x on the baseline. */
  serverX: number;
  land: Vec3;
}

export interface Scenario {
  label: string;
  targets: Target[];
  receivers: { x: number; z: number; hand: Handed }[];
  serves: Serve[];
}

export const SCENARIOS: Record<string, Scenario> = {
  'tab-a': {
    label: 'Righty · center',
    targets: [{ kind: 'fan', cornerX: 10, dir: -1 }],
    receivers: [{ x: 5, z: -2, hand: 'R' }],
    serves: [{ serverX: 10.9, land: v(8.9, 0, 1.5) }],
  },
  'tab-b': {
    label: 'Righty · corner',
    targets: [{ kind: 'fan', cornerX: 20, dir: -1 }],
    receivers: [{ x: 15, z: -2, hand: 'R' }],
    serves: [{ serverX: 0.8, land: v(18.6, 0, 1.6) }],
  },
  'tab-c': {
    label: 'Lefty · corner',
    targets: [{ kind: 'fan', cornerX: 0, dir: 1 }],
    receivers: [{ x: 5, z: -2, hand: 'L' }],
    serves: [{ serverX: 19.2, land: v(1.4, 0, 1.6) }],
  },
  'tab-d': {
    label: 'Lefty · center',
    targets: [{ kind: 'fan', cornerX: 10, dir: 1 }],
    receivers: [{ x: 15, z: -2, hand: 'L' }],
    serves: [{ serverX: 9.1, land: v(11.1, 0, 1.5) }],
  },
  'tab-e': {
    label: 'Sideline targets',
    targets: [
      { kind: 'rect', x: 0, z: 9, w: 2, d: 6 },
      { kind: 'rect', x: 18.5, z: 9, w: 1.5, d: 6 },
    ],
    receivers: [
      { x: 5, z: -2, hand: 'L' },
      { x: 15, z: -2, hand: 'R' },
    ],
    serves: [
      { serverX: 19.2, land: v(1, 0, 12) },
      { serverX: 0.8, land: v(19.25, 0, 12) },
    ],
  },
};

/** Points scored by a ball landing at `p` (0 when it misses every target). */
export function scoreAt(targets: Target[], p: Vec3): 0 | 1 | 3 | 5 {
  let best: 0 | 1 | 3 | 5 = 0;
  for (const t of targets) {
    if (t.kind === 'rect') {
      if (p.x >= t.x && p.x <= t.x + t.w && p.z >= t.z && p.z <= t.z + t.d) best = 5;
      continue;
    }
    const lx = (p.x - t.cornerX) * t.dir;
    if (lx < 0 || p.z < 0) continue;
    const r = Math.hypot(lx, p.z);
    const pts = r <= FAN.z5 ? 5 : r <= FAN.z3 ? 3 : r <= FAN.z1 ? 1 : 0;
    if (pts > best) best = pts;
  }
  return best;
}

// ---------------------------------------------------------------- timeline

/** Seconds. Ball drop + paddle swing, flight, bounce, then hold on the result. */
export const TIMING = { windup: 0.7, flight: 2.0, bounce: 0.6, hold: 1.3 } as const;
export const SERVE_DURATION = TIMING.windup + TIMING.flight + TIMING.bounce + TIMING.hold;

const EYE_HEIGHT = 5.4;
const BASELINE_Z = COURT.length + 1.6;
const APEX = 7;

export const ease = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const clamp01 = (t: number): number => Math.min(1, Math.max(0, t));

export function contactPoint(s: Serve): Vec3 {
  return v(s.serverX + 0.6, 2.9, BASELINE_Z - 3);
}

/** Ball centre during flight, f ∈ [0, 1] from paddle contact to landing. */
export function flightPoint(s: Serve, f: number): Vec3 {
  const p0 = contactPoint(s);
  const g = lerp(p0, s.land, f);
  g.y = p0.y * (1 - f) + 4 * APEX * f * (1 - f);
  return g;
}

/** Fraction of the flight at which the ball is above the net. */
export function netCrossing(s: Serve): number {
  const p0 = contactPoint(s);
  return (p0.z - COURT.net) / (p0.z - s.land.z);
}

export interface Frame {
  ball: Vec3;
  /** 0–1; the ball fades out after its bounce. */
  ballOpacity: number;
  /** Flight path so far (contact → ball), for the trail. */
  trail: Vec3[];
  eye: Vec3;
  look: Vec3;
  /** 0 before contact, 0→1 as the paddle swings through. */
  swing: number;
  /** Seconds since landing, or null before it. */
  sinceLanding: number | null;
}

function cameraStart(s: Serve): { eye: Vec3; look: Vec3 } {
  return { eye: v(s.serverX, EYE_HEIGHT, BASELINE_Z), look: v(lerpN(s.serverX, s.land.x, 0.5), 0, 21) };
}

function cameraEnd(s: Serve): { eye: Vec3; look: Vec3 } {
  const back = normalize(sub(v(s.serverX, 0, BASELINE_Z), s.land));
  return {
    eye: v(s.land.x + back.x * 8, 4.6, s.land.z + back.z * 8),
    look: v(s.land.x, 0, s.land.z - 0.5),
  };
}

const lerpN = (a: number, b: number, t: number): number => a + (b - a) * t;

const TRAIL_STEPS = 40;

/** Everything needed to draw time `t` (seconds) of one serve. */
export function frameAt(s: Serve, t: number): Frame {
  const { windup, flight, bounce } = TIMING;
  const start = cameraStart(s);
  const end = cameraEnd(s);
  const p0 = contactPoint(s);

  // Flight fraction (0 before contact, 1 at landing).
  const f = clamp01((t - windup) / flight);

  let ball: Vec3;
  let ballOpacity = 1;
  if (t < windup) {
    // Ball dropped from the hand to the contact point.
    const k = clamp01(t / windup);
    ball = v(p0.x, p0.y + 1.2 * (1 - k * k), p0.z);
  } else if (f < 1) {
    ball = flightPoint(s, f);
  } else {
    // Low skid-bounce onward in the direction of travel, then fade.
    const b = clamp01((t - windup - flight) / bounce);
    const dir = normalize(sub(s.land, v(p0.x, 0, p0.z)));
    ball = v(s.land.x + dir.x * 4 * b, 4 * 1.4 * b * (1 - b), s.land.z + dir.z * 4 * b);
    ballOpacity = 1 - b;
  }

  const trail: Vec3[] = [];
  if (t >= windup) {
    const n = Math.max(1, Math.round(TRAIL_STEPS * f));
    for (let i = 0; i <= n; i++) trail.push(flightPoint(s, (f * i) / n));
  }

  // Camera chases the ball: eased over flight + settle so it lags behind.
  const camSpan = flight + bounce + 0.4;
  const u = ease(clamp01((t - windup) / camSpan));
  const eye = lerp(start.eye, end.eye, u);
  eye.y += 4 * Math.sin(Math.PI * u);
  const base = lerp(start.look, end.look, u);
  const w = f > 0 && f < 1 ? 0.45 * Math.sin(Math.PI * f) : 0;
  const look = lerp(base, ball, w);

  const swingT = (t - windup + 0.45) / 0.9;
  const swing = clamp01(swingT);

  return {
    ball,
    ballOpacity,
    trail,
    eye,
    look,
    swing,
    sinceLanding: t >= windup + flight ? t - windup - flight : null,
  };
}

/** Single still for reduced motion: the server's view with the whole flight drawn. */
export function stillFrame(s: Serve): Frame {
  const start = frameAt(s, 0);
  return {
    ...start,
    ball: s.land,
    trail: Array.from({ length: TRAIL_STEPS + 1 }, (_, i) => flightPoint(s, i / TRAIL_STEPS)),
    swing: 1,
    sinceLanding: 1,
  };
}
