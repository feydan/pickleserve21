// Canvas painter for the hero shot. Everything is drawn procedurally from the
// world model in shot.ts: golden-hour sky, backlit trees and fence, court with
// long sun shadows, the fan mat, net, ball, the server's arm and paddle, dust,
// then lens bloom, grade, vignette and grain.

import {
  add,
  clipPolygon,
  clipSegment,
  cross,
  lookAt,
  projectCam,
  scale,
  sub,
  toCamera,
  v,
  type Point2,
  type Vec3,
} from '../serve-view/projection';
import { LAND, MAT, SUN, contactPoint, paddleAt, rand, T, type Shot } from './shot';

const BALL_R = 0.121; // ft (2.9 in)
/** Overscan (px) for the soft-focus layer so camera shake never reveals its edge. */
const MARGIN = 24;

const C = {
  courtBlue: '#2b5893',
  surround: '#1f4a3c',
  line: '#e9ecf0',
  red: '#e8432e',
  green: '#3baa4a',
  yellow: '#f5c518',
  white: '#eef1f5',
  ink: '#0b1530',
  silhouette: '#0a1322',
} as const;

/** Left edge of each court in a row of three; ours is the middle one (x = 0). */
const COURTS = [-30, 0, 30];
const FENCE = { left: -42, right: 62, far: -18, near: 62, h: 10 } as const;
/** Light poles on the fence line, lamps just coming on at dusk. */
const LIGHTS: Vec3[] = [
  v(-42, 22, -2),
  v(-42, 22, 46),
  v(62, 22, -2),
  v(62, 22, 46),
  v(-12, 22, -18),
  v(32, 22, -18),
];
/** Earlier serves that rolled out toward the back fence. */
const STRAY_BALLS: Vec3[] = Array.from({ length: 9 }, (_, i) =>
  v(-24 + rand(i + 71) * 34, BALL_R, -16.8 + rand(i + 83) * 5),
);
/** Ground offset of a shadow cast by a point `h` ft above the ground. */
const shadowOf = (p: Vec3): Vec3 => v(p.x - (SUN.x / SUN.y) * p.y, 0, p.z - (SUN.z / SUN.y) * p.y);

interface Scenery {
  carbon: HTMLCanvasElement;
  trees: Vec3[][];
  clouds: HTMLCanvasElement;
  grain: HTMLCanvasElement;
}

/** A row of tree crowns: overlapping round canopies, sampled into a silhouette. */
function treeRow(from: Vec3, to: Vec3, seed: number): Vec3[] {
  const len = Math.hypot(to.x - from.x, to.z - from.z);
  const crowns: { d: number; r: number; h: number }[] = [];
  for (let d = 0, i = 0; d < len; i++) {
    const r = 7 + rand(seed * 31 + i) * 9;
    crowns.push({ d, r, h: 14 + rand(seed * 17 + i) * 16 });
    d += r * (0.8 + rand(seed * 7 + i) * 0.6);
  }
  const top: Vec3[] = [];
  const n = Math.ceil(len / 1.5);
  for (let i = 0; i <= n; i++) {
    const k = i / n;
    const d = k * len;
    let h = 6;
    for (const c of crowns) {
      const dx = d - c.d;
      if (Math.abs(dx) < c.r) h = Math.max(h, c.h + Math.sqrt(c.r * c.r - dx * dx) * 0.8);
    }
    top.push(v(from.x + (to.x - from.x) * k, h, from.z + (to.z - from.z) * k));
  }
  const base = [...top].reverse().map((p) => v(p.x, 0, p.z));
  return [...top, ...base];
}

function makeClouds(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = 1600;
  c.height = 420;
  const g = c.getContext('2d')!;
  // u ∈ [0,1] ↔ azimuth −1.6…1.6 rad; the sun sits at azimuth atan(SUN.x / −SUN.z).
  const sunU = (Math.atan2(SUN.x, -SUN.z) + 1.6) / 3.2;
  for (let i = 0; i < 150; i++) {
    const x = rand(i + 1) * c.width;
    const band = rand(i + 7);
    const y = c.height * (0.25 + band * 0.62);
    const rx = 60 + rand(i + 3) * 190 * (1 - band * 0.4);
    const ry = rx * (0.16 + rand(i + 5) * 0.12);
    const near = 1 - Math.min(1, Math.abs(x / c.width - sunU) * 2.6);
    const lit = 0.25 + 0.75 * near;
    const grad = g.createRadialGradient(x, y + ry * 0.4, 0, x, y, rx);
    grad.addColorStop(0, `rgba(255,${Math.round(150 + 70 * lit)},${Math.round(110 + 60 * lit)},${0.32 * lit + 0.12})`);
    grad.addColorStop(0.6, `rgba(150,90,120,${0.16 + 0.1 * lit})`);
    grad.addColorStop(1, 'rgba(60,50,90,0)');
    g.fillStyle = grad;
    g.beginPath();
    g.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
    g.fill();
  }
  // Feather every edge so the layer never shows a seam.
  g.globalCompositeOperation = 'destination-in';
  const fx = g.createLinearGradient(0, 0, c.width, 0);
  fx.addColorStop(0, 'rgba(0,0,0,0)');
  fx.addColorStop(0.15, '#000');
  fx.addColorStop(0.85, '#000');
  fx.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = fx;
  g.fillRect(0, 0, c.width, c.height);
  const fy = g.createLinearGradient(0, 0, 0, c.height);
  fy.addColorStop(0, 'rgba(0,0,0,0)');
  fy.addColorStop(0.3, '#000');
  fy.addColorStop(0.85, '#000');
  fy.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = fy;
  g.fillRect(0, 0, c.width, c.height);
  return c;
}

