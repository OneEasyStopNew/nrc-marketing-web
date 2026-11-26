import { API_PREFIX } from '@/config/env';
import { TENANT_HEADER } from '@/api/http';
import type { Capability, ContextWire, MeWire } from '@/api/session';
import { CAPTION_MAX, PROMPT_MAX, type Creative } from '@/api/creatives';
import type { DummyUser, MockAiFix, MockAsset, MockClientCheck, MockClientMedia, MockClientPost, MockCreative, MockData, MockJob, MockValidationRun } from './types';
import type { AiFix, ClientCheck } from '@/api/clientPosts';
import { fromMicros, sumMoney, toMicros } from '@/api/usage';
import type { Schemas } from '@/api/schemas.gen';
import type { ValidationContext, ValidationRun as ValidationRunRead } from '@/api/validations';
import { evaluate } from './validator';
import { loadMockData, MOCK_DATA_PATH } from './load';
import { mockServer, saveWorkspaces, workspaceFor } from './server';
import type { MediaUpload, Member, PolicyRule, Publication, PublicationRequest, RuleDraft, SocialChannel } from '@/api/workspace';

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
// Visibly fake: the real API sends a UUID, and the client checks for one (NRC-20).
const SIM_POLICY_BUNDLE_ID = '00000000-0000-4000-8000-00000000b001';
// NRC-20 "Policy setup required": tenants listed in NO_ACTIVE_POLICY_TENANTS have none.
const hasActivePolicy = (data: MockData, tenantId: string | null | undefined): boolean =>
  !!tenantId && !(data.NO_ACTIVE_POLICY_TENANTS ?? []).includes(tenantId);

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
      active_policy: hasActivePolicy(data, tenant.tenant_id) ? {
        policy_bundle_id: SIM_POLICY_BUNDLE_ID, version: data.POLICY_BUNDLE_VERSION, name: 'Placeholder rules (simulation)',
        is_synthetic: true, rule_count: data.VALIDATION_RULES.length,
      } : null,
    };
    return json(200, ctx);
  },

  /** The placeholder rules, in the shape of the real active policy. */
  'GET /policies/active': (req) => {
    const denied = needCap(req, 'creative:read');
    if (denied) return denied;
    if (!hasActivePolicy(req.data, req.tenantId)) return problem(404, 'NOT_FOUND', 'This organisation has no active policy.');
    const bundle: Schemas['PolicyBundleRead'] = {
      policy_bundle_id: SIM_POLICY_BUNDLE_ID, version: req.data.POLICY_BUNDLE_VERSION, name: 'Placeholder rules (simulation)',
      source_ref: 'simulation', is_synthetic: true, approved_by: 'simulation', approved_at: '2026-11-01T00:00:00Z',
      rules: req.data.VALIDATION_RULES.map((r) => ({
        rule_id: r.rule_id, rule_version: r.rule_version, title: r.explanation, requirement: r.explanation,
        gate: r.gate, severity: r.severity, mandatory: r.mandatory, applies_to: ['brief', 'text'], source: r.source,
      })),
    };
    return json(200, bundle);
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
    // The author's display name is looked up when read, like the API does.
    const all = [versionOf(c), ...[...(c.history ?? [])].reverse()].map((v) => ({ ...v, created_by_name: displayName(req, v.created_by) }));
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
    if (c?.tenant_id !== req.tenantId) return problem(404, 'NOT_FOUND', 'This draft does not exist or is not available to you.');
    if (body.input_kind !== 'brief' && body.input_kind !== 'text' && body.input_kind !== 'image') {
      return fieldsProblem([{ loc: ['body', 'input_kind'], msg: "Input should be 'brief', 'text' or 'image'", type: 'enum' }]);
    }
    if (body.creative_version !== c.version) {
      return problem(409, 'VERSION_CONFLICT', 'The creative changed since you loaded it. Reload and validate the latest version.', false, { current_version: c.version });
    }
    const study = (req.data.STUDIES[c.tenant_id] ?? []).find((st) => st.study_id === c.study_id);
    if (study?.recruitment_status !== 'recruiting') return problem(409, 'STUDY_CLOSED', 'The study is closed.');

    const inputKind = body.input_kind;
    if (inputKind === 'image' && !findAsset(req, body.asset_id ?? '')) {
      return fieldsProblem([{ loc: ['body', 'asset_id'], msg: 'Send the asset_id of an image of this draft.', type: 'value_error' }]);
    }
    const text = inputKind === 'brief' ? c.current_prompt : inputKind === 'text' ? c.caption ?? '' : '';
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
      : inputKind === 'image' ? IMAGE_RESULT : evaluate(text, req.data.VALIDATION_RULES);
    const run: MockValidationRun = {
      tenant_id: c.tenant_id, creative_id: c.id, started_ms: Date.now(),
      final: {
        validation_run_id: id, job_id: `sim-job-${id.slice(8)}`, input_kind: inputKind,
        creative_version: c.version, state: failure ? 'FAILED' : 'SUCCEEDED', is_current: true,
        evaluated_at: null, input_hash: `sim-${text.length}`, asset_id: inputKind === 'image' ? body.asset_id ?? null : null,
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
    const c = run?.tenant_id === req.tenantId ? store(req).get(run.creative_id) : undefined;
    if (!run || !c) return problem(404, 'NOT_FOUND', 'This validation run does not exist or is not available to you.');
    return json(200, readRun(run, c));
  },

  /**
   * NRC-5: the placeholder rules a finished brief or caption run was checked
   * against, each with its placeholder source text. A run that did not finish,
   * or an image run, stored none.
   */
  'GET /validations/:id/context': (req) => {
    const denied = needCap(req, 'creative:read');
    if (denied) return denied;
    const run = mockServer.runs(req.data.VALIDATION_RUNS).get(req.params.id);
    const c = run?.tenant_id === req.tenantId ? store(req).get(run.creative_id) : undefined;
    if (!run || !c) return problem(404, 'NOT_FOUND', 'This validation run does not exist or is not available to you.');
    const read = readRun(run, c);
    if (read.state !== 'SUCCEEDED' || read.input_kind === 'image') {
      return problem(404, 'CONTEXT_NOT_AVAILABLE', 'No policy context was stored for this validation run.');
    }
    const rules = req.data.VALIDATION_RULES;
    const selected = (mandatory: boolean): ValidationContext['required_rules'] => rules.filter((r) => r.mandatory === mandatory).map((r) => ({
      rule_id: r.rule_id, rule_version: r.rule_version, node_key: r.rule_id, mandatory: r.mandatory,
      // The fake validator only matches phrases and counts words: code, never a model.
      check_type: 'deterministic', gate: r.gate, severity: r.severity, unresolved: [],
    }));
    const context: ValidationContext = {
      validation_run_id: read.validation_run_id, manifest_sha256: null,
      policy_bundle_id: SIM_POLICY_BUNDLE_ID, policy_bundle_version: req.data.POLICY_BUNDLE_VERSION, is_synthetic: true,
      study_snapshot_id: c.study_snapshot_id, study_snapshot_version: read.study_snapshot_version,
      input_kind: read.input_kind, channel: c.channel, post_format: c.post_format, language: c.language,
      audience: null, jurisdiction: null, evaluated_at: read.evaluated_at ?? new Date(run.started_ms).toISOString(),
      retrieval_mode: 'lexical_only', embedding_model_id: null, statements: [{ span: null }],
      required_rules: selected(true), optional_rules: selected(false),
      evidence: rules.map((r) => ({
        node_key: `CL-${r.rule_id}`, node_type: 'CLAUSE', language: 'en', excerpt: r.source.excerpt ?? '[Placeholder clause text]',
        clause_ref: r.source.clause, paths: [[r.rule_id, 'supported_by', `CL-${r.rule_id}`]], matches: [],
      })),
      exceptions: [], superseded: [],
      // True of the simulation: it searches by words only.
      missing_context: [{ code: 'SEMANTIC_SEARCH_SKIPPED', rule_id: null, detail: null }],
    };
    return json(200, context);
  },

  'POST /__sim/fail-next-validation': (req) => {
    const mode = (req.body as { mode?: string } | undefined)?.mode;
    mockServer.nextValidationFailure = mode === 'extraction' ? 'extraction' : 'timeout';
    return json(200, { ok: true });
  },

  /* ---------- Images and export (NRC-23) ---------- */

  'GET /assets/:id': (req) => {
    const denied = needCap(req, 'creative:read');
    if (denied) return denied;
    const next = mockServer.nextImageLinks.shift();
    const a = findAsset(req, req.params.id);
    // Another organisation's image is answered exactly like a missing one.
    if (!a || next === 'other-organisation') return problem(404, 'NOT_FOUND', 'This image does not exist or is not available to you.');
    if (next === 'unavailable') return problem(503, 'STORAGE_UNAVAILABLE', 'Image storage is temporarily unavailable. Try again.', true);
    return json(200, next === 'expired' ? { ...assetRead(a), download_url: EXPIRED_IMAGE_LINK } : assetRead(a));
  },

  /** expired: a link the browser cannot load; expired-twice: the renewed one too; unavailable: expired, then storage 503s. */
  'POST /__sim/next-image-link': (req) => {
    const mode = (req.body as { mode?: string } | undefined)?.mode;
    mockServer.nextImageLinks = mode === 'expired' ? ['expired']
      : mode === 'expired-twice' ? ['expired', 'expired']
        // The link expires and storage is down while renewing it; the client retries a 503 twice, so all three tries fail.
        : mode === 'unavailable' ? ['expired', 'unavailable', 'unavailable', 'unavailable']
          : mode === 'other-organisation' ? ['other-organisation']
            : [];
    return json(200, { ok: true });
  },

  /* ---------- Image generation (placeholder pictures only) ---------- */

  'GET /generation-models': (req) => {
    const denied = needCap(req, 'creative:read');
    return denied ?? json(200, { items: req.data.GENERATION_MODELS ?? [] });
  },

  'GET /creatives/:id/generation-eligibility': (req) => {
    const denied = needCap(req, 'creative:read');
    if (denied) return denied;
    const c = find(req);
    return c ? json(200, eligibilityOf(req, c)) : problem(404, 'NOT_FOUND', 'This draft does not exist or is not available to you.');
  },

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
      if (earlier.payload !== payload) return problem(409, 'IDEMPOTENCY_KEY_REUSED', 'This Idempotency-Key was already used with a different request.');
      return json(202, { job_id: earlier.id, state: 'QUEUED' }, { 'Idempotent-Replayed': 'true' });
    }
    const c = store(req).get(body.creative_id ?? '');
    if (c?.tenant_id !== req.tenantId) return problem(404, 'NOT_FOUND', 'This draft does not exist or is not available to you.');
    const e = eligibilityOf(req, c, body.creative_version);
    if (!e.eligible) return problem(409, 'GENERATION_NOT_ELIGIBLE', e.message, false, { reason: e.reason });
    // NRC-21 (proposed, Firoz): the model must be enabled; a text-in-image model needs the text;
    // the brief (plus the image text, for that model) must fit the model's limit.
    const choice = req.body as { model?: string; image_text?: string };
    const models = req.data.GENERATION_MODELS ?? [];
    if (models.length) {
      const model = choice.model ? models.find((m) => m.model === choice.model) : models.find((m) => m.is_default);
      const invalid = (reason: string, extra: Record<string, unknown> = {}) =>
        problem(422, 'GENERATION_REQUEST_INVALID', 'The generation request is not valid for this model.', false, { reason, ...extra });
      if (!model) return invalid('MODEL_NOT_ENABLED');
      if (model.text_in_image && !choice.image_text?.trim()) return invalid('IMAGE_TEXT_REQUIRED');
      const used = codePoints(c.current_prompt) + (model.text_in_image ? codePoints(choice.image_text ?? '') : 0);
      if (used > model.max_brief_chars) return invalid('BRIEF_TOO_LONG', { max_brief_chars: model.max_brief_chars });
    }
    const format = req.data.POST_FORMATS.find((f) => f.channel === c.channel && f.post_format === c.post_format);
    // A UUID like the API's: the web app refuses any other job id in a path (NRC-21).
    const id = crypto.randomUUID();
    const suffix = id.slice(0, 8);
    const job: MockJob = {
      job_id: id, tenant_id: c.tenant_id, creative_id: c.id, creative_version: c.version, started_ms: Date.now(),
      asset: {
        tenant_id: c.tenant_id, asset_id: `sim-asset-${suffix}`, creative_id: c.id, origin: 'generated', mime_type: 'image/svg+xml',
        width_px: format?.width_px ?? 1080, height_px: format?.height_px ?? 1080, size_bytes: 600,
        checksum_sha256: suffix.padEnd(64, '0'), provider: 'simulation', model: 'placeholder',
        created_at: new Date(Date.now() + JOB_DONE_MS).toISOString(),
      },
    };
    mockServer.jobs().set(id, job);
    mockServer.saveJobs();
    mockServer.idempotency.set(`${req.tenantId}:job:${key}`, { payload, id });
    return json(202, { job_id: id, state: 'QUEUED' });
  },

  'GET /jobs/:id': (req) => {
    const denied = needCap(req, 'creative:read');
    if (denied) return denied;
    const job = mockServer.jobs().get(req.params.id);
    if (job?.tenant_id !== req.tenantId) return problem(404, 'NOT_FOUND', 'This job does not exist or is not available to you.');
    const read = readJob(job);
    // The finished picture becomes the draft's image.
    const c = store(req).get(job.creative_id);
    if (read.state === 'SUCCEEDED' && c && c.asset_id !== job.asset.asset_id && c.version === job.creative_version) {
      c.asset_id = job.asset.asset_id;
      mockServer.saveCreatives();
    }
    return json(200, read);
  },

  'GET /creatives/:id/export': (req) => {
    const denied = needCap(req, 'creative:read');
    if (denied) return denied;
    const c = find(req);
    if (!c) return problem(404, 'NOT_FOUND', 'This draft does not exist or is not available to you.');
    const a = c.asset_id ? findAsset(req, c.asset_id) : undefined;
    if (!a) return problem(409, 'EXPORT_NOT_READY', 'Generate an image for the current version before exporting.');
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
    // As the API: the finished generated images of this tenant's drafts, newest
    // first, a page at a time (cursor = created_at of the last item seen).
    const creatives = [...store(req).values()].filter((c) => c.tenant_id === req.tenantId);
    const finished = [
      ...req.data.ASSETS.filter((a) => a.tenant_id === req.tenantId).map((a) => ({ a, version: creatives.find((c) => c.asset_id === a.asset_id)?.version })),
      ...[...mockServer.jobs().values()].filter((j) => j.tenant_id === req.tenantId && Date.now() - j.started_ms >= JOB_DONE_MS).map((j) => ({ a: j.asset, version: j.creative_version })),
    ];
    const items = finished.flatMap(({ a, version }) => {
      const c = creatives.find((x) => x.id === a.creative_id);
      if (!c || version == null) return [];
      const { download_url, download_url_expires_at } = assetRead(a);
      return [{
        asset_id: a.asset_id, creative_id: a.creative_id, creative_version: version, origin: a.origin, mime_type: a.mime_type,
        width_px: a.width_px, height_px: a.height_px, size_bytes: a.size_bytes, created_at: a.created_at,
        created_by: c.created_by, created_by_name: displayName(req, c.created_by), download_url, download_url_expires_at,
      }];
    }).sort((x, y) => y.created_at.localeCompare(x.created_at));
    const cursor = req.query.get('cursor');
    const limit = Math.max(1, Math.min(50, Number(req.query.get('limit') ?? 20)));
    const older = cursor ? items.filter((m) => m.created_at < cursor) : items;
    const page = older.slice(0, limit);
    return json(200, { items: page, next_cursor: older.length > limit ? page[page.length - 1].created_at : null });
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

  'GET /social-sets': (req) => {
    const denied = needCap(req, 'creative:read');
    if (denied) return denied;
    // The count is what the set holds now, so it moves when accounts are connected or removed.
    return json(200, (ws(req).social_sets ?? []).map((s) => ({ ...s, account_count: ws(req).accounts.filter((a) => a.social_set_id === s.social_set_id).length })));
  },

  'POST /accounts': (req) => {
    const denied = needCap(req, 'publication:manage');
    if (denied) return denied;
    const b = req.body as { channel?: SocialChannel; name?: string; social_set_id?: string };
    const errs: FieldError[] = [];
    if (!b.name?.trim()) errs.push({ loc: ['body', 'name'], msg: 'Name the page or profile.', type: 'missing' });
    const set = (ws(req).social_sets ?? []).find((s) => s.social_set_id === b.social_set_id);
    if (!set) errs.push({ loc: ['body', 'social_set_id'], msg: 'Choose the social set this account belongs to.', type: 'missing' });
    if (errs.length) return fieldsProblem(errs);
    // At the limit nothing is removed and no upgrade is offered: the new account is refused.
    const count = ws(req).accounts.filter((a) => a.social_set_id === set!.social_set_id).length;
    if (count >= set!.account_limit) {
      return problem(409, 'SOCIAL_SET_LIMIT', `${set!.name} already holds ${count} accounts, its limit is ${set!.account_limit}. Disconnect one, or ask an administrator to raise the limit.`);
    }
    const channel = b.channel ?? 'facebook';
    const caps = req.data.CHANNEL_CAPABILITIES?.[channel] ?? { formats: ['Feed image'], caption_max: 2200, publish_mode: 'API' as const, required_fields: [], permissions: [] };
    const acc = {
      account_id: `sim-acc-${crypto.randomUUID().slice(0, 6)}`, social_set_id: set!.social_set_id, channel, name: `${b.name!.trim()} (simulation)`,
      handle: b.name!.trim().toLowerCase().replace(/\s+/g, '.'), state: 'TEST_ONLY' as const,
      state_reason: caps.publish_mode === 'MANUAL'
        ? 'No publishing API for this account type: posts are handed off to post by hand.'
        : 'Connected in simulation. Only test users would see posts.',
      connected_by: req.user.user_id, connected_at: new Date().toISOString(), expires_at: new Date(Date.now() + 90 * 864e5).toISOString(),
      ...structuredClone(caps),
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
    const caps = req.data.CHANNEL_CAPABILITIES?.[acc.channel];
    Object.assign(acc, {
      state: 'CONNECTED', state_reason: acc.publish_mode === 'MANUAL' ? 'No publishing API for this account type: posts are handed off to post by hand.' : null,
      connected_by: req.user.user_id, connected_at: new Date().toISOString(), expires_at: new Date(Date.now() + 90 * 864e5).toISOString(),
      ...(caps ? { permissions: [...caps.permissions], formats: [...caps.formats] } : {}),
    });
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
    const targets = b.targets ?? [];
    const accounts = ws(req).accounts.filter((a) => targets.some((t) => t.account_id === a.account_id));
    const errs: FieldError[] = [];
    if (!accounts.length) errs.push({ loc: ['body', 'targets'], msg: 'Choose at least one account.', type: 'missing' });
    // The server is the authority: every target is checked against what its account can take.
    for (const a of accounts) {
      const t = targets.find((x) => x.account_id === a.account_id)!;
      const fail = (msg: string) => errs.push({ loc: ['body', 'targets'], msg: `${a.name}: ${msg}`, type: 'value_error' });
      if (a.state !== 'CONNECTED' && a.state !== 'TEST_ONLY') fail(`cannot publish. ${a.state_reason ?? 'Reconnect it first.'}`);
      else if (!a.formats.includes(t.format)) fail(`does not accept "${t.format}".`);
      if (a.caption_max != null && codePoints(approval.caption) > a.caption_max) fail(`the caption is longer than ${a.caption_max} characters.`);
      if (a.required_fields.includes('title') && !t.title?.trim()) fail('needs a title.');
      if (a.required_fields.includes('privacy') && !t.privacy) fail('needs a privacy setting.');
      if (a.required_fields.includes('ai_disclosure') && t.ai_disclosure == null) fail('needs the AI-content answer.');
    }
    if (b.publish_at && Date.parse(b.publish_at) < Date.now() - 60_000) errs.push({ loc: ['body', 'publish_at'], msg: 'Choose a time in the future.', type: 'value_error' });
    if (errs.length) return fieldsProblem(errs);
    const pub = {
      publication_id: `sim-pub-${crypto.randomUUID().slice(0, 6)}`, creative_id: b.creative_id!, creative_version: b.creative_version!,
      study_title: approval.study_title, caption: approval.caption, publish_at: b.publish_at ?? null, timezone: b.timezone ?? 'UTC',
      // Simulation never pretends a post went live: "now" stays queued.
      state: (b.publish_at ? 'SCHEDULED' : 'QUEUED') as Publication['state'],
      state_reason: b.publish_at ? null : 'Queued in simulation. Nothing is sent to any social network.',
      created_by: req.user.user_id, created_at: new Date().toISOString(),
      // A manual account is handed off, never sent or shown as published.
      channels: accounts.map((a) => ({
        account_id: a.account_id, channel: a.channel, account_name: a.name, format: targets.find((t) => t.account_id === a.account_id)!.format,
        state: a.publish_mode === 'MANUAL' ? ('MANUAL' as const) : b.publish_at ? ('SCHEDULED' as const) : ('QUEUED' as const),
        permalink: null, error: null,
      })),
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

  'POST /publications/:id/reschedule': (req) => {
    const denied = needCap(req, 'publication:manage');
    if (denied) return denied;
    const pub = ws(req).publications.find((p) => p.publication_id === req.params.id);
    if (!pub) return problem(404, 'NOT_FOUND', 'This publication does not exist.');
    if (pub.state !== 'SCHEDULED') return problem(409, 'NOT_RESCHEDULABLE', 'Only a scheduled post that has not been sent can be moved.');
    const b = req.body as { publish_at?: string; timezone?: string };
    if (!b.publish_at) return fieldsProblem([{ loc: ['body', 'publish_at'], msg: 'Choose a date and time.', type: 'missing' }]);
    if (Date.parse(b.publish_at) < Date.now() - 60_000) return fieldsProblem([{ loc: ['body', 'publish_at'], msg: 'Choose a time in the future.', type: 'value_error' }]);
    pub.publish_at = b.publish_at;
    pub.timezone = b.timezone ?? pub.timezone;
    logActivity(req, 'rescheduled', pub.publication_id, '/marketing/publications');
    saveWorkspaces();
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
    else if (!b.email?.endsWith('.test')) errs.push({ loc: ['body', 'email'], msg: 'In simulation, use an example.test address.', type: 'value_error' });
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

  /* ---------- Client posts: validation only (NRC-41, proposed contract) ---------- */

  'POST /client-uploads': (req) => {
    const denied = needCap(req, 'creative:write');
    if (denied) return denied;
    const b = req.body as { file_name?: string; mime_type?: string; size_bytes?: number };
    if (!b.file_name?.trim()) return fieldsProblem([{ loc: ['body', 'file_name'], msg: 'Choose a file to upload.', type: 'missing' }]);
    const kind = b.mime_type?.startsWith('video/') ? 'video' as const : b.mime_type?.startsWith('image/') ? 'image' as const : null;
    // As the server would after inspecting the bytes: wrong type, too large or unreadable files are rejected with a reason.
    const reason = !kind ? 'Only images and videos can be checked.'
      : (b.size_bytes ?? 0) > MAX_UPLOAD_BYTES ? 'The file is larger than 200 MB.'
        : /corrupt/i.test(b.file_name) ? 'The file could not be read. It may be damaged; export it again and upload the new file.'
          : null;
    const media: MockClientMedia = {
      tenant_id: req.tenantId ?? '', asset_id: `sim-upload-${crypto.randomUUID().slice(0, 8)}`,
      kind: kind ?? 'image', file_name: b.file_name, mime_type: b.mime_type ?? 'application/octet-stream', size_bytes: b.size_bytes ?? 0,
      width_px: kind === 'video' ? 1080 : 1080, height_px: kind === 'video' ? 1920 : 1080, duration_s: kind === 'video' ? 15 : null,
      state: reason ? 'REJECTED' : 'READY', state_reason: reason,
    };
    mockServer.client().media.set(media.asset_id, media);
    mockServer.saveClient();
    return json(201, clientMediaRead(media));
  },

  'POST /client-posts': (req) => {
    const denied = needCap(req, 'creative:write');
    if (denied) return denied;
    const key = req.idempotencyKey;
    if (!key) return fieldsProblem([{ loc: ['header', 'Idempotency-Key'], msg: 'Send an Idempotency-Key.', type: 'missing' }]);
    const b = req.body as { study_id?: string; language?: string; channel?: string; post_format?: string; caption?: string | null; asset_ids?: string[] };
    const payload = JSON.stringify(b);
    const earlier = mockServer.idempotency.get(`${req.tenantId}:client:${key}`);
    if (earlier) {
      if (earlier.payload !== payload) return problem(409, 'IDEMPOTENCY_KEY_REUSED', 'This Idempotency-Key was already used with a different request.');
      return clientPostRead(req, 200, mockServer.client().posts.get(earlier.id)!);
    }
    const study = (req.data.STUDIES[req.tenantId ?? ''] ?? []).find((s) => s.study_id === b.study_id);
    const errs = [...checkSetup(req.data, b), ...clientContentErrors(req, b.caption ?? null, b.asset_ids ?? [])];
    if (!study) errs.push({ loc: ['body', 'study_id'], msg: 'Choose a study.', type: 'missing' });
    else if (study.recruitment_status !== 'recruiting') errs.push({ loc: ['body', 'study_id'], msg: 'This study is closed to recruitment.', type: 'value_error' });
    if (errs.length) return fieldsProblem(errs);
    const now = new Date().toISOString();
    const post: MockClientPost = {
      tenant_id: req.tenantId ?? '', id: `sim-cp-${crypto.randomUUID().slice(0, 8)}`, version: 1,
      study_id: b.study_id!, language: b.language as MockClientPost['language'], channel: b.channel as MockClientPost['channel'],
      post_format: b.post_format as MockClientPost['post_format'], origin: 'CLIENT_UPLOAD', workflow_mode: 'VALIDATION_ONLY',
      caption: b.caption?.trim() ? b.caption : null, asset_ids: b.asset_ids ?? [], created_by: req.user.user_id,
      created_at: now, updated_at: now, change_note: 'Uploaded', history: [], generation_requests: 0,
    };
    mockServer.client().posts.set(post.id, post);
    mockServer.saveClient();
    mockServer.idempotency.set(`${req.tenantId}:client:${key}`, { payload, id: post.id });
    return clientPostRead(req, 201, post);
  },

  'GET /client-posts/:id': (req) => {
    const denied = needCap(req, 'creative:read');
    if (denied) return denied;
    const post = findClientPost(req);
    return post ? clientPostRead(req, 200, post) : problem(404, 'NOT_FOUND', 'This post does not exist or is not available to you.');
  },

  'PATCH /client-posts/:id': (req) => {
    const denied = needCap(req, 'creative:write');
    if (denied) return denied;
    const post = findClientPost(req);
    if (!post) return problem(404, 'NOT_FOUND', 'This post does not exist or is not available to you.');
    if (!req.ifMatch) return problem(428, 'PRECONDITION_REQUIRED', 'Send If-Match with the version you edited.');
    if (req.ifMatch !== `"${post.version}"`) {
      return problem(412, 'VERSION_CONFLICT', 'The post changed since you loaded it. Reload it and try again.', false, { current_version: post.version });
    }
    const b = req.body as { caption?: string | null; asset_ids?: string[]; change_note?: string };
    const caption = b.caption === undefined ? post.caption : b.caption?.trim() ? b.caption : null;
    const assetIds = b.asset_ids ?? post.asset_ids;
    const errs = clientContentErrors(req, caption, assetIds);
    if (errs.length) return fieldsProblem(errs);
    post.history.push({
      version: post.version, caption: post.caption, asset_ids: post.asset_ids, change_note: post.change_note,
      created_by: post.updated_by ?? post.created_by, created_at: post.updated_at,
    });
    post.caption = caption;
    post.asset_ids = assetIds;
    post.version += 1;
    post.change_note = b.change_note?.trim() || 'Edited';
    post.updated_at = new Date().toISOString();
    post.updated_by = req.user.user_id;
    mockServer.saveClient();
    return clientPostRead(req, 200, post);
  },

  'POST /client-posts/:id/checks': (req) => {
    const denied = needCap(req, 'validation:run');
    if (denied) return denied;
    const post = findClientPost(req);
    if (!post) return problem(404, 'NOT_FOUND', 'This post does not exist or is not available to you.');
    const key = req.idempotencyKey;
    if (!key) return fieldsProblem([{ loc: ['header', 'Idempotency-Key'], msg: 'Send an Idempotency-Key.', type: 'missing' }]);
    const b = req.body as { post_version?: number };
    const payload = JSON.stringify({ id: post.id, ...b });
    const earlier = mockServer.idempotency.get(`${req.tenantId}:client-check:${key}`);
    if (earlier) {
      if (earlier.payload !== payload) return problem(409, 'IDEMPOTENCY_KEY_REUSED', 'This Idempotency-Key was already used with a different request.');
      return json(202, { check_id: earlier.id, state: 'QUEUED' });
    }
    if (b.post_version !== post.version) {
      return problem(409, 'VERSION_CONFLICT', 'The post changed since you loaded it. Reload it and check the latest version.', false, { current_version: post.version });
    }
    const check = clientCheckOf(req, post);
    mockServer.client().checks.set(check.final.check_id, check);
    mockServer.saveClient();
    mockServer.idempotency.set(`${req.tenantId}:client-check:${key}`, { payload, id: check.final.check_id });
    return json(202, { check_id: check.final.check_id, state: 'QUEUED' });
  },

  'GET /client-posts/:id/checks/latest': (req) => {
    const denied = needCap(req, 'creative:read');
    if (denied) return denied;
    const post = findClientPost(req);
    if (!post) return problem(404, 'NOT_FOUND', 'This post does not exist or is not available to you.');
    const latest = [...mockServer.client().checks.values()]
      .filter((c) => c.post_id === post.id && c.tenant_id === req.tenantId)
      .sort((a, b) => b.started_ms - a.started_ms)[0];
    return latest ? json(200, readClientCheck(latest, post)) : problem(404, 'NOT_FOUND', 'This post has not been checked yet.');
  },

  'GET /client-posts/:id/versions': (req) => {
    const denied = needCap(req, 'creative:read');
    if (denied) return denied;
    const post = findClientPost(req);
    if (!post) return problem(404, 'NOT_FOUND', 'This post does not exist or is not available to you.');
    const files = mockServer.client().media;
    const checks = [...mockServer.client().checks.values()]
      .filter((c) => c.post_id === post.id && c.tenant_id === req.tenantId)
      .sort((a, b) => b.started_ms - a.started_ms);
    const all = [
      { version: post.version, caption: post.caption, asset_ids: post.asset_ids, change_note: post.change_note, created_by: post.updated_by ?? post.created_by, created_at: post.updated_at },
      ...[...post.history].reverse(),
    ];
    const items = all.map((v) => {
      const c = checks.find((x) => x.final.post_version === v.version);
      const read = c ? readClientCheck(c, post) : null;
      const createdBy = v.created_by ?? post.created_by;
      return {
        version: v.version, caption: v.caption, change_note: v.change_note,
        media: v.asset_ids.flatMap((assetId) => { const m = files.get(assetId); return m?.tenant_id === req.tenantId ? [clientMediaRead(m)] : []; }),
        created_by: createdBy, created_by_name: displayName(req, createdBy), created_at: v.created_at ?? post.created_at,
        check: read && {
          check_id: read.check_id, state: read.state, outcome: read.outcome, evaluated_at: read.evaluated_at,
          has_coverage_gaps: read.parts.some((p) => p.coverage_gaps.length > 0),
        },
      };
    });
    return json(200, { items });
  },

  'POST /client-posts/:id/ai-fixes': (req) => {
    const denied = needCap(req, 'generation:run');
    if (denied) return denied;
    const post = findClientPost(req);
    if (!post) return problem(404, 'NOT_FOUND', 'This post does not exist or is not available to you.');
    const key = req.idempotencyKey;
    if (!key) return fieldsProblem([{ loc: ['header', 'Idempotency-Key'], msg: 'Send an Idempotency-Key.', type: 'missing' }]);
    const b = req.body as { post_version?: number; asset_id?: string; instructions?: string | null };
    const payload = JSON.stringify({ id: post.id, ...b });
    const earlier = mockServer.idempotency.get(`${req.tenantId}:ai-fix:${key}`);
    if (earlier) {
      if (earlier.payload !== payload) return problem(409, 'IDEMPOTENCY_KEY_REUSED', 'This Idempotency-Key was already used with a different request.');
      return json(202, readAiFix(mockServer.client().fixes.get(earlier.id)!));
    }
    if (b.instructions && codePoints(b.instructions) > 500) {
      return fieldsProblem([{ loc: ['body', 'instructions'], msg: 'Shorten the instructions to 500 characters.', type: 'string_too_long' }]);
    }
    if (b.post_version !== post.version) {
      return problem(409, 'VERSION_CONFLICT', 'The post changed since you loaded it. Reload it and try again.', false, { current_version: post.version });
    }
    // Only an image the current, finished check flagged can be fixed.
    const latest = [...mockServer.client().checks.values()]
      .filter((c) => c.post_id === post.id && c.tenant_id === req.tenantId)
      .sort((x, y) => y.started_ms - x.started_ms)[0];
    const read = latest ? readClientCheck(latest, post) : null;
    const part = read?.is_current && read.state === 'SUCCEEDED' ? read.parts.find((p) => p.asset_id === b.asset_id) : undefined;
    if (part?.target !== 'image' || !part.findings.length) {
      return problem(409, 'AI_FIX_NOT_ELIGIBLE', 'Only an image flagged by the check of the current version can be fixed with AI.');
    }
    const source = mockServer.client().media.get(b.asset_id ?? '')!;
    const suffix = crypto.randomUUID().slice(0, 8);
    const fix: MockAiFix = {
      tenant_id: post.tenant_id, fix_id: `sim-fix-${suffix}`, post_id: post.id, post_version: post.version, asset_id: source.asset_id,
      instructions: b.instructions?.trim() || null, started_ms: Date.now(), created_by: req.user.user_id,
      // No flagged words in the name: the fake checker reads the name as the text on the image.
      result: {
        tenant_id: post.tenant_id, asset_id: `sim-upload-${suffix}`, kind: 'image', file_name: `ai-fixed-image-${suffix}.png`, mime_type: 'image/png',
        size_bytes: 600, width_px: source.width_px, height_px: source.height_px, duration_s: null, state: 'READY', state_reason: null, origin: 'ai_fix',
      },
    };
    mockServer.client().fixes.set(fix.fix_id, fix);
    mockServer.client().media.set(fix.result.asset_id, fix.result);
    post.generation_requests = (post.generation_requests ?? 0) + 1;
    mockServer.saveClient();
    mockServer.idempotency.set(`${req.tenantId}:ai-fix:${key}`, { payload, id: fix.fix_id });
    return json(202, readAiFix(fix));
  },

  'GET /client-posts/:id/ai-fixes/:fixId': (req) => {
    const denied = needCap(req, 'creative:read');
    if (denied) return denied;
    const fix = mockServer.client().fixes.get(req.params.fixId);
    if (fix?.tenant_id !== req.tenantId || fix.post_id !== req.params.id) return problem(404, 'NOT_FOUND', 'This AI fix does not exist or is not available to you.');
    return json(200, readAiFix(fix));
  },

  /* ---------- Generation usage and balance (NRC-44, proposed contract) ---------- */

  'GET /usage/balance': (req) => {
    const denied = needCap(req, 'creative:read');
    if (denied) return denied;
    const u = req.data.USAGE?.[req.tenantId ?? ''];
    return json(200, u?.balance ?? {
      provider: 'Higgsfield (simulation)', currency: 'USD', source: 'UNAVAILABLE', amount: null, as_of: null,
      reserved: '0.00', allocation: null, low_threshold: '5.00', recharge_url: null, provider_tokens: null,
    });
  },

  'GET /usage/attempts': (req) => {
    const denied = needCap(req, 'creative:read');
    if (denied) return denied;
    const q = req.query;
    const all = (req.data.USAGE?.[req.tenantId ?? '']?.attempts ?? [])
      .filter((a) => (!q.get('model') || a.model === q.get('model'))
        && (!q.get('creative_id') || a.creative_id === q.get('creative_id'))
        && (!q.get('from') || a.created_at >= `${q.get('from')}T00:00:00Z`)
        && (!q.get('to') || a.created_at <= `${q.get('to')}T23:59:59Z`))
      .sort((x, y) => y.created_at.localeCompare(x.created_at));
    const offset = Number(q.get('cursor') ?? 0) || 0;
    const items = all.slice(offset, offset + USAGE_PAGE);
    const sum = (pick: (a: (typeof all)[number]) => string | null) => sumMoney(all.map(pick).filter((v): v is string => v != null));
    return json(200, {
      items,
      next_cursor: offset + USAGE_PAGE < all.length ? String(offset + USAGE_PAGE) : null,
      totals: {
        attempts: all.length,
        estimated: sum((a) => a.estimated),
        reserved: sum((a) => (a.status === 'RESERVED' ? a.estimated : null)),
        confirmed: sum((a) => a.confirmed),
        refunded: sum((a) => a.refunded),
        unknown: all.filter((a) => a.status === 'UNKNOWN').length,
      },
    });
  },

  'GET /usage/prices': (req) => {
    const denied = needCap(req, 'creative:read');
    if (denied) return denied;
    return req.data.PRICES ? json(200, req.data.PRICES) : problem(503, 'PRICES_UNAVAILABLE', 'Prices are not available right now.', true);
  },

  /* ---------- Dashboards (NRC-46, proposed contract in api/analytics.ts) ---------- */

  'GET /analytics/dashboard': (req) => {
    const denied = needCap(req, 'creative:read');
    if (denied) return denied;
    const q = req.query;
    const from = q.get('from'); const to = q.get('to'); const workflow = q.get('workflow'); const setId = q.get('social_set_id');
    const inRange = (iso: string | null) => !!iso && (!from || iso >= `${from}T00:00`) && (!to || iso <= `${to}T23:59:59Z`);

    // Usage: the same attempts the usage page lists, so the two always agree.
    const attempts = (req.data.USAGE?.[req.tenantId ?? '']?.attempts ?? [])
      .filter((a) => inRange(a.created_at) && (!workflow || a.workflow === workflow));
    const usable = attempts.filter((a) => a.outcome === 'USED');
    const confirmed = sumMoney(attempts.map((a) => a.confirmed).filter((v): v is string => v != null));
    const publications = ws(req).publications.filter((p) => inRange(p.publish_at ?? p.created_at));
    const publishedPosts = new Set(publications.filter((p) => p.channels.some((c) => c.state === 'PUBLISHED')).map((p) => p.creative_id)).size;
    const per = (n: number) => (n ? fromMicros(toMicros(confirmed) / BigInt(n)) : null);
    const models = [...new Set(attempts.map((a) => a.model_label))].map((label) => {
      const rows = attempts.filter((a) => a.model_label === label);
      return { model_label: label, attempts: rows.length, usable: rows.filter((a) => a.outcome === 'USED').length, confirmed: sumMoney(rows.map((a) => a.confirmed ?? '0')) };
    });

    // Validation: every finished run in this organisation.
    const runs = [...mockServer.runs(req.data.VALIDATION_RUNS).values()]
      .filter((r) => r.tenant_id === req.tenantId && r.final.state === 'SUCCEEDED' && (!r.final.evaluated_at || inRange(r.final.evaluated_at)));
    const counts = new Map<string, number>();
    for (const r of runs) for (const f of r.final.findings) counts.set(f.rule_id, (counts.get(f.rule_id) ?? 0) + 1);
    const rule = (id: string) => req.data.VALIDATION_RULES.find((x) => x.rule_id === id);

    // Social: per account only; a figure the network does not report stays null.
    const accounts = ws(req).accounts.filter((a) => !setId || a.social_set_id === setId);
    const channelState = (s: string) => publications.flatMap((p) => p.channels).filter((c) => accounts.some((a) => a.account_id === c.account_id) && c.state === s).length;

    return json(200, {
      generated_at: new Date().toISOString(),
      usage: {
        freshness: { as_of: req.data.USAGE?.[req.tenantId ?? ''] ? new Date(Date.now() - 10 * 60_000).toISOString() : null, partial: attempts.some((a) => a.status === 'UNKNOWN') ? 'Some attempts are not billed yet; their estimates are shown apart.' : null },
        attempts: attempts.length, usable_outputs: usable.length, published_posts: publishedPosts,
        confirmed, unconfirmed_estimate: sumMoney(attempts.filter((a) => a.confirmed == null).map((a) => a.estimated)),
        cost_per_usable: per(usable.length), cost_per_published: per(publishedPosts),
        median_latency_s: attempts.length ? 38 : null,
        by_model: models,
      },
      validation: {
        freshness: { as_of: new Date(Date.now() - 2 * 60_000).toISOString(), partial: null },
        runs: runs.length,
        pass: runs.filter((r) => r.final.outcome === 'PASS').length,
        fail: runs.filter((r) => r.final.outcome === 'FAIL').length,
        needs_review: runs.filter((r) => r.final.outcome === 'NEEDS_REVIEW').length,
        unable_to_assess: runs.filter((r) => r.final.rule_results.some((x) => x.mandatory && x.result === 'UNABLE_TO_ASSESS')).length,
        avg_correction_rounds: runs.some((r) => r.final.outcome === 'PASS') ? 2.3 : null,
        top_rules: [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
          .map(([id, n]) => ({ rule_id: id, title: rule(id)?.explanation ?? id, findings: n })),
      },
      social: {
        freshness: { as_of: new Date(Date.now() - 6 * 3600_000).toISOString(), partial: 'Networks update their figures at different times; some accounts report none.' },
        published: channelState('PUBLISHED'), failed: channelState('FAILED'), unknown: channelState('UNKNOWN'), partial: publications.filter((p) => p.state === 'PARTIAL').length, manual: channelState('MANUAL'),
        by_account: accounts.map((a) => {
          const m = req.data.SOCIAL_METRICS?.[a.account_id];
          return {
            account_id: a.account_id, channel: a.channel, account_name: a.name,
            posts: publications.filter((p) => p.channels.some((c) => c.account_id === a.account_id && c.state === 'PUBLISHED')).length,
            impressions: m?.impressions ?? null, engagements: m?.engagements ?? null, video_views: m?.video_views ?? null,
            unavailable_reason: m ? null : a.publish_mode === 'MANUAL' ? 'Posted by hand: no figures come back.' : 'The network has not reported figures for this account.',
          };
        }),
      },
    });
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

interface FieldError { loc: (string | number)[]; msg: string; type: string }

const store = (req: MockRequest) => mockServer.creatives(req.data.CREATIVES);
const find = (req: MockRequest) => {
  const c = store(req).get(req.params.id);
  return c?.tenant_id === req.tenantId ? c : undefined;
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
  // A visibly fake replacement for findings with a span and advice, so "Use the suggested wording" can be tried (NRC-22; real wording comes from NRC-11).
  const findings = run.final.findings.map((f) => ({ ...f, replacement_text: f.text_span && f.suggested_correction ? '[approved wording]' : null }));
  return { ...run.final, findings, is_current, evaluated_at: run.final.evaluated_at ?? new Date(run.started_ms + RUNNING_MS).toISOString() };
}

const summaryOf = (r: ValidationRunRead) => ({
  validation_run_id: r.validation_run_id, input_kind: r.input_kind, creative_version: r.creative_version,
  state: r.state, outcome: r.outcome, is_current: r.is_current, evaluated_at: r.evaluated_at,
});

const versionOf = (c: MockCreative) => ({
  version: c.version, current_prompt: c.current_prompt, caption: c.caption, study_snapshot_id: c.study_snapshot_id,
  language: c.language, channel: c.channel, post_format: c.post_format, created_by: c.created_by, created_by_name: null, created_at: c.updated_at,
});

/** The display name of a user in the simulation, or null when there is none (as the API answers). */
const displayName = (req: MockRequest, userId: string): string | null => req.data.USERS.find((u) => u.user_id === userId)?.display_name ?? null;

function needCap({ user, tenantId }: MockRequest, cap: Capability) {
  const grant = tenantId ? user.grants[tenantId] : undefined;
  return grant?.capabilities.includes(cap) ? null : problem(403, 'FORBIDDEN', 'Your role does not allow this here.');
}

/* ---------- Image helpers ---------- */

/** Stands in for a signed link that has expired: the browser cannot draw it. */
const EXPIRED_IMAGE_LINK = 'data:image/png;base64,ZXhwaXJlZA==';

/** Seeded images plus the placeholder pictures finished jobs made. */
function findAsset(req: MockRequest, assetId: string): MockAsset | undefined {
  const mine = (a: MockAsset) => a.asset_id === assetId && a.tenant_id === req.tenantId;
  return req.data.ASSETS.find(mine)
    ?? [...mockServer.jobs().values()].filter((j) => Date.now() - j.started_ms >= JOB_DONE_MS).map((j) => j.asset).find(mine);
}

const JOB_DONE_MS = 3200;

function readJob(j: MockJob): Schemas['JobRead'] {
  const t = Date.now() - j.started_ms;
  const [state, stage] = t < 600 ? (['QUEUED', null] as const)
    : t < 1500 ? (['RUNNING', 'submitting'] as const)
      : t < JOB_DONE_MS ? (['WAITING_PROVIDER', 'waiting_provider'] as const)
        : (['SUCCEEDED', 'stored'] as const);
  const done = state === 'SUCCEEDED';
  return {
    job_id: j.job_id, kind: 'image_generation', creative_id: j.creative_id, creative_version: j.creative_version,
    state, stage, provider_request_id: `sim-${j.job_id.slice(8)}`, failure_code: null, failure_message: null,
    result_asset_id: done ? j.asset.asset_id : null,
    created_at: new Date(j.started_ms).toISOString(),
    updated_at: new Date(Math.min(Date.now(), j.started_ms + JOB_DONE_MS)).toISOString(),
    completed_at: done ? new Date(j.started_ms + JOB_DONE_MS).toISOString() : null,
  };
}

/** The same rule the real API applies: only a brief that passed for this exact version may be generated. */
function eligibilityOf(req: MockRequest, c: MockCreative, version = c.version): Schemas['GenerationEligibility'] {
  const base = { creative_id: c.id, creative_version: version, policy_bundle_version: req.data.POLICY_BUNDLE_VERSION, validation_run_id: null };
  const no = (reason: Schemas['EligibilityReason'], message: string) => ({ ...base, eligible: false, reason, message });
  if (version !== c.version) return no('STALE_VERSION', 'A newer version of the draft exists. Validate and generate that one.');
  const study = (req.data.STUDIES[c.tenant_id] ?? []).find((st) => st.study_id === c.study_id);
  if (study?.recruitment_status !== 'recruiting') return no('STUDY_CLOSED', 'The study is closed to recruitment.');
  const run = runsFor(req, c).find((r) => r.final.input_kind === 'brief' && r.final.creative_version === c.version);
  const now = run ? readRun(run, c) : null;
  if (now?.state !== 'SUCCEEDED' || !now.outcome) return no('NOT_VALIDATED', 'Validate the brief for this version before generating.');
  if (now.outcome === 'FAIL') return no('VALIDATION_FAILED', 'The brief failed validation. Fix and revalidate.');
  if (now.outcome === 'NEEDS_REVIEW') return no('NEEDS_REVIEW', 'The brief needs a person to review it before generating.');
  return { ...base, eligible: true, reason: 'ELIGIBLE', message: 'The brief passed validation against the placeholder rules.', validation_run_id: now.validation_run_id };
}

/** What the fake validator says about any picture: nothing is inspected, so a person must look. */
const IMAGE_RESULT: Pick<ValidationRunRead, 'outcome' | 'gates' | 'rule_results' | 'findings' | 'coverage_gaps'> = {
  outcome: 'NEEDS_REVIEW',
  gates: [{ gate: 'media', outcome: 'NEEDS_REVIEW' }],
  rule_results: [{ rule_id: 'SIM-IMG-1', rule_version: 1, mandatory: false, result: 'FAIL', reason: null }],
  findings: [{
    rule_id: 'SIM-IMG-1', rule_version: 1, severity: 'minor',
    explanation: 'Simulation: a person should look at the marked area of the picture.',
    source: { source_id: 'sim-policy-bundle', clause: 'Placeholder image clause', excerpt: null },
    text_span: null, image_region: { x: 0.12, y: 0.55, width: 0.76, height: 0.22 },
    offending_excerpt: null, suggested_correction: null, needs_human_decision: true,
  }],
  coverage_gaps: [{ rule_id: null, reason: 'Simulation: the picture itself is not inspected.' }],
};

/** The asset with a short-lived link: a labelled placeholder picture, clearly not a real generated image. */
function assetRead(a: MockAsset) {
  const { tenant_id: _tenant, ...asset } = a;
  return {
    ...asset,
    download_url: placeholderImage(a.width_px, a.height_px),
    download_url_expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
  };
}

function placeholderImage(w: number, h: number, caption = 'Simulation image', note = 'Not a real generated image') {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`
    + '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#dbe7f3"/><stop offset="1" stop-color="#eef2e6"/></linearGradient></defs>'
    + `<rect width="${w}" height="${h}" fill="url(#g)"/>`
    + `<rect x="${w * 0.12}" y="${h * 0.55}" width="${w * 0.76}" height="${h * 0.22}" rx="24" fill="#ffffff" opacity="0.8"/>`
    + `<text x="50%" y="${h * 0.64}" text-anchor="middle" font-family="sans-serif" font-size="${w * 0.045}" fill="#334155">${caption.replace(/[<&>]/g, '')}</text>`
    + `<text x="50%" y="${h * 0.71}" text-anchor="middle" font-family="sans-serif" font-size="${w * 0.03}" fill="#64748b">${note.replace(/[<&>]/g, '')}</text>`
    + '</svg>';
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/* ---------- Client post helpers (NRC-41) ---------- */

const MAX_UPLOAD_BYTES = 200_000_000;
/** Attempts per page of the usage list (NRC-44). */
const USAGE_PAGE = 8;

const findClientPost = (req: MockRequest): MockClientPost | undefined => {
  const p = mockServer.client().posts.get(req.params.id);
  return p?.tenant_id === req.tenantId ? p : undefined;
};

function clientMediaRead(m: MockClientMedia) {
  const { tenant_id: _tenant, origin, ...media } = m;
  const label = m.kind === 'video' ? `Video: ${m.file_name}` : origin === 'ai_fix' ? 'AI fixed image' : m.file_name;
  const note = origin === 'ai_fix' ? 'Simulation: not a real generated image' : 'Simulation stand-in for the uploaded file';
  return { ...media, preview_url: m.state === 'READY' ? placeholderImage(m.width_px ?? 1080, m.height_px ?? 1080, label, note) : null };
}

/** An AI fix as it reads now: queued, then running, then its new picture. "fail" in the instructions makes it fail. */
function readAiFix(f: MockAiFix): AiFix {
  const elapsed = Date.now() - f.started_ms;
  const base = { fix_id: f.fix_id, post_id: f.post_id, post_version: f.post_version, asset_id: f.asset_id, generation_requests: 1, created_at: new Date(f.started_ms).toISOString() };
  if (elapsed < RUNNING_MS) return { ...base, state: elapsed < QUEUED_MS ? 'QUEUED' : 'RUNNING', result: null, error: null };
  if (f.instructions && /\bfail\b/i.test(f.instructions)) return { ...base, state: 'FAILED', result: null, error: 'The new image could not be made. Try again, or replace the file yourself.' };
  return { ...base, state: 'SUCCEEDED', result: clientMediaRead(f.result), error: null };
}

/** Strips the internal fields, puts the files in, and sends the ETag header. */
function clientPostRead(req: MockRequest, status: number, p: MockClientPost) {
  const { tenant_id: _tenant, asset_ids, history: _history, updated_by: _by, ...post } = p;
  const files = mockServer.client().media;
  const media = asset_ids.flatMap((assetId) => { const m = files.get(assetId); return m?.tenant_id === req.tenantId ? [clientMediaRead(m)] : []; });
  return json(status, { ...post, media, generation_requests: p.generation_requests ?? 0 }, { ETag: `"${p.version}"` });
}

/** A post needs a caption or files; files are up to 10 ready images or one ready video, never both. */
function clientContentErrors(req: MockRequest, caption: string | null, assetIds: string[]): FieldError[] {
  const errs: FieldError[] = [];
  if (caption && codePoints(caption) > CAPTION_MAX) errs.push({ loc: ['body', 'caption'], msg: `Shorten the caption to ${CAPTION_MAX} characters.`, type: 'string_too_long' });
  if (!caption?.trim() && !assetIds.length) errs.push({ loc: ['body', 'caption'], msg: 'Add the caption, the files, or both.', type: 'missing' });
  const files = assetIds.map((assetId) => mockServer.client().media.get(assetId));
  if (files.some((m) => m?.tenant_id !== req.tenantId || m.state !== 'READY')) {
    errs.push({ loc: ['body', 'asset_ids'], msg: 'Remove the files that are not ready.', type: 'value_error' });
  }
  const videos = files.filter((m) => m?.kind === 'video').length;
  if (videos && (videos > 1 || files.length > 1)) errs.push({ loc: ['body', 'asset_ids'], msg: 'A post holds images or one video, not both.', type: 'value_error' });
  if (!videos && files.length > 10) errs.push({ loc: ['body', 'asset_ids'], msg: 'A carousel holds up to 10 images.', type: 'value_error' });
  return errs;
}

/**
 * The fake combined check. It proves nothing about compliance: the caption is
 * checked with the placeholder rules; for an image or video only the words in
 * its file name stand in for the text read from it; pictures, audio and
 * scenes are not inspected. A video is never passed. No generation request is made.
 */
function clientCheckOf(req: MockRequest, post: MockClientPost): MockClientCheck {
  const rules = req.data.VALIDATION_RULES;
  const files = mockServer.client().media;
  const parts: ClientCheck['parts'] = [];
  if (post.caption) {
    const r = evaluate(post.caption, rules);
    // A visibly fake replacement, so the comparison and accept steps can be tried; real wording comes from NRC-11.
    const findings = r.findings.map((f) => ({ ...f, replacement_text: f.text_span && f.suggested_correction ? '[approved wording]' : null }));
    parts.push({ target: 'caption', asset_id: null, state: 'SUCCEEDED', ...r, findings });
  }
  for (const assetId of post.asset_ids) {
    const m = files.get(assetId);
    if (!m) continue;
    const read = m.file_name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ');
    const r = evaluate(read, rules.filter((x) => x.check.kind === 'phrases'));
    const findings = r.findings.map((f) => ({
      ...f, text_span: null,
      image_region: m.kind === 'image' ? { x: 0.12, y: 0.55, width: 0.76, height: 0.22 } : null,
      time_range: m.kind === 'video' ? { start_s: 3, end_s: 6 } : null,
    }));
    if (m.kind === 'image') {
      parts.push({
        target: 'image', asset_id: assetId, state: 'SUCCEEDED', ...r, findings,
        coverage_gaps: [{ rule_id: null, reason: 'Simulation: only the text on the image is checked; the picture itself is not inspected.' }],
      });
    } else {
      parts.push({
        target: 'video', asset_id: assetId, state: 'SUCCEEDED', outcome: r.outcome === 'FAIL' ? 'FAIL' : 'NEEDS_REVIEW', gates: [{ gate: 'media', outcome: r.outcome === 'FAIL' ? 'FAIL' : 'NEEDS_REVIEW' }],
        rule_results: [...r.rule_results, { rule_id: 'SIM-VID-1', rule_version: 1, mandatory: true, result: 'UNABLE_TO_ASSESS', reason: 'Video checks (audio, on-screen text and scenes) are not available yet.' }],
        findings,
        coverage_gaps: [{ rule_id: 'SIM-VID-1', reason: 'Video checks (audio, on-screen text and scenes) are not available yet. A person must review the video.' }],
      });
    }
  }
  const outcomes = parts.map((p) => p.outcome);
  const outcome = outcomes.includes('FAIL') ? 'FAIL' : outcomes.includes('NEEDS_REVIEW') ? 'NEEDS_REVIEW' : 'PASS';
  const study = (req.data.STUDIES[post.tenant_id] ?? []).find((s) => s.study_id === post.study_id);
  return {
    tenant_id: post.tenant_id, post_id: post.id, started_ms: Date.now(),
    final: {
      check_id: `sim-check-${crypto.randomUUID().slice(0, 8)}`, post_id: post.id, post_version: post.version,
      state: 'SUCCEEDED', outcome, is_current: true, evaluated_at: null,
      study_snapshot_version: study?.version ?? 1, policy_bundle_version: req.data.POLICY_BUNDLE_VERSION,
      parts, generation_requests: 0,
    },
  };
}

/** The check as it reads now: queued, then running, then its result. Not current once the post moved on. */
function readClientCheck(c: MockClientCheck, post: MockClientPost): ClientCheck {
  const elapsed = Date.now() - c.started_ms;
  const is_current = c.final.post_version === post.version;
  if (elapsed < RUNNING_MS) {
    return {
      ...c.final, state: elapsed < QUEUED_MS ? 'QUEUED' : 'RUNNING', outcome: null, is_current, evaluated_at: null,
      parts: c.final.parts.map((p) => ({ ...p, state: 'RUNNING', outcome: null, gates: [], rule_results: [], findings: [], coverage_gaps: [] })),
    };
  }
  return { ...c.final, is_current, evaluated_at: new Date(c.started_ms + RUNNING_MS).toISOString() };
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

export const json = (status: number, body: unknown, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

export const problem = (status: number, code: string, message: string, retryable = false, details?: unknown): Response =>
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
