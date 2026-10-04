import { describe, expect, it } from 'vitest';
import { clipPolygon, clipSegment, lookAt, NEAR, project, v } from './projection';
import { COURT, NET_HEIGHT, SCENARIOS, SERVE_DURATION, TIMING, flightPoint, frameAt, netCrossing, scoreAt } from './scene';

const screen = { width: 800, height: 500, fovY: Math.PI / 3 };

describe('projection', () => {
  it('projects the look-at target to the screen centre', () => {
    const cam = lookAt(v(10, 5, 46), v(10, 0, 10), screen);
    const p = project(cam, v(10, 0, 10));
    expect(p?.x).toBeCloseTo(400);
    expect(p?.y).toBeCloseTo(250);
  });

  it('keeps world +x on the right when looking down the court', () => {
    const cam = lookAt(v(10, 5, 46), v(10, 0, 0), screen);
    expect(project(cam, v(20, 0, 22))!.x).toBeGreaterThan(project(cam, v(0, 0, 22))!.x);
  });

  it('returns null behind the camera', () => {
    const cam = lookAt(v(10, 5, 46), v(10, 0, 0), screen);
    expect(project(cam, v(10, 0, 50))).toBeNull();
  });

  it('clips polygons and segments at the near plane', () => {
    const poly = clipPolygon([v(0, 0, -1), v(1, 0, -1), v(1, 0, 2), v(0, 0, 2)]);
    expect(poly.every((p) => p.z >= NEAR - 1e-9)).toBe(true);
    expect(poly).toHaveLength(4);
    expect(clipSegment(v(0, 0, -2), v(0, 0, -1))).toBeNull();
    expect(clipSegment(v(0, 0, -1), v(0, 0, 2))![0].z).toBeCloseTo(NEAR);
  });
});

describe('scenarios', () => {
  for (const [id, sc] of Object.entries(SCENARIOS)) {
    describe(id, () => {
      for (const serve of sc.serves) {
        it('lands on a red 5', () => {
          expect(scoreAt(sc.targets, serve.land)).toBe(5);
        });

        it('clears the net', () => {
          const p = flightPoint(serve, netCrossing(serve));
          expect(p.z).toBeCloseTo(COURT.net);
          expect(p.y).toBeGreaterThan(NET_HEIGHT.post + 1);
        });

        it('keeps the camera above the net while crossing it', () => {
          for (let t = 0; t <= SERVE_DURATION; t += 0.02) {
            const { eye } = frameAt(serve, t);
            if (Math.abs(eye.z - COURT.net) < 1) expect(eye.y).toBeGreaterThan(NET_HEIGHT.post + 1);
          }
        });

        it('reaches the landing point at the end of the flight', () => {
          const f = frameAt(serve, TIMING.windup + TIMING.flight);
          expect(f.ball.x).toBeCloseTo(serve.land.x);
          expect(f.ball.z).toBeCloseTo(serve.land.z);
          expect(f.sinceLanding).toBeCloseTo(0);
        });
      }
    });
  }
});

describe('scoreAt', () => {
  const fan = [{ kind: 'fan' as const, cornerX: 10, dir: -1 as const }];
  it('scores the fan zones by distance from the corner', () => {
    expect(scoreAt(fan, v(9, 0, 1))).toBe(5);
    expect(scoreAt(fan, v(6, 0, 1))).toBe(3);
    expect(scoreAt(fan, v(3, 0, 1))).toBe(1);
    expect(scoreAt(fan, v(1, 0, 1))).toBe(0);
    // Wrong side of the corner.
    expect(scoreAt(fan, v(11, 0, 1))).toBe(0);
  });
});
