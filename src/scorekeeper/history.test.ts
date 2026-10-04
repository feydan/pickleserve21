import { describe, expect, it } from 'vitest';
import { addBall, createSession, finalizeSession, nextTrial, type BallScore, type Mode, type Session } from './model';
import { personalBests } from './history';

const NOW = new Date('2026-10-01T12:00:00Z');

function saved(id: string, trials: BallScore[][], mode: Mode = 'standard'): Session {
  const s = trials.reduce(
    (acc, balls, i) => balls.reduce(addBall, i === 0 ? acc : nextTrial(acc)),
    createSession({ mode }, NOW, id),
  );
  return finalizeSession(s);
}

const full = (score: BallScore, n = 12): BallScore[] => Array<BallScore>(n).fill(score);

describe('personal bests', () => {
  it('ignores sessions saved before all trials were played', () => {
    const partial = saved('partial', [full(5)]);
    const complete = saved('complete', [full(1), full(3), full(3)]);
    const best = personalBests([partial, complete]);
    expect(best.get('standard')?.id).toBe('complete');
  });

  it('has no best when only partial sessions exist', () => {
    expect(personalBests([saved('p', [full(5)])]).size).toBe(0);
  });

  it('tracks each mode separately', () => {
    const std = saved('std', [full(1), full(1), full(1)]);
    const adv = saved('adv', [full(3, 10), full(3, 10), full(3, 10)], 'advanced');
    const best = personalBests([std, adv]);
    expect(best.get('standard')?.id).toBe('std');
    expect(best.get('advanced')?.id).toBe('adv');
  });
});