function makeGrain(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = 192;
  const g = c.getContext('2d')!;
  const img = g.createImageData(c.width, c.height);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = Math.floor(rand(i * 0.37 + 9) * 255);
    img.data[i] = img.data[i + 1] = img.data[i + 2] = n;
    img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return c;
}

/** Raw carbon twill: alternating diagonal tows in two tones. */
function makeCarbon(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = 16;
  const g = c.getContext('2d')!;
  g.fillStyle = '#181c24';
  g.fillRect(0, 0, 16, 16);
  for (let y = 0; y < 16; y += 4) {
    for (let x = 0; x < 16; x += 4) {
      const even = ((x + y) / 4) % 2 === 0;
      const grad = even ? g.createLinearGradient(x, y, x + 4, y) : g.createLinearGradient(x, y, x, y + 4);
      grad.addColorStop(0, '#20252f');
      grad.addColorStop(0.5, even ? '#343b49' : '#2a303c');
      grad.addColorStop(1, '#1a1e26');
      g.fillStyle = grad;
      g.fillRect(x + 0.3, y + 0.3, 3.4, 3.4);
    }
  }
  return c;
}

export function createScenery(): Scenery {
  return {
    carbon: makeCarbon(),
    trees: [
      treeRow(v(-260, 0, -95), v(280, 0, -95), 1),
      treeRow(v(-90, 0, 140), v(-90, 0, -95), 2),
      treeRow(v(110, 0, -95), v(110, 0, 140), 3),
    ],
    clouds: makeClouds(),
    grain: makeGrain(),
  };
}

export interface Painter {
  /** `hideBall`: the served ball has been handed over to the page rally, so leave it out. */
  draw(shot: Shot, time: number, opts?: { hideBall?: boolean }): void;
  /** Where the served ball is drawn for this shot, in canvas CSS px, with its radius. */
  locate(shot: Shot): { x: number; y: number; r: number } | null;
  resize(width: number, height: number, dpr: number): void;
}

