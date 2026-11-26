import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { lightTheme, seen, signInAt } from './helpers';

/**
 * Usage and balance (NRC-44), in simulation against the proposed contract
 * (api/usage.ts). Estimated, reserved, billed and refunded amounts must never
 * be confused, and no post count is promised without a current balance.
 */

let pageErrors: string[] = [];
test.beforeEach(async ({ page }) => {
  pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await lightTheme(page);
});
test.afterEach(() => { expect(pageErrors, 'page errors').toEqual([]); });

const choose = async (page: Page, box: string, option: string) => {
  await page.getByRole('combobox', { name: box }).click();
  await page.getByRole('option', { name: option, exact: true }).click();
};

test('the balance, what is reserved and what can be spent are shown apart', async ({ page }) => {
  await signInAt(page, '/marketing/usage', 'admin');
  await expect(page.getByRole('heading', { level: 1, name: 'Usage and balance' })).toBeVisible();
  await expect(seen(page, 'Balance now')).toBeVisible();
  await expect(seen(page, '$18.40').first()).toBeVisible();
  await expect(seen(page, 'Reserved', { exact: true }).first()).toBeVisible();
  await expect(seen(page, 'Allocation left')).toBeVisible();
  // 18.40 less 0.04 reserved, within the 23.65 allocation left.
  await expect(seen(page, '$18.36')).toBeVisible();
});

test('the forecast follows the chosen plan, and image and video counts are alternatives', async ({ page }) => {
  await signInAt(page, '/marketing/usage', 'admin');
  // One image at $0.02 against $18.36.
  await expect(seen(page, 'About 918')).toBeVisible();
  await choose(page, 'Each post has', 'One video');
  // Video model A at 720p: (0.05 + 0.01 audio) x 5 s = $0.30, so 61 posts.
  await expect(page.getByRole('heading', { name: '$0.30', exact: true })).toBeVisible();
  await expect(seen(page, 'About 61')).toBeVisible();
  await choose(page, 'Video length', '10 seconds');
  await expect(page.getByRole('heading', { name: '$0.60', exact: true })).toBeVisible();
  await expect(seen(page, 'About 30')).toBeVisible();
  await expect(seen(page, 'They are alternatives and cannot be added together.', { exact: false })).toBeVisible();
});

test('a balance snapshot never promises a number of posts', async ({ page }) => {
  await signInAt(page, '/marketing/usage', 'reviewer');
  await page.locator('li button', { hasText: 'Partner company (simulation)' }).click();
  await expect(seen(page, 'This balance is not current')).toBeVisible();
  await expect(seen(page, 'Last known balance')).toBeVisible();
  await expect(seen(page, 'No count without a current balance')).toBeVisible();
  await expect(seen(page, /^About \d+/)).toHaveCount(0);
  await expect(seen(page, 'No attempts').first()).toBeVisible();
});

test('every attempt keeps its estimate, bill and refund apart, and the statement matches', async ({ page }) => {
  await signInAt(page, '/marketing/usage', 'admin');
  const totals = page.getByLabel('Totals for the filtered attempts');
  await expect(totals).toContainText('11');
  await expect(totals).toContainText('$2.12'); // confirmed only
  await expect(totals).toContainText('$0.06'); // refunded
  await expect(totals).toContainText('1 attempt: not in the billed total');
  await expect(seen(page, 'Reserved, not billed yet').first()).toBeVisible();
  await expect(seen(page, 'Billing unknown').first()).toBeVisible();

  // Filtering by post narrows the list and the totals.
  await page.getByRole('textbox', { name: 'Post' }).fill('sim-cr-0003');
  await expect(totals).toContainText('3');
  await expect(seen(page, 'Rejected by validation', { exact: false }).first()).toBeVisible();

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download CSV' }).click();
  const file = await (await download).path();
  const csv = await readFile(file, 'utf8');
  const lines = csv.split('\r\n');
  expect(lines[0]).toContain('"Estimated USD","Confirmed USD","Refunded USD"');
  expect(lines).toHaveLength(4);
  expect(csv).toContain('"0.06"');
});

test('a draft shows what its generation cost across attempts', async ({ page }) => {
  await signInAt(page, '/marketing/create/sim-cr-0001', 'creator');
  const card = page.getByRole('list', { name: 'Generation attempts for this post' });
  await expect(card.getByRole('listitem')).toHaveCount(3);
  await expect(seen(page, 'Rejected by validation', { exact: false }).first()).toBeVisible();
  await expect(seen(page, '$0.08')).toBeVisible();
});
