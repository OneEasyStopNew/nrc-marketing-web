import type { Page, TestInfo } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * Simulation sign-in: open a (deep) link while signed out, pick a fixture
 * identity, and wait for the redirect through /auth/callback to settle.
 * Tokens live in memory, so every page.goto() starts signed out again.
 */
export async function signInAt(page: Page, path: string, identity: string) {
  await page.goto(path);
  await page.getByRole('heading', { level: 1, name: 'Sign in' }).waitFor();
  await page.locator('li button', { hasText: identityLabel(identity) }).click();
  // The sign-in page itself is not under /auth/callback: wait for it to go first.
  await page.getByRole('heading', { level: 1, name: 'Sign in' }).waitFor({ state: 'detached' });
  await page.waitForURL((u) => !u.pathname.startsWith('/auth/callback'));
  await settle(page);
}

const LABELS: Record<string, string> = {
  creator: 'Marketing creator', reviewer: 'Policy reviewer', admin: 'Marketing administrator',
  'no-access': 'No Marketing access', disabled: 'Disabled account', mfa: 'Two-step sign-in missing',
  'creator-no-studies': 'Creator, no studies set up', 'creator-closed': 'Creator, only closed studies',
  publisher: 'Publisher', 'policy-admin': 'Policy administrator',
};
const identityLabel = (id: string) => LABELS[id] ?? id;

/**
 * Waits until no spinner or skeleton is left on screen. The kit marks its
 * loaders with data-loading; Astryx keeps an empty live region (role=status)
 * mounted all the time, so that role says nothing about loading.
 */
export async function settle(page: Page) {
  await page.waitForLoadState('networkidle');
  await page.waitForFunction(() => !document.querySelector('[data-loading], [aria-busy=true]'), null, { timeout: 10_000 }).catch(() => undefined);
}

/**
 * Text the user can see. Astryx repeats announcements (toasts, empty states,
 * status changes) in screen-reader live regions (one on <body>, one per dialog); those are
 * not part of the page, so a plain getByText would match twice.
 */
export function seen(page: Page, text: string | RegExp, options?: { exact?: boolean }) {
  return page.getByText(text, options).and(page.locator(':not([data-astryx-live-region], [data-astryx-modal-live-region]):not([data-astryx-live-region] *, [data-astryx-modal-live-region] *)'));
}

/**
 * The section navigation. On phones the shell moves it, with the organisation
 * switcher, into a drawer behind "Open navigation"; this opens it when needed.
 */
export async function openNav(page: Page) {
  if (await navOf(page).first().isVisible()) return navOf(page);
  const open = page.getByRole('button', { name: 'Open navigation' });
  if (await open.isVisible()) {
    await open.click();
    await navOf(page).first().waitFor();
  }
  return navOf(page);
}
export const navOf = (page: Page) => page.getByRole('navigation', { name: /^(Main|Navigation)$/ });

/** Use the light theme unless a test sets another. */
export async function lightTheme(page: Page) {
  // try/catch: init scripts also run in opaque-origin frames, where storage access throws.
  await page.addInitScript(() => { try { if (!localStorage.getItem('theme')) localStorage.setItem('theme', 'light'); } catch { /* no storage here */ } });
}

export interface LayoutAudit { issues: string[]; words: number; primaries: number }

/**
 * Checks a rendered page against the rules this module is held to
 * (design-system/ and Practical UI): no sideways scroll, one h1, at most one
 * primary button outside dialogs, targets of 24px or more, nothing spilling
 * out of a card, sections at least 16px apart, no text under 11px, and the
 * WCAG 2.1 AA checks axe can run (contrast, names, labels).
 */
