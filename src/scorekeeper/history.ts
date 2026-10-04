// History panel: past sessions list, personal best and an SVG sparkline.

import { GOAL, bestTrial, type Session } from './model';

const SVG_NS = 'http://www.w3.org/2000/svg';

export interface HistoryElements {
  list: HTMLElement;
  empty: HTMLElement;
  spark: HTMLElement;
  pb: HTMLElement;
  clear: HTMLElement;
}

export function modeLabel(session: Pick<Session, 'mode'>): string {
  return session.mode === 'advanced' ? 'Advanced · 10 balls' : 'Standard · 12 balls';
}

export function formatScore(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0$/, '');
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

/** Personal best = highest session average for each mode. Returns the best session per mode. */
export function personalBests(history: readonly Session[]): Map<Session['mode'], Session> {
  const best = new Map<Session['mode'], Session>();
  for (const s of history) {
    const current = best.get(s.mode);
    if (!current || s.average > current.average) best.set(s.mode, s);
  }
  return best;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}

export function renderSparkline(container: HTMLElement, history: readonly Session[]): void {
  container.replaceChildren();
  if (history.length === 0) return;

  const W = 300;
  const H = 64;
  const PAD = 6;
  const values = history.map((s) => s.average);
  const max = Math.max(GOAL + 6, ...values);
  const x = (i: number) => (values.length === 1 ? W / 2 : PAD + (i * (W - 2 * PAD)) / (values.length - 1));
  const y = (v: number) => H - PAD - (v / max) * (H - 2 * PAD);

  const root = svg('svg', {
    viewBox: `0 0 ${W} ${H}`,
    preserveAspectRatio: 'none',
    role: 'img',
    'aria-label': `Session averages over time: ${values.map(formatScore).join(', ')}. Goal line at ${GOAL}.`,
  });
  root.append(svg('line', { class: 'spark-goal', x1: 0, x2: W, y1: y(GOAL), y2: y(GOAL) }));
  if (values.length > 1) {
    root.append(
      svg('polyline', {
        class: 'spark-line',
        points: values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' '),
      }),
    );
  }
  const lastIndex = values.length - 1;
  const last = values[lastIndex] ?? 0;
  // Zero-length round-capped stroke instead of a <circle>: with preserveAspectRatio="none"
  // a circle would be stretched into an ellipse, a non-scaling stroke stays round.
  root.append(svg('path', { class: 'spark-dot', d: `M${x(lastIndex).toFixed(1)},${y(last).toFixed(1)}h0` }));
  container.append(root);
}

export function renderHistory(els: HistoryElements, history: readonly Session[]): void {
  const newestFirst = [...history].reverse();
  const bests = personalBests(history);
  const bestIds = new Set([...bests.values()].map((s) => s.id));

  els.list.replaceChildren(
    ...newestFirst.map((s) => {
      const item = el('li', 'hist-item');
      const isPb = bestIds.has(s.id) && s.average > 0;
      if (isPb) item.classList.add('is-pb');

      const main = el('span', 'hist-item__main', `${formatDate(s.date)}${s.name ? ` · ${s.name}` : ''}`);
      if (isPb) main.append(el('span', 'badge', 'PB'));

      const details = [modeLabel(s), `${s.size} target`];
      if (s.placement) details.push(s.placement);
      details.push(`${s.trials.length} trial${s.trials.length === 1 ? '' : 's'}`, `best ${bestTrial(s)}`);
      const sub = el('span', 'hist-item__sub', details.join(' · '));

      const avg = el('span', 'hist-item__avg', formatScore(s.average));
      avg.append(el('small', undefined, 'avg'));

      item.append(main, avg, sub);
      return item;
    }),
  );

  els.empty.hidden = history.length > 0;
  // Stay hidden while its inline confirm is open (see inlineConfirm in ui.ts).
  els.clear.hidden = history.length === 0 || els.clear.dataset.confirming === 'true';

  const pbParts = [...bests.values()]
    .filter((s) => s.average > 0)
    .map((s) => `${s.mode === 'advanced' ? '10-ball' : '12-ball'} ${formatScore(s.average)}`);
  els.pb.hidden = pbParts.length === 0;
  els.pb.textContent = pbParts.length ? `Personal best: ${pbParts.join(' · ')}` : '';

  renderSparkline(els.spark, history);
}
