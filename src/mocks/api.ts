import { API_PREFIX } from '@/config/env';
import { TENANT_HEADER } from '@/api/http';
import type { Capability, ContextWire, MeWire } from '@/api/session';
import { CAPTION_MAX, PROMPT_MAX, type Creative } from '@/api/creatives';
import type { DummyUser, MockAsset, MockCreative, MockData, MockJob, MockValidationRun } from './types';
import type { Job } from '@/api/jobs';
import type { ValidationRun as ValidationRunRead } from '@/api/validations';
import { evaluate } from './validator';
import { loadMockData, MOCK_DATA_PATH } from './load';
import { mockServer, saveWorkspaces, workspaceFor } from './server';
import type { MediaUpload, Member, PolicyRule, Publication, PublicationRequest, RuleDraft } from '@/api/workspace';

/**
 * Fake Marketing API for simulation mode, following the backend's published
 * contract (NRC-1 / NRC-2). It replaces `fetch` inside api/http.ts, so pages,
 * the Bearer header, 401 → refresh → retry and 403 handling all run exactly as
 * they will against the real API.
 *
 * Add an endpoint: add the data's type to MockData (types.ts), the data to the
 * local, git-ignored mocks/data.ts, then one entry to ROUTES. Answer with the
 * agreed error shape { code, message, request_id, details, retryable }.
 */

interface MockRequest {
  data: MockData;
  user: DummyUser;
  tenantId: string | null;
  ifMatch: string | null;
  idempotencyKey: string | null;
  params: Record<string, string>;
  query: URLSearchParams;
  body: unknown;
}
type Handler = (req: MockRequest) => Response | Promise<Response>;