export async function auditLayout(page: Page, testInfo: TestInfo, name: string): Promise<LayoutAudit> {
  const r = await page.evaluate((vw) => {
    const issues: string[] = [];
    const vis = (el: Element) => {
      const s = getComputedStyle(el);
      const b = el.getBoundingClientRect();
      return s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0 && b.width > 0 && b.height > 0;
    };
    const label = (el: Element) => (el.getAttribute('aria-label') || (el as HTMLElement).innerText || el.tagName).replace(/\s+/g, ' ').trim().slice(0, 48);

    const wide = Math.max(document.documentElement.scrollWidth, window.innerWidth);
    if (wide > vw + 1) issues.push(`page scrolls sideways: ${wide}px wide in a ${vw}px window`);

    const h1 = [...document.querySelectorAll('h1')].filter(vis);
    if (h1.length !== 1) issues.push(`${h1.length} visible h1 headings`);

    const prim = [...document.querySelectorAll('[data-variant=primary], .btn-primary')].filter((b) => vis(b) && !b.closest('[role=dialog], dialog'));
    if (prim.length > 1) issues.push(`${prim.length} primary buttons: ${prim.map(label).join(' | ')}`);

    // .sr-only elements (the skip link) are visually hidden until focused; they are not pointer targets.
    // With a modal open, only the modal can be pointed at; the page behind it is inert.
    const modal = [...document.querySelectorAll('dialog[open], [role=dialog][aria-modal=true]')].filter(vis).pop();
    const scope: ParentNode = modal ?? document;
    const targets = [...scope.querySelectorAll('button, a.btn, [role=button], [role=tab], [role=radio], [role=checkbox], [role=switch], [role=combobox], select, input:not([type=hidden]), textarea')]
      .filter((el) => vis(el) && !el.matches('.sr-only'))
      // Visually hidden native inputs behind a styled control (file drop zones, checkboxes) are not what the pointer hits.
      .filter((el) => { const b = el.getBoundingClientRect(); return b.width > 1 || b.height > 1; })
      // WCAG 2.5.8 "equivalent" exception: the date can be typed into the field this button sits in.
      .filter((el) => el.getAttribute('aria-label') !== 'Open calendar');
    const boxes = targets.map((el) => el.getBoundingClientRect());
    const small = new Set<string>();
    // WCAG 2.5.8: a target under 24px passes when a 24px circle on its centre
    // touches no other target (the spacing exception). Inputs inside a taller
    // field box are covered by this too.
    targets.forEach((t, i) => {
      const b = boxes[i];
      if (b.width >= 24 && b.height >= 24) return;
      const cx = b.left + b.width / 2, cy = b.top + b.height / 2;
      // A target scrolled under a sticky footer or header cannot be hit there; it is judged once it is in view.
      const top = document.elementFromPoint(cx, cy);
      if (top && !t.contains(top) && !top.contains(t)) return;
      const crowded = boxes.some((o, j) => {
        if (j === i || t.contains(targets[j]) || targets[j].contains(t)) return false;
        const nx = Math.max(o.left, Math.min(cx, o.right)), ny = Math.max(o.top, Math.min(cy, o.bottom));
        return Math.hypot(nx - cx, ny - cy) < 12;
      });
      if (crowded) small.add(`${Math.round(b.width)}x${Math.round(b.height)} "${label(t)}"`);
    });
    small.forEach((s) => issues.push('target under 24px: ' + s));

    for (const card of [...document.querySelectorAll('#main [data-card], main .card')].filter(vis)) {
      const cb = card.getBoundingClientRect();
      for (const el of card.querySelectorAll('*')) {
        if (!vis(el) || el.closest('.overflow-x-auto, .overflow-auto, .tabs, [role=dialog], dialog, .ribbon')) continue;
        const b = el.getBoundingClientRect();
        if (b.width <= 1 && b.height <= 1) continue; // visually hidden (screen-reader only) text
        const spill = Math.max(b.right - cb.right, cb.left - b.left);
        if (spill > 2) { issues.push(`spills ${Math.round(spill)}px out of a card: "${label(el)}"`); break; }
      }
    }

    const pageEl = document.querySelector('.app-page-inner > *') ?? document.querySelector('main .page');
    if (pageEl) {
      const kids = [...pageEl.children].filter(vis);
      for (let i = 1; i < kids.length; i++) {
        const gap = kids[i].getBoundingClientRect().top - kids[i - 1].getBoundingClientRect().bottom;
        if (gap >= 0 && gap < 16) issues.push(`page sections only ${Math.round(gap)}px apart`);
      }
    }

    const tiny = new Set<string>();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const t = n.textContent?.trim();
      const el = n.parentElement;
      // Avatars are identity glyphs (initials, network marks) sized by the design system; their names are given in text or aria-label.
      if (!t || !el || !vis(el) || el.closest('.av')) continue;
      const fs = parseFloat(getComputedStyle(el).fontSize);
      if (fs < 11) tiny.add(`${fs}px "${t.slice(0, 24)}"`);
    }
    tiny.forEach((s) => issues.push('text under 11px: ' + s));

    const main = document.querySelector<HTMLElement>('.app-page-inner') ?? document.querySelector<HTMLElement>('main .page');
    const words = main ? main.innerText.split(/\s+/).filter(Boolean).length : 0;
    return { issues, words, primaries: prim.length };
  }, page.viewportSize()?.width ?? 0);

  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  for (const v of axe.violations) for (const node of v.nodes.slice(0, 3)) r.issues.push(`axe ${v.id}: ${node.target.join(' ')}`);

  testInfo.annotations.push({ type: 'words', description: String(r.words) });
  await testInfo.attach(`${name}.png`, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
  return r;
}
