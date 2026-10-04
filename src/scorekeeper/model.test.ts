import { describe, expect, it } from 'vitest';
import {
  addBall,
  averageOf,
  ballLimit,
  bestTrial,
  canStartNextTrial,
  createSession,
  currentTrial,
  finalizeSession,
  hitGoal,
  isSession,
  isSessionComplete,
  isTrialComplete,
  makeTrial,
  nextTrial,
  normalizeSession,
  setMode,
  undo,
  type BallScore,
  type Session,
} from './model';

const NOW = new Date('2026-10-01T12:00:00Z');

function play(session: Session, balls: BallScore[]): Session {
  return balls.reduce(addBall, session);
}

function playTrials(session: Session, trials: BallScore[][]): Session {
  return trials.reduce((s, balls, i) => play(i === 0 ? s : nextTrial(s), balls), session);
}

const twelve = (score: BallScore): BallScore[] => Array<BallScore>(12).fill(score);

describe('ball limits', () => {
  it('maps modes to 12 and 10 balls', () => {
    expect(ballLimit('standard')).toBe(12);
    expect(ballLimit('advanced')).toBe(10);
  });

  it('accepts up to 12 balls in standard mode and rejects extras', () => {
    let s = createSession({}, NOW, 'a');
    s = play(s, twelve(1));
    expect(currentTrial(s).balls).toHaveLength(12);
    const after = addBall(s, 5);
    expect(after).toBe(s);
    expect(currentTrial(after).balls).toHaveLength(12);
    expect(isTrialComplete(currentTrial(s), 'standard')).toBe(true);
  });

  it('stops at 10 balls in advanced mode', () => {
    let s = createSession({ mode: 'advanced' }, NOW, 'a');
    s = play(s, twelve(3));
    expect(currentTrial(s).balls).toHaveLength(10);
    expect(currentTrial(s).total).toBe(30);
    expect(isTrialComplete(currentTrial(s), 'advanced')).toBe(true);
  });

  it('ignores invalid scores', () => {
    const s = createSession({}, NOW, 'a');
    expect(addBall(s, 2 as BallScore)).toBe(s);
  });
});

describe('totals and goal', () => {
  it('keeps a running total', () => {
    const s = play(createSession({}, NOW, 'a'), [5, 3, 1, 0, 5]);
    expect(currentTrial(s).total).toBe(14);
  });

  it('checks the 21 goal', () => {
    expect(hitGoal(20)).toBe(false);
    expect(hitGoal(21)).toBe(true);
    expect(hitGoal(60)).toBe(true);
  });

  it('does not mutate the input session', () => {
    const s = createSession({}, NOW, 'a');
    addBall(s, 5);
    expect(currentTrial(s).balls).toEqual([]);
  });
});

describe('undo', () => {
  it('removes the last ball and updates the total', () => {
    let s = play(createSession({}, NOW, 'a'), [5, 3]);
    s = undo(s);
    expect(currentTrial(s).balls).toEqual([5]);
    expect(currentTrial(s).total).toBe(5);
  });

  it('is a no-op on an empty session', () => {
    const s = createSession({}, NOW, 'a');
    expect(undo(s)).toBe(s);
  });

  it('steps back into the previous trial when the current one is empty', () => {
    let s = nextTrial(play(createSession({}, NOW, 'a'), twelve(1)));
    expect(s.trials).toHaveLength(2);
    s = undo(s);
    expect(s.trials).toHaveLength(1);
    expect(currentTrial(s).balls).toHaveLength(11);
    expect(s.average).toBe(0);
  });

  it('re-opens a completed trial', () => {
    let s = play(createSession({}, NOW, 'a'), twelve(3));
    s = undo(s);
    expect(isTrialComplete(currentTrial(s), 'standard')).toBe(false);
    s = addBall(s, 5);
    expect(currentTrial(s).total).toBe(38);
  });
});

describe('trials and average', () => {
  it('only allows the next trial after the current one is complete', () => {
    const s = play(createSession({}, NOW, 'a'), [5]);
    expect(canStartNextTrial(s)).toBe(false);
    expect(nextTrial(s)).toBe(s);
  });

  it('caps a session at 3 trials', () => {
    const s = playTrials(createSession({}, NOW, 'a'), [twelve(1), twelve(1), twelve(1)]);
    expect(s.trials).toHaveLength(3);
    expect(isSessionComplete(s)).toBe(true);
    expect(canStartNextTrial(s)).toBe(false);
    expect(nextTrial(s)).toBe(s);
  });

  it('averages the 3 trial scores', () => {
    // 12, 24, 36 -> average 24
    const s = playTrials(createSession({}, NOW, 'a'), [
      twelve(1),
      [1, 1, 1, 1, 1, 1, 3, 3, 3, 3, 3, 3],
      twelve(3),
    ]);
    expect(s.trials.map((t) => t.total)).toEqual([12, 24, 36]);
    expect(s.average).toBe(24);
    expect(bestTrial(s)).toBe(36);
  });

  it('rounds non-integer averages to 2 decimals', () => {
    expect(averageOf([makeTrial([5]), makeTrial([3]), makeTrial([3])])).toBe(3.67);
    expect(averageOf([])).toBe(0);
  });

  it('ignores the in-progress trial in the average', () => {
    const s = play(nextTrial(play(createSession({}, NOW, 'a'), twelve(3))), [5, 5]);
    expect(s.average).toBe(36);
  });

  it('finalizes to completed trials only', () => {
    const s = play(nextTrial(play(createSession({}, NOW, 'a'), twelve(1))), [5]);
    const f = finalizeSession(s);
    expect(f.trials).toHaveLength(1);
    expect(f.average).toBe(12);
  });
});

describe('mode changes', () => {
  it('allows changing mode before any ball', () => {
    const s = setMode(createSession({}, NOW, 'a'), 'advanced');
    expect(s.mode).toBe('advanced');
  });

  it('locks mode once balls are entered', () => {
    const s = play(createSession({}, NOW, 'a'), [1]);
    expect(setMode(s, 'advanced')).toBe(s);
  });
});

describe('validation', () => {
  it('accepts a real session', () => {
    expect(isSession(play(createSession({ name: 'Pat' }, NOW, 'a'), [5, 3]))).toBe(true);
  });

  it('rejects malformed data', () => {
    const good = createSession({}, NOW, 'a');
    expect(isSession(null)).toBe(false);
    expect(isSession({ ...good, mode: 'expert' })).toBe(false);
    expect(isSession({ ...good, date: 'not a date' })).toBe(false);
    expect(isSession({ ...good, trials: [{ balls: [2], total: 2 }] })).toBe(false);
    expect(isSession({ ...good, trials: [{ balls: twelve(1).concat([1]), total: 13 }] })).toBe(false);
    expect(isSession({ ...good, trials: [makeTrial(), makeTrial(), makeTrial(), makeTrial()] })).toBe(false);
  });

  it('normalizes stale totals', () => {
    const s = { ...createSession({}, NOW, 'a'), trials: [{ balls: twelve(5), total: 1 }], average: 0 };
    const n = normalizeSession(s);
    expect(n.trials[0]?.total).toBe(60);
    expect(n.average).toBe(60);
  });
});
