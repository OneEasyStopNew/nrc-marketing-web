import { expect, test, type Page } from '@playwright/test';
import { lightTheme, openNav, seen, signInAt } from './helpers';

/**
 * Read-only active policy viewer (NRC-20 demo slice), in simulation against
 * GET /policies/active. The rules come from the local, git-ignored
 * src/mocks/data.ts (ACTIVE_POLICIES): synthetic REC-0n placeholders for the
 * NRC tenant, none for the "no studies" tenant.
 */

test.beforeEach(async ({ page }) => { await lightTheme(page); });

const h1 = (page: Page) => page.getByRole('heading', { level: 1 });
const ruleCard = (page: Page, id: string) => page.getByLabel(`Rule ${id}`, { exact: true });

test('a creator sees the policy version and each rule with its clause, severity and mandatory status', async ({ page }) => {
  await signInAt(page, '/marketing', 'creator');
  await (await openNav(page)).getByRole('link', { name: 'Rules', exact: true }).click();
  await expect(h1(page)).toHaveText('Rules');

  const bundle = page.getByLabel('Active policy', { exact: true });
  await expect(bundle).toContainText('Version 1');
  await expect(bundle).toContainText('Active');
  await expect(bundle).toContainText('Synthetic');
  await expect(seen(page, 'Showing 7 of 7 rules')).toBeVisible();

  const rec01 = ruleCard(page, 'REC-01');
  await expect(rec01).toContainText('REC-01 · rule version 1');
  await expect(rec01).toContainText('Critical');
  await expect(rec01).toContainText('Mandatory');
  await expect(rec01).toContainText('Sim section 1.1');
  // Wording exactly as supplied by the API.
  await expect(rec01.getByText('[SYNTHETIC] Placeholder requirement for REC-01: no placeholder outcome claims (simulation, not real policy wording).', { exact: true })).toBeVisible();

  const rec04 = ruleCard(page, 'REC-04');
  await expect(rec04).toContainText('Major');
  await expect(rec04).toContainText('Optional');
  await expect(rec04).toContainText('Sim section 4.2, page 3');
  await expect(rec04).toContainText('[SYNTHETIC] Placeholder excerpt quoted from the simulation guideline.');
});

test('search narrows the rules and clearing the filters restores them', async ({ page }) => {
  await signInAt(page, '/marketing/rules', 'creator');
  await page.getByRole('searchbox', { name: 'Search rules' }).fill('payment');
  await expect(seen(page, 'Showing 1 of 7 rules')).toBeVisible();
  await expect(ruleCard(page, 'REC-04')).toBeVisible();
  await page.getByRole('searchbox', { name: 'Search rules' }).fill('nothing matches this');
  await expect(seen(page, 'No rules match')).toBeVisible();
  await page.getByRole('button', { name: 'Clear filters' }).click();
  await expect(seen(page, 'Showing 7 of 7 rules')).toBeVisible();
});

test('the viewer is read-only: no edit, upload or activate controls', async ({ page }) => {
  // Even a policy administrator gets the read-only view in the Rules section.
  for (const who of ['creator', 'policy-admin']) {
    await signInAt(page, '/marketing/rules', who);
    await expect(ruleCard(page, 'REC-01')).toBeVisible();
    const main = page.getByRole('main');
    for (const name of [/new rule/i, /edit/i, /upload/i, /activate/i, /retire/i, /save/i, /delete/i]) {
      await expect(main.getByRole('button', { name })).toHaveCount(0);
      await expect(main.getByRole('link', { name })).toHaveCount(0);
    }
    await expect(main.getByRole('textbox')).toHaveCount(0);
  }
});

test('only a policy administrator gets the Manage rules link, and editing there is not available yet', async ({ page }) => {
  await signInAt(page, '/marketing/rules', 'creator');
  await expect(ruleCard(page, 'REC-01')).toBeVisible();
  await expect(page.getByRole('main').getByRole('link', { name: 'Manage rules' })).toHaveCount(0);

  await signInAt(page, '/marketing/rules', 'policy-admin');
  await page.getByRole('main').getByRole('link', { name: 'Manage rules' }).click();
  await expect(page).toHaveURL(/\/marketing\/rules\/manage$/);
  await page.getByRole('button', { name: /new rule/i }).click();
  await expect(seen(page, 'Rule editing is not available yet')).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('no active policy shows "Policy setup required", never a clean result', async ({ page }) => {
  await signInAt(page, '/marketing/rules', 'creator-no-studies');
  await expect(h1(page)).toHaveText('Rules');
  await expect(seen(page, 'Policy setup required')).toBeVisible();
  await expect(seen(page, /no active policy/)).toBeVisible();
  await expect(seen(page, /no violations|passed/i)).toHaveCount(0);
  await expect(page.getByLabel(/^Rule REC-/)).toHaveCount(0);
});
