import { expect, test, type Page } from '@playwright/test';
import { auditLayout, seen, settle, signInAt } from './helpers';
import { IN_DEVELOPMENT_IN_SIM as IN_DEVELOPMENT } from './helpers';

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
  { name: 'check-new', open: async (page) => {
    await signInAt(page, '/marketing/create/check', 'creator');
    await page.locator('input[type=file]').first().setInputFiles([
      { name: 'clinic-photo.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('x') },
      { name: 'corrupt-banner.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('x') },
    ]);
    await page.getByText('Rejected').first().waitFor();
  } },
  { name: 'check-results', open: async (page) => {
    await signInAt(page, '/marketing/create/check', 'creator');
    await page.getByRole('textbox', { name: /^Caption/ }).fill('Join our research study. Results guaranteed for adults.');
    await page.locator('input[type=file]').first().setInputFiles({ name: 'guaranteed-results.png', mimeType: 'image/png', buffer: Buffer.from('x') });
    await page.getByText('Ready', { exact: true }).first().waitFor();
    await page.getByRole('button', { name: 'Save and check' }).click();
    await page.getByText('Suggested fix for SIM-FACTS-1').waitFor({ timeout: 15_000 });
  } },
  { name: 'check-versions-compare', open: async (page) => {
    await signInAt(page, '/marketing/create/check', 'creator');
    await page.getByRole('textbox', { name: /^Caption/ }).fill('Join our research study. Results guaranteed for adults.');
    await page.getByRole('button', { name: 'Save and check' }).click();
    await page.getByText('Suggested fix for SIM-FACTS-1').waitFor({ timeout: 15_000 });
    await page.getByRole('button', { name: 'Accept as version 2' }).click();
    await page.getByRole('button', { name: 'Compare version 1 with version 2' }).click();
    await page.getByRole('dialog').waitFor();
    await page.waitForTimeout(400); // let the dialog finish fading in before checking contrast
  } },
  { name: 'check-carousel', open: async (page) => {
    await signInAt(page, '/marketing/create/check', 'creator');
    await page.locator('input[type=file]').first().setInputFiles(['one.png', 'two.png', 'three.png'].map((name) => ({ name, mimeType: 'image/png', buffer: Buffer.from('x') })));
    await page.getByText('Ready', { exact: true }).nth(2).waitFor();
    await page.getByRole('button', { name: 'Save and check' }).click();
    await page.getByRole('list', { name: 'Carousel order' }).getByRole('button', { name: 'Move two.png up' }).click();
    await page.getByRole('button', { name: 'Save order as version 2' }).waitFor();
  } },
  { name: 'check-ai-fix-confirm', open: async (page) => {
    await signInAt(page, '/marketing/create/check', 'creator');
    await page.locator('input[type=file]').first().setInputFiles({ name: 'guaranteed-results.png', mimeType: 'image/png', buffer: Buffer.from('x') });
    await page.getByText('Ready', { exact: true }).first().waitFor();
    await page.getByRole('button', { name: 'Save and check' }).click();
    await page.getByRole('button', { name: 'Fix with AI (paid)' }).click({ timeout: 15_000 });
    await page.getByRole('dialog').waitFor();
    await page.waitForTimeout(400); // let the dialog finish fading in before checking contrast
  } },
  { name: 'check-ai-fix-result', open: async (page) => {
    await signInAt(page, '/marketing/create/check', 'creator');
    await page.locator('input[type=file]').first().setInputFiles({ name: 'guaranteed-results.png', mimeType: 'image/png', buffer: Buffer.from('x') });
    await page.getByText('Ready', { exact: true }).first().waitFor();
    await page.getByRole('button', { name: 'Save and check' }).click();
    await page.getByRole('button', { name: 'Fix with AI (paid)' }).click({ timeout: 15_000 });
    await page.getByRole('checkbox', { name: 'I understand this makes 1 paid request' }).check();
    await page.getByRole('button', { name: 'Make 1 paid request' }).click();
    await page.getByRole('heading', { name: 'The AI fixed image' }).waitFor({ timeout: 15_000 });
    await page.waitForTimeout(400);
  } },
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
  // One review is not reachable while approvals are in development.
  ...(IN_DEVELOPMENT.approvals ? [] : [{ name: 'approval-review', open: async (page: Page) => {
    await signInAt(page, '/marketing/approvals/sim-ap-0002', 'reviewer');
    await page.locator('li button', { hasText: 'NRC (simulation)' }).click();
    await settle(page);
  } }]),
  { name: 'publications', open: (page) => signInAt(page, '/marketing/publications', 'publisher') },
  // The schedule dialog is not reachable while publishing is in development.
  ...(IN_DEVELOPMENT.publications ? [] : [{ name: 'publications-schedule', open: async (page: Page) => {
    await signInAt(page, '/marketing/publications', 'publisher');
    await page.getByRole('button', { name: 'Schedule a post' }).click();
    await page.getByRole('dialog').waitFor();
    await page.waitForTimeout(400);
  } }]),
  { name: 'accounts', open: (page) => signInAt(page, '/marketing/integrations', 'publisher') },
  { name: 'accounts-connect', open: async (page) => {
    await signInAt(page, '/marketing/integrations', 'publisher');
    await page.getByRole('button', { name: 'Connect an account' }).click();
    await page.getByRole('dialog').waitFor();
    await page.waitForTimeout(400);
  } },
  { name: 'publications-calendar', open: async (page) => {
    await signInAt(page, '/marketing/publications', 'publisher');
    await page.getByRole('tab', { name: /Calendar/ }).click();
    await page.getByRole('list', { name: /^Posts on / }).waitFor();
  } },
  { name: 'publications-multichannel', open: async (page) => {
    await signInAt(page, '/marketing/publications', 'publisher');
    await page.getByRole('button', { name: 'Schedule a post' }).click();
    const d = page.getByRole('dialog');
    await d.getByRole('combobox', { name: /Approved version/ }).click();
    await page.getByRole('option', { name: /sim-cr-0001 · version 3/ }).click();
    await d.getByRole('combobox', { name: /Social set/ }).click();
    await page.getByRole('option', { name: /Spanish/ }).click();
    for (const n of [/^nrc_estudios_sim$/, /^NRC Estudios \(simulation\)$/, /Snapchat/]) await d.getByRole('checkbox', { name: n }).check();
    await page.waitForTimeout(400);
  } },
  { name: 'team', open: (page) => signInAt(page, '/marketing/team', 'admin') },
  { name: 'usage', open: (page) => signInAt(page, '/marketing/usage', 'admin') },
  { name: 'rulebooks', open: (page) => signInAt(page, '/marketing/rules/rulebooks', 'policy-admin') },
  { name: 'rulebook-draft', open: (page) => signInAt(page, '/marketing/rules/rulebooks/00000000-0000-4000-8000-00000000c004', 'policy-admin') },
  { name: 'rulebook-add-rule', open: async (page) => {
    await signInAt(page, '/marketing/rules/rulebooks/00000000-0000-4000-8000-00000000c004', 'policy-admin');
    await page.getByRole('button', { name: 'Add a rule' }).click();
    await page.getByRole('dialog').waitFor();
  } },
  { name: 'rulebook-retire-confirm', open: async (page) => {
    await signInAt(page, '/marketing/rules/rulebooks/00000000-0000-4000-8000-00000000c002', 'policy-admin');
    await page.getByLabel('Status actions', { exact: true }).getByRole('button', { name: 'Retire' }).click();
    await page.getByRole('dialog').waitFor();
  } },
  { name: 'policy-files', open: (page) => signInAt(page, '/marketing/rules/sources', 'policy-admin') },
  { name: 'policy-file', open: (page) => signInAt(page, '/marketing/rules/sources/00000000-0000-4000-8000-00000000d001', 'policy-admin') },
  { name: 'dashboards-usage', open: (page) => signInAt(page, '/marketing/insights', 'admin') },
  { name: 'dashboards-validation', open: async (page) => {
    await signInAt(page, '/marketing/insights', 'admin');
    await page.getByRole('tab', { name: 'Validation quality' }).click();
    await page.getByText('Rules found most often').waitFor();
  } },
  { name: 'dashboards-social', open: async (page) => {
    await signInAt(page, '/marketing/insights', 'admin');
    await page.getByRole('tab', { name: 'Social performance' }).click();
    await page.getByText('Impressions by account').waitFor();
  } },
  { name: 'usage-snapshot', open: async (page) => {
    await signInAt(page, '/marketing/usage', 'reviewer');
    await page.locator('li button', { hasText: 'Partner company (simulation)' }).click();
    await page.getByText('This balance is not current').first().waitFor();
  } },
  { name: 'rules-active-policy', open: (page) => signInAt(page, '/marketing/rules', 'creator') },
  { name: 'rules-setup-required', open: (page) => signInAt(page, '/marketing/rules', 'creator-no-studies') },
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
