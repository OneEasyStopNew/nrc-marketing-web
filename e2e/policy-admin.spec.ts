import { expect, test, type Page } from '@playwright/test';
import { lightTheme, seen, signInAt } from './helpers';

/**
 * Policy administration (NRC-20), in simulation against the NRC-4 contract
 * (api/policyAdmin.ts). The local, git-ignored src/mocks/data.ts seeds four
 * synthetic rulebook versions for the NRC tenant: 1 retired, 2 active,
 * 3 in review, 4 a draft with an unreviewed AI-suggested rule.
 */

test.beforeEach(async ({ page }) => {
  await lightTheme(page);
});

const h1 = (page: Page) => page.getByRole('heading', { level: 1 });
const row = (page: Page, version: number) => page.getByRole('row').filter({ has: page.getByRole('link', { name: `Version ${version}`, exact: true }) });

test('a policy administrator sees every rulebook version with its status, and which one is active', async ({ page }) => {
  await signInAt(page, '/marketing/rules', 'policy-admin');
  await page.getByRole('link', { name: 'Rulebooks' }).click();
  await expect(h1(page)).toHaveText('Rulebooks');
  await expect(seen(page, 'Version 2 is the active rulebook.')).toBeVisible();

  await expect(row(page, 4)).toContainText('Draft');
  await expect(row(page, 3)).toContainText('In review');
  await expect(row(page, 2)).toContainText('Active');
  await expect(row(page, 1)).toContainText('Retired');
  await expect(row(page, 4)).toContainText('Synthetic');

  // The status filter narrows the list.
  await page.getByRole('combobox', { name: 'Status' }).click();
  await page.getByRole('option', { name: 'Draft' }).click();
  await expect(row(page, 4)).toBeVisible();
  await expect(row(page, 2)).toHaveCount(0);
});

test('a draft rulebook shows its rules, unreviewed AI suggestions, blocking problems and history', async ({ page }) => {
  await signInAt(page, '/marketing/rules/rulebooks', 'policy-admin');
  await page.getByRole('link', { name: 'Version 4', exact: true }).click();
  await expect(h1(page)).toContainText('Version 4');
  await expect(seen(page, 'Draft', { exact: true }).first()).toBeVisible();
  await expect(seen(page, 'Not in use. A draft can be edited, then sent for review.')).toBeVisible();

  // Rules keep their ID, wording, severity and mandatory status.
  const rules = page.getByLabel('Rules', { exact: true });
  await expect(rules).toContainText('SYN-REC-01');
  await expect(rules).toContainText('Critical');
  await expect(rules).toContainText('Mandatory');
  // An AI-suggested rule is never shown as reviewed.
  await expect(rules).toContainText('SYN-REC-04');
  await expect(rules).toContainText('Not reviewed');
  await expect(rules).toContainText('Suggested by AI (simulated)');

  // The server's checks are shown as blockers, never as a success badge.
  const problems = page.getByLabel('Problems that block approval or activation', { exact: true });
  await expect(problems).toContainText('Not reviewed yet');
  await expect(problems).toContainText('rule:SYN-REC-04');

  const history = page.getByLabel('History', { exact: true });
  await expect(history).toContainText('Created');
});

test('the active rulebook says it is in use and cannot be edited in place', async ({ page }) => {
  await signInAt(page, '/marketing/rules/rulebooks', 'policy-admin');
  await page.getByRole('link', { name: 'Version 2', exact: true }).click();
  await expect(seen(page, 'In use now. Every brief, caption and image is checked against it. It cannot be edited; changes go into a new draft.')).toBeVisible();
  await expect(page.getByLabel('Problems that block approval or activation', { exact: true })).toContainText('The server found no blocking problems.');
});

test('a policy owner (approver) can read the rulebooks too', async ({ page }) => {
  await signInAt(page, '/marketing/rules/rulebooks', 'policy-approver');
  await expect(h1(page)).toHaveText('Rulebooks');
  await expect(row(page, 3)).toContainText('In review');
});

test('a creator gets no link to the rulebooks', async ({ page }) => {
  await signInAt(page, '/marketing/rules', 'creator');
  await expect(h1(page)).toHaveText('Rules');
  await expect(page.getByRole('link', { name: 'Rulebooks' })).toHaveCount(0);
});

