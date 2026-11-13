import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { z } from 'zod';
import { lightTheme, seen, signInAt } from './helpers';

/** The fields of a downloaded review draft this test reads. */
const DownloadedManifest = z.object({
  status: z.literal('DRAFT'),
  creative_version: z.number().int(),
  latest_validation: z.object({ outcome: z.string().nullable() }).nullable(),
  image: z.record(z.string(), z.unknown()),
});

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

  await expect(preview(page).getByRole('img', { name: /^Generated image for the brief: .+ \(placeholder picture\)$/ })).toBeVisible();
  await expect(preview(page)).toContainText('[Required disclosure placeholder: this is a research study.]');
  await expect(seen(page, 'Not approved; not posted')).toBeVisible();
  await expect(seen(page, 'Passed the assessed checks')).toBeVisible();
  await expect(seen(page, 'version 1', { exact: true })).toBeVisible();
  await expect(seen(page, '515151515151')).toBeVisible();
  await expect(seen(page, 'Reviewer approval is a separate step. This page does not approve anything.')).toBeVisible();
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
  // The download is checked like any other untrusted file: through its schema.
  const body = DownloadedManifest.parse(JSON.parse(await readFile(await download.path(), 'utf8')));
  expect(body.status).toBe('DRAFT');
  expect(body.creative_version).toBe(3);
  expect(body.latest_validation?.outcome).toBe('PASS');
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

// NRC-30: the validation evidence report, built in the browser from the persisted run.
const downloadReport = async (page: Page): Promise<string> => {
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download validation report' }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^nrc-validation-report-sim-cr-0001-v3-[A-Za-z0-9._-]+\.html$/);
  return readFile(await download.path(), 'utf8');
};

test('the validation report downloads after a reload, matches the preview and is labelled a draft and a simulation', async ({ page }) => {
  await signInAt(page, `${SEEDED}/preview`, 'creator');
  // Tokens live in memory only, so an authorised refresh means signing in again and returning to the preview.
  await page.reload();
  await page.locator('li button', { hasText: 'Marketing creator' }).click();
  await page.waitForURL((u) => u.pathname === `${SEEDED}/preview`);
  await expect(page.getByRole('heading', { name: 'Final preview' })).toBeVisible();
  const report = await downloadReport(page);
  expect(report).toContain('Draft for review');
  expect(report).toContain('It is not an approval');
  expect(report).toContain('Simulation: synthetic data');
  expect(report).toContain('sim-cr-0001 · version 3');
  expect(report).toContain('Policy bundle</th><td class="evidence">version 1');
  expect(report).toContain('PASS');
  expect(report).not.toContain('Historical result');
  // Self-contained and inert: no scripts, links, image data or signed URLs.
  expect(report).not.toMatch(/<script|<a |https?:\/\/|data:image|src=/i);
  expect(report).not.toMatch(/\bapproved\b|compliant/i);
  await expect(seen(page, 'Validation report for version 3 downloaded')).toBeVisible();
});

test('after an edit the validation report is labelled historical, not current', async ({ page }) => {
  await signInAt(page, SEEDED, 'creator');
  await brief(page).press('Control+End');
  await brief(page).pressSequentially(' Edited.');
  await expect(saveStatus(page)).toHaveText('Saved · version 4', { timeout: 10_000 });
  await page.getByRole('link', { name: 'Open final preview' }).click();
  await expect(seen(page, 'Out of date', { exact: true })).toBeVisible();
  const report = await downloadReport(page);
  expect(report).toContain('Historical result');
  expect(report).toContain('This result is for version 3 of the draft and is no longer current.');
  await expect(seen(page, 'Historical validation report for version 3 downloaded')).toBeVisible();
});

test('the validation report still downloads when the image cannot be shown', async ({ page }) => {
  await signInAt(page, `${SEEDED}/preview`, 'creator');
  await expect(preview(page).getByRole('img', { name: /^Generated image for the brief: / })).toBeVisible();
  await page.getByRole('button', { name: 'Move the image to another organisation', exact: true }).click();
  await expect(seen(page, 'Not available', { exact: true })).toBeVisible();
  // The draft still names its image, so this is not "the draft changed".
  const report = await downloadReport(page);
  expect(report).toContain('reference not available');
  await expect(seen(page, 'Validation report for version 3 downloaded')).toBeVisible();
  await expect(seen(page, 'The draft changed while the report was prepared')).toHaveCount(0);
});

test('a draft that was never validated has no validation report to download', async ({ page }) => {
  await signInAt(page, '/marketing/create', 'creator');
  await brief(page).fill('A calm clinic waiting room for a research study post.');
  await page.getByRole('button', { name: 'Create draft' }).click();
  await expect(page).toHaveURL(/\/marketing\/create\/sim-cr-/);
  await page.getByRole('link', { name: 'Open final preview' }).click();
  await expect(seen(page, 'Not validated', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Download validation report' })).toBeDisabled();
});
