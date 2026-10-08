import { describe, expect, it } from 'vitest';
import { DURATION, LANDING, contactPoint, finalShot, flightFraction, flightPoint, kickPoint, matScore, netCrossing, shotAt } from './shot';

describe('hero shot', () => {
  it('serves underhand, below the waist', () => {
    expect(contactPoint().y).toBeLessThan(2.5);
  });

  it('clears the net', () => {
    expect(flightPoint(netCrossing()).y).toBeGreaterThan(3);
  });

  it('lands on the red 5 and freezes over it', () => {
    expect(matScore(flightPoint(1))).toBe(5);
    const freeze = kickPoint(1);
    expect(matScore(freeze)).toBe(5);
    expect(freeze.y).toBeGreaterThan(0);
  });

  it('slows down before landing without stopping', () => {
    expect(flightFraction(0)).toBe(0);
    expect(flightFraction(1)).toBeCloseTo(1);
    const early = flightFraction(0.3) - flightFraction(0.2);
    const late = flightFraction(0.95) - flightFraction(0.85);
    expect(late).toBeGreaterThan(0);
    expect(late).toBeLessThan(early);
  });

  it('rests on the frozen landing', () => {
    const a = shotAt(DURATION, { aspect: 1.6 });
    expect(a.done).toBe(true);
    expect(a.sinceLanding).toBeCloseTo(DURATION - LANDING);
    expect(finalShot({ aspect: 1.6 }).ball).toEqual(a.ball);
  });
});
