import { expect, test, type Page } from '@playwright/test';
import { lightTheme, seen, signInAt } from './helpers';

/**
 * Social sets, eight networks, multichannel scheduling and the calendar
 * (NRC-39), in simulation against the proposed contracts (api/workspace.ts).
 * Unsupported formats cannot be sent, limits never remove anything, and an
 * account with no publishing API is handed off, never shown as published.
 */

let pageErrors: string[] = [];
test.beforeEach(async ({ page }) => {
  pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await lightTheme(page);
});
test.afterEach(() => { expect(pageErrors, 'page errors').toEqual([]); });

const choose = async (page: Page, box: RegExp, option: RegExp) => {
  await page.getByRole('dialog').getByRole('combobox', { name: box }).click();
  await page.getByRole('option', { name: option }).click();
};

test('accounts are grouped by social set, and a set over its limit keeps every account', async ({ page }) => {
  await signInAt(page, '/marketing/integrations', 'publisher');
  const us = page.getByRole('region', { name: 'NRC US (simulation)' });
  await expect(us.getByText('7 of 6 accounts', { exact: false })).toBeVisible();
  await expect(us.getByText('Over the account limit')).toBeVisible();
  await expect(us.getByRole('button', { name: 'Connect to this set' })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'NRC Spanish-language (simulation)' }).getByText('3 of 4 accounts', { exact: false })).toBeVisible();
  // A network with no publishing API says so.
  await expect(seen(page, 'By hand: no publishing API')).toBeVisible();
  await expect(seen(page, 'Title, Privacy setting, AI-content answer')).toBeVisible();
});

