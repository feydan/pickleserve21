// Scorekeeper DOM rendering and event wiring.

import {
  GOAL,
  TRIALS_PER_SESSION,
  addBall,
  ballLimit,
  canStartNextTrial,
  completedTrials,
  createSession,
  currentTrial,
  currentTrialIndex,
  finalizeSession,
  hasAnyBalls,
  hitGoal,
  isBallScore,
  isMode,
  isSessionComplete,
  isTargetSize,
  isTrialComplete,
  makeTrial,
  nextTrial,
  setMode,
  undo,
  type BallScore,
  type Session,
} from './model';
import { HISTORY_LIMIT, createStore, type ScoreStore } from './storage';
import { formatScore, renderHistory, type HistoryElements } from './history';

const ZONE_NAMES: Record<BallScore, string> = { 0: 'Miss', 1: 'Yellow', 3: 'Green', 5: 'Red' };

function req<T extends Element>(root: ParentNode, selector: string): T {
  const node = root.querySelector<T>(selector);
  if (!node) throw new Error(`Scorekeeper: missing ${selector}`);
  return node;
}

/**
 * Two-step in-page confirmation (no window.confirm). The trigger button is
 * swapped for "message + Confirm + Cancel" until the user decides.
 */
function inlineConfirm(wrap: HTMLElement, trigger: HTMLButtonElement, message: string, onConfirm: () => void): void {
  trigger.hidden = true;
  trigger.dataset.confirming = 'true';
  const text = document.createElement('span');
  text.className = 'confirm-wrap__text';
  text.textContent = message;
  const yes = document.createElement('button');
  yes.type = 'button';
  yes.className = 'btn btn--small btn--danger';
  yes.textContent = 'Confirm';
  const no = document.createElement('button');
  no.type = 'button';
  no.className = 'btn btn--small btn--ghost';
  no.textContent = 'Cancel';

  const close = (restoreFocus: boolean) => {
    text.remove();
    yes.remove();
    no.remove();
    delete trigger.dataset.confirming;
    trigger.hidden = false;
    if (restoreFocus && !trigger.hidden) trigger.focus();
  };
  yes.addEventListener('click', () => {
    close(false);
    onConfirm();
  });
  no.addEventListener('click', () => close(true));
  wrap.append(text, yes, no);
  no.focus();
}

