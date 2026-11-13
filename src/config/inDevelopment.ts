/**
 * Built features that are not in the current delivery plan, checked against
 * the NRC Jira tickets on 11 Nov 2026. Each one shows the in-development
 * screen (pages/shared/ui InDevelopment) where it would appear; its own code
 * stays in place. Set an entry to false when the feature is planned.
 */
export const IN_DEVELOPMENT = {
  /** Role dashboards and recent activity on Home: in no ticket. */
  dashboards: true,
  /** Team page, inviting people and changing roles: in no ticket. */
  team: true,
  /**
   * The approvals queue and reviewer decisions (NRC-23 full scope): "Formal
   * approvals" are outside the 13 Nov demo, and the backend has no /approvals
   * endpoints yet.
   */
  approvals: true,
  /** Publications (NRC-24): outside the demo. */
  publications: true,
  /** Connected accounts (NRC-24): outside the demo. */
  accounts: true,
  /**
   * Adding, editing, activating and retiring rules (NRC-20): the demo is read-only.
   * Owner: Firoz (NRC-20). Set to false when the backend /rules write endpoints
   * (draft, edit, activate, retire; Dinesh) are merged. Undo then: the e2e test
   * 'rule editing controls stay visible but only open the in-development dialog'
   * and layout case 'rule-new-in-development' skip or go; 'a policy administrator
   * drafts a rule…' (workspace.spec.ts) runs again.
   */
  ruleEditing: true,
  /** Uploading and removing media (NRC-18): "user upload remains later". */
  mediaUpload: true,
  /** Video in the media library (NRC-18): "video remains later". */
  mediaVideo: true,
  /**
   * The list of drafts (`GET /creatives`): not in the backend's API or its
   * documentation (only POST /creatives exists; GET answers 405). While true
   * the app does not call it. Used by "Your drafts" on Create post and the
   * Validation start page.
   */
  draftList: true,
} as const;
