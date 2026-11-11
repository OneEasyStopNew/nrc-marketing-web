import type { MockCreative, MockValidationRun, MockWorkspace } from './types';

/**
 * In-memory state of the pretend authorization server and API, shared by the
 * simulation identity provider (auth/simulation.ts) and the fake API
 * (mocks/api.ts).
 *
 * Tokens live only as long as the page. Drafts are kept in sessionStorage so a
 * reload restores them, as the real API would; they are dummy data only.
 */
const DRAFTS_KEY = 'nrc.sim.creatives';
const RUNS_KEY = 'nrc.sim.validations';
const WORKSPACE_KEY = 'nrc.sim.workspace';

export const mockServer = {
  /** Issued access token → dummy user id. */
  tokens: new Map<string, string>(),
  /** False after "End session": the next refresh is refused. */
  refreshAllowed: true,
  /** Set by the simulation tools: the next draft write fails with a retryable 503. */
  failNextWrite: false,
  /** Set by the simulation tools: how the next validation run fails. */
  nextValidationFailure: null as null | 'timeout' | 'extraction',
  /** Create requests already handled: `${tenant}:${Idempotency-Key}` → payload and the draft it made. */
  idempotency: new Map<string, { payload: string; id: string }>(),

  issueToken(userId: string) {
    const token = `sim.${crypto.randomUUID()}`;
    this.tokens.set(token, userId);
    return token;
  },
  revokeToken(token: string | null) {
    if (token) this.tokens.delete(token);
  },
  userFor(token: string) {
    return this.tokens.get(token);
  },

  /** All stored drafts, seeded from data.ts on first use in this tab. */
  creatives(seed: MockCreative[]): Map<string, MockCreative> {
    if (!creatives) {
      let stored: MockCreative[] | null = null;
      try { stored = JSON.parse(sessionStorage.getItem(DRAFTS_KEY) ?? 'null'); } catch { /* start from the seed */ }
      creatives = new Map((stored ?? structuredClone(seed)).map((c) => [c.id, c]));
    }
    return creatives;
  },
  saveCreatives() {
    if (!creatives) return;
    try { sessionStorage.setItem(DRAFTS_KEY, JSON.stringify([...creatives.values()])); } catch { /* storage blocked */ }
  },

  /** Validation runs by id, seeded from data.ts; kept across reloads like drafts. */
  runs(seed: MockValidationRun[]): Map<string, MockValidationRun> {
    if (!runs) {
      let stored: MockValidationRun[] | null = null;
      try { stored = JSON.parse(sessionStorage.getItem(RUNS_KEY) ?? 'null'); } catch { /* start from the seed */ }
      runs = new Map((stored ?? structuredClone(seed)).map((r) => [r.final.validation_run_id, r]));
    }
    return runs;
  },
  saveRuns() {
    if (!runs) return;
    try { sessionStorage.setItem(RUNS_KEY, JSON.stringify([...runs.values()])); } catch { /* storage blocked */ }
  },
};

/** Media, rules, approvals, accounts, publications and team per tenant, seeded from data.ts. */
export function workspaceFor(tenantId: string, seed: Record<string, MockWorkspace>): MockWorkspace {
  if (!workspaces) {
    try { workspaces = JSON.parse(sessionStorage.getItem(WORKSPACE_KEY) ?? 'null'); } catch { /* start from the seed */ }
    workspaces ??= {};
  }
  workspaces[tenantId] ??= structuredClone(seed[tenantId] ?? { media: [], rules: [], approvals: [], accounts: [], publications: [], members: [], activity: [] });
  return workspaces[tenantId];
}
export function saveWorkspaces() {
  if (!workspaces) return;
  try { sessionStorage.setItem(WORKSPACE_KEY, JSON.stringify(workspaces)); } catch { /* storage blocked */ }
}

let workspaces: Record<string, MockWorkspace> | null = null;
let creatives: Map<string, MockCreative> | null = null;
let runs: Map<string, MockValidationRun> | null = null;
