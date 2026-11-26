import { expect, test, type Page } from '@playwright/test';
import { lightTheme, seen, signInAt } from './helpers';

/**
 * Checking a client's existing post without generating anything (NRC-41), in
 * simulation mode against the proposed contract (api/clientPosts.ts). The fake
 * checker reads an image's file name as the text on the image; pictures and
 * video are not inspected, so they never count as passed.
 */

let pageErrors: string[] = [];
test.beforeEach(async ({ page }) => {
  pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await lightTheme(page);
});
test.afterEach(() => { expect(pageErrors, 'page errors').toEqual([]); });

const file = (name: string, mimeType: string) => ({ name, mimeType, buffer: Buffer.from('placeholder') });
const caption = (page: Page) => page.getByRole('textbox', { name: /^Caption/ });
/** Paid generation requests the fake API holds; validation only must never add one. */
const jobs = (page: Page) => page.evaluate(() => (JSON.parse(sessionStorage.getItem('nrc.sim.jobs') ?? '[]') as unknown[]).length);

test('the creator picks "Check an existing post" and sees no brief or generation step', async ({ page }) => {
  await signInAt(page, '/marketing/create', 'creator');
  await page.getByRole('radio', { name: 'Check an existing post' }).click();
  await expect(page).toHaveURL(/\/marketing\/create\/check$/);
  await expect(seen(page, 'Checking only, nothing is generated')).toBeVisible();
  await expect(page.getByRole('textbox', { name: /^Brief/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Generate/ })).toHaveCount(0);
});

test('an existing post is checked, fixed, replaced and checked again without any generation', async ({ page }) => {
  await signInAt(page, '/marketing/create/check', 'creator');
  await caption(page).fill('Join our research study. Results guaranteed for adults. [Required disclosure placeholder: this is a research study.]');
  await page.locator('input[type=file]').first().setInputFiles([
    file('clinic-photo.jpg', 'image/jpeg'), file('guaranteed-results.png', 'image/png'), file('corrupt-banner.jpg', 'image/jpeg'),
  ]);
  await expect(seen(page, 'Rejected')).toBeVisible();

  // A rejected file blocks saving until it is removed.
  await page.getByRole('button', { name: 'Save and check' }).click();
  await expect(seen(page, 'Remove the files that could not be used.').first()).toBeVisible();
  await page.getByRole('button', { name: 'Remove corrupt-banner.jpg' }).click();
  await page.getByRole('button', { name: 'Save and check' }).click();
  await expect(page).toHaveURL(/\/marketing\/create\/check\/[^/]+$/);

  // The combined check: the caption and the flagged image fail.
  await expect(page.getByText('Failed', { exact: true }).first()).toBeVisible({ timeout: 15_000 });
  await expect(seen(page, 'Suggested fix for SIM-FACTS-1')).toBeVisible();
  await expect(seen(page, '0 requests').first()).toBeVisible();

  // Accepting the fix makes version 2; the result is now out of date.
  await page.getByRole('button', { name: 'Accept as version 2' }).click();
  await expect(seen(page, 'The post changed after its last check')).toBeVisible();

  // Replacing the flagged image makes version 3; check it.
  await page.locator('input[type=file]').nth(1).setInputFiles(file('fixed-banner.png', 'image/png'));
  await page.getByRole('button', { name: 'Check version 3' }).click();
  // Pictures are not inspected in simulation: never a plain pass.
  await expect(seen(page, 'Passed what could be assessed').first()).toBeVisible({ timeout: 15_000 });
  await expect(seen(page, 'Partly assessed').first()).toBeVisible();

  // The download holds the report for the version that was checked.
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download post and report' }).click();
  expect((await download).suggestedFilename()).toBe('check-report-v3.html');

  expect(await jobs(page)).toBe(0);
});