test('all eight networks can be connected into a set until it is full', async ({ page }) => {
  await signInAt(page, '/marketing/integrations', 'publisher');
  await page.getByRole('button', { name: 'Connect an account' }).click();
  const dialog = page.getByRole('dialog', { name: 'Connect an account' });
  for (const n of ['Facebook', 'Instagram', 'Threads', 'TikTok', 'LinkedIn', 'YouTube', 'Pinterest', 'Snapchat']) {
    await expect(dialog.getByRole('radio', { name: n })).toBeVisible();
  }
  // Only sets with room are offered: the Spanish-language set.
  await dialog.getByRole('radio', { name: 'LinkedIn' }).check();
  await dialog.getByRole('textbox', { name: /Page or profile name/ }).fill('NRC Estudios page');
  await dialog.getByRole('button', { name: 'Continue to sign in' }).click();
  await expect(seen(page, 'NRC Estudios page (simulation) connected')).toBeVisible();
  await expect(page.getByRole('region', { name: 'NRC Spanish-language (simulation)' }).getByText('4 of 4 accounts', { exact: false })).toBeVisible();

  await page.getByRole('button', { name: 'Connect an account' }).click();
  await expect(seen(page, 'Every social set is at its limit')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Continue to sign in' })).toBeDisabled();
});

test('each account shows what it receives, and one that cannot take the post says why', async ({ page }) => {
  await signInAt(page, '/marketing/publications', 'publisher');
  await page.getByRole('button', { name: 'Schedule a post' }).click();
  const dialog = page.getByRole('dialog', { name: 'Schedule a post' });
  await choose(page, /Approved version/, /sim-cr-0001 · version 3/);
  await choose(page, /Social set/, /Spanish/);
  for (const n of [/^nrc_estudios_sim$/, /^NRC Estudios \(simulation\)$/, /Snapchat/]) await dialog.getByRole('checkbox', { name: n }).check();

  const tiktok = dialog.getByLabel('What nrc_estudios_sim receives');
  const pin = dialog.getByLabel('What NRC Estudios (simulation) receives');
  const snap = dialog.getByLabel('What nrc_estudios_sim (Snapchat) receives');
  // TikTok takes video only; this post is an image.
  await expect(tiktok.getByText('this post is an image', { exact: false })).toBeVisible();
  // The approved caption is longer than this Snapchat account takes.
  await expect(snap.getByText('this account takes 80', { exact: false })).toBeVisible();
  // Pinterest needs a title before it is ready.
  await expect(pin.getByText('Add a title.')).toBeVisible();
  await pin.getByRole('textbox', { name: /Title/ }).fill('Research study (simulation)');
  await expect(pin.getByText('Ready', { exact: true })).toBeVisible();

  // Blocked accounts stop the whole schedule until they are left out.
  await dialog.getByRole('button', { name: 'Schedule post' }).click();
  await expect(seen(page, 'Fix the accounts marked below, or leave them out.')).toBeVisible();
  await dialog.getByRole('checkbox', { name: /^nrc_estudios_sim$/ }).uncheck();
  await dialog.getByRole('checkbox', { name: /Snapchat/ }).uncheck();
  await dialog.getByRole('radio', { name: 'As soon as possible' }).check();
  await dialog.getByRole('button', { name: 'Queue post' }).click();
  await expect(seen(page, 'Post queued')).toBeVisible();
  await page.getByRole('row').filter({ hasText: 'NRC Estudios (simulation)' }).getByRole('button', { name: /sim-cr-0001 · version 3/ }).click();
  await expect(page.getByRole('list', { name: 'Result per account' })).toContainText('Pinterest · Pin');
});

test('an account with no publishing API is handed off to post by hand, never published', async ({ page }) => {
  await signInAt(page, '/marketing/publications', 'publisher');
  await page.getByRole('button', { name: 'Schedule a post' }).click();
  const dialog = page.getByRole('dialog', { name: 'Schedule a post' });
  await choose(page, /Approved version/, /sim-cr-0005 · version 3/);
  await choose(page, /Social set/, /Spanish/);
  await dialog.getByRole('checkbox', { name: /Snapchat/ }).check();
  await expect(dialog.getByText('never as published', { exact: false })).toBeVisible();
  await dialog.getByRole('radio', { name: 'As soon as possible' }).check();
  await dialog.getByRole('button', { name: 'Queue post' }).click();
  await expect(seen(page, 'posted by hand', { exact: false }).first()).toBeVisible();

  await page.getByRole('tab', { name: /Needs attention/ }).click();
  await page.getByRole('row').filter({ hasText: 'Snapchat' }).getByRole('button', { name: /sim-cr-0005 · version 3/ }).click();
  await expect(page.getByRole('list', { name: 'Result per account' }).getByText('Post by hand')).toBeVisible();
  await expect(page.getByRole('list', { name: 'Result per account' }).getByText('Published')).toHaveCount(0);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download for posting by hand' }).click();
  expect((await download).suggestedFilename()).toMatch(/^post-by-hand-sim-pub-/);
});

test('the calendar shows a day\'s posts, and a scheduled post can be moved', async ({ page }) => {
  await signInAt(page, '/marketing/publications', 'publisher');
  await page.getByRole('tab', { name: /Calendar/ }).click();
  await page.getByRole('button', { name: /^2026-11-14, 1 posts$/ }).click();
  const day = page.getByRole('list', { name: 'Posts on 2026-11-14' });
  await expect(day).toContainText('12:30 America/Chicago');
  await day.getByRole('button').first().click();
  await page.getByRole('button', { name: 'Reschedule' }).click();
  const dialog = page.getByRole('dialog', { name: 'Reschedule' });
  // Desktop shows one text field; small screens show the native date and time pickers.
  const first = dialog.locator('input').first();
  await first.fill((await first.getAttribute('type')) === 'date' ? '2027-01-20' : '2027-01-20T10:00');
  await dialog.getByRole('button', { name: 'Move the post' }).click();
  await expect(seen(page, 'Post rescheduled')).toBeVisible();
  await expect(seen(page, /^2027-01-20 \d\d:\d\d \(America\/Chicago\)$/).first()).toBeVisible();
});
