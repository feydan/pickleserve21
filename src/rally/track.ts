// Scroll-driven rally: a paddle fixed in the viewport hits a ball at the top of
// each section; the ball bounces on a mark beside that section's title and comes
// back to the paddle in time for the next section. Pure, no DOM. Everything is a
// function of scroll position so scrolling back up rewinds the rally.

export interface Vec {
  x: number;
  y: number;
}

export type Points = 1 | 3 | 5;

/** The opening serve in the hero lands on the red 5, so the rally starts there. */
export const START_SCORE = 5;

/** Section id → points scored when the ball lands there. With the opening 5: nine balls, 21 points. */
export const RALLY_STOPS: { id: string; points: Points }[] = [
  { id: 'why', points: 1 },
  { id: 'how', points: 3 },
  { id: 'play', points: 1 },
  { id: 'strategy', points: 3 },
  { id: 'scorekeeper', points: 1 },
  { id: 'scoresheet', points: 1 },
  { id: 'care', points: 1 },
  { id: 'contact', points: 5 },
];

/** Where the rally ends and the ball comes back to rest on the paddle. */
export const RALLY_END = '.site-footer';

export interface Stop {
  /** Document y of the section's top edge (where the paddle meets the ball). */
  top: number;
  /** Document position of the bounce mark's centre. */
  mark: Vec;
  points: Points;
}

export interface Layout {
  vh: number;
  maxScroll: number;
  /** Viewport position of the ball at the moment of contact. */
  contact: Vec;
  stops: Stop[];
  /** Document y where the rally ends (the ball comes back to rest on the paddle). */
  endTop: number;
  /** Document position of the opening serve's ball, resting in the hero; the rally picks it up from there. */
  serve?: Vec | null;
}

export interface Segment {
  hit: number;
  bounce: number;
  end: number;
  /** Document positions. */
  from: Vec;
  mark: Vec;
  to: Vec;
  points: Points;
}

export interface Rally {
  segments: Segment[];
  /** The opening serve's ball coming back to the paddle for the first hit, or null without one. */
  intro: Segment | null;
  /** Scroll distance of a full swing, either side of contact. */
  swingSpan: number;
  /** Peak ball height (px) on the way out. */
  apex: number;
  /** Scroll at which the paddle has fully slid in. */
  enterEnd: number;
}

export interface Frame {
  /** Viewport position of the ball, or null while it rests on the paddle. */
  ball: Vec | null;
  shadow: Vec | null;
  /** 0 on the ground, 1 at the top of the arc. */
  height: number;
  /** Recent ball path, viewport coordinates, oldest first. */
  trail: Vec[];
  /** Paddle rotation offset in degrees: positive = wound back, negative = follow-through. */
  swing: number;
  /** 0 = off-screen, 1 = fully in. */
  enter: number;
  score: number;
  landed: boolean[];
  /** 0–1 progress of the ball from the hero to the first hit, or null outside it. */
  intro: number | null;
}

/** Where the mark sits in the viewport when the ball lands on it (fraction of vh). */
export const BOUNCE_LINE = 0.4;
export const WIND_UP = 26;
export const FOLLOW_THROUGH = 34;

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const smooth = (t: number) => {
  const c = clamp(t, 0, 1);
  return c * c * (3 - 2 * c);
};
const lerp = (a: Vec, b: Vec, t: number): Vec => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

