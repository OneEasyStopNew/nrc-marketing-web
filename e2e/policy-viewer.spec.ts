import { expect, test, type Page } from '@playwright/test';
import { IN_DEVELOPMENT } from '../src/config/inDevelopment';
import { lightTheme, openNav, seen, signInAt } from './helpers';

/**
 * Read-only active policy viewer (NRC-20 demo slice), in simulation against
 * GET /policies/active. The mock serves the placeholder VALIDATION_RULES from
 * the local, git-ignored src/mocks/data.ts (SIM-COMPLETE-1, SIM-FACTS-1,
 * SIM-POLICY-4) for the NRC tenant; tenants in NO_ACTIVE_POLICY_TENANTS (the
 * "no studies" one) have none.
 */

test.beforeEach(async ({ page }) => {
  await lightTheme(page);
});

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
  await expect(seen(page, 'Showing 3 of 3 rules')).toBeVisible();

  const facts = ruleCard(page, 'SIM-FACTS-1');
  await expect(facts).toContainText('SIM-FACTS-1 · rule version 2');
  await expect(facts).toContainText('Critical');
  await expect(facts).toContainText('Mandatory');
  await expect(facts).toContainText('Sim 2.3');
  // Wording exactly as supplied by the API (the mock uses the rule's explanation as its requirement).
  await expect(facts.getByText('Claims a benefit the study has not shown (placeholder rule).', { exact: true }).first()).toBeVisible();
  await expect(facts).toContainText('[Placeholder clause text for Sim 2.3 (simulation)]');

  const payment = ruleCard(page, 'SIM-POLICY-4');
  await expect(payment).toContainText('Minor');
  await expect(payment).toContainText('Optional');
  await expect(payment).toContainText('Sim 4.1');
});

test('search narrows the rules and clearing the filters restores them', async ({ page }) => {
  await signInAt(page, '/marketing/rules', 'creator');
  await page.getByRole('searchbox', { name: 'Search rules' }).fill('payment');
  await expect(seen(page, 'Showing 1 of 3 rules')).toBeVisible();
  await expect(ruleCard(page, 'SIM-POLICY-4')).toBeVisible();
  await page.getByRole('searchbox', { name: 'Search rules' }).fill('nothing matches this');
  await expect(seen(page, 'No rules match')).toBeVisible();
  await page.getByRole('button', { name: 'Clear filters' }).click();
  await expect(seen(page, 'Showing 3 of 3 rules')).toBeVisible();
});

// Regression (PR #4, RE-11): filters live in the URL, so a filtered view can be shared and survives
// going to Manage rules and back. (Sign-in drops the query string by design, see src/auth/returnTo.ts.)
test('filters are kept in the URL and survive going to Manage rules and back', async ({ page }) => {
  await signInAt(page, '/marketing/rules', 'policy-admin');
  const pick = async (box: string, option: string) => {
    // Under parallel load the mobile selector can miss its first tap; retry until the list opens.
    await expect(async () => {
      await page.getByRole('combobox', { name: box }).click();
      await expect(page.getByRole('option', { name: option, exact: true })).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 15_000 });
    await page.getByRole('option', { name: option, exact: true }).click();
    // On mobile the next selector ignores a click while this listbox is still closing.
    await expect(page.getByRole('listbox')).toHaveCount(0);
    await expect(page.getByRole('combobox', { name: box })).toContainText(option);
  };
  await pick('Severity', 'Critical');
  await pick('Mandatory', 'Mandatory only');
  await page.getByRole('searchbox', { name: 'Search rules' }).fill('SIM');
  await expect(page).toHaveURL(/[?&]severity=critical(&|$)/);
  await expect(page).toHaveURL(/[?&]mandatory=mandatory(&|$)/);
  await expect(page).toHaveURL(/[?&]q=SIM(&|$)/);

  const check = async () => {
    // Only SIM-FACTS-1 is critical and mandatory.
    await expect(ruleCard(page, 'SIM-FACTS-1')).toBeVisible();
    await expect(page.getByLabel(/^Rule SIM-/)).toHaveCount(1);
    await expect(seen(page, 'Showing 1 of 3 rules')).toBeVisible();
  };
  await check();

  await page.getByRole('main').getByRole('link', { name: 'Manage rules' }).click();
  await expect(page).toHaveURL(/\/marketing\/rules\/manage$/);
  await page.goBack();
  await expect(page).toHaveURL(/severity=critical/);
  await expect(page.getByRole('searchbox', { name: 'Search rules' })).toHaveValue('SIM');
  await check();

  await page.getByRole('searchbox', { name: 'Search rules' }).fill('nothing matches this');
  await page.getByRole('button', { name: 'Clear filters' }).click();
  await expect(seen(page, 'Showing 3 of 3 rules')).toBeVisible();
  await expect(page).toHaveURL(/\/marketing\/rules$/);
});

