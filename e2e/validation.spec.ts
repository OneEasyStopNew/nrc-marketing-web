import { expect, test, type Page } from '@playwright/test';
import { lightTheme, seen, signInAt } from './helpers';

/**
 * NRC-19 demo slice in simulation mode: text validation results with rule
 * evidence, separate execution state and outcome, stale results and failures.
 * The fake validator's placeholder rules live in the local src/mocks/data.ts:
 * under six words → cannot be assessed; "cure"/"guaranteed" → FAIL;
 * "paid" → minor finding that needs a decision.
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
const findings = (page: Page) => page.getByRole('list', { name: 'Findings' }).getByRole('listitem');

/** Replaces the brief, waits for the autosave, validates that version and waits for the result. */
async function validateBrief(page: Page, text: string) {
  await brief(page).fill(text);
  await expect(saveStatus(page)).toHaveText(/Saved · version \d+/, { timeout: 10_000 });
  // The status was just asserted to read "Saved · version N".
  const version = /version (\d+)/.exec((await saveStatus(page).textContent())!)![1];
  await page.getByRole('button', { name: `Validate version ${version}` }).click();
  await expect(page).toHaveURL(/\/marketing\/validation\/sim-cr-0001\/sim-run-/);
  await expect(seen(page, 'Checking the brief', { exact: true }).first()).toBeVisible();
  await expect(seen(page, 'Finished', { exact: true }).or(seen(page, 'Could not finish', { exact: true }))).toBeVisible({ timeout: 15_000 });
  return Number(version);
}

test('the seeded PASS opens from the draft and keeps approval separate', async ({ page }) => {
  await signInAt(page, SEEDED, 'creator');
  await page.getByRole('link', { name: 'View results for version 3' }).click();
  await expect(page).toHaveURL(/\/marketing\/validation\/sim-cr-0001\/sim-run-0003$/);
  await expect(page.getByRole('heading', { name: 'Validation results' })).toBeVisible();
  await expect(seen(page, 'Passed the assessed checks').first()).toBeVisible();
  const checks = page.getByRole('list', { name: 'Checks by area' });
  // The run reported no media gate: shown as not assessed, never green.
  await expect(checks.getByRole('listitem').filter({ hasText: 'Image and media' })).toContainText('Not assessed');
  await expect(checks.getByRole('listitem').filter({ hasText: 'Human approval' })).toContainText('Separate step');
  await expect(seen(page, 'This is not approval; a reviewer still decides.')).toBeVisible();
  await expect(seen(page, 'Placeholder rules (simulation)')).toBeVisible();
});

test('a failing brief shows each finding with its rule, source and highlighted words', async ({ page }) => {
  await signInAt(page, SEEDED, 'creator');
  await validateBrief(page, 'A guaranteed cure for everyone who joins the study, and you get paid.');

  await expect(seen(page, 'Failed', { exact: true }).first()).toBeVisible();
  await expect(findings(page)).toHaveCount(3);
  // Most severe first.
  await expect(findings(page).first()).toContainText('Critical');
  await expect(findings(page).first()).toContainText('SIM-FACTS-1 v2');

  // Filters.
  const show = (label: string) => async () => {
    await page.getByRole('combobox', { name: 'Show' }).click();
    await page.getByRole('option', { name: label }).click();
  };
  await show('Needs a decision (1)')();
  await expect(findings(page)).toHaveCount(1);
  await expect(findings(page).first()).toContainText('SIM-POLICY-4');
  await show('All findings (3)')();

  // Source evidence.
  await findings(page).first().getByText(/^Source: Sim 2\.3/).click();
  await expect(findings(page).first().getByText('[Placeholder clause text for Sim 2.3 (simulation)]')).toBeVisible();

  // Show in text moves focus to the marked words.
  await findings(page).first().getByRole('button', { name: 'Show in text' }).click();
  const focused = page.locator('mark:focus');
  await expect(focused).toHaveText(/^(guaranteed|cure)$/);
  await expect(page.locator('mark')).toHaveCount(3);
});

test('highlights count Unicode code points, not UTF-16 units', async ({ page }) => {
  await signInAt(page, SEEDED, 'creator');
  await validateBrief(page, '😀🎉 Participación: no es una cure milagrosa, solo investigación clínica.');
  await expect(page.locator('mark')).toHaveCount(1);
  await expect(page.locator('mark')).toHaveText('cure');
});

test('a required check that cannot be assessed blocks the brief, even with no findings', async ({ page }) => {
  await signInAt(page, SEEDED, 'creator');
  await validateBrief(page, 'asdf qwer');
  await expect(seen(page, 'A required check could not be assessed')).toBeVisible();
  await expect(seen(page, /too short to assess/).first()).toBeVisible();
  await expect(seen(page, 'No findings were reported. This alone does not mean the brief passed')).toBeVisible();
  await expect(seen(page, 'Passed the assessed checks')).toHaveCount(0);
});

test('editing the brief makes the result out of date, and the run survives a reload', async ({ page }) => {
  await signInAt(page, SEEDED, 'creator');
  const version = await validateBrief(page, 'A calm clinic waiting room for a research study post.');
  const runUrl = new URL(page.url()).pathname;
  // Tokens live in memory only, so a reload signs in again and returns to the same run.
  await page.reload();
  await page.locator('li button', { hasText: 'Marketing creator' }).click();
  await page.waitForURL((u) => u.pathname === runUrl);
  await expect(seen(page, 'Passed the assessed checks').first()).toBeVisible();

  await page.getByRole('link', { name: 'Revise the brief' }).click();
  await brief(page).press('Control+End');
  await brief(page).pressSequentially(' Edited.');
  await expect(saveStatus(page)).toHaveText(`Saved · version ${version + 1}`, { timeout: 10_000 });
  await expect(seen(page, 'Out of date')).toBeVisible();

  await page.goBack();
  await page.waitForURL((u) => u.pathname === runUrl);
  await expect(seen(page, 'This result is out of date')).toBeVisible();
  await expect(seen(page, 'Passed the assessed checks')).toHaveCount(0);
  await expect(page.getByRole('button', { name: `Validate version ${version + 1}` })).toBeEnabled();
  // The historical text is the version that was checked, not the edited one.
  await expect(seen(page, 'A calm clinic waiting room for a research study post.', { exact: true })).toBeVisible();
});

test('a timeout and an unreadable text are shown as failures to run, not as results', async ({ page }) => {
  await signInAt(page, SEEDED, 'creator');
  await validateBrief(page, 'A calm clinic waiting room for a research study post.');

  await page.getByRole('button', { name: 'Make the next validation time out' }).click();
  await page.getByRole('link', { name: 'Revise the brief' }).click();
  await validateBrief(page, 'A bright clinic waiting room for a research study post.');
  await expect(seen(page, 'Validation could not finish')).toBeVisible();
  await expect(seen(page, /did not answer in time/)).toBeVisible();
  await expect(seen(page, 'Passed the assessed checks')).toHaveCount(0);

  await page.getByRole('button', { name: 'Make the next validation unreadable' }).click();
  await page.getByRole('button', { name: /^Validate version \d+$/ }).click();
  await expect(seen(page, /could not be read for checking/)).toBeVisible({ timeout: 15_000 });
});

test('an unknown run id shows "not found", not another tenant\'s results', async ({ page }) => {
  await signInAt(page, '/marketing/validation/sim-cr-0001/sim-run-nope', 'creator');
  await expect(seen(page, 'Validation run not found')).toBeVisible();
});
