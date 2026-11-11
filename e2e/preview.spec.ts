import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { lightTheme, seen, signInAt } from './helpers';

/**
 * NRC-23 demo slice in simulation mode: the exact saved version as it would
 * post, still a "Draft for review", and the review-draft download.
 */

let pageErrors: string[] = [];
test.beforeEach(async ({ page }) => {
  pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await lightTheme(page);
});
test.afterEach(() => { expect(pageErrors, 'page errors').toEqual([]); });

const SEEDED = '/marketing/create/sim-cr-0001';
const brief = (page: Page) => page.getByRole('textbox', { name: /^Brief/ });
const saveStatus = (page: Page) => page.getByRole('status').filter({ hasText: /Saved|Saving|Unsaved|Not saved|failed|conflict|Read-only/ });
const preview = (page: Page) => page.getByRole('region', { name: 'Post preview' });

test('the final preview shows the exact version, what it was checked against, and stays a draft', async ({ page }) => {
  await signInAt(page, SEEDED, 'creator');
  await page.getByRole('link', { name: 'Open final preview' }).click();
  await expect(page).toHaveURL(/\/marketing\/create\/sim-cr-0001\/preview$/);
  await expect(page.getByRole('heading', { name: 'Final preview' })).toBeVisible();

  await expect(preview(page).getByRole('img', { name: /Image for version 3 of this draft \(simulation placeholder\)/ })).toBeVisible();
  await expect(preview(page)).toContainText('[Required disclosure placeholder: this is a research study.]');
  await expect(seen(page, 'Not approved; not posted')).toBeVisible();
  await expect(seen(page, 'Passed the assessed checks')).toBeVisible();
  await expect(seen(page, 'sim-policy-2026.11')).toBeVisible();
  await expect(seen(page, '515151515151')).toBeVisible();
  await expect(seen(page, 'Reviewer approval is a separate step and is not part of this build.')).toBeVisible();
  // Nothing on the preview is editable.
  await expect(page.getByRole('textbox')).toHaveCount(0);
});

test('the review draft downloads without the signed image link', async ({ page }) => {
  await signInAt(page, `${SEEDED}/preview`, 'creator');
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download review draft' }).click(),
  ]);
  expect(download.suggestedFilename()).toBe('nrc-review-draft-sim-cr-0001-v3.json');
  const body = JSON.parse(await readFile((await download.path())!, 'utf8'));
  expect(body.status).toBe('DRAFT');
  expect(body.creative_version).toBe(3);
  expect(body.latest_validation.outcome).toBe('PASS');
  expect(body.image).not.toHaveProperty('download_url');
  expect(JSON.stringify(body)).not.toContain('data:image');
  await expect(seen(page, 'Review draft for version 3 downloaded')).toBeVisible();
});

test('after an edit the preview shows the new version, out-of-date validation and the unchanged image', async ({ page }) => {
  await signInAt(page, SEEDED, 'creator');
  await brief(page).press('Control+End');
  await brief(page).pressSequentially(' Edited.');
  // Unsaved edits are not previewed.
  await page.getByRole('link', { name: 'Open final preview' }).click();
  await expect(seen(page, 'Save your changes first')).toBeVisible();
  await expect(saveStatus(page)).toHaveText('Saved · version 4', { timeout: 10_000 });

  await page.getByRole('link', { name: 'Open final preview' }).click();
  await expect(seen(page, /^4 · saved/)).toBeVisible();
  await expect(seen(page, 'Out of date', { exact: true })).toBeVisible();
  await expect(seen(page, 'The brief changed after the image was made')).toBeVisible();
  await expect(seen(page, 'Passed the assessed checks')).toHaveCount(0);
});

test('a draft without an image cannot be exported yet', async ({ page }) => {
  await signInAt(page, '/marketing/create', 'creator');
  await brief(page).fill('A calm clinic waiting room for a research study post.');
  await page.getByRole('button', { name: 'Create draft' }).click();
  await expect(page).toHaveURL(/\/marketing\/create\/sim-cr-/);
  await page.getByRole('link', { name: 'Open final preview' }).click();
  await expect(seen(page, 'No image yet', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Download review draft' })).toBeDisabled();
  await expect(preview(page)).toContainText('No image yet. The image is generated after the brief passes validation.');
});
