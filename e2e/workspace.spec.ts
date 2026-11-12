import { expect, test, type Page } from '@playwright/test';
import { lightTheme, navOf, openNav, seen, settle, signInAt } from './helpers';

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
  // sim-ap-0002 was submitted by the administrator.
  await signInAt(page, '/marketing/approvals/sim-ap-0002', 'admin');
  await expect(seen(page, 'You submitted this post. Someone else must review it.')).toBeVisible();
  await expect(page.getByRole('radio', { name: /Approve this version/ })).toBeDisabled();
});

test('approve is not offered when validation did not pass', async ({ page }) => {
  await asReviewerInNrc(page, '/marketing/approvals/sim-ap-0005');
  // Already decided: shows the decision, no form.
  await expect(seen(page, 'Remove "guaranteed result" and add the required disclosure.')).toBeVisible();
  await expect(page.getByRole('radio', { name: /Approve this version/ })).toHaveCount(0);
});

test('a publisher queues an approved post; it is never shown as published', async ({ page }) => {
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

// Demo decision (NRC-20, 13 Nov): rule editing is switched off (RULE_EDITING_AVAILABLE in RulesPage.tsx)
// because the backend has no rule-writing endpoints yet. The controls stay where they are and explain
// that instead of opening the editor or a confirmation. The editor's own flow (validation messages,
// draft, activate) is not reachable until the flag is turned back on.
// fixme while RULE_EDITING_AVAILABLE is false (RulesPage.tsx): turn back into test() when the flag goes.
test.fixme('a policy administrator drafts a rule with its source, then activates it', async ({ page }) => {
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

test('rule editing controls stay visible but only explain that editing is not available yet', async ({ page }) => {
  // Rule administration is parked under /manage while the Rules section shows the read-only active policy (NRC-20).
  await signInAt(page, '/marketing/rules/manage', 'policy-admin');
  const notYet = async () => {
    await expect(seen(page, 'Rule editing is not available yet').first()).toBeVisible();
    await expect(page.getByRole('dialog', { name: /New rule|^Edit / })).toHaveCount(0);
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    // Dismiss it, so the next control is shown to raise its own.
    await page.getByRole('region', { name: 'Notifications' }).getByRole('button', { name: 'Dismiss notification' }).click();
    await expect(seen(page, 'Rule editing is not available yet')).toHaveCount(0);
  };
  const draftsTab = page.getByRole('tab', { name: /Drafts/ });
  await expect(draftsTab).toContainText('1');

  await page.getByRole('button', { name: 'New rule' }).click();
  await notYet();

  // Active rule: Edit and Retire.
  await page.getByRole('button', { name: 'No promised results' }).click();
  const drawer = page.getByRole('dialog', { name: 'No promised results' });
  await drawer.getByRole('button', { name: 'Edit' }).click();
  await notYet();
  await drawer.getByRole('button', { name: 'Retire' }).click();
  await notYet();
  await page.keyboard.press('Escape');

  // Draft rule: Activate. Drafts stay viewable, read-only.
  await draftsTab.click();
  await page.getByRole('button', { name: 'Image rights are on file' }).click();
  await page.getByRole('dialog', { name: 'Image rights are on file' }).getByRole('button', { name: 'Activate' }).click();
  await notYet();
  await page.keyboard.press('Escape');

  // Nothing was written: still one draft, and the active rule is unchanged.
  await expect(draftsTab).toContainText('1');
  await page.getByRole('tab', { name: /Active/ }).click();
  await expect(page.getByRole('button', { name: 'No promised results' })).toBeVisible();
});

test('an administrator invites someone and changes roles; a role is always required', async ({ page }) => {
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
  await signInAt(page, '/marketing/media', 'creator');
  await expect(h1(page)).toHaveText('Media');
  await expect(page.getByRole('button', { name: 'Upload' }).or(page.getByRole('button', { name: /Upload/ })).first()).toBeVisible();

  await signInAt(page, '/marketing/integrations', 'publisher');
  await expect(h1(page)).toHaveText('Connected accounts');
  await expect(seen(page, 'Access expired on 2 Nov 2026. Reconnect to publish again.')).toBeVisible();
  await page.getByRole('button', { name: 'Reconnect' }).first().click();
  await expect(seen(page, /reconnected$/)).toBeVisible();
});
