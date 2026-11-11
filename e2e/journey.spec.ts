import { expect, test, type Page } from '@playwright/test';
import { lightTheme, openNav, seen, signInAt } from './helpers';

/**
 * NRC-27: the demo journey end to end, in simulation (fixtures, not live
 * evidence): sign in → brief → validate (fail) → fix → revalidate (pass) →
 * final preview → sign out. Plus recovery from a page crash.
 * Staging runs of the same journey replace this once the backend is deployed.
 */

const brief = (page: Page) => page.getByRole('textbox', { name: /^Brief/ });
const caption = (page: Page) => page.getByRole('textbox', { name: /^Caption/ });
const saveStatus = (page: Page) => page.getByRole('status').filter({ hasText: /Saved|Saving|Unsaved|Not saved|failed|conflict|Read-only/ });

test.beforeEach(async ({ page }) => { await lightTheme(page); });

/** Opens a section from the main menu (behind the menu button on narrow screens). */
async function openSection(page: Page, name: string) {
  const menuButton = page.getByRole('button', { name: 'Open menu' });
  if (await menuButton.isVisible()) await menuButton.click();
  await (await openNav(page)).getByRole('link', { name, exact: true }).click();
}

test('demo journey: brief, failed check, fix, passed check, final preview, sign out', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await signInAt(page, '/marketing', 'creator');
  await openSection(page, 'Create post');
  await expect(page).toHaveURL(/\/marketing\/create$/);

  // 1. Write and create the draft.
  await brief(page).fill('A guaranteed result for adults who join this research study near them.');
  await caption(page).fill('Placeholder caption for the journey test.');
  await page.getByRole('button', { name: 'Create draft' }).click();
  await expect(saveStatus(page)).toHaveText('Saved · version 1');

  // 2. Validate: fails with evidence.
  await page.getByRole('button', { name: 'Validate version 1' }).click();
  await expect(seen(page, 'Finished', { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(seen(page, 'Failed', { exact: true }).first()).toBeVisible();
  await expect(page.locator('mark')).toHaveText('guaranteed');

  // 3. Fix it in the draft, with the findings beside the editor.
  await page.getByRole('link', { name: 'Revise the brief' }).click();
  await expect(page.getByRole('region', { name: 'Findings to fix' })).toContainText('guaranteed');
  await brief(page).fill('An optional research study for adults, explained by the study team near them.');
  await expect(saveStatus(page)).toHaveText('Saved · version 2', { timeout: 10_000 });

  // 4. Validate again: passes, still not an approval.
  await page.getByRole('button', { name: 'Validate version 2' }).click();
  await expect(seen(page, 'Passed the assessed checks').first()).toBeVisible({ timeout: 15_000 });
  await expect(seen(page, 'This is not approval; a reviewer still decides.')).toBeVisible();

  // 5. Final preview of the exact version.
  await page.getByRole('link', { name: 'Revise the brief' }).click();
  await page.getByRole('link', { name: 'Open final preview' }).click();
  await expect(page.getByRole('heading', { name: 'Final preview' })).toBeVisible();
  await expect(seen(page, /^2 · saved/)).toBeVisible();
  await expect(seen(page, 'Passed the assessed checks')).toBeVisible();
  await expect(seen(page, 'Not approved; not posted')).toBeVisible();

  // 6. Sign out.
  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('menuitem', { name: /Sign out/ }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Signed out');

  expect(errors, 'page errors').toEqual([]);
});

test('a crashing page keeps the shell working and recovers on another page', async ({ page }) => {
  await signInAt(page, '/marketing/__sim/crash', 'creator');
  const alert = page.getByRole('alert').filter({ hasText: 'This page stopped working' });
  await expect(alert).toBeVisible();
  await expect(alert).toContainText(/reference ui-/);
  await expect(alert).not.toContainText('Simulated page crash');
  await openSection(page, 'Create post');
  await expect(page.getByRole('heading', { name: 'Create post', level: 1 })).toBeVisible();
  await expect(alert).toHaveCount(0);
});
