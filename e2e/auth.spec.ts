import { expect, test, type Page } from '@playwright/test';
import { lightTheme, navOf, openNav, seen, settle, signInAt } from './helpers';

/**
 * OR-102 acceptance in simulation mode. Each test notes the criterion it covers.
 * Console output is collected and must never contain a token.
 */

let consoleLines: string[] = [];
test.beforeEach(async ({ page }) => {
  consoleLines = [];
  page.on('console', (m) => consoleLines.push(m.text()));
  page.on('pageerror', (e) => consoleLines.push(`pageerror: ${e.message}`));
  await lightTheme(page);
});
test.afterEach(() => {
  expect(consoleLines.filter((l) => /Bearer|sim\.[0-9a-f-]{36}|access_token|refresh_token/i.test(l)), 'tokens in console').toEqual([]);
  expect(consoleLines.filter((l) => l.startsWith('pageerror')), 'page errors').toEqual([]);
});

const h1 = (page: Page) => page.getByRole('heading', { level: 1 });
/** Sections the user can open: the side navigation shows only what the server's capabilities allow. */
const homeItem = (page: Page, name: string) => navOf(page).getByRole('link', { name, exact: true });

async function openOrgMenu(page: Page) {
  await openNav(page);
  await page.getByRole('button', { name: /Organisation: .* Change organisation/ }).click();
}

test('logged-out deep link signs in and returns to the same page, with a clean URL', async ({ page }) => {
  // AC: logged-out deep link redirects safely and returns only to an allowed path.
  await signInAt(page, '/marketing/create', 'creator');
  await expect(h1(page)).toHaveText('Create post');
  expect(new URL(page.url()).pathname).toBe('/marketing/create');
  expect(page.url()).not.toMatch(/code=|state=/);
});

test('unknown paths after sign-in fall back to the home page', async ({ page }) => {
  await signInAt(page, '/admin/secret', 'creator');
  // /admin is outside the allow-list: sign-in returns to home, not to the requested path.
  expect(new URL(page.url()).pathname).toBe('/marketing');
  await expect(h1(page)).toHaveText(/^Welcome, /);
});

test('a stale or replayed callback shows a clear message and no loop', async ({ page }) => {
  await page.goto('/auth/callback?code=sim&state=not-issued-here');
  await expect(seen(page, 'That sign-in link was already used or has expired')).toBeVisible();
  expect(new URL(page.url()).pathname).toBe('/marketing');
});

test('one organisation opens straight in, with capabilities from the server', async ({ page }) => {
  // AC: individual permitted user reaches the right tenant/context and capabilities.
  await signInAt(page, '/marketing', 'creator');
  await expect(h1(page)).toHaveText(/^Welcome, /);
  await openNav(page);
  await expect(homeItem(page, 'Create post')).toBeVisible();
  await expect(homeItem(page, 'Validation')).toBeVisible();
  await expect(homeItem(page, 'Approvals')).toHaveCount(0);
  // NRC-20: creators read the active policy (creative:read), read-only.
  await expect(homeItem(page, 'Rules')).toBeVisible();
});

test('a route outside the role shows the reason and never the page', async ({ page }) => {
  // AC: role change and 403 hide/disable the action with a useful reason.
  await signInAt(page, '/marketing/approvals', 'creator');
  await expect(seen(page, 'Not available with your role')).toBeVisible();
  await expect(seen(page, /does not include Approvals/)).toBeVisible();
});

test('two organisations: explicit choice, and switching re-scopes the capabilities', async ({ page }) => {
  // AC: explicitly select authorized context; clear cached tenant data on switch.
  await page.goto('/marketing');
  await page.locator('li button', { hasText: 'Policy reviewer' }).click();
  await expect(h1(page)).toHaveText('Choose an organisation');
  await page.locator('li button', { hasText: 'NRC (simulation)' }).click();
  await settle(page);
  await openNav(page);
  await expect(homeItem(page, 'Approvals')).toBeVisible();

  await openOrgMenu(page);
  await page.getByRole('menuitemradio', { name: 'Partner company (simulation)' }).click();
  await settle(page);
  await openNav(page);
  await expect(page.getByRole('button', { name: /^Organisation: Partner company \(simulation\)/ })).toBeVisible();
  await expect(homeItem(page, 'Validation')).toBeVisible();
  await expect(homeItem(page, 'Approvals')).toHaveCount(0);
});

