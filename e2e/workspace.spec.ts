import { expect, test, type Page } from '@playwright/test';
import { lightTheme, navOf, openNav, seen, settle, signInAt } from './helpers';
import { IN_DEVELOPMENT } from '../src/config/inDevelopment';

/**
 * Role dashboards and the workspace pages (approvals, publications, rules,
 * team, media, accounts) in simulation. The workspace endpoints are proposed
 * contracts (docs/contracts/workspace.md); these tests pin the behaviour the
 * UI promises, including the rules the server must also enforce.
 */

test.beforeEach(async ({ page }) => { await lightTheme(page); });

const h1 = (page: Page) => page.getByRole('heading', { level: 1 });
const section = (page: Page, name: string) => page.getByRole('heading', { level: 2, name, exact: true });
const nav = navOf;

async function asReviewerInNrc(page: Page, path: string) {
  await signInAt(page, path, 'reviewer');
  await page.locator('li button', { hasText: 'NRC (simulation)' }).click();
  await settle(page);
}

test('each role gets its own dashboard and only its own sections', async ({ page }) => {
  test.skip(IN_DEVELOPMENT.dashboards, 'the role dashboards are in development (config/inDevelopment.ts)');
  await signInAt(page, '/marketing', 'creator');
  await expect(h1(page)).toHaveText(/^Welcome, /);
  await expect(section(page, 'Your drafts')).toBeVisible();
  await expect(section(page, 'Review queue')).toHaveCount(0);
  await expect(section(page, 'Publishing')).toHaveCount(0);
  await openNav(page);
  await expect(nav(page).getByRole('link', { name: 'Team', exact: true })).toHaveCount(0);

  await signInAt(page, '/marketing', 'publisher');
  await expect(section(page, 'Publishing')).toBeVisible();
  await expect(section(page, 'Your drafts')).toHaveCount(0);
  await openNav(page);
  await expect(nav(page).getByRole('link', { name: 'Publications', exact: true })).toBeVisible();

  await signInAt(page, '/marketing', 'policy-admin');
  await expect(section(page, 'Policy rules')).toBeVisible();
  await expect(section(page, 'Publishing')).toHaveCount(0);

  await signInAt(page, '/marketing', 'admin');
  for (const name of ['Organisation overview', 'Your drafts', 'Review queue', 'Policy rules', 'Publishing', 'Recent activity']) {
    await expect(section(page, name)).toBeVisible();
  }
  await openNav(page);
  await expect(nav(page).getByRole('link', { name: 'Team', exact: true })).toBeVisible();
});

test('a reviewer approves a passed version, and a reason is required to send one back', async ({ page }) => {
  test.skip(IN_DEVELOPMENT.approvals, 'approvals are in development (config/inDevelopment.ts)');
  await asReviewerInNrc(page, '/marketing/approvals');
  await expect(h1(page)).toHaveText('Approvals');
  await page.getByRole('link', { name: 'sim-cr-0005 · version 4' }).click();
  await expect(h1(page)).toHaveText('Review');

  await page.getByRole('radio', { name: /Request changes/ }).check();
  await page.getByRole('button', { name: 'Send back for changes' }).click();
  await expect(seen(page, /^Say what needs to change/)).toBeVisible();

  await page.getByRole('radio', { name: /Approve this version/ }).check();
  await page.getByRole('button', { name: 'Record decision' }).click();
  await expect(seen(page, 'Version 4 approved')).toBeVisible();
  await (await openNav(page)).getByRole('link', { name: 'Approvals', exact: true }).click();
  await page.getByRole('tab', { name: /Decided/ }).click();
  await expect(page.getByRole('link', { name: 'sim-cr-0005 · version 4' })).toBeVisible();
});

test('nobody can approve their own submission', async ({ page }) => {
  test.skip(IN_DEVELOPMENT.approvals, 'approvals are in development (config/inDevelopment.ts)');
  // sim-ap-0002 was submitted by the administrator.
  await signInAt(page, '/marketing/approvals/sim-ap-0002', 'admin');
  await expect(seen(page, 'You submitted this post. Someone else must review it.')).toBeVisible();
  await expect(page.getByRole('radio', { name: /Approve this version/ })).toBeDisabled();
});

test('approve is not offered when validation did not pass', async ({ page }) => {
  test.skip(IN_DEVELOPMENT.approvals, 'approvals are in development (config/inDevelopment.ts)');
  await asReviewerInNrc(page, '/marketing/approvals/sim-ap-0005');
  // Already decided: shows the decision, no form.
  await expect(seen(page, 'Remove "guaranteed result" and add the required disclosure.')).toBeVisible();
  await expect(page.getByRole('radio', { name: /Approve this version/ })).toHaveCount(0);
});

