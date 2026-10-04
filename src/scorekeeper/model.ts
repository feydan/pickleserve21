// Pure scorekeeper logic. No DOM access here so it stays easy to unit-test.

export type BallScore = 0 | 1 | 3 | 5;
export type Mode = 'standard' | 'advanced';
export type TargetSize = 'large' | 'small';

export interface Trial {
  balls: BallScore[];
  total: number;
}

export interface Session {
  id: string;
  date: string; // ISO timestamp
  name: string;
  mode: Mode;
  size: TargetSize;
  placement: string;
  trials: Trial[];
  average: number;
}

export interface SessionOptions {
  name?: string;
  mode?: Mode;
  size?: TargetSize;
  placement?: string;
}

export const BALL_SCORES: readonly BallScore[] = [0, 1, 3, 5];
export const GOAL = 21;
export const TRIALS_PER_SESSION = 3;

const BALL_LIMITS: Record<Mode, number> = { standard: 12, advanced: 10 };

export function ballLimit(mode: Mode): number {
  return BALL_LIMITS[mode];
}

export function isBallScore(value: unknown): value is BallScore {
  return value === 0 || value === 1 || value === 3 || value === 5;
}

export function isMode(value: unknown): value is Mode {
  return value === 'standard' || value === 'advanced';
}

export function isTargetSize(value: unknown): value is TargetSize {
  return value === 'large' || value === 'small';
}

export function sumBalls(balls: readonly BallScore[]): number {
  return balls.reduce<number>((acc, b) => acc + b, 0);
}

export function makeTrial(balls: BallScore[] = []): Trial {
  return { balls, total: sumBalls(balls) };
}

export function hitGoal(total: number): boolean {
  return total >= GOAL;
}

export function isTrialComplete(trial: Trial, mode: Mode): boolean {
  return trial.balls.length >= ballLimit(mode);
}

export function completedTrials(session: Session): Trial[] {
  return session.trials.filter((t) => isTrialComplete(t, session.mode));
}

/** Average of completed trials (scoresheet: add 3 scores, divide by 3). */
export function averageOf(trials: readonly Trial[]): number {
  if (trials.length === 0) return 0;
  const sum = trials.reduce((acc, t) => acc + t.total, 0);
  return Math.round((sum / trials.length) * 100) / 100;
}

export function bestTrial(session: Session): number {
  const done = completedTrials(session);
  return done.length ? Math.max(...done.map((t) => t.total)) : 0;
}

function generateId(now: Date): string {
  return `${now.getTime().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createSession(opts: SessionOptions = {}, now: Date = new Date(), id?: string): Session {
  return {
    id: id ?? generateId(now),
    date: now.toISOString(),
    name: opts.name ?? '',
    mode: opts.mode ?? 'standard',
    size: opts.size ?? 'large',
    placement: opts.placement ?? '',
    trials: [makeTrial()],
    average: 0,
  };
}

function withTrials(session: Session, trials: Trial[]): Session {
  const next = { ...session, trials };
  return { ...next, average: averageOf(completedTrials(next)) };
}

export function currentTrial(session: Session): Trial {
  const last = session.trials[session.trials.length - 1];
  return last ?? makeTrial();
}

export function currentTrialIndex(session: Session): number {
  return Math.max(0, session.trials.length - 1);
}

export function isSessionComplete(session: Session): boolean {
  return (
    session.trials.length >= TRIALS_PER_SESSION &&
    session.trials.every((t) => isTrialComplete(t, session.mode))
  );
}

export function hasAnyBalls(session: Session): boolean {
  return session.trials.some((t) => t.balls.length > 0);
}

/** Adds the next ball to the current trial. Returns the same session if the trial is full. */
export function addBall(session: Session, score: BallScore): Session {
  if (!isBallScore(score)) return session;
  const trial = currentTrial(session);
  if (isTrialComplete(trial, session.mode)) return session;
  const trials = session.trials.slice(0, -1);
  trials.push(makeTrial([...trial.balls, score]));
  return withTrials(session, trials);
}

/** Removes the last entered ball, stepping back into the previous trial if the current one is empty. */
export function undo(session: Session): Session {
  const trials = session.trials.map((t) => makeTrial([...t.balls]));
  let last = trials[trials.length - 1];
  if (last && last.balls.length === 0 && trials.length > 1) {
    trials.pop();
    last = trials[trials.length - 1];
  }
  if (!last || last.balls.length === 0) return session;
  trials[trials.length - 1] = makeTrial(last.balls.slice(0, -1));
  return withTrials(session, trials);
}

export function canStartNextTrial(session: Session): boolean {
  return (
    session.trials.length < TRIALS_PER_SESSION &&
    isTrialComplete(currentTrial(session), session.mode)
  );
}

export function nextTrial(session: Session): Session {
  if (!canStartNextTrial(session)) return session;
  return withTrials(session, [...session.trials, makeTrial()]);
}

/** Mode can only change before any ball has been entered. */
export function setMode(session: Session, mode: Mode): Session {
  if (hasAnyBalls(session) || session.mode === mode) return session;
  return withTrials({ ...session, mode }, session.trials);
}

/** Session as it should be stored in history: completed trials only, average recomputed. */
export function finalizeSession(session: Session): Session {
  return withTrials(session, completedTrials(session));
}

export function isSession(value: unknown): value is Session {
  if (typeof value !== 'object' || value === null) return false;
  const s = value as Record<string, unknown>;
  if (
    typeof s.id !== 'string' ||
    typeof s.date !== 'string' ||
    Number.isNaN(Date.parse(s.date)) ||
    typeof s.name !== 'string' ||
    !isMode(s.mode) ||
    !isTargetSize(s.size) ||
    typeof s.placement !== 'string' ||
    typeof s.average !== 'number' ||
    !Array.isArray(s.trials) ||
    s.trials.length > TRIALS_PER_SESSION
  ) {
    return false;
  }
  const limit = ballLimit(s.mode);
  return s.trials.every((t: unknown) => {
    if (typeof t !== 'object' || t === null) return false;
    const trial = t as Record<string, unknown>;
    return (
      Array.isArray(trial.balls) &&
      trial.balls.length <= limit &&
      trial.balls.every(isBallScore) &&
      typeof trial.total === 'number'
    );
  });
}

/** Rebuilds derived fields (totals, average) so stored data can't drift from the balls. */
export function normalizeSession(session: Session): Session {
  return withTrials(session, session.trials.map((t) => makeTrial([...t.balls])));
}