test('a creator cannot open the rulebooks by a direct link', async ({ page }) => {
  await signInAt(page, '/marketing/rules/rulebooks/00000000-0000-4000-8000-00000000c004', 'creator');
  await expect(seen(page, 'Not available with your role')).toBeVisible();
  await expect(page.getByLabel('Rules', { exact: true })).toHaveCount(0);
});

/* ---------- Step 3: status buttons ---------- */

const openVersion = async (page: Page, who: string, version: number) => {
  await signInAt(page, '/marketing/rules/rulebooks', who);
  await page.getByRole('link', { name: `Version ${version}`, exact: true }).click();
  await expect(h1(page)).toContainText(`Version ${version}`);
};
const actions = (page: Page) => page.getByLabel('Status actions', { exact: true });

test('a policy administrator sends a draft for review, and the history records it', async ({ page }) => {
  await openVersion(page, 'policy-admin', 4);
  await actions(page).getByRole('button', { name: 'Send for review' }).click();
  const dialog = page.getByRole('dialog', { name: 'Send for review: version 4' });
  await expect(dialog).toContainText('It cannot be edited while it is in review.');
  await dialog.getByRole('button', { name: 'Send for review' }).click();
  await expect(seen(page, 'Not in use. Waiting for the policy owner to approve or reject it.')).toBeVisible();
  await expect(page.getByLabel('History', { exact: true })).toContainText('Sent for review');
});

test('in review, the administrator is told that approving is for the policy owner', async ({ page }) => {
  await openVersion(page, 'policy-admin', 3);
  await expect(actions(page)).toContainText('Approve: only the policy owner can do this.');
  await expect(actions(page).getByRole('button', { name: 'Approve' })).toHaveCount(0);
  await expect(actions(page).getByRole('button', { name: 'Return to draft' })).toBeVisible();
});

