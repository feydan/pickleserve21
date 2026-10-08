// The hero shot: one first-person serve at golden hour, from the ball drop to a
// slow-motion freeze as it kicks up off the red 5. Pure, no DOM. World units
// match the server's-eye view (feet; x across, y up, z = 0 far baseline,
// z = 44 server's baseline).

import { add, lerp, normalize, scale, sub, v, type Vec3 } from '../serve-view/projection';

/**
 * Same serve as the "Righty · corner" diagram: right-hand court corner, fan opening left.
 * Size estimated from the instruction PDF photos (the mat beside the 2 ft sideline
 * target): about 6 ft square, yellow reaching the edges, white only in the far corner.
 */
export const MAT = { cornerX: 20, size: 6, z5: 2, z3: 3.7, z1: 6 } as const;
export const LAND = v(19.0, 0, 1.3);

/** Low sun beyond the far baseline, a little right: backlights the whole shot (~12° up, shadows ~5× height). */
export const SUN = normalize(v(0.22, 0.21, -1));

const SHOULDER = v(1.6, 4.5, 45.2);
/** Arm + half paddle, shoulder to paddle centre. */
const REACH = 2.9;
const CONTACT_ANGLE = 20; // degrees past straight down: low, underhand, below the waist
const APEX = 7.5;

/** Seconds. */
export const T = {
  drop: 0.25,
  contact: 1.05,
  flight: 2.3,
  /** Bounce until the freeze. */
  kick: 1.1,
  settle: 1.3,
} as const;
export const LANDING = T.contact + T.flight;
export const DURATION = LANDING + T.kick + T.settle;

const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
const smooth = (t: number) => {
  const c = clamp01(t);
  return c * c * (3 - 2 * c);
};
const easeInOut = (t: number) => {
  const c = clamp01(t);
  return c < 0.5 ? 4 * c * c * c : 1 - (-2 * c + 2) ** 3 / 2;
};
const mix = (a: number, b: number, t: number) => a + (b - a) * t;

/** Paddle centre and long axis (shoulder → tip) for a swing angle in degrees (0 = straight down). */
export function paddlePose(angle: number): { centre: Vec3; axis: Vec3 } {
  const r = (angle * Math.PI) / 180;
  // Past contact the follow-through rises toward the target (cross-court, to the right).
  const across = Math.max(0, Math.sin(r)) * (angle > CONTACT_ANGLE ? 0.75 : 0.2);
  const axis = normalize(v(across, -Math.cos(r), -Math.sin(r)));
  return { centre: add(SHOULDER, scale(axis, REACH)), axis };
}

export function contactPoint(): Vec3 {
  const { centre } = paddlePose(CONTACT_ANGLE);
  return add(centre, v(0, 0, -0.18));
}

/** Ball during flight, f ∈ [0, 1] from contact to landing. */
export function flightPoint(f: number): Vec3 {
  const p0 = contactPoint();
  const g = lerp(p0, LAND, f);
  g.y = p0.y * (1 - f) + 4 * APEX * f * (1 - f);
  return g;
}

/** Fraction of the flight with the ball over the net (z = 22). */
export function netCrossing(): number {
  const p0 = contactPoint();
  return (p0.z - 22) / (p0.z - LAND.z);
}

/** Flight time warp: full speed, then slow motion for the last stretch before landing. */
export function flightFraction(u: number): number {
  const a = 0.62;
  const slow = 0.38;
  const k = 1 / (a + (1 - a) * slow);
  const c = clamp01(u);
  return c < a ? c * k : (a + (c - a) * slow) * k;
}

/** Bounce off the mat, slowing to a freeze at the top of a small kick (b ∈ [0, 1]). */
export function kickPoint(b: number): Vec3 {
  const dir = normalize(sub(v(LAND.x, 0, LAND.z), v(contactPoint().x, 0, contactPoint().z)));
  // Decelerating clock: ends at the apex of the kick with zero speed.
  const k = 1 - (1 - clamp01(b)) ** 2.4;
  const reach = 0.7;
  const p = add(LAND, scale(dir, reach * k));
  p.y = 1.35 * Math.sin((Math.PI / 2) * k);
  return p;
}

export interface Shot {
  /** Ball centre; null while it is still in the other hand, out of frame. */
  ball: Vec3;
  /** Recent ball positions, oldest first, for the motion streak. */
  streak: Vec3[];
  /** Paddle swing angle (degrees) or null once it has left the frame for good. */
  swing: number | null;
  /** Swing angular speed (deg/s), drives the paddle motion blur. */
  swingSpeed: number;
  eye: Vec3;
  look: Vec3;
  fovY: number;
  /** 0–1 white flash at paddle contact. */
  flash: number;
  /** Seconds since landing (slow-mo clock), or null before it. */
  sinceLanding: number | null;
  /** 0–1 how far into the dust/settle phase. */
  settle: number;
  /** Small camera shake in screen px at 1× (decays). */
  shake: number;
  done: boolean;
}

/** Ready position before the backswing: paddle held upright in front of the chest. */
const READY = {
  // Low enough that the grip runs out of frame: the hand is just out of shot.
  centre: v(1.95, 3.75, 44.8),
  axis: normalize(v(0.35, 0.88, -0.3)),
  until: 0.3,
  back: 0.6,
} as const;