export function createPainter(canvas: HTMLCanvasElement, scenery: Scenery): Painter {
  const ctx = canvas.getContext('2d')!;
  const blur = document.createElement('canvas');
  const bctx = blur.getContext('2d')!;
  let W = 1;
  let H = 1;
  let dpr = 1;

  function resize(width: number, height: number, ratio: number): void {
    W = Math.max(1, width);
    H = Math.max(1, height);
    dpr = ratio;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    blur.width = Math.max(1, Math.round((W + 2 * MARGIN) / 5));
    blur.height = Math.max(1, Math.round((H + 2 * MARGIN) / 5));
  }

  function draw(shot: Shot, time: number, opts: { hideBall?: boolean } = {}): void {
    const cam = lookAt(shot.eye, shot.look, { width: W, height: H, fovY: shot.fovY });
    const f = cam.focal;

    const path = (g: CanvasRenderingContext2D, world: Vec3[], s = 1): boolean => {
      const pts = clipPolygon(world.map((p) => toCamera(cam, p)));
      if (pts.length < 3) return false;
      g.beginPath();
      pts.forEach((c, i) => {
        const p = projectCam(cam, c);
        if (i === 0) g.moveTo(p.x * s, p.y * s);
        else g.lineTo(p.x * s, p.y * s);
      });
      g.closePath();
      return true;
    };
    const fill = (world: Vec3[], style: string | CanvasGradient, alpha = 1): void => {
      if (!path(ctx, world)) return;
      ctx.globalAlpha = alpha;
      ctx.fillStyle = style;
      ctx.fill();
      ctx.globalAlpha = 1;
    };
    const proj = (p: Vec3): (Point2 & { z: number }) | null => {
      const c = toCamera(cam, p);
      if (c.z < 0.3) return null;
      return { ...projectCam(cam, c), z: c.z };
    };
    /** Flat ground quad along a segment (court lines, shadows). */
    const groundStrip = (a: Vec3, b: Vec3, w: number): Vec3[] => {
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const len = Math.hypot(dx, dz) || 1;
      const nx = (-dz / len) * (w / 2);
      const nz = (dx / len) * (w / 2);
      return [v(a.x + nx, a.y, a.z + nz), v(b.x + nx, b.y, b.z + nz), v(b.x - nx, b.y, b.z - nz), v(a.x - nx, a.y, a.z - nz)];
    };
    const arc = (cx: number, cz: number, r: number, from: number, to: number, n: number): Vec3[] =>
      Array.from({ length: n + 1 }, (_, i) => {
        const a = from + ((to - from) * i) / n;
        return v(cx + Math.cos(a) * r, 0.01, cz + Math.sin(a) * r);
      });

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // Contact and landing shake.
    if (shot.shake > 0.05) {
      ctx.translate((rand(time * 97) - 0.5) * shot.shake, (rand(time * 61 + 3) - 0.5) * shot.shake);
    }

    // ------------------------------------------------------------- sky
    const fwd = cam.forward;
    const horizonY = cam.cy - f * (-fwd.y / Math.hypot(fwd.x, fwd.z));
    const sky = ctx.createLinearGradient(0, horizonY - f * 1.1, 0, horizonY);
    sky.addColorStop(0, '#0d1f45');
    sky.addColorStop(0.42, '#2c3566');
    sky.addColorStop(0.7, '#9a5a72');
    sky.addColorStop(0.88, '#ef9a5a');
    sky.addColorStop(1, '#ffd9a1');
    ctx.fillStyle = sky;
    ctx.fillRect(-20, -20, W + 40, H + 40);

    const yaw = Math.atan2(fwd.x, -fwd.z);
    const cloudX = cam.cx + f * (-1.6 - yaw);
    ctx.globalAlpha = 0.9;
    ctx.drawImage(scenery.clouds, cloudX, horizonY - f * 0.66, f * 3.2, f * 0.6);
    ctx.globalAlpha = 1;

    const sunC = toCamera(cam, add(cam.eye, scale(SUN, 4000)));
    const sun = sunC.z > 0 ? projectCam(cam, sunC) : null;
    if (sun) {
      const glow = ctx.createRadialGradient(sun.x, sun.y, 0, sun.x, sun.y, f * 0.75);
      glow.addColorStop(0, 'rgba(255,240,205,0.95)');
      glow.addColorStop(0.05, 'rgba(255,214,150,0.75)');
      glow.addColorStop(0.3, 'rgba(255,160,90,0.28)');
      glow.addColorStop(1, 'rgba(255,140,80,0)');
      ctx.fillStyle = glow;
      ctx.fillRect(-20, -20, W + 40, H + 40);
      ctx.fillStyle = '#fff7e6';
      ctx.beginPath();
      ctx.arc(sun.x, sun.y, Math.max(4, f * 0.016), 0, Math.PI * 2);
      ctx.fill();
    }

    // ------------------------------------------------------------- trees (soft focus)
    bctx.setTransform(1, 0, 0, 1, 0, 0);
    bctx.clearRect(0, 0, blur.width, blur.height);
    const s = blur.width / (W + 2 * MARGIN);
    bctx.translate(MARGIN * s, MARGIN * s);
    bctx.fillStyle = '#0e1828';
    for (const row of scenery.trees) {
      if (path(bctx, row, s)) bctx.fill();
    }
    // Rim light where the sun catches the canopy edge.
    bctx.globalCompositeOperation = 'source-atop';
    if (sun) {
      const rim = bctx.createRadialGradient(sun.x * s, sun.y * s, 0, sun.x * s, sun.y * s, f * 0.35 * s);
      rim.addColorStop(0, 'rgba(255,190,120,0.65)');
      rim.addColorStop(1, 'rgba(255,190,120,0)');
      bctx.fillStyle = rim;
      bctx.fillRect(-MARGIN * s, -MARGIN * s, blur.width, blur.height);
    }
    bctx.globalCompositeOperation = 'source-over';
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(blur, -MARGIN, -MARGIN, W + 2 * MARGIN, H + 2 * MARGIN);

    const haze = ctx.createLinearGradient(0, horizonY - f * 0.2, 0, horizonY + f * 0.05);
    haze.addColorStop(0, 'rgba(255,170,110,0)');
    haze.addColorStop(0.75, 'rgba(255,180,120,0.32)');
    haze.addColorStop(1, 'rgba(255,180,120,0)');
    ctx.fillStyle = haze;
    ctx.fillRect(-20, horizonY - f * 0.2, W + 40, f * 0.25);

    // ------------------------------------------------------------- ground
    fill([v(-300, 0, -95), v(300, 0, -95), v(300, 0, 300), v(-300, 0, 300)], '#1b3a2e');
    fill([v(-60, 0, -48), v(80, 0, -48), v(80, 0, 98), v(-60, 0, 98)], C.surround);
    fill([v(FENCE.left, 0, FENCE.far), v(FENCE.right, 0, FENCE.far), v(FENCE.right, 0, FENCE.near), v(FENCE.left, 0, FENCE.near)], '#244f74');
    for (const ox of COURTS) fill([v(ox, 0, 0), v(ox + 20, 0, 0), v(ox + 20, 0, 44), v(ox, 0, 44)], C.courtBlue);

    // Warm glare on the surface toward the sun, darker toward the camera.
    if (sun) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(-20, horizonY, W + 40, H + 40);
      ctx.clip();
      const glare = ctx.createRadialGradient(sun.x, horizonY + f * 0.04, 0, sun.x, horizonY + f * 0.04, f * 0.9);
      glare.addColorStop(0, 'rgba(255,200,140,0.55)');
      glare.addColorStop(0.35, 'rgba(255,170,110,0.18)');
      glare.addColorStop(1, 'rgba(255,170,110,0)');
      ctx.globalCompositeOperation = 'screen';
      ctx.fillStyle = glare;
      ctx.fillRect(-20, horizonY, W + 40, H + 40);
      ctx.restore();
    }
    const near = ctx.createLinearGradient(0, horizonY, 0, H);
    near.addColorStop(0, 'rgba(6,12,30,0)');
    near.addColorStop(1, 'rgba(6,12,30,0.5)');
    ctx.fillStyle = near;
    ctx.fillRect(-20, Math.max(-20, horizonY), W + 40, H + 40);

    // Court lines (2 in wide).
    const LW = 0.17;
    for (const ox of COURTS) {
      const lines: [Vec3, Vec3][] = [
        [v(ox, 0, 0), v(ox + 20, 0, 0)],
        [v(ox, 0, 44), v(ox + 20, 0, 44)],
        [v(ox, 0, 0), v(ox, 0, 44)],
        [v(ox + 20, 0, 0), v(ox + 20, 0, 44)],
        [v(ox, 0, 15), v(ox + 20, 0, 15)],
        [v(ox, 0, 29), v(ox + 20, 0, 29)],
        [v(ox + 10, 0, 0), v(ox + 10, 0, 15)],
        [v(ox + 10, 0, 29), v(ox + 10, 0, 44)],
      ];
      for (const [a, b] of lines) fill(groundStrip(a, b, LW), C.line, 0.88);
    }

    // ------------------------------------------------------------- mat
    const cx = MAT.cornerX;
    const fan = (r: number) => [v(cx, 0.01, 0), ...arc(cx, 0, r, Math.PI, Math.PI / 2, 28)];
    fill([v(cx - MAT.size, 0.01, 0), v(cx, 0.01, 0), v(cx, 0.01, MAT.size), v(cx - MAT.size, 0.01, MAT.size)], C.white, 0.95);
    fill(fan(MAT.z1), C.yellow);
    fill(fan(MAT.z3), C.green);
    fill(fan(MAT.z5), C.red);
    // Backlit: the mat faces away from the sun, so it sits a stop darker.
    fill([v(cx - MAT.size, 0.015, 0), v(cx, 0.015, 0), v(cx, 0.015, MAT.size), v(cx - MAT.size, 0.015, MAT.size)], 'rgba(20,24,48,1)', 0.22);
    // Printed zone numbers and the wordmark, as on the real mat.
    const printFlat = (at: Vec3, text: string, font: string, color: string, alpha: number): void => {
      const p0 = proj(at);
      const px = proj(add(at, v(1, 0, 0)));
      const pz = proj(add(at, v(0, 0, 1)));
      if (!p0 || !px || !pz) return;
      ctx.save();
      ctx.transform(px.x - p0.x, px.y - p0.y, pz.x - p0.x, pz.y - p0.y, p0.x, p0.y);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = color;
      ctx.font = font;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, 0, 0);
      ctx.restore();
    };
    for (const [r, n] of [
      [1.3, '5'],
      [2.85, '3'],
      [4.85, '1'],
    ] as const) {
      printFlat(v(cx - r * 0.72, 0.02, r * 0.69), n, '700 1.0px Inter, system-ui, sans-serif', '#22252c', 0.85);
    }
    printFlat(v(cx - 1.15, 0.02, 0.17), 'PickleServe™ 21', 'italic 600 0.22px Inter, system-ui, sans-serif', '#fff', 0.9);

    // Low sun skims the mat: a soft sheen across the far half.
    if (path(ctx, [v(cx - MAT.size, 0.02, 0), v(cx, 0.02, 0), v(cx, 0.02, MAT.size), v(cx - MAT.size, 0.02, MAT.size)])) {
      const p0 = proj(v(cx - 3, 0, 0));
      const p1 = proj(v(cx - 3, 0, MAT.size));
      if (p0 && p1) {
        const sheen = ctx.createLinearGradient(p0.x, p0.y, p1.x, p1.y);
        sheen.addColorStop(0, 'rgba(255,215,160,0.28)');
        sheen.addColorStop(1, 'rgba(255,215,160,0)');
        ctx.fillStyle = sheen;
        ctx.fill();
      }
    }

    // Landing: the red zone lights up and a ring runs out across the mat.
    if (shot.sinceLanding !== null) {
      const k = Math.min(1, shot.sinceLanding / 0.9);
      ctx.globalCompositeOperation = 'lighter';
      fill(fan(MAT.z5), 'rgba(255,120,90,1)', 0.45 * (1 - k));
      ctx.globalCompositeOperation = 'source-over';
      const ring = arc(LAND.x, LAND.z, 0.2 + 1.6 * Math.sqrt(k), 0, Math.PI * 2, 40);
      const inner = arc(LAND.x, LAND.z, 0.12 + 1.5 * Math.sqrt(k), 0, Math.PI * 2, 40).reverse();
      fill([...ring, ...inner], '#fff', 0.55 * (1 - k));
    }

    // ------------------------------------------------------------- long shadows
    /** Shadow strip from a caster's base to its tip, fading out along its length (soft penumbra). */
    const softShadow = (base: Vec3, tip: Vec3, width: number, alpha: number): void => {
      const pb = proj(base);
      const pt = proj(tip);
      if (!path(ctx, groundStrip(base, tip, width))) return;
      if (!pb || !pt) {
        ctx.globalAlpha = alpha * 0.5;
        ctx.fillStyle = 'rgba(4,8,22,1)';
      } else {
        const g = ctx.createLinearGradient(pb.x, pb.y, pt.x, pt.y);
        g.addColorStop(0, `rgba(4,8,22,${alpha})`);
        g.addColorStop(1, 'rgba(4,8,22,0)');
        ctx.fillStyle = g;
      }
      ctx.fill();
      ctx.globalAlpha = 1;
    };
    const netTop = (x: number) => 3 - 0.17 * (1 - Math.abs(x - 10) / 11);
    for (const ox of COURTS) {
      const netShadow: Vec3[] = [];
      for (let x = -1; x <= 21; x += 2) netShadow.push(shadowOf(v(ox + x, netTop(x), 22)));
      const top = netShadow[Math.floor(netShadow.length / 2)]!;
      const pb = proj(v(ox + 10, 0, 22));
      const pt = proj(top);
      if (path(ctx, [v(ox - 1, 0, 22), v(ox + 21, 0, 22), ...netShadow.reverse()])) {
        if (pb && pt) {
          const g = ctx.createLinearGradient(pb.x, pb.y, pt.x, pt.y);
          g.addColorStop(0, 'rgba(4,8,22,0.26)');
          g.addColorStop(1, 'rgba(4,8,22,0.06)');
          ctx.fillStyle = g;
        } else ctx.fillStyle = 'rgba(4,8,22,0.16)';
        ctx.fill();
      }
    }
    const posts: Vec3[] = [];
    for (let x = FENCE.left; x <= FENCE.right; x += 10) posts.push(v(x, FENCE.h, FENCE.far));
    for (let z = FENCE.far + 10; z <= FENCE.near; z += 10) posts.push(v(FENCE.left, FENCE.h, z), v(FENCE.right, FENCE.h, z));
    /** A ball's shadow: an ellipse stretched away from the sun, centred where the ball's shadow falls. */
    const ballShadow = (ball: Vec3, alpha: number): void => {
      const c = shadowOf(ball);
      const len = Math.hypot(SUN.x, SUN.z);
      const dir = v(-SUN.x / len, 0, -SUN.z / len);
      const side = v(-dir.z, 0, dir.x);
      const major = BALL_R / Math.max(0.15, SUN.y);
      const pts: Vec3[] = [];
      for (let i = 0; i < 20; i++) {
        const a = (i / 20) * Math.PI * 2;
        pts.push(add(c, add(scale(dir, Math.cos(a) * major), scale(side, Math.sin(a) * BALL_R))));
      }
      fill(pts, 'rgba(4,8,22,1)', alpha);
    };
    for (const p of posts) softShadow(v(p.x, 0, p.z), shadowOf(p), 0.3, 0.2);
    for (const l of LIGHTS) softShadow(v(l.x, 0, l.z), shadowOf(l), 0.5, 0.16);
    for (const ox of COURTS) for (const x of [-1, 21]) softShadow(v(ox + x, 0, 22), shadowOf(v(ox + x, 3, 22)), 0.3, 0.35);
    for (const b of STRAY_BALLS) ballShadow(b, 0.45);
    if (!opts.hideBall && shot.ball.y < 12) ballShadow(shot.ball, 0.5 * Math.max(0, 1 - shot.ball.y / 12));

    // ------------------------------------------------------------- fence
    const fenceRuns: [Vec3, Vec3][] = [
      [v(FENCE.left, 0, FENCE.far), v(FENCE.right, 0, FENCE.far)],
      [v(FENCE.left, 0, FENCE.far), v(FENCE.left, 0, FENCE.near)],
      [v(FENCE.right, 0, FENCE.far), v(FENCE.right, 0, FENCE.near)],
    ];
    for (const [a, b] of fenceRuns) {
      fill([a, b, v(b.x, FENCE.h, b.z), v(a.x, FENCE.h, a.z)], 'rgba(12,18,32,1)', 0.16);
      const top = clipSegment(toCamera(cam, v(a.x, FENCE.h, a.z)), toCamera(cam, v(b.x, FENCE.h, b.z)));
      if (top) {
        const p = projectCam(cam, top[0]);
        const q = projectCam(cam, top[1]);
        ctx.strokeStyle = 'rgba(10,16,28,0.7)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(q.x, q.y);
        ctx.stroke();
      }
    }
    for (const p of posts) {
      const base = v(p.x, 0, p.z);
      const side = p.z === FENCE.far ? v(0.08, 0, 0) : v(0, 0, 0.08);
      fill([add(base, scale(side, -1)), add(base, side), add(p, side), add(p, scale(side, -1))], '#0b1220', 0.8);
    }

    // Light poles: dark masts, warm lamps just switched on.
    const lamps: Point2[] = [];
    for (const l of LIGHTS) {
      const side = v(0.15, 0, 0.15);
      fill([v(l.x - side.x, 0, l.z), v(l.x + side.x, 0, l.z), v(l.x + side.x, l.y, l.z), v(l.x - side.x, l.y, l.z)], '#0b1220', 0.9);
      fill([v(l.x - 1.2, l.y, l.z), v(l.x + 1.2, l.y, l.z), v(l.x + 1.2, l.y + 0.9, l.z), v(l.x - 1.2, l.y + 0.9, l.z)], '#151c2b');
      const lp = proj(v(l.x, l.y + 0.2, l.z));
      if (lp) lamps.push(lp);
    }

    for (const b of STRAY_BALLS) drawRestingBall(b);

    for (const ox of COURTS) if (ox !== 0) drawNet(ox);

    // ------------------------------------------------------------- net + ball (depth ordered)
    function drawNet(ox = 0): void {
      const top: Vec3[] = [];
      for (let x = -1; x <= 21; x += 1) top.push(v(ox + x, netTop(x), 22));
      fill([v(ox - 1, 0.15, 22), v(ox + 21, 0.15, 22), ...[...top].reverse()], 'rgba(8,12,22,1)', 0.42);
      ctx.strokeStyle = 'rgba(20,26,40,0.5)';
      ctx.lineWidth = 0.6;
      for (let x = -1; x <= 21; x += 0.5) {
        const seg = clipSegment(toCamera(cam, v(ox + x, 0.15, 22)), toCamera(cam, v(ox + x, netTop(x), 22)));
        if (!seg) continue;
        const a = projectCam(cam, seg[0]);
        const b = projectCam(cam, seg[1]);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
      for (let i = 0; i < top.length - 1; i++) {
        const a = top[i]!;
        const b = top[i + 1]!;
        fill([v(a.x, a.y - 0.17, 22), v(b.x, b.y - 0.17, 22), b, a], '#f2efe8', 0.95);
      }
      fill([v(ox + 9.9, 0.15, 22), v(ox + 10.1, 0.15, 22), v(ox + 10.1, netTop(10), 22), v(ox + 9.9, netTop(10), 22)], '#f2efe8', 0.9);
      for (const x of [-1, 21]) {
        fill([v(ox + x - 0.12, 0, 22), v(ox + x + 0.12, 0, 22), v(ox + x + 0.12, 3.1, 22), v(ox + x - 0.12, 3.1, 22)], '#121a2a');
      }
    }

    const drawBall = () => {
      if (opts.hideBall) return;
      const p = proj(shot.ball);
      if (!p) return;
      const r = Math.max(1.6, (f * BALL_R) / p.z);
      // Motion streak.
      const pts = shot.streak.map(proj).filter((q): q is NonNullable<typeof q> => q !== null);
      if (pts.length > 1) {
        ctx.lineCap = 'round';
        for (let i = 1; i < pts.length; i++) {
          const a = pts[i - 1]!;
          const b = pts[i]!;
          ctx.strokeStyle = `rgba(240,236,226,${(0.28 * i) / pts.length})`;
          ctx.lineWidth = r * 1.7 * (0.4 + (0.6 * i) / pts.length);
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
      }
      // A faint halo keeps the served ball the subject once it is small in frame.
      const halo = ctx.createRadialGradient(p.x, p.y, r, p.x, p.y, r * 4);
      halo.addColorStop(0, 'rgba(255,236,200,0.35)');
      halo.addColorStop(1, 'rgba(255,236,200,0)');
      ctx.fillStyle = halo;
      ctx.fillRect(p.x - r * 4, p.y - r * 4, r * 8, r * 8);
      // Backlit sphere: shaded body, warm rim on the sun side.
      const body = ctx.createRadialGradient(p.x - r * 0.25, p.y + r * 0.2, r * 0.1, p.x, p.y, r);
      body.addColorStop(0, '#d9dee6');
      body.addColorStop(0.7, '#aeb6c4');
      body.addColorStop(1, '#7c8698');
      ctx.fillStyle = body;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fill();
      if (r > 4) {
        ctx.fillStyle = 'rgba(40,48,66,0.55)';
        for (const [hx, hy] of [
          [-0.35, -0.2],
          [0.3, -0.35],
          [-0.1, 0.35],
          [0.42, 0.25],
          [-0.55, 0.3],
        ] as const) {
          ctx.beginPath();
          ctx.ellipse(p.x + hx * r, p.y + hy * r, r * 0.13, r * 0.11, 0, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      if (sun) {
        const ang = Math.atan2(sun.y - p.y, sun.x - p.x);
        ctx.strokeStyle = 'rgba(255,226,180,0.95)';
        ctx.lineWidth = Math.max(1, r * 0.22);
        ctx.beginPath();
        ctx.arc(p.x, p.y, r * 0.9, ang - 1.1, ang + 1.1);
        ctx.stroke();
      }
    };

    const ballBeyondNet = (shot.ball.z - 22) * (cam.eye.z - 22) < 0;
    if (ballBeyondNet) {
      drawDust();
      drawBall();
      drawNet();
    } else {
      drawNet();
      drawDust();
      drawBall();
    }

    function drawRestingBall(b: Vec3): void {
      const p = proj(b);
      if (!p) return;
      const r = Math.max(1, (f * BALL_R) / p.z);
      const body = ctx.createRadialGradient(p.x - r * 0.2, p.y + r * 0.25, r * 0.1, p.x, p.y, r);
      body.addColorStop(0, '#c9d0da');
      body.addColorStop(1, '#6f7a8d');
      ctx.fillStyle = body;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fill();
      if (sun && r > 1.5) {
        ctx.strokeStyle = 'rgba(255,220,170,0.8)';
        ctx.lineWidth = Math.max(0.6, r * 0.2);
        ctx.beginPath();
        ctx.arc(p.x, p.y, r * 0.88, -Math.PI * 0.9, -Math.PI * 0.1);
        ctx.stroke();
      }
    }

    function drawDust(): void {
      if (shot.sinceLanding === null) return;
      const b = Math.min(1, shot.sinceLanding / T.kick);
      const k = 1 - (1 - b) ** 2.4;
      for (let i = 0; i < 54; i++) {
        const a = -Math.PI * (0.15 + rand(i + 11) * 0.95);
        const sp = 0.4 + rand(i + 23) * 1.9;
        const up = 0.15 + rand(i + 37) * 1.1;
        const pos = v(LAND.x + Math.cos(a) * sp * k, Math.max(0.02, up * k - 0.25 * k * k), LAND.z + Math.sin(a) * sp * k * 0.8);
        const p = proj(pos);
        if (!p) continue;
        const r = Math.min(4, Math.max(0.7, (f * (0.012 + rand(i + 51) * 0.025)) / p.z));
        ctx.fillStyle = `rgba(255,${200 + Math.round(rand(i) * 40)},170,${0.75 * (1 - 0.35 * k)})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.fill();
      }
      // A soft puff behind the grains.
      const c = proj(v(LAND.x - 0.2, 0.25 * k, LAND.z - 0.3));
      if (c) {
        const r = (f * (0.4 + 1.1 * k)) / c.z;
        const puff = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, r);
        puff.addColorStop(0, `rgba(255,214,170,${0.22 * (1 - 0.4 * k)})`);
        puff.addColorStop(1, 'rgba(255,214,170,0)');
        ctx.fillStyle = puff;
        ctx.fillRect(c.x - r, c.y - r, r * 2, r * 2);
      }
    }

    // ------------------------------------------------------------- arm + paddle (foreground)
    if (shot.swing !== null) {
      const ghosts = Math.min(6, Math.floor(shot.swingSpeed / 60));
      for (let gi = ghosts; gi >= 0; gi--) {
        const at = time - gi * 0.008;
        drawArm(paddleAt(at), shot.swing - gi * shot.swingSpeed * 0.008, gi === 0 ? 1 : 0.18 * (1 - gi / (ghosts + 1)));
      }
    }

    function drawArm(pose: { centre: Vec3; axis: Vec3 }, angle: number, alpha: number): void {
      const { centre, axis } = pose;
      // Wrist turns the face toward the viewer so it reads as a paddle, not an edge.
      const wx = cross(axis, sub(cam.eye, centre));
      const w = scale(wx, 1 / (Math.hypot(wx.x, wx.y, wx.z) || 1));
      const pc = proj(centre);
      const pw = proj(add(centre, w));
      const pa = proj(add(centre, axis));
      if (!pc || !pw || !pa) return;

      // Draw in the paddle's own plane: local x across the face, local y toward the tip (ft).
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.transform(pw.x - pc.x, pw.y - pc.y, -(pa.x - pc.x), -(pa.y - pc.y), pc.x, pc.y);
      // Local y is flipped so +y points down the handle, matching canvas conventions.
      const HW = 0.315;
      const FACE_TOP = -0.43;
      const FACE_BOTTOM = 0.41;
      const faceShape = () => {
        ctx.beginPath();
        ctx.roundRect(-HW, FACE_TOP, HW * 2, FACE_BOTTOM - FACE_TOP, [0.13, 0.13, 0.09, 0.09]);
      };

      // Handle: wrapped grip with a flared butt cap.
      ctx.fillStyle = '#15181f';
      ctx.beginPath();
      ctx.roundRect(-0.058, FACE_BOTTOM - 0.02, 0.116, 0.47, 0.03);
      ctx.fill();
      ctx.strokeStyle = 'rgba(120,130,150,0.35)';
      ctx.lineWidth = 0.008;
      for (let y = FACE_BOTTOM + 0.03; y < FACE_BOTTOM + 0.43; y += 0.045) {
        ctx.beginPath();
        ctx.moveTo(-0.058, y + 0.02);
        ctx.lineTo(0.058, y);
        ctx.stroke();
      }
      ctx.fillStyle = '#0c0e13';
      ctx.beginPath();
      ctx.roundRect(-0.07, FACE_BOTTOM + 0.43, 0.14, 0.05, 0.02);
      ctx.fill();
      // Throat: the face tapers into the handle.
      ctx.fillStyle = '#1a1e27';
      ctx.beginPath();
      ctx.moveTo(-0.12, FACE_BOTTOM - 0.01);
      ctx.lineTo(0.12, FACE_BOTTOM - 0.01);
      ctx.lineTo(0.06, FACE_BOTTOM + 0.07);
      ctx.lineTo(-0.06, FACE_BOTTOM + 0.07);
      ctx.closePath();
      ctx.fill();

      // Face: raw carbon weave, then a graphic band, then the moving sheen.
      faceShape();
      ctx.fillStyle = '#1b2029';
      ctx.fill();
      ctx.save();
      faceShape();
      ctx.clip();
      const weave = ctx.createPattern(scenery.carbon, 'repeat');
      if (weave) {
        weave.setTransform(new DOMMatrix().scale(0.0035));
        ctx.fillStyle = weave;
        ctx.fillRect(-HW, FACE_TOP, HW * 2, FACE_BOTTOM - FACE_TOP);
      }
      ctx.fillStyle = '#2f5da8';
      ctx.beginPath();
      ctx.moveTo(-HW, 0.12);
      ctx.lineTo(HW, -0.02);
      ctx.lineTo(HW, 0.08);
      ctx.lineTo(-HW, 0.22);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#e8432e';
      ctx.beginPath();
      ctx.moveTo(-HW, 0.245);
      ctx.lineTo(HW, 0.105);
      ctx.lineTo(HW, 0.125);
      ctx.lineTo(-HW, 0.265);
      ctx.closePath();
      ctx.fill();
      // Reflection slides across the face as it turns through the swing.
      const k = ((angle + 70) / 205) * 1.6 - 0.3;
      const sheen = ctx.createLinearGradient(-HW, FACE_TOP, HW, FACE_BOTTOM);
      const stop = (n: number) => Math.min(1, Math.max(0, n));
      sheen.addColorStop(stop(k - 0.25), 'rgba(255,214,170,0)');
      sheen.addColorStop(stop(k), 'rgba(255,214,170,0.32)');
      sheen.addColorStop(stop(k + 0.25), 'rgba(255,214,170,0)');
      ctx.fillStyle = sheen;
      ctx.fillRect(-HW, FACE_TOP, HW * 2, FACE_BOTTOM - FACE_TOP);
      ctx.restore();

      // Edge guard: matte black rim with a thin highlight on the sun side.
      faceShape();
      ctx.strokeStyle = '#0a0c10';
      ctx.lineWidth = 0.03;
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,200,150,0.35)';
      ctx.lineWidth = 0.008;
      ctx.beginPath();
      ctx.roundRect(-HW + 0.012, FACE_TOP + 0.012, HW * 2 - 0.024, FACE_BOTTOM - FACE_TOP - 0.024, [0.12, 0.12, 0.08, 0.08]);
      ctx.stroke();
      ctx.restore();
    }

    if (shot.flash > 0) {
      const c = proj(contactPoint());
      if (c) {
        const r = f * 0.12;
        const g = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, r);
        g.addColorStop(0, `rgba(255,250,235,${0.9 * shot.flash})`);
        g.addColorStop(1, 'rgba(255,250,235,0)');
        ctx.fillStyle = g;
        ctx.fillRect(c.x - r, c.y - r, r * 2, r * 2);
      }
    }

    // ------------------------------------------------------------- lens + grade
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (sun) {
      ctx.globalCompositeOperation = 'lighter';
      const bloom = ctx.createRadialGradient(sun.x, sun.y, 0, sun.x, sun.y, f * 0.45);
      bloom.addColorStop(0, 'rgba(255,200,140,0.5)');
      bloom.addColorStop(0.25, 'rgba(255,170,100,0.12)');
      bloom.addColorStop(1, 'rgba(255,170,100,0)');
      ctx.fillStyle = bloom;
      ctx.fillRect(0, 0, W, H);
      const dx = cam.cx - sun.x;
      const dy = cam.cy - sun.y;
      for (const [k, r, a] of [
        [0.45, 0.03, 0.08],
        [0.8, 0.06, 0.05],
        [1.25, 0.02, 0.1],
        [1.6, 0.1, 0.04],
      ] as const) {
        const x = sun.x + dx * k;
        const y = sun.y + dy * k;
        const g = ctx.createRadialGradient(x, y, 0, x, y, f * r);
        g.addColorStop(0, `rgba(255,190,140,${a})`);
        g.addColorStop(1, 'rgba(255,190,140,0)');
        ctx.fillStyle = g;
        ctx.fillRect(x - f * r, y - f * r, f * r * 2, f * r * 2);
      }
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.globalCompositeOperation = 'lighter';
    for (const l of lamps) {
      const r = f * 0.05;
      const g = ctx.createRadialGradient(l.x, l.y, 0, l.x, l.y, r);
      g.addColorStop(0, 'rgba(255,244,220,0.9)');
      g.addColorStop(0.12, 'rgba(255,226,180,0.45)');
      g.addColorStop(1, 'rgba(255,210,160,0)');
      ctx.fillStyle = g;
      ctx.fillRect(l.x - r, l.y - r, r * 2, r * 2);
    }
    ctx.globalCompositeOperation = 'source-over';

    ctx.globalCompositeOperation = 'soft-light';
    ctx.fillStyle = 'rgba(255,150,90,0.22)';
    ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'source-over';

    const vig = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.hypot(W, H) * 0.62);
    vig.addColorStop(0, 'rgba(5,10,28,0)');
    vig.addColorStop(1, 'rgba(5,10,28,0.55)');
    ctx.fillStyle = vig;
    ctx.fillRect(0, 0, W, H);

    const pattern = ctx.createPattern(scenery.grain, 'repeat');
    if (pattern) {
      ctx.save();
      ctx.globalAlpha = 0.07;
      ctx.globalCompositeOperation = 'overlay';
      ctx.translate(Math.floor(rand(time * 13) * 192), Math.floor(rand(time * 17) * 192));
      ctx.fillStyle = pattern;
      ctx.fillRect(-192, -192, W + 384, H + 384);
      ctx.restore();
    }
  }

  function locate(shot: Shot): { x: number; y: number; r: number } | null {
    const cam = lookAt(shot.eye, shot.look, { width: W, height: H, fovY: shot.fovY });
    const c = toCamera(cam, shot.ball);
    if (c.z < 0.3) return null;
    const p = projectCam(cam, c);
    return { x: p.x, y: p.y, r: Math.max(1.6, (cam.focal * BALL_R) / c.z) };
  }

  return { draw, resize, locate };
}

