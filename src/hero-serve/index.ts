// Hero serve: a cinematic first-person serve drawn on a canvas behind the hero
// copy. Plays once on load and rests on the frozen landing; "Replay serve" runs
// it again. Reduced motion gets the final frame only.

import { createPainter, createScenery } from './render';
import { DURATION, finalShot, shotAt, type Framing } from './shot';

/**
 * `handoff`: the page rally is running. Once the serve rests, the hero stops drawing its
 * ball and announces where it was (`hero-serve:rest`), so the rally can carry that same
 * ball down the page; `hero-serve:play` takes it back for a replay.
 */
export function initHeroServe(hero: HTMLElement, reducedMotion: MediaQueryList, opts: { handoff?: boolean } = {}): void {
  const canvas = document.createElement('canvas');
  canvas.className = 'hero-scene';
  canvas.setAttribute('role', 'img');
  canvas.setAttribute(
    'aria-label',
    'A pickleball serve at sunset, seen from the server: the ball clears the net and lands on the red 5 of the PickleServe 21 target mat.',
  );
  const replay = document.createElement('button');
  replay.type = 'button';
  replay.className = 'hero-replay';
  replay.textContent = 'Replay serve';
  replay.hidden = true;

  hero.prepend(canvas);
  hero.append(replay);
  hero.classList.add('hero--scene');

  const painter = createPainter(canvas, createScenery());
  let framing: Framing = { aspect: 1.6 };
  let t = DURATION;
  let raf = 0;
  let last = 0;

  const resting = () => t >= DURATION;
  const render = () =>
    painter.draw(resting() ? finalShot(framing) : shotAt(t, framing), t, { hideBall: resting() && opts.handoff });

  function handOff(): void {
    if (!opts.handoff || !resting()) return;
    const at = painter.locate(finalShot(framing));
    if (at) window.dispatchEvent(new CustomEvent('hero-serve:rest', { detail: { canvas, ...at } }));
  }

  function size(): void {
    const r = canvas.getBoundingClientRect();
    framing = { aspect: r.width / Math.max(1, r.height) };
    painter.resize(r.width, r.height, Math.min(window.devicePixelRatio || 1, 1.75));
    render();
    handOff();
  }

  function tick(now: number): void {
    // Clamp the step so a backgrounded tab resumes instead of skipping ahead.
    t += Math.min(0.05, Math.max(0, now - last) / 1000);
    last = now;
    render();
    if (t < DURATION) raf = requestAnimationFrame(tick);
    else finish();
  }

  function finish(): void {
    cancelAnimationFrame(raf);
    raf = 0;
    t = DURATION;
    render();
    replay.hidden = reducedMotion.matches;
    handOff();
  }

  function play(): void {
    cancelAnimationFrame(raf);
    replay.hidden = true;
    t = 0;
    last = performance.now();
    if (opts.handoff) window.dispatchEvent(new CustomEvent('hero-serve:play'));
    raf = requestAnimationFrame(tick);
  }

  // Scrolling away mid-serve skips to the landing, so the rally can pick the ball up.
  window.addEventListener(
    'scroll',
    () => {
      if (raf && window.scrollY > 40) finish();
    },
    { passive: true },
  );

  new ResizeObserver(size).observe(canvas);
  replay.addEventListener('click', play);

  if (import.meta.env.DEV) {
    (window as unknown as { heroSeek: (s: number) => void }).heroSeek = (s: number) => {
      cancelAnimationFrame(raf);
      t = s;
      render();
    };
  }

  // Wait for the display font so the mat numbers render in it.
  const start = () => {
    size();
    if (reducedMotion.matches) return;
    play();
  };
  (document.fonts?.ready ?? Promise.resolve()).then(start, start);
}