/** "GET /creatives/:id" style keys; `:name` segments become params. */
const ROUTES: Record<string, Handler> = {
  'GET /me': ({ data, user }) => {
    const me: MeWire = {
      sub: user.user_id,
      username: user.id,
      memberships: Object.values(data.TENANTS)
        .filter((t) => user.grants[t.tenant_id])
        .map((t) => ({ tenant_id: t.tenant_id, tenant_name: t.name, ...user.grants[t.tenant_id] })),
    };
    return json(200, me);
  },

  'GET /context': ({ data, user, tenantId }) => {
    const tenant = Object.values(data.TENANTS).find((t) => t.tenant_id === tenantId);
    const grant = tenantId ? user.grants[tenantId] : undefined;
    if (!tenant || !grant) return problem(403, 'FORBIDDEN', 'This account cannot work in that organisation.');
    const ctx: ContextWire = {
      tenant_id: tenant.tenant_id, tenant_name: tenant.name, roles: grant.roles, capabilities: grant.capabilities,
      studies: data.STUDIES[tenant.tenant_id] ?? [],
      languages: data.LANGUAGES,
      post_formats: data.POST_FORMATS,
    };
    return json(200, ctx);
  },

  /* ---------- Creatives (NRC-2) ---------- */

  /** Not built in the backend yet; shape to confirm. */
  // Not in the backend contract yet (the real API answers 405). Kept so drafts
  // can be reopened locally; the UI shows "not available yet" on 405/501.
  'GET /creatives': (req) => {
    const denied = needCap(req, 'creative:read');
    if (denied) return denied;
    const list = [...store(req).values()]
      .filter((c) => c.tenant_id === req.tenantId)
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
      .map((c) => draftSummary(req, c));
    return json(200, list);
  },

  'GET /creatives/:id': (req) => {
    const denied = needCap(req, 'creative:read');
    if (denied) return denied;
    const c = find(req);
    return c ? versioned(req, 200, c) : problem(404, 'NOT_FOUND', 'This draft does not exist or is not available to you.');
  },

  'POST /creatives': (req) => {
    const denied = needCreate(req);
    if (denied) return denied;
    const key = req.idempotencyKey;
    if (!key || !/^[A-Za-z0-9_-]{8,128}$/.test(key)) {
      return problem(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Send an Idempotency-Key of 8–128 letters, digits, _ or -.');
    }
    const payload = JSON.stringify(req.body);
    const earlier = mockServer.idempotency.get(`${req.tenantId}:${key}`);
    if (earlier) {
      if (earlier.payload !== payload) return problem(409, 'IDEMPOTENCY_KEY_REUSED', 'This key was used for a different request.');
      const same = store(req).get(earlier.id);
      if (same) return versioned(req, 201, same);
    }

    const body = req.body as { study_id?: string; prompt?: string; caption?: string | null; language?: string; channel?: string; post_format?: string };
    const study = (req.data.STUDIES[req.tenantId ?? ''] ?? []).find((s) => s.study_id === body.study_id);
    if (!study) return fieldsProblem([{ loc: ['body', 'study_id'], msg: 'Choose a study you can work on.', type: 'value_error' }]);
    if (study.recruitment_status !== 'recruiting') return problem(409, 'STUDY_CLOSED', `${study.study_title} is closed. Choose a recruiting study.`);
    const errs = [
      ...checkSetup(req.data, body),
      ...checkText(body.prompt, body.caption, 'prompt'),
    ];
    if (errs.length) return fieldsProblem(errs);
    if (writeFails()) return problem(503, 'TEMPORARILY_UNAVAILABLE', 'The draft could not be saved. Try again.', true);

    const now = new Date().toISOString();
    const c: MockCreative = {
      tenant_id: req.tenantId!, id: `sim-cr-${crypto.randomUUID().slice(0, 8)}`, version: 1,
      study_id: study.study_id, study_snapshot_id: study.snapshot_id, study_snapshot_version: study.version,
      language: body.language as MockCreative['language'], channel: body.channel as MockCreative['channel'], post_format: body.post_format as MockCreative['post_format'],
      original_prompt: body.prompt!, current_prompt: body.prompt!, caption: body.caption ?? null,
      created_by: req.user.user_id, asset_id: null, created_at: now, updated_at: now,
      validation_runs: [],
    };
    store(req).set(c.id, c);
    mockServer.idempotency.set(`${req.tenantId}:${key}`, { payload, id: c.id });
    mockServer.saveCreatives();
    return versioned(req, 201, c, { Location: `${API_PREFIX}/creatives/${c.id}` });
  },

  'PATCH /creatives/:id': (req) => {
    const denied = needCreate(req);
    if (denied) return denied;
    const c = find(req);
    if (!c) return problem(404, 'NOT_FOUND', 'This draft does not exist or is not available to you.');
    const study = (req.data.STUDIES[c.tenant_id] ?? []).find((s) => s.study_id === c.study_id);
    if (study?.recruitment_status !== 'recruiting') return problem(409, 'STUDY_CLOSED', 'The study is closed. This draft is read-only history.');
    if (!req.ifMatch) return problem(428, 'PRECONDITION_REQUIRED', 'Send the version you edited (If-Match).');
    if (req.ifMatch !== etagOf(c)) {
      return problem(412, 'VERSION_CONFLICT', 'Someone saved a newer version of this draft.', false, { current_version: c.version });
    }
    const body = req.body as { current_prompt?: string; caption?: string | null };
    const prompt = body.current_prompt ?? c.current_prompt;
    const caption = 'caption' in body ? body.caption ?? null : c.caption;
    const errs = checkText(prompt, caption, 'current_prompt');
    if (errs.length) return fieldsProblem(errs);
    if (writeFails()) return problem(503, 'TEMPORARILY_UNAVAILABLE', 'The draft could not be saved. Try again.', true);
    if (prompt !== c.current_prompt || caption !== c.caption) applyEdit(c, prompt, caption);
    return versioned(req, 200, c);
  },

  'GET /creatives/:id/versions': (req) => {
    const denied = needCap(req, 'creative:read');
    if (denied) return denied;
    const c = find(req);
    if (!c) return problem(404, 'NOT_FOUND', 'This draft does not exist or is not available to you.');
    const all = [versionOf(c), ...[...(c.history ?? [])].reverse()];
    const cursor = req.query.get('cursor');
    const limit = Math.max(1, Math.min(100, Number(req.query.get('limit') ?? 20)));
    const older = cursor ? all.filter((v) => v.version < Number(cursor)) : all;
    const items = older.slice(0, limit);
    return json(200, { items, next_cursor: older.length > limit ? items[items.length - 1].version : null });
  },

  /* ---------- Validation (NRC-7 / NRC-19) ---------- */

  'POST /validations': (req) => {
    const denied = needCap(req, 'validation:run');
    if (denied) return denied;
    const key = req.idempotencyKey;
    if (!key || !/^[A-Za-z0-9_-]{8,128}$/.test(key)) {
      return fieldsProblem([{ loc: ['header', 'Idempotency-Key'], msg: 'Send an Idempotency-Key of 8 to 128 letters, digits, _ or -.', type: 'missing' }]);
    }
    const body = req.body as { creative_id?: string; creative_version?: number; input_kind?: string; asset_id?: string | null };
    const payload = JSON.stringify(body);
    const earlier = mockServer.idempotency.get(`${req.tenantId}:val:${key}`);
    if (earlier) {
      if (earlier.payload !== payload) return problem(409, 'IDEMPOTENCY_KEY_REUSED', 'This Idempotency-Key was already used with a different request.');
      const prior = mockServer.runs(req.data.VALIDATION_RUNS).get(earlier.id)!;
      return json(202, { job_id: prior.final.job_id, validation_run_id: prior.final.validation_run_id, state: 'QUEUED' });
    }
    const c = store(req).get(body.creative_id ?? '');
    if (!c || c.tenant_id !== req.tenantId) return problem(404, 'NOT_FOUND', 'This draft does not exist or is not available to you.');
    if (body.input_kind === 'image') return problem(501, 'NOT_IMPLEMENTED', 'Image validation is not available yet.');
    if (body.input_kind !== 'brief' && body.input_kind !== 'text') {
      return fieldsProblem([{ loc: ['body', 'input_kind'], msg: "Input should be 'brief', 'text' or 'image'", type: 'enum' }]);
    }
    if (body.creative_version !== c.version) {
      return problem(409, 'VERSION_CONFLICT', 'The creative changed since you loaded it. Reload and validate the latest version.', false, { current_version: c.version });
    }
    const study = (req.data.STUDIES[c.tenant_id] ?? []).find((st) => st.study_id === c.study_id);
    if (study?.recruitment_status !== 'recruiting') return problem(409, 'STUDY_CLOSED', 'The study is closed.');

    const inputKind = body.input_kind;
    const text = inputKind === 'brief' ? c.current_prompt : c.caption ?? '';
    const failure = mockServer.nextValidationFailure;
    mockServer.nextValidationFailure = null;
    const id = `sim-run-${crypto.randomUUID().slice(0, 8)}`;
    const result = failure
      ? {
          outcome: null, gates: [], rule_results: [], findings: [],
          coverage_gaps: [{
            rule_id: null,
            reason: failure === 'timeout'
              ? 'The checking service did not answer in time (simulation). Nothing was assessed.'
              : 'The text could not be read for checking (simulation). Nothing was assessed.',
          }],
        }
      : evaluate(text, req.data.VALIDATION_RULES);
    const run: MockValidationRun = {
      tenant_id: c.tenant_id, creative_id: c.id, started_ms: Date.now(),
      final: {
        validation_run_id: id, job_id: `sim-job-${id.slice(8)}`, input_kind: inputKind,
        creative_version: c.version, state: failure ? 'FAILED' : 'SUCCEEDED', is_current: true,
        evaluated_at: null, input_hash: `sim-${text.length}`, asset_id: null,
        study_snapshot_version: c.study_snapshot_version, policy_bundle_version: req.data.POLICY_BUNDLE_VERSION,
        ...result,
      },
    };
    mockServer.runs(req.data.VALIDATION_RUNS).set(id, run);
    mockServer.saveRuns();
    mockServer.idempotency.set(`${req.tenantId}:val:${key}`, { payload, id });
    return json(202, { job_id: run.final.job_id, validation_run_id: id, state: 'QUEUED' });
  },

  'GET /validations/:id': (req) => {
    const denied = needCap(req, 'creative:read');
    if (denied) return denied;
    const run = mockServer.runs(req.data.VALIDATION_RUNS).get(req.params.id);
    const c = run && run.tenant_id === req.tenantId ? store(req).get(run.creative_id) : undefined;
    if (!run || !c) return problem(404, 'NOT_FOUND', 'This validation run does not exist or is not available to you.');
    return json(200, readRun(run, c));
  },

  'POST /__sim/fail-next-validation': (req) => {
    const mode = (req.body as { mode?: string } | undefined)?.mode;
    mockServer.nextValidationFailure = mode === 'extraction' ? 'extraction' : 'timeout';
    return json(200, { ok: true });
  },

  /* ---------- Generation jobs (NRC-6 / NRC-10 / NRC-21) ---------- */

  'POST /creative-jobs': (req) => {
    const denied = needCap(req, 'generation:run');
    if (denied) return denied;
    const key = req.idempotencyKey;
    if (!key || !/^[A-Za-z0-9_-]{8,128}$/.test(key)) {
      return fieldsProblem([{ loc: ['header', 'Idempotency-Key'], msg: 'Send an Idempotency-Key of 8 to 128 letters, digits, _ or -.', type: 'missing' }]);
    }
    const body = req.body as { creative_id?: string; creative_version?: number; kind?: string };
    const payload = JSON.stringify(body);
    const earlier = mockServer.idempotency.get(`${req.tenantId}:job:${key}`);
    if (earlier) {
      // Same command again (double click, lost response): the job it already made, never a second one.
      if (earlier.payload !== payload) return problem(409, 'IDEMPOTENCY_KEY_REUSED', 'This Idempotency-Key was already used with a different request.');
      const prior = mockServer.jobs().get(earlier.id)!;
      return json(202, { job_id: prior.final.job_id, state: readJob(prior).state }, { Location: `${API_PREFIX}/jobs/${prior.final.job_id}` });
    }
    if (body.kind !== 'image_generation') return fieldsProblem([{ loc: ['body', 'kind'], msg: "Input should be 'image_generation'", type: 'enum' }]);
    const c = store(req).get(body.creative_id ?? '');
    if (!c || c.tenant_id !== req.tenantId) return problem(404, 'NOT_FOUND', 'This draft does not exist or is not available to you.');
    if (body.creative_version !== c.version) {
      return problem(412, 'VERSION_CONFLICT', 'The creative changed since you loaded it.', false, { current_version: c.version });
    }
    const study = (req.data.STUDIES[c.tenant_id] ?? []).find((st) => st.study_id === c.study_id);
    if (study?.recruitment_status !== 'recruiting') {
      return problem(409, 'GENERATION_NOT_ELIGIBLE', 'This draft cannot be generated.', false, { reason: 'STUDY_CLOSED' });
    }
    // The validation gate (NRC-7): only a version whose current run passed.
    const latest = runsFor(req, c)[0];
    const run = latest ? readRun(latest, c) : null;
    if (!run || !run.is_current || run.state !== 'SUCCEEDED' || run.outcome !== 'PASS') {
      return problem(409, 'VALIDATION_NOT_PASSED', 'This version has not passed validation.', false, { validation_run_id: run?.validation_run_id ?? null });
    }
    const sim = mockServer.nextGeneration;
    mockServer.nextGeneration = null;
    if (sim === 'limit') {
      return problem(429, 'GENERATION_LIMIT_REACHED', 'Your organisation has reached its image limit for today.', false, { reason: 'CREDIT_CEILING' });
    }
    const active = [...mockServer.jobs().values()].filter((j) => j.tenant_id === req.tenantId && !['SUCCEEDED', 'FAILED', 'CANCELLED'].includes(readJob(j).state));
    if (active.length >= 2) return problem(429, 'GENERATION_LIMIT_REACHED', 'Too many images are being made at once.', true, { reason: 'ACTIVE_JOB_LIMIT' });

    const id = `sim-gen-${crypto.randomUUID().slice(0, 8)}`;
    const outcome: MockJob['outcome'] = sim === 'rejected' ? 'rejected' : sim === 'unknown' ? 'unknown' : 'image';
    const now = new Date().toISOString();
    const assetId = `sim-img-${id.slice(8)}`;
    const job: MockJob = {
      tenant_id: c.tenant_id, started_ms: Date.now(), outcome,
      final: {
        job_id: id, kind: 'image_generation', creative_id: c.id, creative_version: c.version,
        state: outcome === 'image' ? 'SUCCEEDED' : outcome === 'rejected' ? 'FAILED' : 'UNKNOWN',
        stage: outcome === 'image' ? 'stored' : outcome === 'unknown' ? 'reconcile' : null,
        provider_request_id: `sim-request-${id.slice(8)}`,
        failure_code: outcome === 'rejected' ? 'content_rejected' : null,
        failure_message: null,
        result_asset_id: outcome === 'image' ? assetId : null,
        created_at: now, updated_at: now, completed_at: null,
      },
      asset: outcome === 'image' ? {
        tenant_id: c.tenant_id, asset_id: assetId, creative_id: c.id, origin: 'generated', mime_type: 'image/png',
        width_px: 1080, height_px: 1080, size_bytes: 0, checksum_sha256: fakeChecksum(),
        provider: 'simulation', model: 'simulation', created_at: now,
      } : null,
    };
    mockServer.jobs().set(id, job);
    mockServer.saveJobs();
    mockServer.idempotency.set(`${req.tenantId}:job:${key}`, { payload, id });
    // The job exists, but its answer never reaches the browser (like a dropped connection).
    if (sim === 'lost') throw new TypeError('Failed to fetch (simulated lost response)');
    return json(202, { job_id: id, state: 'QUEUED' }, { Location: `${API_PREFIX}/jobs/${id}` });
  },

  'GET /jobs/:id': (req) => {
    const denied = needCap(req, 'creative:read');
    if (denied) return denied;
    const job = mockServer.jobs().get(req.params.id);
    if (!job || job.tenant_id !== req.tenantId) return problem(404, 'NOT_FOUND', 'This job does not exist or is not available to you.');
    return json(200, readJob(job));
  },

  'POST /__sim/next-generation/:mode': (req) => {
    const mode = req.params.mode;
    mockServer.nextGeneration = mode === 'rejected' || mode === 'unknown' || mode === 'limit' || mode === 'lost' ? mode : null;
    return json(200, { ok: true });
  },

  /* ---------- Images and export (NRC-23) ---------- */

  'GET /assets/:id': (req) => {
    const denied = needCap(req, 'creative:read');
    if (denied) return denied;
    const a = req.data.ASSETS.find((x) => x.asset_id === req.params.id && x.tenant_id === req.tenantId) ?? generatedAsset(req.params.id, req.tenantId);
    if (!a) return problem(404, 'NOT_FOUND', 'This image does not exist or is not available to you.');
    return json(200, assetRead(a));
  },

  'GET /creatives/:id/export': (req) => {
    const denied = needCap(req, 'creative:read');
    if (denied) return denied;
    const c = find(req);
    if (!c) return problem(404, 'NOT_FOUND', 'This draft does not exist or is not available to you.');
    const a = c.asset_id ? req.data.ASSETS.find((x) => x.asset_id === c.asset_id && x.tenant_id === c.tenant_id) : undefined;
    if (!a) {
      return fieldsProblem([{ loc: ['path', 'creative_id'], msg: 'The draft has no image yet. Generate the image first.', type: 'value_error' }]);
    }
    const latest = runsFor(req, c)[0];
    const full = latest ? readRun(latest, c) : null;
    return json(200, {
      status: 'DRAFT', creative_id: c.id, creative_version: c.version, caption: c.caption, image: assetRead(a),
      study_snapshot_version: c.study_snapshot_version,
      policy_bundle_version: full?.policy_bundle_version ?? null,
      latest_validation: full ? summaryOf(full) : null,
      exported_at: new Date().toISOString(),
    });
  },

  /* ---------- Workspace sections (proposed contracts, src/api/workspace.ts) ---------- */

  'GET /activity': (req) => {
    const denied = needCap(req, 'creative:read');
    return denied ?? json(200, ws(req).activity);
  },

  'GET /media': (req) => {
    const denied = needCap(req, 'creative:read');
    if (denied) return denied;
    return json(200, ws(req).media.map((m) => ({ ...m, preview_url: m.kind === 'image' ? placeholderImage(m.width_px, m.height_px, m.name.replace(/\.[a-z0-9]+$/i, '')) : null })));
  },

  'POST /media': (req) => {
    const denied = needCap(req, 'creative:write');
    if (denied) return denied;
    const b = req.body as Partial<MediaUpload>;
    const errs: FieldError[] = [];
    if (!b.name?.trim()) errs.push({ loc: ['body', 'name'], msg: 'Choose a file to upload.', type: 'missing' });
    if (!b.source?.trim()) errs.push({ loc: ['body', 'source'], msg: 'Say where the file comes from.', type: 'missing' });
    if (!b.licence?.trim()) errs.push({ loc: ['body', 'licence'], msg: 'Say what licence covers it.', type: 'missing' });
    if ((b.size_bytes ?? 0) > 50_000_000) errs.push({ loc: ['body', 'size_bytes'], msg: 'Files must be 50 MB or smaller.', type: 'value_error' });
    if (errs.length) return fieldsProblem(errs);
    const blocked = !!b.people_shown && !b.consent_on_file;
    const asset = {
      asset_id: `sim-media-${crypto.randomUUID().slice(0, 6)}`, name: b.name!, kind: b.kind ?? 'image', origin: 'uploaded' as const,
      mime_type: b.mime_type ?? 'image/jpeg', width_px: 1080, height_px: 1080, size_bytes: b.size_bytes ?? 0, duration_s: null,
      created_at: new Date().toISOString(), created_by: req.user.user_id,
      status: blocked ? 'BLOCKED' as const : 'PENDING_CHECK' as const,
      status_reason: blocked ? 'A person is shown and no signed release is on file.' : 'Waiting for the media check to finish.',
      rights: { source: b.source!, licence: b.licence!, expires_at: b.expires_at ?? null, people_shown: !!b.people_shown, consent_on_file: !!b.consent_on_file },
      tags: b.tags ?? [], used_in: 0,
    };
    ws(req).media.unshift(asset);
    logActivity(req, 'uploaded', asset.name, '/marketing/media');
    return json(201, { ...asset, preview_url: placeholderImage(1080, 1080, asset.name) });
  },

  'DELETE /media/:id': (req) => {
    const denied = needCap(req, 'creative:write');
    if (denied) return denied;
    const list = ws(req).media;
    const i = list.findIndex((m) => m.asset_id === req.params.id);
    if (i < 0) return problem(404, 'NOT_FOUND', 'This file does not exist or is not available to you.');
    if (list[i].used_in > 0) return problem(409, 'IN_USE', 'This file is used in a draft. Remove it from the draft first.');
    list.splice(i, 1);
    saveWorkspaces();
    return new Response(null, { status: 204 });
  },

  'GET /rules': (req) => {
    const denied = needCap(req, 'creative:read');
    return denied ?? json(200, ws(req).rules);
  },

  'POST /rules': (req) => {
    const denied = needCap(req, 'policy:manage');
    if (denied) return denied;
    const b = req.body as Partial<RuleDraft>;
    const errs = ruleErrors(b);
    if (errs.length) return fieldsProblem(errs);
    const n = ws(req).rules.length + 1;
    const rule = {
      rule_id: `SIM-NEW-${n}`, version: 1, title: b.title!.trim(), description: b.description!.trim(), gate: b.gate!, severity: b.severity!,
      mandatory: !!b.mandatory, status: 'DRAFT' as const, applies_to: b.applies_to!, source: b.source!, suggested_correction: b.suggested_correction ?? null,
      updated_by: req.user.user_id, updated_at: new Date().toISOString(), fail_count_30d: 0, unable_count_30d: 0,
    };
    ws(req).rules.unshift(rule);
    logActivity(req, 'drafted rule', rule.rule_id, '/marketing/rules');
    return json(201, rule);
  },

  'PATCH /rules/:id': (req) => {
    const denied = needCap(req, 'policy:manage');
    if (denied) return denied;
    const rule = ws(req).rules.find((r) => r.rule_id === req.params.id);
    if (!rule) return problem(404, 'NOT_FOUND', 'This rule does not exist.');
    if (!req.ifMatch) return problem(428, 'PRECONDITION_REQUIRED', 'Send the version you edited (If-Match).');
    if (req.ifMatch !== `"${rule.version}"`) return problem(412, 'VERSION_CONFLICT', 'Someone changed this rule. Reload it.', false, { current_version: rule.version });
    const b = req.body as Partial<RuleDraft> & { status?: PolicyRule['status'] };
    if (rule.status === 'RETIRED') return problem(409, 'RULE_RETIRED', 'A retired rule cannot be changed. Draft a new rule instead.');
    if (b.status && b.status !== rule.status && !(rule.status === 'DRAFT' && b.status === 'ACTIVE') && !(rule.status === 'ACTIVE' && b.status === 'RETIRED')) {
      return problem(409, 'INVALID_TRANSITION', `A ${rule.status.toLowerCase()} rule cannot become ${b.status.toLowerCase()}.`);
    }
    const errs = ruleErrors({ ...rule, ...b });
    if (errs.length) return fieldsProblem(errs);
    Object.assign(rule, b, { version: rule.version + 1, updated_by: req.user.user_id, updated_at: new Date().toISOString() });
    logActivity(req, b.status === 'ACTIVE' ? 'activated rule' : b.status === 'RETIRED' ? 'retired rule' : 'edited rule', rule.rule_id, '/marketing/rules');
    return json(200, rule);
  },

  'GET /approvals': (req) => {
    const denied = needCap(req, 'creative:read');
    if (denied) return denied;
    return json(200, ws(req).approvals.map((a) => ({ ...a, is_own: a.submitted_by === req.user.user_id })));
  },

  'GET /approvals/:id': (req) => {
    const denied = needCap(req, 'creative:read');
    if (denied) return denied;
    const a = ws(req).approvals.find((x) => x.approval_id === req.params.id);
    return a ? json(200, { ...a, is_own: a.submitted_by === req.user.user_id }) : problem(404, 'NOT_FOUND', 'This review request does not exist or is not available to you.');
  },

  'POST /approvals/:id/decision': (req) => {
    const denied = needCap(req, 'approval:decide');
    if (denied) return denied;
    const a = ws(req).approvals.find((x) => x.approval_id === req.params.id);
    if (!a) return problem(404, 'NOT_FOUND', 'This review request does not exist or is not available to you.');
    const b = req.body as { decision?: string; reason?: string; creative_version?: number };
    if (a.submitted_by === req.user.user_id) return problem(403, 'SELF_APPROVAL', 'You cannot decide on your own submission.');
    if (a.state !== 'PENDING') return problem(409, 'NOT_PENDING', 'This request was already decided or is out of date.');
    if (b.creative_version !== a.creative_version) return problem(409, 'VERSION_CONFLICT', 'The draft changed. Reload before deciding.', false, { current_version: a.creative_version });
    if (!a.validation.is_current || a.validation.outcome === 'FAIL') return problem(409, 'NOT_ELIGIBLE', 'Validation for this version did not pass. It cannot be approved.');
    if (!['APPROVE', 'REQUEST_CHANGES', 'REJECT'].includes(b.decision ?? '')) return fieldsProblem([{ loc: ['body', 'decision'], msg: 'Choose a decision.', type: 'missing' }]);
    if (b.decision !== 'APPROVE' && !b.reason?.trim()) return fieldsProblem([{ loc: ['body', 'reason'], msg: 'Say what needs to change.', type: 'missing' }]);
    a.state = b.decision === 'APPROVE' ? 'APPROVED' : b.decision === 'REJECT' ? 'REJECTED' : 'CHANGES_REQUESTED';
    a.decided_by = req.user.user_id;
    a.decided_at = new Date().toISOString();
    a.reason = b.reason?.trim() || null;
    logActivity(req, a.state === 'APPROVED' ? 'approved' : a.state === 'REJECTED' ? 'rejected' : 'requested changes on', `${a.creative_id} v${a.creative_version}`, `/marketing/approvals/${a.approval_id}`);
    return json(200, { ...a, is_own: false });
  },

  'GET /accounts': (req) => {
    const denied = needCap(req, 'creative:read');
    return denied ?? json(200, ws(req).accounts);
  },

  'POST /accounts': (req) => {
    const denied = needCap(req, 'publication:manage');
    if (denied) return denied;
    const b = req.body as { channel?: 'facebook' | 'instagram'; name?: string };
    if (!b.name?.trim()) return fieldsProblem([{ loc: ['body', 'name'], msg: 'Name the page or profile.', type: 'missing' }]);
    const acc = {
      account_id: `sim-acc-${crypto.randomUUID().slice(0, 6)}`, channel: b.channel ?? 'facebook', name: `${b.name.trim()} (simulation)`,
      handle: b.name.trim().toLowerCase().replace(/\s+/g, '.'), state: 'TEST_ONLY' as const,
      state_reason: 'Connected in simulation. Only test users would see posts.', permissions: ['pages_manage_posts'],
      connected_by: req.user.user_id, connected_at: new Date().toISOString(), expires_at: new Date(Date.now() + 90 * 864e5).toISOString(),
      formats: b.channel === 'instagram' ? ['Feed image', 'Reel'] : ['Feed image', 'Feed video'],
    };
    ws(req).accounts.push(acc);
    logActivity(req, 'connected', acc.name, '/marketing/integrations');
    return json(201, acc);
  },

  'POST /accounts/:id/reconnect': (req) => {
    const denied = needCap(req, 'publication:manage');
    if (denied) return denied;
    const acc = ws(req).accounts.find((a) => a.account_id === req.params.id);
    if (!acc) return problem(404, 'NOT_FOUND', 'This account is not connected here.');
    Object.assign(acc, { state: 'CONNECTED', state_reason: null, permissions: acc.channel === 'instagram' ? ['instagram_content_publish'] : ['pages_manage_posts', 'pages_read_engagement'], connected_by: req.user.user_id, connected_at: new Date().toISOString(), expires_at: new Date(Date.now() + 90 * 864e5).toISOString(), formats: acc.channel === 'instagram' ? ['Feed image', 'Reel'] : ['Feed image', 'Feed video'] });
    logActivity(req, 'reconnected', acc.name, '/marketing/integrations');
    return json(200, acc);
  },

  'DELETE /accounts/:id': (req) => {
    const denied = needCap(req, 'publication:manage');
    if (denied) return denied;
    const list = ws(req).accounts;
    const i = list.findIndex((a) => a.account_id === req.params.id);
    if (i < 0) return problem(404, 'NOT_FOUND', 'This account is not connected here.');
    if (ws(req).publications.some((p) => p.state === 'SCHEDULED' && p.channels.some((c) => c.account_id === req.params.id))) {
      return problem(409, 'HAS_SCHEDULED', 'Posts are scheduled to this account. Cancel them first.');
    }
    logActivity(req, 'disconnected', list[i].name, '/marketing/integrations');
    list.splice(i, 1);
    saveWorkspaces();
    return new Response(null, { status: 204 });
  },

  'GET /publications': (req) => {
    const denied = needCap(req, 'creative:read');
    return denied ?? json(200, ws(req).publications);
  },

  'POST /publications': (req) => {
    const denied = needCap(req, 'publication:manage');
    if (denied) return denied;
    const b = req.body as Partial<PublicationRequest>;
    const key = `${req.tenantId}:pub:${req.idempotencyKey}`;
    const earlier = mockServer.idempotency.get(key);
    if (earlier) return json(201, ws(req).publications.find((p) => p.publication_id === earlier.id));
    const approval = ws(req).approvals.find((a) => a.creative_id === b.creative_id && a.creative_version === b.creative_version && a.state === 'APPROVED');
    if (!approval) return problem(409, 'NOT_APPROVED', 'Only an approved version can be scheduled. This version has no current approval.');
    const accounts = ws(req).accounts.filter((a) => b.account_ids?.includes(a.account_id));
    const errs: FieldError[] = [];
    if (!accounts.length) errs.push({ loc: ['body', 'account_ids'], msg: 'Choose at least one account.', type: 'missing' });
    const unusable = accounts.find((a) => a.state !== 'CONNECTED' && a.state !== 'TEST_ONLY');
    if (unusable) errs.push({ loc: ['body', 'account_ids'], msg: `${unusable.name} cannot publish: ${unusable.state_reason ?? 'reconnect it first.'}`, type: 'value_error' });
    if (b.publish_at && Date.parse(b.publish_at) < Date.now() - 60_000) errs.push({ loc: ['body', 'publish_at'], msg: 'Choose a time in the future.', type: 'value_error' });
    if (errs.length) return fieldsProblem(errs);
    const pub = {
      publication_id: `sim-pub-${crypto.randomUUID().slice(0, 6)}`, creative_id: b.creative_id!, creative_version: b.creative_version!,
      study_title: approval.study_title, caption: approval.caption, publish_at: b.publish_at ?? null, timezone: b.timezone ?? 'UTC',
      // Simulation never pretends a post went live: "now" stays queued.
      state: (b.publish_at ? 'SCHEDULED' : 'QUEUED') as Publication['state'],
      state_reason: b.publish_at ? null : 'Queued in simulation. Nothing is sent to Facebook or Instagram.',
      created_by: req.user.user_id, created_at: new Date().toISOString(),
      channels: accounts.map((a) => ({ account_id: a.account_id, channel: a.channel, account_name: a.name, state: (b.publish_at ? 'SCHEDULED' : 'QUEUED') as Publication['state'], permalink: null, error: null })),
    };
    ws(req).publications.unshift(pub);
    mockServer.idempotency.set(key, { payload: JSON.stringify(b), id: pub.publication_id });
    logActivity(req, b.publish_at ? 'scheduled' : 'queued', `${pub.creative_id} v${pub.creative_version}`, '/marketing/publications');
    return json(201, pub);
  },

  'POST /publications/:id/cancel': (req) => {
    const denied = needCap(req, 'publication:manage');
    if (denied) return denied;
    const pub = ws(req).publications.find((p) => p.publication_id === req.params.id);
    if (!pub) return problem(404, 'NOT_FOUND', 'This publication does not exist.');
    if (pub.state !== 'SCHEDULED' && pub.state !== 'QUEUED') return problem(409, 'NOT_CANCELLABLE', 'Only a post that has not been sent can be cancelled.');
    pub.state = 'CANCELLED';
    pub.state_reason = 'Cancelled before sending.';
    pub.channels.forEach((c) => { c.state = 'CANCELLED'; });
    logActivity(req, 'cancelled', pub.publication_id, '/marketing/publications');
    return json(200, pub);
  },

  'GET /members': (req) => {
    const denied = needCap(req, 'membership:manage');
    return denied ?? json(200, ws(req).members);
  },

  'POST /members': (req) => {
    const denied = needCap(req, 'membership:manage');
    if (denied) return denied;
    const b = req.body as { name?: string; email?: string; roles?: Member['roles'] };
    const errs: FieldError[] = [];
    if (!b.name?.trim()) errs.push({ loc: ['body', 'name'], msg: 'Enter their name.', type: 'missing' });
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(b.email ?? '')) errs.push({ loc: ['body', 'email'], msg: 'Enter a work email address.', type: 'value_error' });
    else if (!/\.test$/.test(b.email!)) errs.push({ loc: ['body', 'email'], msg: 'In simulation, use an example.test address.', type: 'value_error' });
    if (!b.roles?.length) errs.push({ loc: ['body', 'roles'], msg: 'Give them at least one role.', type: 'missing' });
    if (ws(req).members.some((m) => m.email === b.email)) errs.push({ loc: ['body', 'email'], msg: 'This person is already a member.', type: 'value_error' });
    if (errs.length) return fieldsProblem(errs);
    const m: Member = { user_id: `sim-inv-${crypto.randomUUID().slice(0, 6)}`, name: b.name!.trim(), email: b.email!, roles: b.roles!, status: 'INVITED', mfa: false, last_active_at: null };
    ws(req).members.push(m);
    logActivity(req, 'invited', m.name, '/marketing/team');
    return json(201, m);
  },

  'PATCH /members/:id': (req) => {
    const denied = needCap(req, 'membership:manage');
    if (denied) return denied;
    const m = ws(req).members.find((x) => x.user_id === req.params.id);
    if (!m) return problem(404, 'NOT_FOUND', 'This person is not a member.');
    const b = req.body as { roles?: Member['roles'] };
    if (!b.roles?.length) return fieldsProblem([{ loc: ['body', 'roles'], msg: 'Keep at least one role.', type: 'missing' }]);
    if (m.user_id === req.user.user_id && !b.roles.includes('admin')) return problem(409, 'LAST_ADMIN', 'You cannot remove your own administrator role.');
    m.roles = b.roles;
    logActivity(req, 'changed roles of', m.name, '/marketing/team');
    return json(200, m);
  },

  /* Simulation tools, for testing failure paths by hand and in e2e. */

  'POST /__sim/creatives/:id/concurrent-edit': (req) => {
    const c = find(req);
    if (!c) return problem(404, 'NOT_FOUND', 'No such draft.');
    applyEdit(c, c.current_prompt, `${c.caption ?? ''} (edited by someone else)`.trim());
    return json(200, { version: c.version });
  },

  'POST /__sim/fail-next-save': () => {
    mockServer.failNextWrite = true;
    return json(200, { ok: true });
  },
};

