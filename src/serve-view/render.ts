// Builds the server's-eye SVG once, then re-projects it for every frame.

import {
  add,
  groundMatrix,
  lookAt,
  polygonPath,
  polylinePath,
  project,
  toCamera,
  v,
  type Camera,
  type Vec3,
} from './projection';
import { COURT, FAN, NET_HEIGHT, contactPoint, scoreAt, type Frame, type Scenario, type Serve, type Target } from './scene';

export const VIEW = { width: 800, height: 500, fovY: (58 * Math.PI) / 180 } as const;

const SVG_NS = 'http://www.w3.org/2000/svg';
const LINE_WIDTH = 0.22; // ft; a touch wider than a real 2" line so it reads at distance

function el<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number> = {},
  parent?: Element,
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, val] of Object.entries(attrs)) node.setAttribute(k, String(val));
  parent?.appendChild(node);
  return node;
}

const rect = (x0: number, z0: number, x1: number, z1: number): Vec3[] => [
  v(x0, 0, z0),
  v(x1, 0, z0),
  v(x1, 0, z1),
  v(x0, 0, z1),
];

/** Vertical wall quad in the plane through (x0,z0)–(x1,z1). */
const wall = (x0: number, z0: number, x1: number, z1: number, y0: number, y1: number): Vec3[] => [
  v(x0, y0, z0),
  v(x1, y0, z1),
  v(x1, y1, z1),
  v(x0, y1, z0),
];

function circle(c: Vec3, r: number, n = 20): Vec3[] {
  return Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    return v(c.x + Math.cos(a) * r, 0, c.z + Math.sin(a) * r);
  });
}

/** Quarter-circle wedge of the fan mat in world space. */
function fanWedge(t: { cornerX: number; dir: 1 | -1 }, r: number, n = 18): Vec3[] {
  const pts = [v(t.cornerX, 0, 0)];
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * (Math.PI / 2);
    pts.push(v(t.cornerX + t.dir * Math.cos(a) * r, 0, Math.sin(a) * r));
  }
  return pts;
}

/** Split a ground line into short pieces so each gets a depth-correct stroke width. */
function lineSegments(a: Vec3, b: Vec3, step = 2): [Vec3, Vec3][] {
  const len = Math.hypot(b.x - a.x, b.z - a.z);
  const n = Math.max(1, Math.ceil(len / step));
  const out: [Vec3, Vec3][] = [];
  for (let i = 0; i < n; i++) {
    const t0 = i / n;
    const t1 = (i + 1) / n;
    out.push([
      v(a.x + (b.x - a.x) * t0, 0, a.z + (b.z - a.z) * t0),
      v(a.x + (b.x - a.x) * t1, 0, a.z + (b.z - a.z) * t1),
    ]);
  }
  return out;
}

interface Poly {
  node: SVGPathElement;
  pts: Vec3[];
}

interface GroundText {
  node: SVGTextElement;
  at: Vec3;
}

interface Receiver {
  node: SVGGElement;
  at: Vec3;
}

export interface ServeViewRenderer {
  svg: SVGSVGElement;
  setScenario(sc: Scenario): void;
  draw(frame: Frame, serve: Serve): void;
}

