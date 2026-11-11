import { expect, test, type Page } from '@playwright/test';
import { lightTheme, seen, signInAt } from './helpers';

/**
 * NRC-18 demo slice in simulation mode: the generated-image preview with its
 * provenance, renewal of an expired image link, and the states for an image
 * that cannot be shown. The simulation tools on the final preview make the
 * fake API answer the next image request with an expired link, a storage
 * outage or "not available to you".
 */

let pageErrors: string[] = [];
test.beforeEach(async ({ page }) => {
  pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await lightTheme(page);
});
test.afterEach(() => { expect(pageErrors, 'page errors').toEqual([]); });

const SEEDED = '/marketing/create/sim-cr-0001';
const preview = (page: Page) => page.getByRole('region', { name: 'Post preview' });
const image = (page: Page) => preview(page).getByRole('img', { name: 'Image for version 3 of this draft (simulation placeholder)' });

/** The image is on screen and the browser actually drew it. */
async function expectDrawn(page: Page) {
  await expect(image(page)).toBeVisible();
  await expect.poll(() => image(page).evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
}

async function simulate(page: Page, tool: string) {
  await expectDrawn(page);
  await page.getByRole('button', { name: tool, exact: true }).click();
}

test('the seeded draft shows its image with where it came from', async ({ page }) => {
  await signInAt(page, `${SEEDED}/preview`, 'creator');
  await expectDrawn(page);
  await expect(seen(page, 'Simulation, not a real generated image')).toBeVisible();
  await expect(seen(page, /1080×1080 · .* · Checksum 515151515151/)).toBeVisible();

  // The composer shows the same image with its provenance under it.
  await page.getByRole('link', { name: 'Back to the draft' }).click();
  await expect(page.getByRole('img', { name: 'Image for this draft (simulation placeholder)' })).toBeVisible();
  await expect(seen(page, 'Simulation, not a real generated image')).toBeVisible();
  await expect(seen(page, /Checksum 515151515151/)).toBeVisible();
});

test('the full-size image opens and closes from the keyboard', async ({ page }) => {
  await signInAt(page, `${SEEDED}/preview`, 'creator');
  await expectDrawn(page);
  await preview(page).getByRole('button', { name: 'Open full size' }).focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Image at full size' });
  await expect(dialog.getByRole('img', { name: 'Image for version 3 of this draft (simulation placeholder)' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
});

test('an expired image link is renewed automatically', async ({ page }) => {
  await signInAt(page, `${SEEDED}/preview`, 'creator');
  await simulate(page, 'Expire the image link');
  await expect(seen(page, 'The image link expired')).toBeVisible();
  await expectDrawn(page);
  await expect(image(page)).toHaveAttribute('src', /^data:image\/svg\+xml/);
  await expect(seen(page, 'The image could not be shown')).toHaveCount(0);
});

test('a renewed link that fails too shows an error with Try again, and Try again recovers', async ({ page }) => {
  await signInAt(page, `${SEEDED}/preview`, 'creator');
  await simulate(page, 'Expire the image link twice');
  await expect(seen(page, 'The image could not be shown')).toBeVisible();
  await expect(image(page)).toHaveCount(0);
  // It does not keep retrying on its own.
  await page.waitForTimeout(1500);
  await expect(seen(page, 'The image could not be shown')).toBeVisible();

  await preview(page).getByRole('button', { name: 'Try again' }).click();
  await expectDrawn(page);
  await expect(seen(page, 'The image could not be shown')).toHaveCount(0);
});

test('storage being down while renewing says so and offers Try again', async ({ page }) => {
  await signInAt(page, `${SEEDED}/preview`, 'creator');
  await simulate(page, 'Expire the link with storage unavailable');
  await expect(seen(page, 'The image is temporarily unavailable')).toBeVisible({ timeout: 15_000 });
  await preview(page).getByRole('button', { name: 'Try again' }).click();
  await expectDrawn(page);
});

test('an image from another organisation is not shown', async ({ page }) => {
  await signInAt(page, `${SEEDED}/preview`, 'creator');
  await simulate(page, 'Move the image to another organisation');
  await expect(seen(page, 'Image not available')).toBeVisible();
  await expect(seen(page, 'It does not exist, or it is not available to you in this organisation.')).toBeVisible();
  await expect(image(page)).toHaveCount(0);
  // Nothing about it is shown from the cache either.
  await expect(seen(page, /Checksum 515151515151/)).toHaveCount(0);
  await expect(seen(page, 'Not available', { exact: true })).toBeVisible();
});
