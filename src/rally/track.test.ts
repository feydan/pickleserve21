import { describe, expect, it } from 'vitest';
import { BOUNCE_LINE, RALLY_STOPS, START_SCORE, buildRally, frameAt, swingAt, type Layout } from './track';

const layout: Layout = {
  vh: 800,
  maxScroll: 6000,
  contact: { x: 1200, y: 480 },
  stops: [
    { top: 900, mark: { x: 500, y: 1100 }, points: 3 },
    { top: 2000, mark: { x: 400, y: 2200 }, points: 5 },
    { top: 3400, mark: { x: 600, y: 3600 }, points: 1 },
  ],
  endTop: 4500,
};

describe('rally', () => {
  const rally = buildRally(layout);

  it('scores 21 across the page', () => {
    expect(RALLY_STOPS.reduce((sum, s) => sum + s.points, START_SCORE)).toBe(21);
  });

  it('meets the paddle at the contact point on every hit', () => {
    for (const seg of rally.segments) {
      const f = frameAt(rally, seg.hit);
      expect(f.ball!.x).toBeCloseTo(layout.contact.x);
      expect(f.ball!.y).toBeCloseTo(layout.contact.y);
      expect(f.swing).toBeCloseTo(0);
    }
  });

  it('lands on the mark with the mark on the bounce line', () => {
    const seg = rally.segments[1]!;
    const f = frameAt(rally, seg.bounce);
    expect(f.ball!.x).toBeCloseTo(400);
    expect(f.ball!.y).toBeCloseTo(layout.vh * BOUNCE_LINE);
    expect(f.height).toBeCloseTo(0);
  });

  it('chains segments so the ball comes back to the paddle', () => {
    const [a, b] = rally.segments;
    expect(a!.end).toBe(b!.hit);
    const f = frameAt(rally, a!.end - 0.001);
    expect(f.ball!.y).toBeCloseTo(layout.contact.y, 1);
  });

  it('rests the ball on the paddle before the first hit and after the last', () => {
    expect(frameAt(rally, 0).ball).toBeNull();
    expect(frameAt(rally, 0).enter).toBe(0);
    expect(frameAt(rally, 5000).ball).toBeNull();
  });

  it('adds points as each ball lands and rewinds when scrolling back', () => {
    expect(frameAt(rally, rally.segments[0]!.bounce - 1).score).toBe(START_SCORE);
    expect(frameAt(rally, rally.segments[1]!.bounce).score).toBe(START_SCORE + 8);
    expect(frameAt(rally, 5000).score).toBe(START_SCORE + 9);
    expect(frameAt(rally, 5000).landed).toEqual([true, true, true]);
    expect(frameAt(rally, 500).landed).toEqual([false, false, false]);
  });

  it('picks up the opening serve ball and brings it to the first hit', () => {
    const serve = { x: 900, y: 600 };
    const withServe = buildRally({ ...layout, serve });
    const start = frameAt(withServe, 0);
    expect(start.ball).toEqual(serve);
    expect(start.intro).toBe(0);
    const hit = withServe.segments[0]!.hit;
    const before = frameAt(withServe, hit - 0.001);
    expect(before.ball!.x).toBeCloseTo(layout.contact.x, 1);
    expect(before.ball!.y).toBeCloseTo(layout.contact.y, 1);
    expect(frameAt(withServe, hit).intro).toBeNull();
  });

  it('winds back before contact and follows through after', () => {
    expect(swingAt(-0.5)).toBeGreaterThan(0);
    expect(swingAt(0.4)).toBeLessThan(0);
    expect(swingAt(2)).toBe(0);
  });
});
