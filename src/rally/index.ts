// Scroll rally: a paddle rides down the right edge of the viewport and returns a
// ball into each section. Each landing marks the section title with the zone it
// hit, and the paddle face keeps the running score — 21 by the time you reach
// the contact section. Decorative only (aria-hidden); skipped under reduced motion.

import { RALLY_END, RALLY_STOPS, buildRally, frameAt, type Layout, type Rally, type Vec } from './track';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Paddle geometry in its own units; origin is the butt of the handle. */
const FACE = { w: 62, h: 92, cy: -88 } as const;
const REST_ANGLE = -38;
const BALL_R = 9;

function el<K extends keyof SVGElementTagNameMap>(name: K, attrs: Record<string, string | number> = {}): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}

function rotate(p: Vec, deg: number): Vec {
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return { x: p.x * c - p.y * s, y: p.x * s + p.y * c };
}

function buildPaddle(): { root: SVGGElement; face: SVGGElement } {
  const root = el('g', { class: 'rally-paddle' });
  const face = el('g', { class: 'rally-paddle__body' });
  face.append(
    el('rect', { class: 'rally-paddle__handle', x: -7, y: -46, width: 14, height: 46, rx: 5 }),
    ...[-8, -16, -24, -32].map((y) => el('line', { class: 'rally-paddle__grip', x1: -7, y1: y, x2: 7, y2: y - 4 })),
    el('path', { class: 'rally-paddle__throat', d: 'M-6,-40 L-12,-44 H12 L6,-40 Z' }),
    el('rect', { class: 'rally-paddle__face', x: -FACE.w / 2, y: FACE.cy - FACE.h / 2, width: FACE.w, height: FACE.h, rx: 24 }),
    el('rect', { class: 'rally-paddle__inlay', x: -FACE.w / 2 + 7, y: FACE.cy - FACE.h / 2 + 7, width: FACE.w - 14, height: FACE.h - 14, rx: 18 }),
  );
  root.append(face);
  return { root, face };
}

function buildBall(): SVGGElement {
  const g = el('g', { class: 'rally-ball' });
  g.append(
    el('circle', { class: 'ball', r: BALL_R }),
    ...[
      [-3.2, -3],
      [3, -2.6],
      [-1.4, 3.4],
      [3.6, 3.2],
    ].map(([cx, cy]) => el('circle', { class: 'ball-hole', cx: cx!, cy: cy!, r: 1.5 })),
  );
  return g;
}

function addMarks(): HTMLElement[] {
  const marks: HTMLElement[] = [];
  for (const stop of RALLY_STOPS) {
    const title = document.querySelector<HTMLElement>(`#${stop.id} .section__title`);
    if (!title) continue;
    const mark = document.createElement('span');
    mark.className = `rally-mark rally-mark--${stop.points}`;
    mark.setAttribute('aria-hidden', 'true');
    mark.textContent = String(stop.points);
    title.append(' ', mark);
    marks.push(mark);
  }
  return marks;
}

/** Where the hero's opening serve left its ball, relative to the hero canvas (see hero-serve). */
export interface ServeRest {
  canvas: HTMLCanvasElement;
  x: number;
  y: number;
  r: number;
}