/* ---------- Creatives helpers ---------- */

type FieldError = { loc: (string | number)[]; msg: string; type: string };

const store = (req: MockRequest) => mockServer.creatives(req.data.CREATIVES);
const find = (req: MockRequest) => {
  const c = store(req).get(req.params.id);
  return c && c.tenant_id === req.tenantId ? c : undefined;
};
const etagOf = (c: MockCreative) => `"${c.version}"`;
const codePoints = (s: string) => [...s].length;

function needCreate({ user, tenantId }: MockRequest) {
  const grant = tenantId ? user.grants[tenantId] : undefined;
  return grant?.capabilities.includes('creative:write')
    ? null
    : problem(403, 'FORBIDDEN', 'Your role cannot create or edit drafts here.');
}

function writeFails() {
  if (!mockServer.failNextWrite) return false;
  mockServer.failNextWrite = false;
  return true;
}

function checkSetup(data: MockData, b: { language?: string; channel?: string; post_format?: string }): FieldError[] {
  const errs: FieldError[] = [];
  if (!data.LANGUAGES.some((l) => l === b.language)) errs.push({ loc: ['body', 'language'], msg: 'Choose a supported language.', type: 'value_error' });
  if (!data.POST_FORMATS.some((f) => f.channel === b.channel && f.post_format === b.post_format)) {
    errs.push({ loc: ['body', 'post_format'], msg: 'Choose a supported post format.', type: 'value_error' });
  }
  return errs;
}

