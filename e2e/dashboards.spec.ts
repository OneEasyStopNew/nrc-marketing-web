import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { lightTheme, seen, signInAt } from './helpers';

/**
 * Dashboards (NRC-46) in simulation against the proposed contract
 * (api/analytics.ts). The usage figures must match Usage and balance, a
 * missing figure is never shown as zero, and every chart has a table.
 */

let pageErrors: string[] = [];
test.beforeEach(async ({ page }) => {
  pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await lightTheme(page);
});
test.afterEach(() => { expect(pageErrors, 'page errors').toEqual([]); });

const stat = (page: Page, label: string) => page.getByText(label, { exact: true }).locator('xpath=..');

test('usage and cost agree with Usage and balance, with the denominators stated', async ({ page }) => {
  await signInAt(page, '/marketing/insights', 'admin');
  await expect(page.getByRole('heading', { level: 1, name: 'Dashboards' })).toBeVisible();
  await expect(stat(page, 'Generation attempts')).toContainText('11');
  await expect(stat(page, 'Billed')).toContainText('$2.12');
  // 2.12 billed over 4 used outputs.
  await expect(stat(page, 'Cost per usable output')).toContainText('$0.53');
  await expect(stat(page, 'Cost per usable output')).toContainText('Billed ÷ 4 usable outputs');

  // The workflow filter narrows every figure.
  await page.getByRole('combobox', { name: 'Workflow' }).click();
  await page.getByRole('option', { name: 'Check an existing post' }).click();
  await expect(stat(page, 'Generation attempts')).toContainText('1');
  await expect(stat(page, 'Billed')).toContainText('$0.02');
});

test('every chart has a table version, and the statement downloads', async ({ page }) => {
  await signInAt(page, '/marketing/insights', 'admin');
  await page.getByRole('tab', { name: 'Validation quality' }).click();
  await expect(page.getByRole('progressbar', { name: /^Passed: / })).toBeVisible();
  await page.getByRole('radiogroup', { name: 'Show Results as' }).getByRole('radio', { name: 'Table' }).click();
  await expect(page.getByRole('table').first()).toContainText('Passed');

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download CSV' }).click();
  const csv = await readFile(await (await download).path(), 'utf8');
  expect(csv).toContain('"Result","Checks"');
  expect(csv).toContain('"Filters: from any to any');
});

test('social figures are per account, and a missing one reads "Not available", never zero', async ({ page }) => {
  await signInAt(page, '/marketing/insights', 'admin');
  await page.getByRole('tab', { name: 'Social performance' }).click();
  await expect(seen(page, 'Figures are not added across networks')).toBeVisible();
  await expect(page.getByRole('progressbar', { name: /NRC Research \(simulation page\) \(Facebook\): 1,200/ })).toBeVisible();
  // YouTube reports views but no impressions: no bar and no zero.
  await expect(page.getByRole('progressbar', { name: /YouTube/ })).toHaveCount(0);
  await expect(seen(page, 'Not available').first()).toBeVisible();
  await expect(seen(page, 'Posted by hand: no figures come back.')).toBeVisible();
});
