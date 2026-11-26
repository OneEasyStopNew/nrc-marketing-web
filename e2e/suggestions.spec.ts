import { expect, test } from '@playwright/test';
import { lightTheme, seen, signInAt } from './helpers';

/**
 * NRC-22: a finding that carries exact replacement words can be applied to
 * the brief in one step. It changes the editor only; saving makes a new
 * version that must be validated again. Advice without exact words is never
 * applied by guesswork.
 */

let pageErrors: string[] = [];
test.beforeEach(async ({ page }) => {
  pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await lightTheme(page);
});
test.afterEach(() => { expect(pageErrors, 'page errors').toEqual([]); });

test('the suggested wording replaces the flagged words in the brief, and the new version needs validating', async ({ page }) => {
  await signInAt(page, '/marketing/create/sim-cr-0001', 'creator');
  const brief = page.getByRole('textbox', { name: /^Brief/ });
  await brief.fill('A guaranteed result for everyone who joins this research study.');
  await expect(page.getByRole('status').filter({ hasText: /^Saved · version 4$/ }).or(seen(page, 'Saved · version 4')).first()).toBeVisible({ timeout: 10_000 });
  await page.getByRole('button', { name: 'Validate version 4' }).click();
  await expect(seen(page, 'Finished', { exact: true })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('link', { name: 'Revise the brief' }).click();
  await expect(page.getByRole('region', { name: 'Findings to fix' })).toContainText('guaranteed: Claims a benefit');
  await page.getByRole('button', { name: /^Use the suggested wording for / }).first().click();
  await expect(seen(page, 'Suggested wording put in the brief')).toBeVisible();
  await expect(brief).toHaveValue(/\[approved wording\]/);
  await expect(brief).not.toHaveValue(/guaranteed/);
});
