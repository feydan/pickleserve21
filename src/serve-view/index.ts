// Server's-eye view: an animated first-person serve that follows the ball from
// the baseline to the target, kept in sync with the strategy diagram tabs.

import { createRenderer } from './render';
import { SCENARIOS, SERVE_DURATION, frameAt, stillFrame, type Scenario } from './scene';

function req<T extends Element>(root: ParentNode, selector: string): T {
  const node = root.querySelector<T>(selector);
  if (!node) throw new Error(`Serve view: missing ${selector}`);
  return node;
}

export function initServeView(root: HTMLElement, tablist: HTMLElement | null, reducedMotion: MediaQueryList): void {
  const svg = req<SVGSVGElement>(root, '.pv-svg');
  const button = req<HTMLButtonElement>(root, '.pv-play');
  const picker = req<HTMLElement>(root, '.pv-picker');
  const svgLabel = req<SVGTitleElement>(svg, 'title');
  const renderer = createRenderer(svg);

  let scenario: Scenario = SCENARIOS['tab-a']!;
  let elapsed = 0; // seconds into the current run
  let playing = false;
  let raf = 0;
  let last = 0;
  let visible = false;
  let autoPlayed = false;

  const total = () => scenario.serves.length * SERVE_DURATION;

  function drawAt(t: number): void {
    const i = Math.min(scenario.serves.length - 1, Math.floor(t / SERVE_DURATION));
    const serve = scenario.serves[i]!;
    renderer.draw(frameAt(serve, Math.min(t - i * SERVE_DURATION, SERVE_DURATION)), serve);
  }

  function drawStill(): void {
    const serve = scenario.serves[0]!;
    renderer.draw(stillFrame(serve), serve);
  }

  function setButton(state: 'play' | 'pause' | 'replay'): void {
    button.dataset.state = state;
    button.textContent = state === 'pause' ? 'Pause' : state === 'play' ? 'Play serve' : 'Replay';
  }

  function tick(now: number): void {
    // Clamp the step so a backgrounded tab doesn't jump to the end.
    elapsed += Math.min(0.05, Math.max(0, now - last) / 1000);
    last = now;
    if (elapsed >= total()) {
      elapsed = total();
      drawAt(elapsed);
      stop();
      setButton('replay');
      return;
    }
    drawAt(elapsed);
    raf = requestAnimationFrame(tick);
  }

  function play(): void {
    if (elapsed >= total()) elapsed = 0;
    playing = true;
    setButton('pause');
    last = performance.now();
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(tick);
  }

  function stop(): void {
    playing = false;
    cancelAnimationFrame(raf);
  }

  function pause(): void {
    stop();
    setButton('play');
  }

  function show(id: string): void {
    const next = SCENARIOS[id];
    if (!next) return;
    stop();
    scenario = next;
    elapsed = 0;
    renderer.setScenario(scenario);
    for (const b of pickerButtons) b.setAttribute('aria-pressed', String(b.dataset.scenario === id));
    svgLabel.textContent = `Server's-eye view: ${scenario.label}`;
    if (reducedMotion.matches) {
      drawStill();
      setButton('play');
    } else if (visible) {
      play();
    } else {
      // Play once it scrolls into view.
      autoPlayed = false;
      drawAt(0);
      setButton('play');
    }
  }

  // Scenario buttons right above the view, so switching serves needs no scrolling.
  // They drive the strategy tabs, which in turn drive the view (see below).
  const pickerButtons = Object.entries(SCENARIOS).map(([id, sc]) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'tab';
    b.dataset.scenario = id;
    b.textContent = sc.label;
    b.setAttribute('aria-pressed', 'false');
    b.addEventListener('click', () => {
      const tab = tablist?.querySelector<HTMLElement>(`#${id}`);
      if (!tab) return show(id);
      // The tab panels above differ in height; keep the view where it was.
      const top = root.getBoundingClientRect().top;
      tab.click();
      window.scrollBy({ top: root.getBoundingClientRect().top - top, behavior: 'instant' });
    });
    return b;
  });
  picker.replaceChildren(...pickerButtons);

  button.addEventListener('click', () => {
    if (playing) pause();
    else play();
  });

  if (tablist) {
    const selected = () => tablist.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.id;
    new MutationObserver(() => {
      const id = selected();
      if (id && SCENARIOS[id] !== scenario) show(id);
    }).observe(tablist, { subtree: true, attributeFilter: ['aria-selected'] });
    show(selected() ?? 'tab-a');
  } else {
    show('tab-a');
  }

  if ('IntersectionObserver' in window) {
    new IntersectionObserver(
      ([entry]) => {
        visible = entry?.isIntersecting ?? false;
        if (!visible && playing) pause();
        else if (visible && !autoPlayed && !reducedMotion.matches) {
          autoPlayed = true;
          play();
        }
      },
      { threshold: 0.5 },
    ).observe(svg);
  }
}
