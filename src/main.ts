import '@fontsource/barlow-condensed/latin-700.css';
import '@fontsource/barlow-condensed/latin-800.css';
import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-600.css';
import './styles.css';
import { initScorekeeper } from './scorekeeper/ui';

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

function initNav(): void {
  const toggle = document.querySelector<HTMLButtonElement>('.nav__toggle');
  const menu = document.querySelector<HTMLElement>('#nav-menu');
  if (!toggle || !menu) return;

  const setOpen = (open: boolean) => {
    toggle.setAttribute('aria-expanded', String(open));
    menu.classList.toggle('is-open', open);
  };

  toggle.addEventListener('click', () => setOpen(toggle.getAttribute('aria-expanded') !== 'true'));
  menu.addEventListener('click', (e) => {
    if ((e.target as Element).closest('a')) setOpen(false);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && menu.classList.contains('is-open')) {
      setOpen(false);
      toggle.focus();
    }
  });
  window.matchMedia('(min-width: 720px)').addEventListener('change', (e) => {
    if (e.matches) setOpen(false);
  });

  // Active-section highlight
  const links = new Map<string, HTMLAnchorElement>();
  for (const a of menu.querySelectorAll<HTMLAnchorElement>('a[href^="#"]')) {
    links.set(a.hash.slice(1), a);
  }
  if (!('IntersectionObserver' in window)) return;
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        for (const [id, a] of links) {
          const active = id === entry.target.id;
          a.classList.toggle('is-active', active);
          if (active) a.setAttribute('aria-current', 'true');
          else a.removeAttribute('aria-current');
        }
      }
    },
    { rootMargin: '-45% 0px -50% 0px' },
  );
  for (const section of document.querySelectorAll<HTMLElement>('main > section[id]')) {
    observer.observe(section);
  }
}

function initReveal(): void {
  if (reducedMotion.matches || !('IntersectionObserver' in window)) return;
  document.documentElement.classList.add('js-reveal');
  const observer = new IntersectionObserver(
    (entries, obs) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          obs.unobserve(entry.target);
        }
      }
    },
    { rootMargin: '0px 0px -8% 0px' },
  );
  for (const el of document.querySelectorAll('.reveal')) observer.observe(el);
}

function initTabs(): void {
  for (const list of document.querySelectorAll<HTMLElement>('[role="tablist"]')) {
    const tabs = [...list.querySelectorAll<HTMLButtonElement>('[role="tab"]')];

    const select = (tab: HTMLButtonElement, focus: boolean) => {
      for (const t of tabs) {
        const selected = t === tab;
        t.setAttribute('aria-selected', String(selected));
        t.tabIndex = selected ? 0 : -1;
        const panel = document.getElementById(t.getAttribute('aria-controls') ?? '');
        if (panel) panel.hidden = !selected;
      }
      if (focus) tab.focus();
    };

    list.addEventListener('click', (e) => {
      const tab = (e.target as Element).closest<HTMLButtonElement>('[role="tab"]');
      if (tab) select(tab, false);
    });

    list.addEventListener('keydown', (e) => {
      const current = tabs.indexOf(document.activeElement as HTMLButtonElement);
      if (current < 0) return;
      let next: number | null = null;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (current + 1) % tabs.length;
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (current - 1 + tabs.length) % tabs.length;
      else if (e.key === 'Home') next = 0;
      else if (e.key === 'End') next = tabs.length - 1;
      const tab = next === null ? undefined : tabs[next];
      if (tab) {
        e.preventDefault();
        select(tab, true);
      }
    });
  }
}

function initYear(): void {
  const year = document.getElementById('year');
  if (year) year.textContent = String(new Date().getFullYear());
}

initNav();
initReveal();
initTabs();
initYear();

const sk = document.getElementById('sk');
if (sk) initScorekeeper(sk);
