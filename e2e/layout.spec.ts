import { expect, test, type Page } from '@playwright/test';
import { auditLayout, seen, settle, signInAt } from './helpers';

/**
 * Layout and accessibility audit (axe WCAG 2.1 AA plus the design-system
 * rules in helpers.ts) of every built screen, light at three widths and dark
 * at desktop.
 */
const SCREENS: { name: string; open: (page: Page) => Promise<void> }[] = [
  { name: 'sign-in', open: async (page) => { await page.goto('/marketing'); await settle(page); } },
  { name: 'session-expired-link', open: async (page) => { await page.goto('/auth/callback?code=sim&state=x'); await settle(page); } },
  { name: 'choose-organisation', open: async (page) => { await page.goto('/marketing'); await page.locator('li button', { hasText: 'Policy reviewer' }).click(); await settle(page); } },
  { name: 'home', open: (page) => signInAt(page, '/marketing', 'admin') },
  { name: 'section', open: (page) => signInAt(page, '/marketing/rules', 'admin') },
  { name: 'create-new', open: (page) => signInAt(page, '/marketing/create', 'creator') },
  { name: 'create-draft', open: (page) => signInAt(page, '/marketing/create/sim-cr-0001', 'creator') },
  { name: 'create-errors', open: async (page) => { await signInAt(page, '/marketing/create', 'creator'); await page.getByRole('button', { name: 'Create draft' }).click(); } },
  { name: 'create-no-studies', open: (page) => signInAt(page, '/marketing/create', 'creator-no-studies') },
  { name: 'create-closed-draft', open: (page) => signInAt(page, '/marketing/create/sim-cr-0002', 'creator-closed') },
  { name: 'create-preview', open: (page) => signInAt(page, '/marketing/create/sim-cr-0001/preview', 'creator') },
  { name: 'create-versions-compare', open: async (page) => {
    await signInAt(page, '/marketing/create/sim-cr-0001', 'creator');
    await page.getByRole('button', { name: 'Compare version 3 with the text now' }).click();
    await page.getByRole('dialog').waitFor();
    await page.waitForTimeout(400); // let the dialog finish fading in before checking contrast
  } },
  { name: 'validation-start', open: (page) => signInAt(page, '/marketing/validation', 'creator') },
  { name: 'validation-pass', open: (page) => signInAt(page, '/marketing/validation/sim-cr-0001/sim-run-0003', 'creator') },
  { name: 'validation-fail', open: async (page) => {
    await signInAt(page, '/marketing/create/sim-cr-0001', 'creator');
    await page.getByRole('textbox', { name: /^Brief/ }).fill('A guaranteed cure for everyone who joins the study, and you get paid.');
    await page.getByRole('button', { name: 'Validate version 4' }).click();
    await seen(page, 'Finished', { exact: true }).waitFor({ timeout: 15_000 });
    await settle(page);
  } },
  { name: 'home-creator', open: (page) => signInAt(page, '/marketing', 'creator') },
  { name: 'home-publisher', open: (page) => signInAt(page, '/marketing', 'publisher') },
  { name: 'media', open: (page) => signInAt(page, '/marketing/media', 'creator') },
  { name: 'media-upload', open: async (page) => {
    await signInAt(page, '/marketing/media', 'creator');
    await page.getByRole('button', { name: 'Upload' }).click();
    await page.getByRole('dialog').waitFor();
    await page.waitForTimeout(400);
  } },
  { name: 'approvals', open: async (page) => {
    await signInAt(page, '/marketing/approvals', 'reviewer');
    await page.locator('li button', { hasText: 'NRC (simulation)' }).click();
    await settle(page);
  } },
  { name: 'approval-review', open: async (page) => {
    await signInAt(page, '/marketing/approvals/sim-ap-0002', 'reviewer');
    await page.locator('li button', { hasText: 'NRC (simulation)' }).click();
    await settle(page);
  } },
  { name: 'publications', open: (page) => signInAt(page, '/marketing/publications', 'publisher') },
  { name: 'publications-schedule', open: async (page) => {
    await signInAt(page, '/marketing/publications', 'publisher');
    await page.getByRole('button', { name: 'Schedule a post' }).click();
    await page.getByRole('dialog').waitFor();
    await page.waitForTimeout(400);
  } },
  { name: 'accounts', open: (page) => signInAt(page, '/marketing/integrations', 'publisher') },
  { name: 'team', open: (page) => signInAt(page, '/marketing/team', 'admin') },
  { name: 'rule-new', open: async (page) => {
    await signInAt(page, '/marketing/rules', 'policy-admin');
    await page.getByRole('button', { name: 'New rule' }).click();
    await page.getByRole('dialog').waitFor();
    await page.waitForTimeout(400);
  } },
  { name: 'no-permission', open: (page) => signInAt(page, '/marketing/approvals', 'creator') },
  { name: 'not-found', open: (page) => signInAt(page, '/marketing/nope', 'creator') },
  { name: 'blocked', open: (page) => signInAt(page, '/marketing', 'disabled') },
];

for (const theme of ['light', 'dark'] as const) {
  test.describe(`layout · ${theme}`, () => {
    for (const s of SCREENS) {
      test(s.name, async ({ page }, testInfo) => {
        test.skip(theme === 'dark' && testInfo.project.name !== 'desktop', 'dark mode is checked at desktop width');
        await page.addInitScript((t) => { try { localStorage.setItem('theme', t); } catch { /* opaque-origin frame */ } }, theme);
        await s.open(page);
        const r = await auditLayout(page, testInfo, `${s.name}-${theme}`);
        expect(r.issues, `${s.name} layout issues`).toEqual([]);
      });
    }
  });
}