test('the viewer is read-only: no edit, upload or activate controls', async ({ page }) => {
  // Even a policy administrator gets the read-only view in the Rules section.
  for (const who of ['creator', 'policy-admin']) {
    await signInAt(page, '/marketing/rules', who);
    await expect(ruleCard(page, 'SIM-FACTS-1')).toBeVisible();
    const main = page.getByRole('main');
    for (const name of [/new rule/i, /edit/i, /upload/i, /activate/i, /retire/i, /save/i, /delete/i]) {
      await expect(main.getByRole('button', { name })).toHaveCount(0);
      await expect(main.getByRole('link', { name })).toHaveCount(0);
    }
    await expect(main.getByRole('textbox')).toHaveCount(0);
  }
});

test('only a policy administrator gets the Manage rules link, and editing there is in development', async ({ page }) => {
  await signInAt(page, '/marketing/rules', 'creator');
  await expect(ruleCard(page, 'SIM-FACTS-1')).toBeVisible();
  await expect(page.getByRole('main').getByRole('link', { name: 'Manage rules' })).toHaveCount(0);

  await signInAt(page, '/marketing/rules', 'policy-admin');
  await page.getByRole('main').getByRole('link', { name: 'Manage rules' }).click();
  await expect(page).toHaveURL(/\/marketing\/rules\/manage$/);
  await page.getByRole('button', { name: /new rule/i }).click();
  if (IN_DEVELOPMENT.ruleEditing) {
    await expect(page.getByRole('heading', { name: 'In development: New rule' })).toBeVisible();
    await expect(page.getByRole('dialog').getByRole('textbox')).toHaveCount(0);
  } else {
    await expect(page.getByRole('dialog', { name: 'New rule' })).toBeVisible();
  }
});

test('no active policy shows "Policy setup required", never a clean result', async ({ page }) => {
  await signInAt(page, '/marketing/rules', 'creator-no-studies');
  await expect(h1(page)).toHaveText('Rules');
  await expect(seen(page, 'Policy setup required')).toBeVisible();
  await expect(seen(page, /no active policy/)).toBeVisible();
  await expect(seen(page, /no violations|passed/i)).toHaveCount(0);
  await expect(page.getByLabel(/^Rule SIM-/)).toHaveCount(0);
  // Regression (PR #4, RE-65): one page-level status region stays mounted and its text follows the state.
  await expect(page.getByRole('status').filter({ hasText: 'No approved policy is in force' })).toHaveCount(1);
});

test('the page keeps one always-mounted status region, empty once the rules are shown', async ({ page }) => {
  await signInAt(page, '/marketing/rules', 'creator');
  await expect(ruleCard(page, 'SIM-FACTS-1')).toBeVisible();
  await expect(
    page.getByRole('status').filter({ hasText: /Loading the active policy|No approved policy|could not be loaded/ }),
  ).toHaveCount(0);
  await expect(page.locator('[role="status"][aria-live="polite"]').filter({ hasText: /^$/ })).not.toHaveCount(0);
});
