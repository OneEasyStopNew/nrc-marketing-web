import { expect, test, type Page } from '@playwright/test';
import { lightTheme, navOf, openNav, seen, settle, signInAt } from './helpers';

/**
 * NRC-17 acceptance in simulation mode (fixtures from the local src/mocks/data.ts).
 * The seeded draft sim-cr-0001 is at version 3 with a current PASS result.
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
const caption = (page: Page) => page.getByRole('textbox', { name: /^Caption/ });
const status = (page: Page) => page.getByRole('status').filter({ hasText: /Saved|Saving|Unsaved|Not saved|failed|conflict|Read-only/ });
/** Leaves the composer through the side menu (the drafts list is in development, so drafts open by link). */
async function goToValidation(page: Page) {
  await openNav(page);
  await navOf(page).getByRole('link', { name: 'Validation' }).click();
}

test('opening and leaving an untouched composer creates no draft', async ({ page }) => {
  // AC: opening/closing an unused composer leaves zero new drafts.
  await signInAt(page, '/marketing/create', 'creator');
  await expect(seen(page, 'Nothing is saved until you create the draft.')).toBeVisible();
  await goToValidation(page);
  await expect(page).toHaveURL(/\/marketing\/validation$/);
  await page.goBack();
  await settle(page);
  // Still the empty composer: no draft id in the address and nothing saved.
  await expect(page).toHaveURL(/\/marketing\/create$/);
  await expect(seen(page, 'Nothing is saved until you create the draft.')).toBeVisible();
  await expect(status(page)).not.toHaveText(/Saved · version/);
});

test('a draft is created only on "Create draft", and a reload restores it', async ({ page }) => {
  // AC: explicit creation; reloading a saved draft restores server version and all fields.
  await signInAt(page, '/marketing/create', 'creator');
  await expect(seen(page, 'Nothing is saved until you create the draft.')).toBeVisible();
  await brief(page).fill('A bright, empty clinic reception for a recruitment post.');
  await caption(page).fill('Placeholder caption for the test.');
  await page.getByRole('button', { name: 'Create draft' }).click();
  await expect(page).toHaveURL(/\/marketing\/create\/sim-cr-[0-9a-f]{8}$/);
  await expect(status(page)).toHaveText('Saved · version 1');
  const url = new URL(page.url()).pathname;

  await page.reload();
  await page.locator('li button', { hasText: 'Marketing creator' }).click();
  await page.waitForURL((u) => u.pathname === url);
  await settle(page);
  await expect(brief(page)).toHaveValue('A bright, empty clinic reception for a recruitment post.');
  await expect(caption(page)).toHaveValue('Placeholder caption for the test.');
  await expect(status(page)).toHaveText('Saved · version 1');
});

test('a missing brief gives an accessible error and focus; caption is optional', async ({ page }) => {
  // AC: missing required copy returns focused, accessible field errors.
  await signInAt(page, '/marketing/create', 'creator');
  await page.getByRole('button', { name: 'Create draft' }).click();
  await expect(seen(page, 'Describe the post you want.')).toBeVisible();
  await expect(seen(page, 'Write the caption.')).toHaveCount(0);
  await expect(brief(page)).toBeFocused();
  await expect(brief(page)).toHaveAttribute('aria-invalid', 'true');
  await expect(brief(page)).toHaveAccessibleDescription(/Describe the post you want/);
  await expect(page).toHaveURL(/\/marketing\/create$/);
});

test('an edit autosaves a new version and makes the old validation out of date at once', async ({ page }) => {
  // AC: an edit clears stale validation/approval indicators immediately and refreshes backend readiness.
  await signInAt(page, SEEDED, 'creator');
  await expect(status(page)).toHaveText('Saved · version 3');
  await expect(seen(page, 'Passed the assessed checks')).toBeVisible();
  // The brief of this version passed, so the server allows generation (the draft already has an image).
  await expect(page.getByRole('button', { name: 'Generate a new image' })).toBeEnabled();

  await caption(page).press('Control+End');
  await caption(page).pressSequentially(' More.');
  await expect(seen(page, 'Out of date')).toBeVisible();
  await expect(seen(page, 'The brief changed after the last validation.')).toBeVisible();

  await expect(status(page)).toHaveText('Saved · version 4', { timeout: 10_000 });
  await expect(seen(page, 'Out of date')).toBeVisible();
  await expect(seen(page, 'Last validated version 3.')).toBeVisible();
});