test('every version is listed with its own check, and an older one can be compared and used again', async ({ page }) => {
  await signInAt(page, '/marketing/create/check', 'creator');
  await caption(page).fill('Join our research study. Results guaranteed for adults. [Required disclosure placeholder: this is a research study.]');
  await page.getByRole('button', { name: 'Save and check' }).click();
  await expect(seen(page, 'Suggested fix for SIM-FACTS-1')).toBeVisible({ timeout: 15_000 });

  const versions = page.getByRole('list', { name: 'Saved versions, newest first' });
  await expect(versions.getByRole('listitem')).toHaveCount(1);
  await expect(versions.getByText('Failed', { exact: true })).toBeVisible();

  // Accepting the fix adds version 2, not checked yet; version 1 keeps its result.
  await page.getByRole('button', { name: 'Accept as version 2' }).click();
  await expect(versions.getByRole('listitem')).toHaveCount(2);
  const [v2, v1] = [versions.getByRole('listitem').nth(0), versions.getByRole('listitem').nth(1)];
  await expect(v2.getByText('Current', { exact: true })).toBeVisible();
  await expect(v2.getByText('Not checked', { exact: true })).toBeVisible();
  await expect(v1.getByText('Failed', { exact: true })).toBeVisible();

  // Compare version 1 with the current text, then use it again as version 3.
  await page.getByRole('button', { name: 'Compare version 1 with version 2' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('deletion').first()).toContainText('guaranteed');
  await dialog.getByRole('button', { name: 'Use version 1' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(versions.getByRole('listitem')).toHaveCount(3);
  await expect(versions.getByRole('listitem').first()).toContainText('Restored version 1');
  await expect(seen(page, 'The post changed after its last check')).toBeVisible();
  expect(await jobs(page)).toBe(0);
});

const PASSING_CAPTION = 'Join our research study for adults. [Required disclosure placeholder: this is a research study.]';

test('the carousel order is set before saving and changed later as a new version', async ({ page }) => {
  await signInAt(page, '/marketing/create/check', 'creator');
  await caption(page).fill(PASSING_CAPTION);
  await page.locator('input[type=file]').first().setInputFiles([file('first.png', 'image/png'), file('second.png', 'image/png'), file('third.png', 'image/png')]);
  await expect(page.getByText('Ready', { exact: true })).toHaveCount(3);

  // Before saving: the third image moves to the top.
  await page.getByRole('button', { name: 'Move third.png up' }).click();
  await page.getByRole('button', { name: 'Move third.png up' }).click();
  await expect(page.getByRole('list', { name: 'Chosen files' }).getByRole('listitem').first()).toContainText('1. third.png');
  await expect(page.getByRole('button', { name: 'Move third.png up' })).toBeDisabled();
  await page.getByRole('button', { name: 'Save and check' }).click();

  // After saving, the order card shows that order; changing it saves version 2.
  const order = page.getByRole('list', { name: 'Carousel order' });
  await expect(order.getByRole('listitem')).toHaveText([/1\. third\.png/, /2\. first\.png/, /3\. second\.png/]);
  await expect(page.getByRole('button', { name: /Save order/ })).toHaveCount(0);
  await order.getByRole('button', { name: 'Move second.png up' }).click();
  await page.getByRole('button', { name: 'Save order as version 2' }).click();
  await expect(seen(page, 'Saved as version 2').first()).toBeVisible();
  await expect(order.getByRole('listitem')).toHaveText([/1\. third\.png/, /2\. second\.png/, /3\. first\.png/]);
  await expect(page.getByRole('heading', { name: 'Image 2: second.png' })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Saved versions, newest first' }).getByRole('listitem').first()).toContainText('Changed the image order');
  await expect(seen(page, 'The post changed after its last check')).toBeVisible();
});

test('a flagged image is fixed with AI only after the cost is confirmed, and the new version is checked again', async ({ page }) => {
  await signInAt(page, '/marketing/create/check', 'creator');
  await caption(page).fill(PASSING_CAPTION);
  await page.locator('input[type=file]').first().setInputFiles(file('guaranteed-results.png', 'image/png'));
  await expect(seen(page, 'Ready')).toBeVisible();
  await page.getByRole('button', { name: 'Save and check' }).click();
  await expect(page.getByText('Failed', { exact: true }).first()).toBeVisible({ timeout: 15_000 });

  // The cost is stated and must be confirmed before anything is made.
  await page.getByRole('button', { name: 'Fix with AI (paid)' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('This is a paid AI request')).toBeVisible();
  const make = dialog.getByRole('button', { name: 'Make 1 paid request' });
  await expect(make).toBeDisabled();
  await dialog.getByRole('checkbox', { name: 'I understand this makes 1 paid request' }).check();
  await make.click();

  // The original and the new picture side by side; nothing changes until it is used.
  await expect(dialog.getByRole('heading', { name: 'The AI fixed image' })).toBeVisible({ timeout: 15_000 });
  await expect(dialog.getByText('The new image has not been checked')).toBeVisible();
  await dialog.getByRole('button', { name: 'Use it as version 2' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('heading', { name: /^Image: ai-fixed-image-/ })).toBeVisible();
  await expect(seen(page, 'Paid AI fixes')).toBeVisible();
  await expect(seen(page, '1 request').first()).toBeVisible();

  // The new version is checked like any other; the picture itself is still not inspected.
  await page.getByRole('button', { name: 'Check version 2' }).click();
  await expect(seen(page, 'Passed what could be assessed').first()).toBeVisible({ timeout: 15_000 });
  // The check itself still made no request.
  await expect(seen(page, '0 requests').first()).toBeVisible();
});

test('a failed AI fix changes nothing and asks before trying again', async ({ page }) => {
  await signInAt(page, '/marketing/create/check', 'creator');
  await page.locator('input[type=file]').first().setInputFiles(file('guaranteed-results.png', 'image/png'));
  await expect(seen(page, 'Ready')).toBeVisible();
  await page.getByRole('button', { name: 'Save and check' }).click();
  await expect(page.getByText('Failed', { exact: true }).first()).toBeVisible({ timeout: 15_000 });

  await page.getByRole('button', { name: 'Fix with AI (paid)' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('textbox', { name: /^Instructions for the AI/ }).fill('Simulation: make this fail');
  await dialog.getByRole('checkbox', { name: 'I understand this makes 1 paid request' }).check();
  await dialog.getByRole('button', { name: 'Make 1 paid request' }).click();
  await expect(dialog.getByText('No new image was made')).toBeVisible({ timeout: 15_000 });
  await dialog.getByRole('button', { name: 'Try again' }).click();
  // Trying again asks for the cost again.
  await expect(dialog.getByRole('button', { name: 'Make 1 paid request' })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('heading', { name: 'Image: guaranteed-results.png' })).toBeVisible();
  await expect(seen(page, 'Version 1').first()).toBeVisible();
});

test('a video is never passed: its checks are not available yet', async ({ page }) => {
  await signInAt(page, '/marketing/create/check', 'creator');
  await caption(page).fill('Join our research study for adults. [Required disclosure placeholder: this is a research study.]');
  await page.locator('input[type=file]').first().setInputFiles(file('study-reel.mp4', 'video/mp4'));
  await expect(seen(page, 'Ready')).toBeVisible();
  await page.getByRole('button', { name: 'Save and check' }).click();
  await expect(seen(page, 'A required check could not be assessed')).toBeVisible({ timeout: 15_000 });
  // Only the caption passes on its own; the video and the post as a whole do not.
  await expect(page.getByText('Passed the assessed checks', { exact: true })).toHaveCount(1);
  await expect(page.getByText('Needs review', { exact: true }).first()).toBeVisible();
  await expect(seen(page, 'Passed what could be assessed')).toHaveCount(0);
  expect(await jobs(page)).toBe(0);
});