export function buildRally(layout: Layout): Rally {
  const { vh, maxScroll, contact, stops, endTop } = layout;
  const toScroll = (top: number) => clamp(top - contact.y, 0, Math.max(0, maxScroll - 1));
  const segments: Segment[] = stops.map((stop, i) => {
    const hit = toScroll(stop.top);
    const nextTop = stops[i + 1]?.top ?? endTop;
    const end = Math.max(hit + 1, toScroll(nextTop));
    const span = end - hit;
    const bounce = clamp(stop.mark.y - vh * BOUNCE_LINE, hit + span * 0.15, hit + span * 0.85);
    return {
      hit,
      bounce,
      end,
      from: { x: contact.x, y: hit + contact.y },
      mark: stop.mark,
      to: { x: contact.x, y: end + contact.y },
      points: stop.points,
    };
  });
  const firstHit = segments[0]?.hit ?? vh;
  const first = segments[0];
  const intro: Segment | null =
    layout.serve && first && first.hit > 0
      ? { hit: 0, bounce: 0, end: first.hit, from: layout.serve, mark: layout.serve, to: first.from, points: START_SCORE }
      : null;
  return {
    segments,
    intro,
    swingSpan: vh * 0.22,
    apex: Math.min(vh * 0.14, 120),
    enterEnd: Math.max(1, Math.min(vh * 0.35, firstHit * 0.6)),
  };
}

/** Document position of the ball (height already lifted off the ground) plus its ground point. */
export function ballAt(seg: Segment, scroll: number, apex: number): { ball: Vec; ground: Vec; height: number } {
  let ground: Vec;
  let height: number;
  if (scroll < seg.bounce) {
    const p = clamp((scroll - seg.hit) / (seg.bounce - seg.hit), 0, 1);
    ground = lerp(seg.from, seg.mark, p);
    height = Math.sin(Math.PI * p);
  } else {
    const p = clamp((scroll - seg.bounce) / (seg.end - seg.bounce), 0, 1);
    ground = lerp(seg.mark, seg.to, p);
    height = Math.sin(Math.PI * p) * 0.7;
  }
  return { ball: { x: ground.x, y: ground.y - height * apex }, ground, height };
}

/** Paddle swing around one contact; u is scroll distance from contact in swing spans. */
export function swingAt(u: number): number {
  if (u <= -1.5 || u >= 1.5) return 0;
  if (u < -0.4) return WIND_UP * smooth((u + 1.5) / 1.1);
  if (u < 0) return WIND_UP * (1 - smooth((u + 0.4) / 0.4));
  if (u < 0.4) return -FOLLOW_THROUGH * smooth(u / 0.4);
  return -FOLLOW_THROUGH * (1 - smooth((u - 0.4) / 1.1));
}

export function frameAt(rally: Rally, scroll: number): Frame {
  const { segments, apex, swingSpan } = rally;
  const landed = segments.map((s) => scroll >= s.bounce);
  const score = segments.reduce((sum, s, i) => (landed[i] ? sum + s.points : sum), START_SCORE);

  let swing = 0;
  let nearest = Infinity;
  for (const s of segments) {
    const d = scroll - s.hit;
    if (Math.abs(d) < Math.abs(nearest)) nearest = d;
  }
  if (Number.isFinite(nearest)) swing = swingAt(nearest / swingSpan);

  const frame: Frame = {
    ball: null,
    shadow: null,
    height: 0,
    trail: [],
    swing,
    enter: smooth(scroll / rally.enterEnd),
    score,
    landed,
    intro: null,
  };

  const seg = [rally.intro, ...segments].find((s): s is Segment => !!s && scroll >= s.hit && scroll < s.end);
  if (!seg) return frame;
  if (seg === rally.intro) frame.intro = clamp(scroll / seg.end, 0, 1);

  const now = ballAt(seg, scroll, apex);
  frame.ball = { x: now.ball.x, y: now.ball.y - scroll };
  frame.shadow = { x: now.ground.x, y: now.ground.y - scroll };
  frame.height = now.height;

  // The trail is anchored to the document, so it scrolls away with the page.
  const length = swingSpan * 0.6;
  const samples = 10;
  for (let i = samples; i >= 0; i--) {
    const at = scroll - (length * i) / samples;
    if (at < seg.hit) continue;
    const p = ballAt(seg, at, apex).ball;
    frame.trail.push({ x: p.x, y: p.y - scroll });
  }
  return frame;
}
