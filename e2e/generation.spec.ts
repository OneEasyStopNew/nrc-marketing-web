import { expect, test, type Page } from '@playwright/test';
import { lightTheme, seen, signInAt } from './helpers';

/**
 * NRC-21 demo slice in simulation mode: Generate from a validated version,
 * durable progress, refresh recovery, no duplicate jobs, and the refused,
 * unconfirmed (UNKNOWN) and limit states. Uses the seeded draft sim-cr-0001,
 * whose version 3 passed validation (local src/mocks/data.ts); the creator
 * needs the generation:run capability there.
 */

let pageErrors: string[] = [];
test.beforeEach(async ({ page }) => {
  pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await lightTheme(page);
});
test.afterEach(() => { expect(pageErrors, 'page errors').toEqual([]); });

const SEEDED = '/marketing/create/sim-cr-0001';
const generate = (page: Page) => page.getByRole('button', { name: 'Generate image' });

/**
 * Jobs the fake server has made in this tab. Simulation replaces fetch inside
 * the page, so Playwright's network events never see API calls; the fake
 * server's stored jobs are the reliable count of what the backend would hold.
 */
const storedJobs = (page: Page) =>
  page.evaluate(() => (JSON.parse(sessionStorage.getItem('nrc.sim.jobs') ?? '[]') as { final: { job_id: string } }[]).map((j) => j.final.job_id));

test('generates an image with progress and finds the same job after a reload', async ({ page }) => {
  await signInAt(page, SEEDED, 'creator');
  await expect(generate(page)).toBeEnabled();
  await generate(page).click();

  await expect(page).toHaveURL(/\/generation\/sim-gen-/);
  await expect(page.getByRole('progressbar', { name: 'Image generation progress' })).toBeVisible();
  await expect(generate(page)).toBeDisabled();
  const jobUrl = page.url();

  // A reload while it runs (signing in again on the way): the job id in the path brings back the same job.
  await signInAt(page, jobUrl.replace(/^https?:\/\/[^/]+/, ''), 'creator');
  await expect(page).toHaveURL(jobUrl);
  await expect(seen(page, 'Image saved', { exact: true }).first()).toBeVisible({ timeout: 15_000 });
  expect(await storedJobs(page)).toHaveLength(1);

  await expect(seen(page, 'Simulation, not a real generated image')).toBeVisible();
  await expect(seen(page, /still needs its final validation/)).toBeVisible();
  await expect(page.getByRole('img', { name: /simulation placeholder/ })).toBeVisible();
});

test('a double click makes one job', async ({ page }) => {
  await signInAt(page, SEEDED, 'creator');
  await generate(page).dblclick();
  await expect(page).toHaveURL(/\/generation\/sim-gen-/);
  expect(await storedJobs(page)).toHaveLength(1);
});

test('a lost response is retried as the same command and finds the job it made', async ({ page }) => {
  await signInAt(page, SEEDED, 'creator');
  await page.getByRole('button', { name: 'Lose the answer to the next Generate' }).click();
  await generate(page).click();
  // The server made the job, but the browser never heard back.
  await expect(seen(page, 'No answer from NRC Marketing')).toBeVisible();
  const made = await storedJobs(page);
  expect(made).toHaveLength(1);

  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page).toHaveURL(new RegExp(`/generation/${made[0]}$`));
  expect(await storedJobs(page)).toEqual(made);
});

test('a refused image explains what to do', async ({ page }) => {
  await signInAt(page, SEEDED, 'creator');
  await page.getByRole('button', { name: 'Image service refuses the next image' }).click();
  await generate(page).click();
  await expect(seen(page, 'The image was not made')).toBeVisible({ timeout: 15_000 });
  await expect(seen(page, /refused this brief under its content rules/)).toBeVisible();
});

test('an unconfirmed job turns Generate off and says it is being checked', async ({ page }) => {
  await signInAt(page, SEEDED, 'creator');
  await page.getByRole('button', { name: 'Next image stays unconfirmed' }).click();
  await generate(page).click();
  await expect(seen(page, 'Confirming with the image service')).toBeVisible({ timeout: 15_000 });
  await expect(generate(page)).toBeDisabled();
});

test('the daily limit is shown and nothing starts', async ({ page }) => {
  await signInAt(page, SEEDED, 'creator');
  await page.getByRole('button', { name: 'Next Generate hits the daily limit' }).click();
  await generate(page).click();
  await expect(seen(page, /today's image allowance/)).toBeVisible();
  await expect(page).not.toHaveURL(/\/generation\//);
});

test('an edited brief needs validation again before Generate', async ({ page }) => {
  await signInAt(page, SEEDED, 'creator');
  await page.getByRole('textbox', { name: /^Brief/ }).fill('A changed brief for the simulation, written to need a new validation run.');
  await expect(generate(page)).toBeDisabled();
});