function checkText(prompt: string | undefined, caption: string | null | undefined, promptField: string): FieldError[] {
  const errs: FieldError[] = [];
  if (!prompt?.trim()) errs.push({ loc: ['body', promptField], msg: 'Describe the post you want.', type: 'missing' });
  else if (codePoints(prompt) > PROMPT_MAX) errs.push({ loc: ['body', promptField], msg: `Shorten the brief to ${PROMPT_MAX} characters.`, type: 'string_too_long' });
  if (caption && codePoints(caption) > CAPTION_MAX) errs.push({ loc: ['body', 'caption'], msg: `Shorten the caption to ${CAPTION_MAX} characters.`, type: 'string_too_long' });
  return errs;
}

const fieldsProblem = (fields: FieldError[]) => problem(422, 'VALIDATION_FAILED', 'Some fields need a fix.', false, { fields });

/** A material edit: new version. Earlier validation runs stop being current (see readRun). */
function applyEdit(c: MockCreative, prompt: string, caption: string | null) {
  c.history = [...(c.history ?? []), versionOf(c)];
  c.current_prompt = prompt;
  c.caption = caption;
  c.version += 1;
  c.updated_at = new Date().toISOString();
  mockServer.saveCreatives();
}

/** Strips the internal tenant_id and sends the ETag header. */
function versioned(req: MockRequest, status: number, c: MockCreative, headers: Record<string, string> = {}) {
  const { tenant_id: _tenant, history: _history, ...rest } = c;
  const creative: Creative = { ...rest, validation_runs: runsFor(req, c).map((r) => summaryOf(readRun(r, c))) };
  return json(status, creative, { ETag: etagOf(c), ...headers });
}

