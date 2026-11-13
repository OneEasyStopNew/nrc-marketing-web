import { expect, test, type Page } from '@playwright/test';
import { lightTheme, seen, signInAt } from './helpers';

/**
 * Image generation and the caption and image checks, in simulation mode
 * (fixtures from the local src/mocks/data.ts). The fake API makes a labelled
 * placeholder picture, never a real image. The seeded draft sim-cr-0001 is at
 * version 3 with a current PASS result.
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
const generate = (page: Page) => page.getByRole('button', { name: /^Generate (image|a new image)$/ });

test('a new draft cannot be generated until its brief passes', async ({ page }) => {
  await signInAt(page, '/marketing/create', 'creator');
  await brief(page).fill('Placeholder brief for a generation test, long enough to be assessed by the placeholder rules.');
  await page.getByRole('button', { name: 'Create draft' }).click();
  await expect(page).toHaveURL(/\/marketing\/create\/[^/]+$/);

  await expect(seen(page, 'Validate the brief for this version before generating.').first()).toBeVisible();
  await expect(generate(page)).toBeDisabled();
});

test('a passed brief can be generated; the job survives a reload and the image can be checked', async ({ page }) => {
  await signInAt(page, SEEDED, 'creator');
  await expect(seen(page, 'Allowed', { exact: true })).toBeVisible();

  await generate(page).click();
  await expect(seen(page, /The image is being generated|Sending the brief|Waiting to start/).first()).toBeVisible();
  // Reload mid-job (tokens live in memory, so sign in again): the same job is followed, no second one is started.
  await page.reload();
  await page.locator('li button', { hasText: 'Marketing creator' }).click();
  await page.waitForURL((u) => u.pathname === SEEDED);
  await expect(seen(page, 'Image ready')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('img', { name: /Image for this draft \(placeholder picture\)/ })).toBeVisible();

  await page.getByRole('button', { name: 'Check image' }).click();
  await expect(page).toHaveURL(/\/marketing\/validation\/sim-cr-0001\//);
  await expect(page.getByRole('heading', { name: 'Checked image' })).toBeVisible();
  await expect(seen(page, 'A person needs to decide on the findings marked below.')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('img', { name: /The visual that was checked/ })).toBeVisible();
  await expect(seen(page, /starts 12% from the left and 55% from the top/).first()).toBeVisible();

  // Back on the draft, the image check is listed with its result; passing the brief is still not approval.
  await page.getByRole('link', { name: 'Revise the brief' }).click();
  await expect(page).toHaveURL(new RegExp(`${SEEDED}$`));
  await expect(page.getByRole('link', { name: 'Image check results' })).toBeVisible();
  await expect(seen(page, 'Validation is an automated check, not an approval.')).toBeVisible();
});

test('an edit turns generation off until the new version is validated', async ({ page }) => {
  await signInAt(page, SEEDED, 'creator');
  await expect(generate(page)).toBeEnabled();
  await brief(page).press('Control+End');
  await brief(page).pressSequentially(' More.');
  await expect(generate(page)).toBeDisabled();
  await expect(seen(page, 'Save your changes, then validate this version.').first()).toBeVisible();
});

/**
 * Jobs the fake API has made in this tab. Simulation replaces fetch inside the
 * page, so Playwright's network events never see API calls; the fake API's
 * stored jobs are the reliable count of what the backend would hold.
 */
const storedJobIds = (page: Page) =>
  page.evaluate(() => (JSON.parse(sessionStorage.getItem('nrc.sim.jobs') ?? '[]') as { job_id: string }[]).map((j) => j.job_id));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

test('a double click starts one job, with a UUID like the API issues', async ({ page }) => {
  await signInAt(page, SEEDED, 'creator');
  await expect(generate(page)).toBeEnabled();
  await generate(page).dblclick();
  await expect(seen(page, /The image is being generated|Sending the brief|Waiting to start/).first()).toBeVisible();
  const ids = await storedJobIds(page);
  expect(ids).toHaveLength(1);
  expect(ids[0]).toMatch(UUID);
});

test('a tampered job reference in this tab is ignored, and Generate stays available', async ({ page }) => {
  await signInAt(page, SEEDED, 'creator');
  await expect(generate(page)).toBeEnabled();
  // A job id that is not a UUID must never reach a request path.
  await page.evaluate(() => sessionStorage.setItem(
    Object.keys(sessionStorage).find((k) => k.startsWith('nrc.job.')) ?? 'nrc.job.x.sim-cr-0001',
    JSON.stringify({ job_id: '../../admin', version: 3 }),
  ));
  await page.reload();
  await page.locator('li button', { hasText: 'Marketing creator' }).click();
  await page.waitForURL((u) => u.pathname === SEEDED);
  await expect(generate(page)).toBeEnabled();
  expect(await storedJobIds(page)).toHaveLength(0);
});