test('the policy owner approves; the rulebook is ready but not in use', async ({ page }) => {
  await openVersion(page, 'policy-approver', 3);
  await actions(page).getByRole('button', { name: 'Approve' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Approve' }).click();
  await expect(seen(page, 'Built and ready, but not in use until someone activates it.')).toBeVisible();
  await expect(actions(page)).toContainText('Activate: only a policy administrator can do this.');
});

test('approving a rulebook with blocking problems is refused with the problems listed', async ({ page }) => {
  await openVersion(page, 'admin', 4);
  await actions(page).getByRole('button', { name: 'Send for review' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Send for review' }).click();
  await actions(page).getByRole('button', { name: 'Approve' }).click();
  const dialog = page.getByRole('dialog', { name: 'Approve: version 4' });
  await dialog.getByRole('button', { name: 'Approve' }).click();
  await expect(dialog).toContainText('Problems block this');
  await expect(dialog).toContainText('Not reviewed yet');
});

test('activation asks for a reason, names the version, and retires the one in use', async ({ page }) => {
  await openVersion(page, 'admin', 3);
  await actions(page).getByRole('button', { name: 'Approve' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Approve' }).click();
  await actions(page).getByRole('button', { name: 'Activate' }).click();
  const dialog = page.getByRole('dialog', { name: 'Activate: version 3' });
  await expect(dialog).toContainText('Version 3 becomes the rulebook every brief, caption and image is checked against.');
  await dialog.getByRole('button', { name: 'Activate' }).click();
  await expect(dialog).toContainText('Give a reason.');
  await dialog.getByRole('textbox', { name: /Reason/ }).fill('[SYNTHETIC] Test activation.');
  await dialog.getByRole('button', { name: 'Activate' }).click();
  await expect(seen(page, /^In use now\./)).toBeVisible();
  await page.getByRole('link', { name: 'Rulebooks', exact: true }).click();
  await expect(seen(page, 'Version 3 is the active rulebook.')).toBeVisible();
  await expect(row(page, 2)).toContainText('Retired');
});

test('a retired version that was active before can be rolled back to', async ({ page }) => {
  await openVersion(page, 'policy-admin', 1);
  await actions(page).getByRole('button', { name: 'Roll back to this version' }).click();
  const dialog = page.getByRole('dialog', { name: 'Roll back to this version: version 1' });
  await dialog.getByRole('textbox', { name: /Reason/ }).fill('[SYNTHETIC] Test rollback.');
  await dialog.getByRole('button', { name: 'Roll back to this version' }).click();
  await expect(seen(page, /^In use now\./)).toBeVisible();
  await expect(page.getByLabel('History', { exact: true })).toContainText('Rolled back to this version');
});

/* ---------- Steps 4 and 7: review items, links and coverage ---------- */

test('each rule shows what it is linked to, and the mandatory rules coverage', async ({ page }) => {
  await openVersion(page, 'policy-admin', 4);
  const rule1 = page.getByLabel('Rule SYN-REC-01', { exact: true });
  await expect(rule1).toContainText('Except when: Exception SYN-EX-01');
  await expect(rule1).toContainText('Comes from: Source clause SYN-CL-01');
  await expect(page.getByLabel('Rule SYN-REC-02', { exact: true })).toContainText('Needs this disclosure: Disclosure SYN-DIS-01');
  await expect(page.getByLabel('Mandatory rule coverage', { exact: true }))
    .toContainText('3 of 3 mandatory rules are reviewed, linked to a source, and have only reviewed links.');
});

test('the administrator reviews an AI-suggested rule and its wording, and the blocking problems go away', async ({ page }) => {
  await openVersion(page, 'policy-admin', 4);
  const rule4 = page.getByLabel('Rule SYN-REC-04', { exact: true });
  const problems = page.getByLabel('Problems that block approval or activation', { exact: true });
  await expect(rule4).toContainText('Not reviewed');
  await rule4.getByRole('button', { name: 'Approve rule SYN-REC-04' }).click();
  await expect(rule4.getByRole('button', { name: 'Approve rule SYN-REC-04' })).toHaveCount(0);
  await expect(problems).not.toContainText('rule:SYN-REC-04');
  // Its suggested wording is still unreviewed, so it still blocks.
  await expect(problems).toContainText('wording:SYN-REC-04');
  await rule4.getByRole('button', { name: /^Reject phrase not allowed of SYN-REC-04$/ }).click();
  await expect(rule4).toContainText('Rejected');
  await expect(problems).toContainText('The server found no blocking problems.');
  await expect(page.getByLabel('History', { exact: true })).toContainText('Reviewed an item');
});

test('the policy owner is not offered review of items that belong to the administrator', async ({ page }) => {
  await openVersion(page, 'policy-approver', 4);
  // The approver reads approved items only; proposals need policy:manage.
  await expect(page.getByLabel('Rule SYN-REC-04', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Approve / })).toHaveCount(0);
});

test('nothing can be reviewed in an active rulebook', async ({ page }) => {
  await openVersion(page, 'admin', 2);
  await expect(page.getByRole('button', { name: /^(Approve|Reject) / })).toHaveCount(0);
});

/* ---------- Step 5: editing a draft ---------- */

test('the administrator adds a rule to a draft; it starts as not reviewed and blocks approval', async ({ page }) => {
  await openVersion(page, 'policy-admin', 4);
  await page.getByRole('button', { name: 'Add a rule' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add a rule to version 4' });
  await dialog.getByRole('button', { name: 'Add rule' }).click();
  await expect(dialog).toContainText('Give the rule a title.');
  await dialog.getByRole('textbox', { name: /^Rule ID/ }).fill('SYN-REC-09');
  await dialog.getByRole('textbox', { name: /^Title/ }).fill('[SYNTHETIC] New test rule');
  await dialog.getByRole('textbox', { name: /^What the post must do/ }).fill('[SYNTHETIC]  Keep  these  spaces.');
  await dialog.getByRole('textbox', { name: /^The rule as it reads in the policy/ }).fill('[SYNTHETIC] Source text.');
  await dialog.getByRole('button', { name: 'Add rule' }).click();
  const rule = page.getByLabel('Rule SYN-REC-09', { exact: true });
  await expect(rule).toContainText('Not reviewed');
  await expect(rule).toContainText('[SYNTHETIC]  Keep  these  spaces.');
  await expect(page.getByLabel('Problems that block approval or activation', { exact: true })).toContainText('rule:SYN-REC-09');
});

test('editing a rule sends it back to review, and wording can be added', async ({ page }) => {
  await openVersion(page, 'policy-admin', 4);
  await page.getByRole('button', { name: 'Edit SYN-REC-01' }).click();
  const edit = page.getByRole('dialog', { name: 'Edit SYN-REC-01' });
  await edit.getByRole('textbox', { name: /^Title/ }).fill('[SYNTHETIC] Research, not treatment (edited)');
  await edit.getByRole('button', { name: 'Save' }).click();
  const rule = page.getByLabel('Rule SYN-REC-01', { exact: true });
  await expect(rule).toContainText('(edited)');
  await expect(rule).toContainText('Not reviewed');

  await page.getByRole('button', { name: 'Add wording to SYN-REC-01' }).click();
  const add = page.getByRole('dialog', { name: 'Add wording to SYN-REC-01' });
  await add.getByRole('textbox', { name: /^Wording/ }).fill('[SYNTHETIC] Exact test words.');
  await add.getByRole('button', { name: 'Add wording' }).click();
  await expect(rule).toContainText('[SYNTHETIC] Exact test words.');
});

test('an active rulebook has no edit buttons; changes start a new draft from it', async ({ page }) => {
  await openVersion(page, 'policy-admin', 2);
  await expect(page.getByRole('button', { name: 'Add a rule' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Edit / })).toHaveCount(0);
  await page.getByRole('button', { name: 'New draft from version 2' }).click();
  await expect(h1(page)).toContainText('Version 5');
  await expect(seen(page, 'Not in use. A draft can be edited, then sent for review.')).toBeVisible();
  await expect(page.getByLabel('Rule SYN-REC-02', { exact: true })).toContainText('[SYNTHETIC] This is a research study. Taking part is voluntary.');
});

test('the policy owner gets no edit buttons on a draft', async ({ page }) => {
  await openVersion(page, 'policy-approver', 4);
  await expect(page.getByRole('button', { name: 'Add a rule' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^New draft/ })).toHaveCount(0);
});

/* ---------- Step 6: policy files ---------- */

test('a policy file shows the clauses read from it, with section and page', async ({ page }) => {
  await signInAt(page, '/marketing/rules/rulebooks', 'policy-admin');
  await page.getByRole('link', { name: 'Policy files' }).click();
  await expect(h1(page)).toHaveText('Policy files');
  await page.getByRole('link', { name: '[SYNTHETIC] Recruitment advertising guidance (simulation)' }).click();
  const clauses = page.getByLabel('Clauses', { exact: true });
  await expect(clauses).toContainText('Clause 2.4');
  await expect(clauses).toContainText('Exceptions · page 2');
  await expect(clauses).toContainText('[SYNTHETIC] Posts for healthcare professionals may name the study phase.');
});

test('uploading a policy file runs the steps, then the clauses are read; no rulebook changes', async ({ page }) => {
  await signInAt(page, '/marketing/rules/sources', 'policy-admin');
  const card = page.getByLabel('Upload a policy file', { exact: true });
  await card.getByRole('button', { name: 'Upload' }).click();
  await expect(card).toContainText('Choose a file.');
  await card.locator('input[type="file"]').setInputFiles({ name: 'synthetic-guidance.txt', mimeType: 'text/plain', buffer: Buffer.from('[SYNTHETIC] test policy text') });
  await card.getByRole('button', { name: 'Upload' }).click();
  await expect(card).toContainText('Give the file a title.');
  await card.getByRole('textbox', { name: /^Title/ }).fill('[SYNTHETIC] Uploaded test guidance');
  await card.getByRole('button', { name: 'Upload' }).click();
  await expect(h1(page)).toHaveText('[SYNTHETIC] Uploaded test guidance');
  await expect(page.getByLabel('Clauses', { exact: true })).toContainText('[SYNTHETIC] Placeholder clause 1.1 read from');
});

test('a file that is not PDF, text or Markdown is refused before sending', async ({ page }) => {
  await signInAt(page, '/marketing/rules/sources', 'policy-admin');
  const card = page.getByLabel('Upload a policy file', { exact: true });
  await card.locator('input[type="file"]').setInputFiles({ name: 'photo.png', mimeType: 'image/png', buffer: Buffer.from('x') });
  await card.getByRole('textbox', { name: /^Title/ }).fill('[SYNTHETIC] Wrong type');
  await card.getByRole('button', { name: 'Upload' }).click();
  await expect(card).toContainText(/PDF, a plain text file or a Markdown file|not accepted|type/);
});

test('the policy owner can read policy files but gets no upload form', async ({ page }) => {
  await signInAt(page, '/marketing/rules/sources', 'policy-approver');
  await expect(h1(page)).toHaveText('Policy files');
  await expect(page.getByLabel('Upload a policy file', { exact: true })).toHaveCount(0);
});