test('a failed save keeps the text and retries safely', async ({ page }) => {
  // AC: autosave failure is visible and retries safely.
  await signInAt(page, SEEDED, 'creator');
  await page.getByRole('button', { name: 'Make the next save fail' }).click();
  await brief(page).press('Control+End');
  await brief(page).pressSequentially(' Edited.');
  await expect(status(page)).toHaveText('Save failed', { timeout: 10_000 });
  await expect(seen(page, 'Your text is still here.')).toBeVisible();
  await expect(brief(page)).toHaveValue(/Edited\.$/);
  // One automatic retry, then saved.
  await expect(status(page)).toHaveText('Saved · version 4', { timeout: 10_000 });
});

test('a concurrent edit shows a conflict; "save mine" keeps my text as the next version', async ({ page }) => {
  // AC: concurrent changes show a recoverable conflict instead of last-write-wins.
  await signInAt(page, SEEDED, 'creator');
  await page.getByRole('button', { name: 'Someone else saves a newer version' }).click();
  await brief(page).press('Control+End');
  await brief(page).pressSequentially(' Mine.');
  const dialog = page.getByRole('dialog', { name: 'Someone saved a newer version' });
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  await expect(dialog.getByText('Their version 4')).toHaveCount(2);
  await dialog.getByRole('button', { name: 'Save mine as version 5' }).click();
  await expect(status(page)).toHaveText('Saved · version 5', { timeout: 10_000 });
  await expect(brief(page)).toHaveValue(/Mine\.$/);
});

test('a conflict can take their version instead, without losing anything silently', async ({ page }) => {
  await signInAt(page, SEEDED, 'creator');
  await page.getByRole('button', { name: 'Someone else saves a newer version' }).click();
  await brief(page).press('Control+End');
  await brief(page).pressSequentially(' Mine.');
  const dialog = page.getByRole('dialog', { name: 'Someone saved a newer version' });
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  await dialog.getByRole('button', { name: 'Use their version' }).click();
  await expect(status(page)).toHaveText('Saved · version 4');
  await expect(caption(page)).toHaveValue(/\(edited by someone else\)$/);
  await expect(brief(page)).not.toHaveValue(/Mine\.$/);
});

test('leaving with unsaved text asks first', async ({ page }) => {
  // AC: navigation warns about unsaved edits.
  await signInAt(page, '/marketing/create', 'creator');
  await brief(page).fill('Typed but not saved.');
  await goToValidation(page);
  const dialog = page.getByRole('dialog', { name: 'Leave without saving?' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Stay on this page' }).click();
  await expect(page).toHaveURL(/\/marketing\/create$/);
  await expect(brief(page)).toHaveValue('Typed but not saved.');

  await goToValidation(page);
  await page.getByRole('dialog', { name: 'Leave without saving?' }).getByRole('button', { name: 'Leave and discard' }).click();
  await expect(page).toHaveURL(/\/marketing\/validation$/);
});

test('no study configured, and only closed studies, are different states', async ({ page }) => {
  // AC: inaccessible/closed studies cannot be selected for new work; empty states are distinct.
  await signInAt(page, '/marketing/create', 'creator-no-studies');
  await expect(seen(page, 'No study set up for Marketing')).toBeVisible();
  await expect(brief(page)).toHaveCount(0);
});

test('a closed study keeps its drafts as read-only history', async ({ page }) => {
  await signInAt(page, '/marketing/create', 'creator-closed');
  await expect(seen(page, 'No study is recruiting right now')).toBeVisible();
  await expect(brief(page)).toHaveCount(0);
  // The seeded draft of the closed study, opened by its link.
  await signInAt(page, '/marketing/create/sim-cr-0002', 'creator-closed');
  await expect(seen(page, /is closed\. This draft is read-only history/)).toBeVisible();
  await expect(brief(page)).toBeDisabled();
  await expect(status(page)).toHaveText('Read-only');
});

test('Spanish and other scripts are counted as characters and saved intact', async ({ page }) => {
  // AC: contracts work for English/Spanish and Unicode without truncating required wording.
  const text = 'Estudio de investigación: niñas y señoras — नमस्ते 😀';
  await signInAt(page, '/marketing/create', 'creator');
  await brief(page).fill(text);
  await expect(seen(page, `${[...text].length} / 4000`)).toBeVisible();
  await caption(page).fill('Texto de prueba en español.');
  await page.getByRole('button', { name: 'Create draft' }).click();
  await expect(status(page)).toHaveText('Saved · version 1');
  await expect(brief(page)).toHaveValue(text);
});

test('an unknown draft id shows "Draft not found", not another tenant\'s data', async ({ page }) => {
  await signInAt(page, '/marketing/create/sim-cr-0002', 'creator');
  await expect(seen(page, 'Draft not found')).toBeVisible();
});