/* ---------- Validation helpers ---------- */

const QUEUED_MS = 700;
const RUNNING_MS = 2200;

const runsFor = (req: MockRequest, c: MockCreative) =>
  [...mockServer.runs(req.data.VALIDATION_RUNS).values()]
    .filter((r) => r.creative_id === c.id && r.tenant_id === c.tenant_id)
    .sort((a, b) => b.started_ms - a.started_ms);

/** The run as it reads now: queued, then running, then its final result. Not current once the draft moved on. */
function readRun(run: MockValidationRun, c: MockCreative): ValidationRunRead {
  const elapsed = Date.now() - run.started_ms;
  const is_current = run.final.creative_version === c.version;
  if (elapsed < RUNNING_MS) {
    return {
      ...run.final, state: elapsed < QUEUED_MS ? 'QUEUED' : 'RUNNING', outcome: null, is_current,
      evaluated_at: null, gates: [], rule_results: [], findings: [], coverage_gaps: [],
    };
  }
  return { ...run.final, is_current, evaluated_at: run.final.evaluated_at ?? new Date(run.started_ms + RUNNING_MS).toISOString() };
}

const summaryOf = (r: ValidationRunRead) => ({
  validation_run_id: r.validation_run_id, input_kind: r.input_kind, creative_version: r.creative_version,
  state: r.state, outcome: r.outcome, is_current: r.is_current, evaluated_at: r.evaluated_at,
});