/** Returns true when the rally is running (it then takes the hero's ball over once it rests). */
export function initRally(reducedMotion: MediaQueryList): boolean {
  if (reducedMotion.matches) return false;
  const sections = RALLY_STOPS.map((s) => document.getElementById(s.id));
  const endNode = document.querySelector(RALLY_END);
  if (sections.some((s) => !s) || !endNode) return false;
  const end: Element = endNode;

  const marks = addMarks();
  if (marks.length !== RALLY_STOPS.length) return false;

  const svg = el('svg', { class: 'rally', 'aria-hidden': 'true', focusable: 'false' });
  const trail = el('polyline', { class: 'rally-trail' });
  const shadow = el('ellipse', { class: 'rally-shadow', rx: BALL_R, ry: BALL_R * 0.4 });
  const impact = el('circle', { class: 'rally-impact', r: 22 });
  const { root: paddle, face } = buildPaddle();
  const score = el('text', { class: 'rally-score', 'text-anchor': 'middle', 'dominant-baseline': 'central' });
  const ball = buildBall();
  svg.append(trail, shadow, paddle, impact, score, ball);
  document.body.append(svg);

  const container = document.querySelector<HTMLElement>('main .container');

  let rally: Rally = buildRally({ vh: 1, maxScroll: 0, contact: { x: 0, y: 0 }, stops: [], endTop: 0 });
  let pivot: Vec = { x: 0, y: 0 };
  let scale = 1;
  let vw = 0;
  let lastScroll = window.scrollY;
  let lastScore = -1;
  let raf = 0;
  let serve: ServeRest | null = null;

  /** Viewport point of the paddle's hitting edge for a given rotation. */
  const contactAt = (angle: number): Vec => {
    const local = rotate({ x: (-FACE.w / 2 - BALL_R) * scale, y: FACE.cy * scale }, angle);
    return { x: pivot.x + local.x, y: pivot.y + local.y };
  };

  function measure(): void {
    vw = document.documentElement.clientWidth;
    const vh = window.innerHeight;
    const narrow = vw < 720;

    // Park the paddle face in the right-hand margin when there is one, otherwise
    // let it peek in from the edge.
    let space = 16;
    if (container) {
      const r = container.getBoundingClientRect();
      space = vw - (r.right - parseFloat(getComputedStyle(container).paddingRight));
    }
    // Full-size paddle only when it fits in the margin beside the content.
    scale = narrow ? 0.7 : space > 120 ? 1.2 : 0.85;
    const faceX = vw - Math.min(110, Math.max(42 * scale, space / 2));
    const faceY = vh * (narrow ? 0.74 : 0.58);
    const offset = rotate({ x: 0, y: FACE.cy * scale }, REST_ANGLE);
    pivot = { x: faceX - offset.x, y: faceY - offset.y };

    const y = window.scrollY;
    const docY = (node: Element) => node.getBoundingClientRect().top + y;
    const layout: Layout = {
      vh,
      maxScroll: document.documentElement.scrollHeight - vh,
      contact: contactAt(REST_ANGLE),
      stops: RALLY_STOPS.map((stop, i) => {
        const r = marks[i]!.getBoundingClientRect();
        return {
          top: docY(sections[i]!),
          mark: { x: r.left + r.width / 2, y: r.top + r.height / 2 + y },
          points: stop.points,
        };
      }),
      endTop: docY(end),
      serve: serve
        ? (() => {
            const r = serve.canvas.getBoundingClientRect();
            return { x: r.left + serve.x, y: r.top + y + serve.y };
          })()
        : null,
    };
    rally = buildRally(layout);
    svg.setAttribute('viewBox', `0 0 ${vw} ${vh}`);
    shadow.setAttribute('rx', String(BALL_R * scale));
    shadow.setAttribute('ry', String(BALL_R * scale * 0.4));
  }

  function pop(node: Element, cls: string): void {
    node.classList.remove(cls);
    void (node as HTMLElement).getBoundingClientRect();
    node.classList.add(cls);
  }

  function draw(): void {
    raf = 0;
    const scroll = window.scrollY;
    const f = frameAt(rally, scroll);
    const slide = (1 - f.enter) * 160 * scale;
    const angle = REST_ANGLE + f.swing;

    paddle.setAttribute('transform', `translate(${pivot.x + slide} ${pivot.y}) rotate(${angle}) scale(${scale})`);
    const faceCentre = rotate({ x: 0, y: FACE.cy * scale }, angle);
    score.setAttribute('x', String(pivot.x + slide + faceCentre.x));
    score.setAttribute('y', String(pivot.y + faceCentre.y));
    score.style.fontSize = `${40 * scale}px`;

    if (f.score !== lastScore) {
      score.textContent = f.score > 0 ? String(f.score) : '';
      face.classList.toggle('is-21', f.score >= 21);
      score.classList.toggle('is-21', f.score >= 21);
      if (lastScore >= 0 && f.score > lastScore) pop(score, 'is-pop');
      lastScore = f.score;
    }

    let b = f.ball;
    if (!b) {
      const held = contactAt(angle);
      b = { x: held.x + slide, y: held.y };
    }
    // Coming out of the hero, the ball starts at the size it was drawn there.
    const k = f.intro === null || !serve ? 1 : f.intro * f.intro * (3 - 2 * f.intro);
    const base = serve && f.intro !== null ? serve.r / BALL_R + (scale - serve.r / BALL_R) * k : scale;
    const s = (1 + f.height * 0.6) * base;
    ball.setAttribute('transform', `translate(${b.x} ${b.y}) scale(${s})`);
    if (f.shadow) {
      shadow.setAttribute('cx', String(f.shadow.x));
      shadow.setAttribute('cy', String(f.shadow.y));
      shadow.style.opacity = String(0.4 * (1 - f.height * 0.6) * Math.min(1, k * 4));
    } else {
      shadow.style.opacity = '0';
    }
    trail.setAttribute('points', f.trail.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' '));

    f.landed.forEach((landed, i) => {
      const mark = marks[i]!;
      const was = mark.classList.contains('is-landed');
      mark.classList.toggle('is-landed', landed);
      if (landed && !was && scroll > lastScroll) pop(mark, 'is-bounce');
    });

    // Contact flash when the paddle meets the ball on the way down.
    for (const seg of rally.segments) {
      if (lastScroll < seg.hit && scroll >= seg.hit) {
        const c = contactAt(REST_ANGLE);
        impact.setAttribute('cx', String(c.x));
        impact.setAttribute('cy', String(c.y));
        pop(impact, 'is-hit');
        break;
      }
    }
    lastScroll = scroll;
  }

  const schedule = () => {
    if (!raf) raf = requestAnimationFrame(draw);
  };
  const remeasure = () => {
    measure();
    schedule();
  };

  measure();
  lastScroll = window.scrollY;
  draw();
  const listening = new AbortController();
  // Hand-off with the hero's opening serve: take its ball once it rests, give it back on replay.
  window.addEventListener(
    'hero-serve:rest',
    (e) => {
      serve = (e as CustomEvent<ServeRest>).detail;
      remeasure();
    },
    { signal: listening.signal },
  );
  window.addEventListener(
    'hero-serve:play',
    () => {
      serve = null;
      remeasure();
    },
    { signal: listening.signal },
  );
  const resizes = new ResizeObserver(remeasure);
  window.addEventListener('scroll', schedule, { passive: true, signal: listening.signal });
  window.addEventListener('resize', remeasure, { signal: listening.signal });
  resizes.observe(document.body);
  document.fonts?.ready.then(remeasure);
  reducedMotion.addEventListener(
    'change',
    (e) => {
      if (!e.matches) return;
      listening.abort();
      resizes.disconnect();
      cancelAnimationFrame(raf);
      svg.remove();
      for (const mark of marks) mark.remove();
    },
    { signal: listening.signal },
  );
  return true;
}