test('a publisher queues an approved post; it is never shown as published', async ({ page }) => {
  test.skip(IN_DEVELOPMENT.publications, 'publishing is in development (config/inDevelopment.ts)');
  await signInAt(page, '/marketing/publications', 'publisher');
  await expect(h1(page)).toHaveText('Publications');
  await page.getByRole('button', { name: 'Schedule a post' }).click();
  const dialog = page.getByRole('dialog', { name: 'Schedule a post' });

  await dialog.getByRole('button', { name: 'Schedule post' }).click();
  await expect(seen(page, 'Choose an approved version.')).toBeVisible();
  await expect(seen(page, 'Choose at least one account.')).toBeVisible();

  await dialog.getByRole('combobox', { name: /Approved version/ }).click();
  await page.getByRole('option', { name: /sim-cr-0001 · version 3/ }).click();
  // Accounts that cannot publish are not selectable.
  await expect(dialog.getByRole('checkbox', { name: /NRC Community/ })).toBeDisabled();
  await dialog.getByRole('checkbox', { name: /nrc_research_sim/ }).check();
  await dialog.getByRole('radio', { name: 'As soon as possible' }).check();
  await dialog.getByRole('button', { name: 'Queue post' }).click();
  await expect(seen(page, 'Post queued')).toBeVisible();
  await expect(dialog).toHaveCount(0);
  await expect(seen(page, 'Queued').first()).toBeVisible();
});

test('a policy administrator drafts a rule with its source, then activates it', async ({ page }) => {
  test.skip(IN_DEVELOPMENT.ruleEditing, 'rule editing is in development (config/inDevelopment.ts)');
  await signInAt(page, '/marketing/rules/manage', 'policy-admin');
  await page.getByRole('button', { name: 'New rule' }).click();
  const dialog = page.getByRole('dialog', { name: 'New rule' });
  await dialog.getByRole('button', { name: 'Save draft' }).click();
  await expect(seen(page, 'Give the rule a short title.')).toBeVisible();
  await expect(seen(page, 'Cite the clause this rule comes from.')).toBeVisible();

  await dialog.getByRole('textbox', { name: /^Title/ }).fill('Placeholder rule for the test');
  await dialog.getByRole('textbox', { name: /^What it checks/ }).fill('Placeholder description (simulation).');
  await dialog.getByRole('textbox', { name: /^Clause/ }).first().fill('Sim 9.9');
  await dialog.getByRole('button', { name: 'Save draft' }).click();
  await expect(seen(page, /drafted$/)).toBeVisible();

  await page.getByRole('tab', { name: /Drafts/ }).click();
  await page.getByRole('button', { name: 'Placeholder rule for the test' }).click();
  await page.getByRole('button', { name: 'Activate' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: /Activate/ }).click();
  await expect(seen(page, /is now active$/)).toBeVisible();
});

test('rule editing controls stay visible but only open the in-development dialog', async ({ page }) => {
  test.skip(!IN_DEVELOPMENT.ruleEditing, 'rule editing is available (config/inDevelopment.ts)');
  // Rule administration is under /manage while the Rules section shows the read-only active policy (NRC-20).
  await signInAt(page, '/marketing/rules/manage', 'policy-admin');
  const notYet = async (feature: string) => {
    // Matched by its own name: the dialog renders inside the rule drawer, which also contains its heading.
    const dialog = page.getByRole('dialog', { name: feature });
    await expect(dialog.getByRole('heading', { name: `In development: ${feature}` })).toBeVisible();
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('textbox')).toHaveCount(0);
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Close', exact: true }).last().click();
    await expect(dialog).toHaveCount(0);
  };
  const draftsTab = page.getByRole('tab', { name: /Drafts/ });
  await expect(draftsTab).toContainText('1');

  await page.getByRole('button', { name: 'New rule' }).click();
  await notYet('New rule');

  // Active rule: Edit and Retire.
  await page.getByRole('button', { name: 'No promised results' }).click();
  const drawer = page.getByRole('dialog', { name: 'No promised results' });
  await drawer.getByRole('button', { name: 'Edit' }).click();
  await notYet('Edit SIM-');
  await drawer.getByRole('button', { name: 'Retire' }).click();
  await notYet('Retire SIM-');
  await page.keyboard.press('Escape');

  // Draft rule: Activate. Drafts stay viewable, read-only.
  await draftsTab.click();
  await page.getByRole('button', { name: 'Image rights are on file' }).click();
  await page.getByRole('dialog', { name: 'Image rights are on file' }).getByRole('button', { name: 'Activate' }).click();
  await notYet('Activate SIM-');
  await page.keyboard.press('Escape');

  // Nothing was written: still one draft, and the active rule is unchanged.
  await expect(draftsTab).toContainText('1');
  await page.getByRole('tab', { name: /Active/ }).click();
  await expect(page.getByRole('button', { name: 'No promised results' })).toBeVisible();
});