const versionOf = (c: MockCreative) => ({
  version: c.version, current_prompt: c.current_prompt, caption: c.caption, study_snapshot_id: c.study_snapshot_id,
  language: c.language, channel: c.channel, post_format: c.post_format, created_by: c.created_by, created_at: c.updated_at,
});

function needCap({ user, tenantId }: MockRequest, cap: Capability) {
  const grant = tenantId ? user.grants[tenantId] : undefined;
  return grant?.capabilities.includes(cap) ? null : problem(403, 'FORBIDDEN', 'Your role does not allow this here.');
}

/* ---------- Generation helpers ---------- */

const JOB_QUEUED_MS = 800;
const JOB_SUBMIT_MS = 1600;
const JOB_PROVIDER_MS = 4000;
const JOB_STORE_MS = 5000;

/** The job as it reads now: queued, submitting, waiting on the provider, saving, then final. */
function readJob(j: MockJob): Job {
  const elapsed = Date.now() - j.started_ms;
  const at = (ms: number) => new Date(j.started_ms + ms).toISOString();
  const running = { ...j.final, failure_code: null, result_asset_id: null, completed_at: null };
  if (elapsed < JOB_QUEUED_MS) return { ...running, state: 'QUEUED', stage: null, provider_request_id: null, updated_at: j.final.created_at };
  if (elapsed < JOB_SUBMIT_MS) return { ...running, state: 'RUNNING', stage: 'submitting', provider_request_id: null, updated_at: at(JOB_QUEUED_MS) };
  if (j.outcome === 'unknown') return { ...j.final, updated_at: at(JOB_SUBMIT_MS) };
  if (elapsed < JOB_PROVIDER_MS) return { ...running, state: 'WAITING_PROVIDER', stage: 'waiting_provider', updated_at: at(JOB_SUBMIT_MS) };
  if (j.outcome === 'rejected') return { ...j.final, updated_at: at(JOB_PROVIDER_MS), completed_at: at(JOB_PROVIDER_MS) };
  if (elapsed < JOB_STORE_MS) return { ...running, state: 'RUNNING', stage: 'fetching_output', updated_at: at(JOB_PROVIDER_MS) };
  return { ...j.final, updated_at: at(JOB_STORE_MS), completed_at: at(JOB_STORE_MS) };
}