export function createRenderer(svg: SVGSVGElement): ServeViewRenderer {
  svg.setAttribute('viewBox', `0 0 ${VIEW.width} ${VIEW.height}`);

  const defs = el('defs', {}, svg);
  const sky = el('linearGradient', { id: 'pv-sky', x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
  el('stop', { offset: 0, class: 'pv-sky-top' }, sky);
  el('stop', { offset: 1, class: 'pv-sky-bottom' }, sky);
  el('rect', { class: 'pv-backdrop', x: 0, y: 0, width: VIEW.width, height: VIEW.height, fill: 'url(#pv-sky)' }, svg);

  const polys: Poly[] = [];
  const addPoly = (parent: Element, cls: string, pts: Vec3[]): Poly => {
    const p = { node: el('path', { class: cls }, parent), pts };
    polys.push(p);
    return p;
  };

  // --- hall: walls, light strips, floor
  const hall = el('g', {}, svg);
  addPoly(hall, 'pv-wall', wall(-40, -18, 60, -18, 0, 22));
  addPoly(hall, 'pv-wall pv-wall--side', wall(-16, -18, -16, 80, 0, 22));
  addPoly(hall, 'pv-wall pv-wall--side', wall(36, -18, 36, 80, 0, 22));
  addPoly(hall, 'pv-curtain', wall(-40, -17.9, 60, -17.9, 0, 9));
  addPoly(hall, 'pv-curtain', wall(-15.9, -18, -15.9, 80, 0, 9));
  addPoly(hall, 'pv-curtain', wall(35.9, -18, 35.9, 80, 0, 9));
  for (const x of [-6, 10, 26]) addPoly(hall, 'pv-light', wall(x - 3, -17.8, x + 3, -17.8, 17, 18));
  addPoly(hall, 'pv-floor', rect(-16, -18, 36, 80));

  // --- court
  const court = el('g', {}, svg);
  addPoly(court, 'court-surround', rect(-7, -9, 27, 53));
  addPoly(court, 'court-surface', rect(0, 0, COURT.width, COURT.length));
  addPoly(court, 'court-kitchen', rect(0, COURT.net - COURT.kitchen, COURT.width, COURT.net + COURT.kitchen));

  const targetLayer = el('g', {}, svg);
  const lineLayer = el('g', { class: 'pv-lines' }, svg);
  const segs: { node: SVGLineElement; a: Vec3; b: Vec3 }[] = [];
  const W = COURT.width;
  const L = COURT.length;
  const courtLines: [Vec3, Vec3][] = [
    [v(0, 0, 0), v(W, 0, 0)],
    [v(0, 0, L), v(W, 0, L)],
    [v(0, 0, 0), v(0, 0, L)],
    [v(W, 0, 0), v(W, 0, L)],
    [v(0, 0, COURT.net - COURT.kitchen), v(W, 0, COURT.net - COURT.kitchen)],
    [v(0, 0, COURT.net + COURT.kitchen), v(W, 0, COURT.net + COURT.kitchen)],
    [v(W / 2, 0, 0), v(W / 2, 0, COURT.net - COURT.kitchen)],
    [v(W / 2, 0, COURT.net + COURT.kitchen), v(W / 2, 0, L)],
  ];
  for (const [a, b] of courtLines) {
    for (const [sa, sb] of lineSegments(a, b)) segs.push({ node: el('line', {}, lineLayer), a: sa, b: sb });
  }

  const groundTexts: GroundText[] = [];
  const shadow = addPoly(el('g', {}, svg), 'pv-shadow', []);
  const ripple = el('path', { class: 'pv-ripple' }, svg);

  // --- upright things, re-ordered each frame around the net
  const uprights = el('g', {}, svg);
  const receiverLayer = el('g', {}, uprights);
  const receivers: Receiver[] = [];

  const net = el('g', { class: 'pv-net' }, uprights);
  const netMeshFill = el('path', { class: 'pv-net__fill' }, net);
  const netMesh = el('path', { class: 'pv-net__mesh' }, net);
  const netTape = el('path', { class: 'pv-net__tape' }, net);
  const posts = [el('line', { class: 'pv-net__post' }, net), el('line', { class: 'pv-net__post' }, net)];
  const sag = (x: number) => NET_HEIGHT.post - (NET_HEIGHT.post - NET_HEIGHT.center) * (1 - ((x - 10) / 11) ** 2);
  const netXs = Array.from({ length: 23 }, (_, i) => i - 1);
  const netTop = netXs.map((x) => v(x, sag(x), COURT.net));
  const netBottom = netXs.map((x) => v(x, 0.15, COURT.net));

  const ballLayer = el('g', {}, uprights);
  const trail = el('path', { class: 'pv-trail' }, ballLayer);
  const ball = el('g', { class: 'pv-ball' }, ballLayer);
  el('circle', { class: 'ball', r: 0.24 }, ball);
  for (const [x, y] of [
    [-0.08, -0.07],
    [0.08, -0.06],
    [-0.03, 0.09],
  ] as const) {
    el('circle', { class: 'ball-hole', cx: x, cy: y, r: 0.035 }, ball);
  }

  // --- screen-space overlay: score pop + the server's paddle
  const pop = el('text', { class: 'pv-pop', 'text-anchor': 'middle' }, svg);
  const paddle = el('g', { class: 'pv-paddle' }, svg);
  el('rect', { class: 'pv-paddle__handle', x: -13, y: 60, width: 26, height: 78, rx: 9 }, paddle);
  el('rect', { class: 'pv-paddle__face', x: -62, y: -92, width: 124, height: 160, rx: 52 }, paddle);
  el('rect', { class: 'pv-paddle__edge', x: -62, y: -92, width: 124, height: 160, rx: 52 }, paddle);

  let targets: Target[] = [];

  function setScenario(sc: Scenario): void {
    targets = sc.targets;
    targetLayer.replaceChildren();
    receiverLayer.replaceChildren();
    for (let i = polys.length - 1; i >= 0; i--) {
      if (polys[i]!.node.parentNode === targetLayer) polys.splice(i, 1);
    }
    groundTexts.length = 0;
    receivers.length = 0;

    const num = (txt: string, at: Vec3, size: number) => {
      const node = el('text', { class: 'pv-num', 'text-anchor': 'middle', y: size * 0.36, 'font-size': size }, targetLayer);
      node.textContent = txt;
      groundTexts.push({ node, at });
    };

    for (const t of sc.targets) {
      if (t.kind === 'rect') {
        addPoly(targetLayer, 'z5', rect(t.x, t.z, t.x + t.w, t.z + t.d));
        num('5', v(t.x + t.w / 2, 0, t.z + t.d / 2), Math.min(1.4, t.w * 0.8));
        continue;
      }
      const x0 = t.cornerX;
      const x1 = t.cornerX + t.dir * FAN.size;
      addPoly(targetLayer, 'mat-white', rect(Math.min(x0, x1), 0, Math.max(x0, x1), FAN.size));
      addPoly(targetLayer, 'z1', fanWedge(t, FAN.z1));
      addPoly(targetLayer, 'z3', fanWedge(t, FAN.z3));
      addPoly(targetLayer, 'z5', fanWedge(t, FAN.z5));
      // Numerals along the fan's diagonal, as on the mat.
      const diag = (r: number) => v(t.cornerX + t.dir * r * Math.SQRT1_2, 0, r * Math.SQRT1_2);
      num('5', diag(1.6), 1.7);
      num('3', diag(4.3), 1.6);
      num('1', diag(6.8), 1.5);
    }

    for (const r of sc.receivers) {
      const node = el('g', { class: 'pv-receiver' }, receiverLayer);
      // Local units are feet, y up is negative. Facing the server, a righty's
      // paddle is on the server's left.
      const side = r.hand === 'R' ? -1 : 1;
      el('rect', { class: 'pv-receiver__body', x: -0.75, y: -4.5, width: 1.5, height: 4.4, rx: 0.6 }, node);
      el('circle', { class: 'pv-receiver__head', cx: 0, cy: -5.15, r: 0.5 }, node);
      el('line', { class: 'pv-receiver__arm', x1: side * 0.6, y1: -3.6, x2: side * 1.3, y2: -2.6 }, node);
      el('ellipse', { class: 'pv-receiver__paddle', cx: side * 1.45, cy: -2.1, rx: 0.4, ry: 0.5 }, node);
      const letter = el('text', { class: 'pv-receiver__letter', x: 0, y: -2.2, 'text-anchor': 'middle' }, node);
      letter.textContent = r.hand;
      receivers.push({ node, at: v(r.x, 0, r.z) });
    }
  }

  function depthScale(cam: Camera, p: Vec3): number | null {
    const c = toCamera(cam, p);
    return c.z < 0.3 ? null : cam.focal / c.z;
  }

  function placeBillboard(cam: Camera, node: SVGGElement, at: Vec3): void {
    const s = project(cam, at);
    const k = depthScale(cam, at);
    if (!s || !k) {
      node.setAttribute('display', 'none');
      return;
    }
    node.removeAttribute('display');
    node.setAttribute('transform', `translate(${s.x.toFixed(1)},${s.y.toFixed(1)}) scale(${k.toFixed(3)})`);
  }

  function draw(frame: Frame, serve: Serve): void {
    const cam = lookAt(frame.eye, frame.look, VIEW);

    for (const p of polys) p.node.setAttribute('d', polygonPath(cam, p.pts));

    for (const s of segs) {
      const a = project(cam, s.a);
      const b = project(cam, s.b);
      if (!a || !b) {
        s.node.setAttribute('display', 'none');
        continue;
      }
      const k = depthScale(cam, v((s.a.x + s.b.x) / 2, 0, (s.a.z + s.b.z) / 2)) ?? 0;
      s.node.removeAttribute('display');
      s.node.setAttribute('x1', a.x.toFixed(1));
      s.node.setAttribute('y1', a.y.toFixed(1));
      s.node.setAttribute('x2', b.x.toFixed(1));
      s.node.setAttribute('y2', b.y.toFixed(1));
      s.node.style.strokeWidth = Math.min(10, Math.max(0.7, k * LINE_WIDTH)).toFixed(2);
    }

    for (const g of groundTexts) {
      const m = groundMatrix(cam, g.at);
      if (m) {
        g.node.setAttribute('transform', m);
        g.node.removeAttribute('display');
      } else {
        g.node.setAttribute('display', 'none');
      }
    }

    // Ball shadow: tighter and darker as the ball nears the ground.
    const h = Math.max(0, frame.ball.y);
    shadow.pts = circle(v(frame.ball.x, 0, frame.ball.z), 0.28 + h * 0.03, 16);
    shadow.node.setAttribute('d', polygonPath(cam, shadow.pts));
    shadow.node.style.opacity = (frame.ballOpacity * Math.max(0.15, 0.55 - h * 0.05)).toFixed(2);

    // Landing ripple + score pop.
    const since = frame.sinceLanding;
    if (since !== null && since < 1.1) {
      const k = since / 1.1;
      ripple.setAttribute('d', polygonPath(cam, circle(serve.land, 0.3 + 2.2 * k, 28)));
      ripple.style.opacity = (1 - k).toFixed(2);
    } else {
      ripple.setAttribute('d', '');
    }
    const pts = scoreAt(targets, serve.land);
    const popAt = since === null ? null : project(cam, add(serve.land, v(0, 2.2 + Math.min(since, 0.8) * 1.2, 0)));
    if (popAt) {
      pop.textContent = pts ? `+${pts}` : 'Miss';
      pop.setAttribute('class', `pv-pop pv-pop--${pts}`);
      pop.setAttribute('x', popAt.x.toFixed(1));
      pop.setAttribute('y', popAt.y.toFixed(1));
      pop.style.opacity = Math.min(1, (since ?? 0) * 4).toFixed(2);
    } else {
      pop.style.opacity = '0';
    }

    // Net.
    netMeshFill.setAttribute('d', polygonPath(cam, [...netBottom, ...[...netTop].reverse()]));
    let mesh = '';
    for (let i = 0; i < netXs.length; i++) mesh += polylinePath(cam, [netBottom[i]!, netTop[i]!]);
    for (const y of [0.75, 1.5, 2.25]) mesh += polylinePath(cam, netXs.map((x) => v(x, Math.min(y, sag(x)), COURT.net)));
    netMesh.setAttribute('d', mesh);
    netTape.setAttribute('d', polylinePath(cam, netTop));
    const kNet = depthScale(cam, v(frame.eye.x, 0, COURT.net)) ?? 0;
    netTape.style.strokeWidth = Math.min(8, Math.max(1, kNet * 0.17)).toFixed(2);
    [-1, 21].forEach((x, i) => {
      const a = project(cam, v(x, 0, COURT.net));
      const b = project(cam, v(x, NET_HEIGHT.post + 0.1, COURT.net));
      const post = posts[i]!;
      if (!a || !b) return post.setAttribute('display', 'none');
      post.removeAttribute('display');
      post.setAttribute('x1', a.x.toFixed(1));
      post.setAttribute('y1', a.y.toFixed(1));
      post.setAttribute('x2', b.x.toFixed(1));
      post.setAttribute('y2', b.y.toFixed(1));
      post.style.strokeWidth = Math.max(1.5, (depthScale(cam, v(x, 0, COURT.net)) ?? 0) * 0.3).toFixed(2);
    });

    for (const r of receivers) placeBillboard(cam, r.node, r.at);

    trail.setAttribute('d', frame.trail.length > 1 ? polylinePath(cam, frame.trail) : '');
    placeBillboard(cam, ball, frame.ball);
    ball.style.opacity = frame.ballOpacity.toFixed(2);

    // Painter's order around the net: whatever is on the far side of the net
    // from the camera goes behind it. Receivers stand behind the far baseline.
    const camNear = frame.eye.z > COURT.net;
    const ballNear = frame.ball.z > COURT.net;
    const order: Element[] = camNear
      ? [receiverLayer, ...(ballNear ? [net, ballLayer] : [ballLayer, net])]
      : [net, receiverLayer, ballLayer];
    order.forEach((node, i) => {
      if (uprights.children[i] !== node) uprights.insertBefore(node, uprights.children[i] ?? null);
    });

    // Paddle: swings up from below the frame through the contact point, then away.
    const sw = frame.swing;
    const hit = project(cam, contactPoint(serve));
    if (hit && sw < 1) {
      // Quadratic through backswing (0), contact (0.5) and follow-through (1).
      const p0 = { x: hit.x + 120, y: hit.y + 190, r: -35 };
      const p1 = { x: hit.x + 40, y: hit.y + 70, r: -10 };
      const p2 = { x: hit.x - 10, y: hit.y - 200, r: 15 };
      const q = (a: number, b: number, c: number) =>
        a * (1 - sw) * (1 - 2 * sw) + b * 4 * sw * (1 - sw) + c * sw * (2 * sw - 1);
      paddle.setAttribute(
        'transform',
        `translate(${q(p0.x, p1.x, p2.x).toFixed(1)},${q(p0.y, p1.y, p2.y).toFixed(1)}) rotate(${q(p0.r, p1.r, p2.r).toFixed(1)})`,
      );
      paddle.style.opacity = (sw < 0.55 ? 1 : Math.max(0, 1 - (sw - 0.55) / 0.25)).toFixed(2);
    } else {
      paddle.style.opacity = '0';
    }
  }

  return { svg, setScenario, draw };
}
