// Minimal pinhole camera for the server's-eye view. Pure math, no DOM.
// World units are feet: x across the court (0–20, left to right from the
// server's side), y up, z along the court (0 = far baseline, 44 = server's baseline).

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Point2 {
  x: number;
  y: number;
}

export const v = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
export const add = (a: Vec3, b: Vec3): Vec3 => v(a.x + b.x, a.y + b.y, a.z + b.z);
export const sub = (a: Vec3, b: Vec3): Vec3 => v(a.x - b.x, a.y - b.y, a.z - b.z);
export const scale = (a: Vec3, s: number): Vec3 => v(a.x * s, a.y * s, a.z * s);
export const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
export const cross = (a: Vec3, b: Vec3): Vec3 =>
  v(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
export const lerp = (a: Vec3, b: Vec3, t: number): Vec3 => add(a, scale(sub(b, a), t));

export function normalize(a: Vec3): Vec3 {
  const len = Math.hypot(a.x, a.y, a.z);
  return len === 0 ? a : scale(a, 1 / len);
}

/** Points closer than this (camera-space depth, ft) are clipped away. */
export const NEAR = 0.3;

export interface Camera {
  eye: Vec3;
  right: Vec3;
  up: Vec3;
  forward: Vec3;
  /** Focal length in screen units. */
  focal: number;
  /** Screen centre. */
  cx: number;
  cy: number;
}

export function lookAt(
  eye: Vec3,
  target: Vec3,
  screen: { width: number; height: number; fovY: number },
): Camera {
  const forward = normalize(sub(target, eye));
  const right = normalize(cross(forward, v(0, 1, 0)));
  const up = cross(right, forward);
  const focal = screen.height / 2 / Math.tan(screen.fovY / 2);
  return { eye, right, up, forward, focal, cx: screen.width / 2, cy: screen.height / 2 };
}

/** World point → camera space (x right, y up, z depth along the view direction). */
export function toCamera(cam: Camera, p: Vec3): Vec3 {
  const d = sub(p, cam.eye);
  return v(dot(d, cam.right), dot(d, cam.up), dot(d, cam.forward));
}

/** Camera-space point (z ≥ NEAR) → screen. */
export function projectCam(cam: Camera, c: Vec3): Point2 {
  return { x: cam.cx + (cam.focal * c.x) / c.z, y: cam.cy - (cam.focal * c.y) / c.z };
}

/** World point → screen, or null when it is behind the near plane. */
export function project(cam: Camera, p: Vec3): Point2 | null {
  const c = toCamera(cam, p);
  return c.z < NEAR ? null : projectCam(cam, c);
}

function cutNear(a: Vec3, b: Vec3): Vec3 {
  return lerp(a, b, (NEAR - a.z) / (b.z - a.z));
}

/** Sutherland–Hodgman against the near plane, in camera space. */
export function clipPolygon(points: Vec3[]): Vec3[] {
  const out: Vec3[] = [];
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    const aIn = a.z >= NEAR;
    const bIn = b.z >= NEAR;
    if (aIn) out.push(a);
    if (aIn !== bIn) out.push(cutNear(a, b));
  }
  return out;
}

/** Clip a segment against the near plane, in camera space. */
export function clipSegment(a: Vec3, b: Vec3): [Vec3, Vec3] | null {
  const aIn = a.z >= NEAR;
  const bIn = b.z >= NEAR;
  if (aIn && bIn) return [a, b];
  if (!aIn && !bIn) return null;
  return aIn ? [a, cutNear(a, b)] : [cutNear(a, b), b];
}

/** World polygon → SVG path data ('' when fully clipped). */
export function polygonPath(cam: Camera, world: Vec3[]): string {
  const clipped = clipPolygon(world.map((p) => toCamera(cam, p)));
  if (clipped.length < 3) return '';
  return (
    clipped
      .map((c, i) => {
        const s = projectCam(cam, c);
        return `${i === 0 ? 'M' : 'L'}${s.x.toFixed(1)},${s.y.toFixed(1)}`;
      })
      .join('') + 'Z'
  );
}

/** World polyline → SVG path data, split where it passes behind the camera. */
export function polylinePath(cam: Camera, world: Vec3[]): string {
  let d = '';
  let penDown = false;
  for (let i = 0; i + 1 < world.length; i++) {
    const seg = clipSegment(toCamera(cam, world[i]!), toCamera(cam, world[i + 1]!));
    if (!seg) {
      penDown = false;
      continue;
    }
    const a = projectCam(cam, seg[0]);
    const b = projectCam(cam, seg[1]);
    if (!penDown) d += `M${a.x.toFixed(1)},${a.y.toFixed(1)}`;
    d += `L${b.x.toFixed(1)},${b.y.toFixed(1)}`;
    // A segment clipped at its far end breaks the line.
    penDown = seg[1].z === toCamera(cam, world[i + 1]!).z;
  }
  return d;
}

/**
 * Affine approximation of the ground plane around `origin`, as an SVG
 * `matrix()`: local +x maps to world +x and local +y (SVG "down") to world +z,
 * so text drawn in local units lies flat on the court, readable from the server.
 */
export function groundMatrix(cam: Camera, origin: Vec3): string | null {
  const o = project(cam, origin);
  const ex = project(cam, add(origin, v(1, 0, 0)));
  const ez = project(cam, add(origin, v(0, 0, 1)));
  if (!o || !ex || !ez) return null;
  const f = (n: number) => n.toFixed(3);
  return `matrix(${f(ex.x - o.x)},${f(ex.y - o.y)},${f(ez.x - o.x)},${f(ez.y - o.y)},${f(o.x)},${f(o.y)})`;
}