export function initScorekeeper(root: HTMLElement, store: ScoreStore = createStore()): void {
  const form = req<HTMLFormElement>(root, '#sk-setup');
  const nameInput = req<HTMLInputElement>(form, '#sk-name');
  const placementInput = req<HTMLInputElement>(form, '#sk-placement');
  const modeInputs = [...form.querySelectorAll<HTMLInputElement>('input[name="mode"]')];
  const sizeInputs = [...form.querySelectorAll<HTMLInputElement>('input[name="size"]')];
  const modeLock = req<HTMLElement>(root, '#sk-mode-lock');

  const ringBar = req<SVGCircleElement>(root, '#sk-ring-bar');
  const totalVisual = req<HTMLElement>(root, '#sk-total-visual');
  const live = req<HTMLElement>(root, '#sk-live');
  const counter = req<HTMLElement>(root, '#sk-counter');
  const trialLabel = req<HTMLElement>(root, '#sk-trial');
  const chips = req<HTMLOListElement>(root, '#sk-chips');
  const result = req<HTMLElement>(root, '#sk-result');
  const pads = [...root.querySelectorAll<HTMLButtonElement>('.pad[data-score]')];
  const undoBtn = req<HTMLButtonElement>(root, '#sk-undo');
  const nextBtn = req<HTMLButtonElement>(root, '#sk-next');
  const saveBtn = req<HTMLButtonElement>(root, '#sk-save');
  const resetBtn = req<HTMLButtonElement>(root, '#sk-reset');
  const resetWrap = req<HTMLElement>(root, '#sk-reset-wrap');
  const trialsList = req<HTMLElement>(root, '#sk-trials');
  const avgOut = req<HTMLElement>(root, '#sk-avg');
  const storageNote = req<HTMLElement>(root, '#sk-storage-note');
  const clearBtn = req<HTMLButtonElement>(root, '#sk-clear');
  const clearWrap = req<HTMLElement>(root, '#sk-clear-wrap');
  const historyEls: HistoryElements = {
    list: req(root, '#sk-history-list'),
    empty: req(root, '#sk-history-empty'),
    spark: req(root, '#sk-spark'),
    pb: req(root, '#sk-pb'),
    clear: clearBtn,
  };

  let history = store.loadHistory();
  let session = store.loadCurrent() ?? createSession();
  if (session.trials.length === 0) session = { ...session, trials: [makeTrial()] };

  const isSaved = () => history.some((h) => h.id === session.id);

  function persist(): void {
    store.saveCurrent(session);
    storageNote.hidden = store.persistent;
  }

  function saveToHistory(): void {
    const finished = finalizeSession(session);
    if (finished.trials.length === 0) return;
    history = [...history.filter((h) => h.id !== finished.id), finished].slice(-HISTORY_LIMIT);
    store.saveHistory(history);
    storageNote.hidden = store.persistent;
    renderHistory(historyEls, history);
  }

  function syncSetupFromSession(): void {
    nameInput.value = session.name;
    placementInput.value = session.placement;
    for (const input of modeInputs) input.checked = input.value === session.mode;
    for (const input of sizeInputs) input.checked = input.value === session.size;
  }

  function announce(message: string): void {
    live.textContent = message;
  }

  function render(): void {
    const limit = ballLimit(session.mode);
    const trial = currentTrial(session);
    const trialIdx = currentTrialIndex(session);
    const trialDone = isTrialComplete(trial, session.mode);
    const sessionDone = isSessionComplete(session);
    const saved = isSaved();
    const locked = hasAnyBalls(session);

    // setup
    for (const input of modeInputs) input.disabled = locked && input.value !== session.mode;
    modeLock.hidden = !locked;

    // ring + totals
    const pct = Math.min(100, (trial.total / GOAL) * 100);
    ringBar.style.strokeDasharray = `${pct} 100`;
    ringBar.classList.toggle('is-goal', hitGoal(trial.total));
    ringBar.style.opacity = pct > 0 ? '1' : '0';
    totalVisual.textContent = String(trial.total);
    counter.textContent = trialDone ? `${limit} of ${limit} balls` : `Ball ${trial.balls.length + 1} of ${limit}`;
    trialLabel.textContent = `Trial ${trialIdx + 1} of ${TRIALS_PER_SESSION}`;

    // chips
    chips.replaceChildren(
      ...Array.from({ length: limit }, (_, i) => {
        const li = document.createElement('li');
        const score = trial.balls[i];
        if (score !== undefined) {
          li.dataset.score = String(score);
          li.textContent = String(score);
          li.setAttribute('aria-label', `Ball ${i + 1}: ${ZONE_NAMES[score]}, ${score}`);
        } else {
          li.textContent = String(i + 1);
          li.setAttribute('aria-label', `Ball ${i + 1}: not played`);
          if (i === trial.balls.length) li.classList.add('is-next');
        }
        return li;
      }),
    );

    // result banner
    if (trialDone || saved) {
      const goal = trialDone && hitGoal(trial.total);
      result.hidden = false;
      result.classList.toggle('is-goal', goal);
      const big = document.createElement('p');
      big.className = 'sk-result__big';
      if (!trialDone) big.textContent = 'Session saved';
      else big.textContent = goal ? `${trial.total} points · 21+ ✓ Goal hit` : `${trial.total} points — keep practicing`;
      const sub = document.createElement('p');
      if (sessionDone) {
        sub.textContent = `Session complete — average ${formatScore(session.average)}.${saved ? ' Saved to history.' : ''}`;
      } else if (saved) {
        const n = completedTrials(session).length;
        sub.textContent = `Saved with ${n} trial${n === 1 ? '' : 's'} — average ${formatScore(session.average)}. Start a new session to keep playing.`;
      } else {
        sub.textContent = `Trial ${trialIdx + 1} done. Start the next trial when you're ready.`;
      }
      result.replaceChildren(big, sub);
    } else {
      result.hidden = true;
      result.replaceChildren();
    }

    // pads + actions
    // A saved session is finished: no more scoring until a new session starts.
    for (const pad of pads) pad.disabled = trialDone || saved;
    undoBtn.disabled = !locked || saved;
    nextBtn.hidden = saved || !canStartNextTrial(session);
    // Only offer saving between trials, so a half-played trial is never silently dropped.
    saveBtn.hidden =
      saved || sessionDone || completedTrials(session).length === 0 || (trial.balls.length > 0 && !trialDone);
    resetBtn.textContent = saved ? 'New session' : 'Reset';

    // session summary
    trialsList.replaceChildren(
      ...Array.from({ length: TRIALS_PER_SESSION }, (_, i) => {
        const t = session.trials[i];
        const wrap = document.createElement('div');
        const dt = document.createElement('dt');
        dt.textContent = `Trial ${i + 1}`;
        const dd = document.createElement('dd');
        if (t && isTrialComplete(t, session.mode)) {
          dd.textContent = String(t.total);
          if (hitGoal(t.total)) dd.classList.add('is-goal');
        } else if (t && t.balls.length) {
          dd.textContent = `${t.total}…`;
        } else {
          dd.textContent = '–';
        }
        wrap.append(dt, dd);
        return wrap;
      }),
    );
    const done = completedTrials(session).length;
    avgOut.textContent = done ? formatScore(session.average) : '–';
  }

  function update(next: Session): void {
    if (next === session) return;
    session = next;
    persist();
    render();
  }

  function score(value: BallScore): void {
    if (isSaved()) return;
    const before = session;
    const next = addBall(session, value);
    if (next === before) return;
    session = next;
    const trial = currentTrial(session);
    const limit = ballLimit(session.mode);
    let message = `${ZONE_NAMES[value]}, ${value}. Total ${trial.total} after ${trial.balls.length} of ${limit} balls.`;
    if (isTrialComplete(trial, session.mode)) {
      message += hitGoal(trial.total) ? ' Goal hit!' : ' Trial over — keep practicing.';
      if (isSessionComplete(session)) {
        saveToHistory();
        message += ` Session average ${formatScore(session.average)}, saved.`;
      }
    }
    persist();
    render();
    announce(message);
  }

  function doUndo(): void {
    if (isSaved()) return;
    const next = undo(session);
    if (next === session) return;
    update(next);
    announce(`Undone. Total ${currentTrial(session).total}.`);
  }

  function startNew(): void {
    update(
      createSession({
        name: session.name,
        mode: session.mode,
        size: session.size,
        placement: session.placement,
      }),
    );
    announce('New session started.');
  }

  // --- events ---
  for (const pad of pads) {
    pad.addEventListener('click', () => {
      const v = Number(pad.dataset.score);
      if (isBallScore(v)) score(v);
    });
  }

  undoBtn.addEventListener('click', doUndo);
  nextBtn.addEventListener('click', () => {
    update(nextTrial(session));
    announce(`Trial ${currentTrialIndex(session) + 1} started.`);
    pads[pads.length - 1]?.focus();
  });
  saveBtn.addEventListener('click', () => {
    saveToHistory();
    render();
    announce(`Session saved. Average ${formatScore(finalizeSession(session).average)}.`);
  });
  resetBtn.addEventListener('click', () => {
    if (isSaved() || !hasAnyBalls(session)) {
      startNew();
      return;
    }
    inlineConfirm(resetWrap, resetBtn, 'Discard this session?', startNew);
  });
  clearBtn.addEventListener('click', () => {
    inlineConfirm(clearWrap, clearBtn, 'Delete all saved sessions?', () => {
      history = [];
      store.saveHistory(history);
      renderHistory(historyEls, history);
      render();
      announce('History cleared.');
    });
  });

  form.addEventListener('submit', (e) => e.preventDefault());
  nameInput.addEventListener('input', () => update({ ...session, name: nameInput.value.trim() }));
  placementInput.addEventListener('input', () => update({ ...session, placement: placementInput.value.trim() }));
  for (const input of modeInputs) {
    input.addEventListener('change', () => {
      if (input.checked && isMode(input.value)) update(setMode(session, input.value));
      syncSetupFromSession();
    });
  }
  for (const input of sizeInputs) {
    input.addEventListener('change', () => {
      if (input.checked && isTargetSize(input.value)) update({ ...session, size: input.value });
    });
  }

  // Keyboard shortcuts while the scorekeeper is on screen.
  let onScreen = false;
  if ('IntersectionObserver' in window) {
    new IntersectionObserver((entries) => {
      for (const entry of entries) onScreen = entry.isIntersecting;
    }).observe(root);
  } else {
    onScreen = true;
  }

  document.addEventListener('keydown', (e) => {
    if (!onScreen || e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
    const target = e.target as HTMLElement | null;
    const typing =
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement ||
      (target instanceof HTMLInputElement && !['radio', 'checkbox', 'button'].includes(target.type)) ||
      target?.isContentEditable;
    if (typing) return;
    if (e.key === 'u' || e.key === 'U') {
      e.preventDefault();
      doUndo();
      return;
    }
    // Exact digit match: Number(' ') is 0, so a looser check would turn Space into a Miss.
    if (e.key === '0' || e.key === '1' || e.key === '3' || e.key === '5') {
      const v = Number(e.key) as BallScore;
      e.preventDefault();
      const pad = pads.find((p) => p.dataset.score === e.key);
      if (pad && !pad.disabled) {
        pad.classList.add('is-pressed');
        window.setTimeout(() => pad.classList.remove('is-pressed'), 120);
      }
      score(v);
    }
  });

  syncSetupFromSession();
  storageNote.hidden = store.persistent;
  renderHistory(historyEls, history);
  render();
}