/** Swing: quick backswing out of frame, through contact, up into a follow-through. */
function swingAngle(t: number): number {
  const back = -70;
  const through = 135;
  const c = T.contact;
  if (t < READY.back) return back;
  if (t < c) return mix(back, CONTACT_ANGLE, easeIn((t - READY.back) / (c - READY.back)));
  return mix(CONTACT_ANGLE, through, easeOut((t - c) / 0.45));
}

/** Paddle centre and long axis at time t: ready, blended into the swing during the backswing. */
export function paddleAt(t: number): { centre: Vec3; axis: Vec3 } {
  const swing = paddlePose(swingAngle(t));
  if (t >= READY.back) return swing;
  const k = easeInOut((t - READY.until) / (READY.back - READY.until));
  const centre = lerp(READY.centre, swing.centre, k);
  centre.y -= 1.6 * Math.sin(Math.PI * k); // drop out of frame rather than sweep past the lens
  return { centre, axis: normalize(lerp(READY.axis, swing.axis, k)) };
}
const easeIn = (t: number) => clamp01(t) ** 2;
const easeOut = (t: number) => 1 - (1 - clamp01(t)) ** 2;

function ballAt(t: number): Vec3 {
  const p0 = contactPoint();
  if (t < T.contact) {
    // Dropped from the left hand, falls into the paddle's path.
    const k = clamp01((t - T.drop) / (T.contact - T.drop));
    return v(p0.x - 0.05, p0.y + 1.6 * (1 - k * k), p0.z + 0.05);
  }
  if (t < LANDING) return flightPoint(flightFraction((t - T.contact) / T.flight));
  return kickPoint((t - LANDING) / T.kick);
}

export interface Framing {
  /** Viewport width / height. */
  aspect: number;
}

/** Final composition: low behind the mat, sun behind it. Wide frames leave the left for the copy. */
export function finalCamera(f: Framing): { eye: Vec3; look: Vec3; fovY: number } {
  const wide = f.aspect >= 1.15;
  return wide
    ? { eye: v(15.0, 2.6, 11.5), look: v(17.0, 1.3, 0), fovY: 0.72 }
    : { eye: v(17.4, 2.8, 12.5), look: v(18.6, 1.4, 0), fovY: 0.86 };
}

const START_EYE = v(1.05, 5.5, 46.6);
const START_LOOK = v(2.2, 0.6, 36.6);

export function shotAt(t: number, framing: Framing): Shot {
  const ball = ballAt(t);
  const streak: Vec3[] = [];
  for (let i = 8; i >= 0; i--) {
    const at = t - i * 0.012;
    if (at >= T.contact) streak.push(ballAt(at));
  }

  const angle = swingAngle(t);
  const swingSpeed = Math.abs(swingAngle(t + 0.01) - angle) / 0.01;

  // Camera: look down at the drop, tilt up after contact to find the ball, then
  // fly with it over the net and drift into the final frame.
  const end = finalCamera(framing);
  const fly = easeInOut((t - (T.contact + 0.35)) / (T.flight + T.kick * 0.6));
  const settle = smooth((t - LANDING - T.kick * 0.35) / (T.settle + T.kick * 0.65));
  const midEye = lerp(START_EYE, end.eye, fly);
  midEye.y += 3.2 * Math.sin(Math.PI * fly);
  const eye = midEye;

  const follow = smooth((t - T.contact + 0.05) / 0.5) * (1 - settle);
  const base = lerp(START_LOOK, end.look, fly);
  // Lead the ball slightly so it sits a little below centre while it climbs.
  const target = add(ball, v(0, 0.4, -1.5));
  const look = lerp(lerp(base, target, follow * 0.7), end.look, settle);

  const sinceLanding = t >= LANDING ? t - LANDING : null;
  const flash = t >= T.contact ? Math.max(0, 1 - (t - T.contact) / 0.12) : 0;
  const shake =
    (t >= T.contact ? 7 * Math.exp(-(t - T.contact) * 14) : 0) +
    (sinceLanding !== null ? 4 * Math.exp(-sinceLanding * 10) : 0);

  return {
    ball,
    streak,
    swing: t < T.contact + 0.6 ? angle : null,
    swingSpeed,
    eye,
    look,
    fovY: mix(1.3, end.fovY, fly),
    flash,
    sinceLanding,
    settle,
    shake,
    done: t >= DURATION,
  };
}

/** Reduced motion and the resting state after the animation: the freeze, framed. */
export function finalShot(framing: Framing): Shot {
  return shotAt(DURATION, framing);
}

/** Points for a ground position on the mat (0 off the fan). */
export function matScore(p: Vec3): 0 | 1 | 3 | 5 {
  const r = Math.hypot(MAT.cornerX - p.x, p.z);
  if (p.x > MAT.cornerX || p.z < 0) return 0;
  return r <= MAT.z5 ? 5 : r <= MAT.z3 ? 3 : r <= MAT.z1 ? 1 : 0;
}

/** Deterministic pseudo-random in [0, 1) for scenery and dust. */
export function rand(seed: number): number {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}
