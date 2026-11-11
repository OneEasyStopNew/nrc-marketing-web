import { expect, test, type Page } from '@playwright/test';
import { lightTheme, seen, signInAt } from './helpers';

/**
 * NRC-22 demo slice in simulation mode: manual revision, version timeline and
 * compare, restoring an older text as a new version, findings to fix beside
 * the editor, and revalidation. (412 recovery is covered in create.spec.ts.)
 */

let pageErrors: string[] = [];
test.beforeEach(async ({ page }) => {
  pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await lightTheme(page);
});
test.afterEach(() => { expect(pageErrors, 'page errors').toEqual([]); });

const SEEDED = '/marketing/create/sim-cr-0001';
const SEEDED_BRIEF = 'Placeholder brief: a calm, bright clinic waiting room with no people, for a recruitment post.';
const brief = (page: Page) => page.getByRole('textbox', { name: /^Brief/ });
const saveStatus = (page: Page) => page.getByRole('status').filter({ hasText: /Saved|Saving|Unsaved|Not saved|failed|conflict|Read-only/ });
const versions = (page: Page) => page.getByRole('list', { name: 'Saved versions, newest first' }).getByRole('listitem');

test('each save adds a version; an older text can be compared and used again without changing history', async ({ page }) => {
  await signInAt(page, SEEDED, 'creator');
  await expect(versions(page)).toHaveCount(1);
  await expect(versions(page).first()).toContainText('Version 3');
  await expect(versions(page).first()).toContainText('Passed');

  await brief(page).fill('A possible new option for adults, explained by the study team.');
  await expect(saveStatus(page)).toHaveText('Saved · version 4', { timeout: 10_000 });
  await expect(versions(page)).toHaveCount(2);
  await expect(versions(page).first()).toContainText('Version 4');
  await expect(versions(page).first()).toContainText('Current');
  await expect(versions(page).first()).toContainText('Not validated');
  await expect(versions(page).nth(1)).toContainText('Passed (old)');

  await page.getByRole('button', { name: 'Compare version 3 with the text now' }).click();
  const dialog = page.getByRole('dialog', { name: 'Version 3 compared with the text now' });
  await expect(dialog).toBeVisible();
  const briefDiff = dialog.getByRole('region', { name: 'Brief differences' });
  await expect(briefDiff.locator('del').first()).toContainText('Placeholder');
  await expect(briefDiff.locator('ins', { hasText: 'possible' })).toHaveCount(1);
  await expect(dialog.getByRole('region', { name: 'Caption differences' })).toContainText('No change');

  await dialog.getByRole('button', { name: 'Use version 3 text' }).click();
  await expect(dialog).toBeHidden();
  await expect(brief(page)).toHaveValue(SEEDED_BRIEF);
  await expect(brief(page)).toBeFocused();
  await expect(saveStatus(page)).toHaveText('Saved · version 5', { timeout: 10_000 });
  await expect(versions(page)).toHaveCount(3);
  await expect(versions(page).nth(1)).toContainText('Version 4');
});

test('findings sit beside the editor, and a fixed brief revalidates as a new version', async ({ page }) => {
  await signInAt(page, SEEDED, 'creator');
  await brief(page).fill('A guaranteed result for everyone who joins this research study.');
  await expect(saveStatus(page)).toHaveText('Saved · version 4', { timeout: 10_000 });
  await page.getByRole('button', { name: 'Validate version 4' }).click();
  await expect(seen(page, 'Finished', { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(seen(page, 'Failed', { exact: true }).first()).toBeVisible();

  await page.getByRole('link', { name: 'Revise the brief' }).click();
  const toFix = page.getByRole('region', { name: 'Findings to fix' });
  await expect(toFix).toContainText('guaranteed: Claims a benefit');
  await expect(toFix).toContainText('Suggested: Describe the study as research');

  await brief(page).fill('An optional research study for adults, explained by the study team.');
  await expect(toFix).toContainText('These are for version 4.');
  await expect(saveStatus(page)).toHaveText('Saved · version 5', { timeout: 10_000 });
  await expect(seen(page, 'Out of date')).toBeVisible();

  await page.getByRole('button', { name: 'Validate version 5' }).click();
  await expect(seen(page, 'Passed the assessed checks').first()).toBeVisible({ timeout: 15_000 });
  await page.getByRole('link', { name: 'Revise the brief' }).click();
  await expect(page.getByRole('region', { name: 'Findings to fix' })).toHaveCount(0);
  await expect(versions(page).first()).toContainText('Passed');
  await expect(versions(page).nth(1)).toContainText('Failed');
});

test('a closed study draft can be compared but not changed', async ({ page }) => {
  await signInAt(page, '/marketing/create/sim-cr-0002', 'creator-closed');
  await page.getByRole('button', { name: 'Compare version 2 with the text now' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('No change');
  await expect(dialog.getByRole('button', { name: /^Use version/ })).toHaveCount(0);
});