/** An image a simulated job saved, once that job has finished. */
function generatedAsset(assetId: string, tenantId: string | null): MockAsset | undefined {
  const job = [...mockServer.jobs().values()].find((j) => j.asset?.asset_id === assetId && j.tenant_id === tenantId);
  return job && readJob(job).state === 'SUCCEEDED' ? job.asset ?? undefined : undefined;
}

const fakeChecksum = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, '0')).join('');

/* ---------- Image helpers ---------- */

/** The asset with a short-lived link: a labelled placeholder picture, clearly not a real generated image. */
function assetRead(a: MockAsset) {
  const { tenant_id: _tenant, ...asset } = a;
  return {
    ...asset,
    download_url: placeholderImage(a.width_px, a.height_px),
    download_url_expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
  };
}

function placeholderImage(w: number, h: number, caption = 'Simulation image') {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`
    + '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#dbe7f3"/><stop offset="1" stop-color="#eef2e6"/></linearGradient></defs>'
    + `<rect width="${w}" height="${h}" fill="url(#g)"/>`
    + `<rect x="${w * 0.12}" y="${h * 0.55}" width="${w * 0.76}" height="${h * 0.22}" rx="24" fill="#ffffff" opacity="0.8"/>`
    + `<text x="50%" y="${h * 0.64}" text-anchor="middle" font-family="sans-serif" font-size="${w * 0.045}" fill="#334155">${caption.replace(/[<&>]/g, '')}</text>`
    + `<text x="50%" y="${h * 0.71}" text-anchor="middle" font-family="sans-serif" font-size="${w * 0.03}" fill="#64748b">Not a real generated image</text>`
    + '</svg>';
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/* ---------- Workspace helpers ---------- */

const ws = (req: MockRequest) => workspaceFor(req.tenantId ?? '', req.data.WORKSPACE);

function logActivity(req: MockRequest, action: string, target: string, href: string | null) {
  ws(req).activity.unshift({ id: crypto.randomUUID(), at: new Date().toISOString(), actor: req.user.display_name, action, target, href });
  saveWorkspaces();
}

function ruleErrors(b: Partial<RuleDraft>): FieldError[] {
  const errs: FieldError[] = [];
  if (!b.title?.trim()) errs.push({ loc: ['body', 'title'], msg: 'Give the rule a short title.', type: 'missing' });
  if (!b.description?.trim()) errs.push({ loc: ['body', 'description'], msg: 'Say what the rule checks.', type: 'missing' });
  if (!b.gate) errs.push({ loc: ['body', 'gate'], msg: 'Choose the check area.', type: 'missing' });
  if (!b.severity) errs.push({ loc: ['body', 'severity'], msg: 'Choose a severity.', type: 'missing' });
  if (!b.applies_to?.length) errs.push({ loc: ['body', 'applies_to'], msg: 'Choose what the rule applies to.', type: 'missing' });
  if (!b.source?.clause?.trim()) errs.push({ loc: ['body', 'source', 'clause'], msg: 'Cite the clause this rule comes from.', type: 'missing' });
  return errs;
}

/** Status of a draft for the drafts list: its latest validation and review. */
function draftSummary(req: MockRequest, c: MockCreative) {
  const latest = runsFor(req, c)[0];
  const run = latest ? readRun(latest, c) : null;
  const validation = !run ? 'NOT_RUN'
    : ['QUEUED', 'RUNNING', 'WAITING_PROVIDER'].includes(run.state) ? 'RUNNING'
      : !run.is_current ? 'STALE'
        : run.outcome ?? 'NOT_RUN';
  const approval = ws(req).approvals.filter((a) => a.creative_id === c.id).sort((a, b) => b.submitted_at.localeCompare(a.submitted_at))[0];
  const review = !approval ? 'NOT_SUBMITTED' : approval.creative_version !== c.version && approval.state !== 'CHANGES_REQUESTED' ? 'STALE' : approval.state;
  const study = (req.data.STUDIES[c.tenant_id] ?? []).find((s) => s.study_id === c.study_id);
  return {
    id: c.id, study_id: c.study_id, study_title: study?.study_title ?? 'Unknown study', version: c.version,
    prompt_preview: [...c.current_prompt].slice(0, 80).join(''), updated_at: c.updated_at, created_by: c.created_by,
    validation, review, has_image: !!c.asset_id,
  };
}

/* ---------- Plumbing ---------- */

const LATENCY_MS = 150;

export const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

export const problem = (status: number, code: string, message: string, retryable = false, details?: unknown) =>
  json(status, { code, message, request_id: `sim-${crypto.randomUUID().slice(0, 8)}`, retryable, details });

function match(method: string, path: string): { handler: Handler; params: Record<string, string> } | null {
  const parts = path.split('/').filter(Boolean);
  for (const [key, handler] of Object.entries(ROUTES)) {
    const [m, pattern] = key.split(' ');
    if (m !== method) continue;
    const segs = pattern.split('/').filter(Boolean);
    if (segs.length !== parts.length) continue;
    const params: Record<string, string> = {};
    if (segs.every((s, i) => (s.startsWith(':') ? ((params[s.slice(1)] = decodeURIComponent(parts[i])), true) : s === parts[i]))) {
      return { handler, params };
    }
  }
  return null;
}

export const mockFetch: typeof fetch = async (input, init) => {
  await new Promise((r) => setTimeout(r, LATENCY_MS));
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, window.location.origin);
  const path = url.pathname.slice(url.pathname.indexOf(API_PREFIX) + API_PREFIX.length) || '/';
  const method = (init?.method ?? 'GET').toUpperCase();
  const headers = new Headers(init?.headers);

  const token = headers.get('Authorization')?.replace(/^Bearer /, '') ?? '';
  const data = await loadMockData();
  if (!data) return problem(503, 'MOCK_DATA_MISSING', `Simulation needs local dummy data in ${MOCK_DATA_PATH}.`);
  const user = data.USERS.find((u) => u.id === mockServer.userFor(token));
  if (!user) return problem(401, 'UNAUTHENTICATED', 'Sign in again.');

  const route = match(method, path);
  // Like the real API for endpoints in the spec that are not built yet.
  if (!route) return problem(501, 'NOT_IMPLEMENTED', `${method} ${path} is not available yet.`);

  return route.handler({
    data,
    user,
    tenantId: headers.get(TENANT_HEADER),
    ifMatch: headers.get('If-Match'),
    idempotencyKey: headers.get('Idempotency-Key'),
    params: route.params,
    query: url.searchParams,
    body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
  });
};