test('an expired access token is refreshed once and the request succeeds', async ({ page }) => {
  // AC: single controlled refresh path; no loop.
  await signInAt(page, '/marketing', 'reviewer');
  await page.locator('li button', { hasText: 'NRC (simulation)' }).click();
  await settle(page);

  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('menuitem', { name: 'Expire access token' }).click();

  await openOrgMenu(page);
  await page.getByRole('menuitemradio', { name: 'Partner company (simulation)' }).click();
  await settle(page);
  await openNav(page);
  await expect(page.getByRole('button', { name: /^Organisation: Partner company \(simulation\)/ })).toBeVisible();
});

test('a session ended on the server signs out cleanly and returns to the same page', async ({ page }) => {
  // AC: expired token and failed refresh clear session/cache without loops.
  await signInAt(page, '/marketing/validation', 'reviewer');
  await page.locator('li button', { hasText: 'NRC (simulation)' }).click();
  await settle(page);
  await expect(h1(page)).toHaveText('Validation');

  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('menuitem', { name: 'End session' }).click();
  await openOrgMenu(page);
  await page.getByRole('menuitemradio', { name: 'Partner company (simulation)' }).click();

  await expect(h1(page)).toHaveText('Sign in');
  await expect(seen(page, 'Your session ended. Sign in again to continue where you were.')).toBeVisible();
  expect(new URL(page.url()).pathname).toBe('/marketing/validation');

  await page.locator('li button', { hasText: 'Policy reviewer' }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/auth/callback'));
  await settle(page);
  // The remembered organisation reopens directly.
  await expect(h1(page)).toHaveText('Validation');
});

test('sign out leaves nothing behind; going back does not show the app', async ({ page }) => {
  // AC: logout clears session/cache without cross-tenant remnants.
  await signInAt(page, '/marketing', 'creator');
  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  await page.waitForURL('**/signed-out');
  await expect(h1(page)).toHaveText('Signed out');
  const stored = await page.evaluate(() => JSON.stringify({ ...sessionStorage, ...localStorage }));
  expect(stored).not.toMatch(/nrc\.auth\.(active|tenant)|sim\.[0-9a-f-]{36}/);

  await page.goBack();
  await expect(h1(page)).toHaveText('Sign in');
  await expect(page.getByRole('navigation', { name: /^(Main|Navigation)$/ })).toHaveCount(0);
});

test('signing out in one tab signs out the other tabs', async ({ page, context }) => {
  // AC: logout clears session/cache without remnants.
  const other = await context.newPage();
  await signInAt(page, '/marketing', 'creator');
  await signInAt(other, '/marketing/create', 'creator');
  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  await page.waitForURL('**/signed-out');
  await expect(other.getByRole('heading', { level: 1 })).toHaveText('Signed out');
  await expect(other.getByRole('navigation', { name: /^(Main|Navigation)$/ })).toHaveCount(0);
});

for (const [identity, title] of [
  ['disabled', 'Account disabled'],
  ['no-access', 'No access to Marketing'],
  ['mfa', 'Two-step sign-in required'],
] as const) {
  test(`${identity}: distinct screen, no shell`, async ({ page }) => {
    // AC: disabled account, MFA required and no access are handled distinctly.
    await signInAt(page, '/marketing', identity);
    await expect(h1(page)).toHaveText(title);
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page.getByRole('navigation', { name: /^(Main|Navigation)$/ })).toHaveCount(0);
  });
}

test('keyboard: skip link first, then the menu; focus moves to the page on navigation', async ({ page }, testInfo) => {
  // AC: auth forms and shell pass keyboard checks.
  test.skip(testInfo.project.name === 'mobile', 'keyboard flow is checked at desktop widths');
  await signInAt(page, '/marketing', 'admin');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('main')).toBeFocused();

  await (await openNav(page)).getByRole('link', { name: 'Rules' }).click();
  await expect(h1(page)).toHaveText('Rules');
  await expect(page.getByRole('main')).toBeFocused();
});