test('an administrator invites someone and changes roles; a role is always required', async ({ page }) => {
  test.skip(IN_DEVELOPMENT.team, 'team management is in development (config/inDevelopment.ts)');
  await signInAt(page, '/marketing/team', 'admin');
  await expect(h1(page)).toHaveText('Team');
  await page.getByRole('button', { name: 'Invite someone' }).click();
  const dialog = page.getByRole('dialog', { name: 'Invite someone' });
  await dialog.getByRole('textbox', { name: /^Name/ }).fill('Placeholder Person');
  await dialog.getByRole('textbox', { name: /^Work email/ }).fill('not-an-email');
  await dialog.getByRole('button', { name: 'Send invitation' }).click();
  await expect(seen(page, 'Enter a valid email address.')).toBeVisible();

  await dialog.getByRole('textbox', { name: /^Work email/ }).fill('placeholder.person@example.test');
  await dialog.getByRole('checkbox', { name: /Creator/ }).uncheck();
  await dialog.getByRole('button', { name: 'Send invitation' }).click();
  await expect(seen(page, 'Choose at least one role.')).toBeVisible();
  await dialog.getByRole('checkbox', { name: /Reviewer/ }).check();
  await dialog.getByRole('button', { name: 'Send invitation' }).click();
  await expect(seen(page, 'Placeholder Person invited')).toBeVisible();

  await page.getByRole('tab', { name: /Invited/ }).click();
  await expect(seen(page, 'placeholder.person@example.test')).toBeVisible();
});

test('pages outside the role are refused, not hidden behind a blank screen', async ({ page }) => {
  await signInAt(page, '/marketing/team', 'creator');
  await expect(seen(page, 'Not available with your role')).toBeVisible();
  await signInAt(page, '/marketing/rules/manage', 'publisher');
  await expect(seen(page, 'Not available with your role')).toBeVisible();
});

test('media and connected accounts show their fixtures and what needs fixing', async ({ page }) => {
  test.skip(IN_DEVELOPMENT.accounts || IN_DEVELOPMENT.mediaVideo, 'connected accounts and video are in development (config/inDevelopment.ts)');
  await signInAt(page, '/marketing/media', 'creator');
  await expect(h1(page)).toHaveText('Media');
  await expect(page.getByRole('button', { name: 'Upload' }).or(page.getByRole('button', { name: /Upload/ })).first()).toBeVisible();

  await signInAt(page, '/marketing/integrations', 'publisher');
  await expect(h1(page)).toHaveText('Connected accounts');
  await expect(seen(page, 'Access expired on 2 Nov 2026. Reconnect to publish again.')).toBeVisible();
  await page.getByRole('button', { name: 'Reconnect' }).first().click();
  await expect(seen(page, /reconnected$/)).toBeVisible();
});

test('features that are not planned yet show the in-development screen, not dummy data', async ({ page }) => {
  const inDevelopment = (feature: string) => page.getByRole('heading', { name: `In development: ${feature}` });

  // Home: the role dashboards.
  await signInAt(page, '/marketing', 'admin');
  if (IN_DEVELOPMENT.dashboards) await expect(inDevelopment('Your dashboard')).toBeVisible();

  // Whole pages. Each is opened directly (simulation signs in again on every load).
  for (const [path, title, feature, on] of [
    ['/marketing/team', 'Team', 'Team management', IN_DEVELOPMENT.team],
    ['/marketing/approvals', 'Approvals', 'Approvals', IN_DEVELOPMENT.approvals],
    ['/marketing/publications', 'Publications', 'Publishing', IN_DEVELOPMENT.publications],
    ['/marketing/integrations', 'Connected accounts', 'Connected accounts', IN_DEVELOPMENT.accounts],
  ] as const) {
    if (!on) continue;
    await signInAt(page, path, 'admin');
    await expect(h1(page)).toHaveText(title);
    await expect(inDevelopment(feature)).toBeVisible();
  }

  // Media: the Videos filter and Upload.
  await signInAt(page, '/marketing/media', 'admin');
  await expect(h1(page)).toHaveText('Media');
  if (IN_DEVELOPMENT.mediaVideo) {
    await page.getByText('Videos', { exact: true }).click();
    await expect(inDevelopment('Video')).toBeVisible();
  }
  if (IN_DEVELOPMENT.mediaUpload) {
    await page.getByRole('button', { name: 'Upload' }).click();
    await expect(page.getByRole('dialog').getByRole('heading', { name: 'In development: Upload media' })).toBeVisible();
    await page.getByRole('dialog').getByRole('button', { name: 'Close' }).last().click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  }

  // Rules: the list stays; New rule opens the in-development dialog, not the editor.
  if (IN_DEVELOPMENT.ruleEditing) {
    // Rule administration moved to /manage when the Rules section became the read-only viewer (NRC-20).
    await signInAt(page, '/marketing/rules/manage', 'admin');
    await expect(h1(page)).toHaveText('Rules');
    await expect(page.getByRole('table')).toBeVisible();
    await page.getByRole('button', { name: 'New rule' }).click();
    await expect(page.getByRole('dialog').getByRole('heading', { name: 'In development: New rule' })).toBeVisible();
    await expect(page.getByRole('textbox')).toHaveCount(0);
  }
});
