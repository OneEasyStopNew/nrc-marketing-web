# Image generation, jobs and generated images (NRC-6, NRC-3, NRC-10, NRC-21)

What the backend provides for generation, what the web app already does with it (NRC-21, this PR), and what the rest of the UI needs to know. Owner: Firoz. Backend PRs: nrc-marketing-api #1 (jobs), #2 (storage), #3 (Higgsfield), #5 (feed size).

**In short: you don't need to integrate anything new.** The Generate flow is built in this PR on top of `feature/NRC-marketing-ui`. Your code already reads images (`src/api/assets.ts`). The sections below are for review, and for the screens that show job or image state.

## 1. Endpoints

All of them are under `/v1/marketing`. They need `Authorization: Bearer`, `X-Tenant-Id` and the capabilities below. Errors use the agreed body `{code, message, request_id, details, retryable}`.

| Method and path | Capability | Request | Response |
|---|---|---|---|
| `POST /creative-jobs` | `generation:run` | `Idempotency-Key` header, 8–128 of `A-Za-z0-9_-`. Body `CreativeJobCreate`: `{creative_id, creative_version, kind: "image_generation"}` | **202** `JobAccepted` `{job_id, state}`, plus a `Location` header pointing at the job. It returns as soon as the job is saved; the image is made later by the worker |
| `GET /jobs/{job_id}` | `creative:read` | – | **200** `JobRead`. Reads stored state only, so polling never starts another generation. Another organisation's job is 404 |
| `GET /assets/{asset_id}` | `creative:read` | – | **200** `AssetRead` with a `download_url` that works for **15 minutes**, and `download_url_expires_at` |

**Retries:** the same `Idempotency-Key` with the same body returns the **same job**. That's how a double click, a lost response or a retry stays at one (paid) image. The same key with a different body gets **409 `IDEMPOTENCY_KEY_REUSED`**. Use a new key only for a new intended command.

## 2. JobRead: what the UI shows

- **`state`** (`ExecutionState`):
  - `QUEUED`, `RUNNING`, `WAITING_PROVIDER`: in progress.
  - `SUCCEEDED`, `FAILED`, `CANCELLED`: finished.
  - `UNKNOWN`: the provider may have accepted the job but didn't confirm. The backend reconciles it with the same provider key. **Never offer a new paid attempt while a job is UNKNOWN.**
  - `NEEDS_REVIEW`: an operator decides.
  - `CANCEL_REQUESTED`: reserved; there's no cancel endpoint in the demo.
- **`stage`** (becomes the `JobStage` enum when the backend PRs merge): `submitting`, `retry_wait`, `reconcile`, `waiting_provider`, `output_ready`, `fetching_output`, `stored`. Show progress from these. There's no time estimate, because the provider gives none.
- **`failure_code`** when `FAILED`:
  - `content_rejected`: the provider refused the brief;
  - `provider_failed`: not charged;
  - `OUTPUT_EXPIRED`, `OUTPUT_UNAVAILABLE`: the provider billed but the image couldn't be kept;
  - `PROVIDER_INSUFFICIENT_BALANCE`, `PROVIDER_REJECTED`, `PROVIDER_NOT_CONFIGURED`;
  - plus a few operational codes. Show plain text, never the raw code alone.
- **`result_asset_id`:** set when `SUCCEEDED`. Load it with `GET /assets/{id}`.
- **`creative_version`:** the job is bound to one version. An edit after generating makes the image out of date; validate the new version, then generate again.

## 3. Errors from POST /creative-jobs

| Status and code | Meaning | UI (already done in NRC-21) |
|---|---|---|
| 409 `VALIDATION_NOT_PASSED` | This version hasn't passed validation | "Validate this version" |
| 412 `VERSION_CONFLICT`, `details.current_version` | A newer version exists | Reload, validate, then generate |
| 409 `GENERATION_NOT_ELIGIBLE`, `details.reason` | `STUDY_CLOSED`, `LANGUAGE_NOT_ALLOWED`, `FORMAT_NOT_ALLOWED`. With Dinesh's NRC-7 also `STALE_VERSION`, `NOT_VALIDATED`, `NO_ACTIVE_POLICY` | One message per reason |
| 429 `GENERATION_LIMIT_REACHED`, `details.reason` | `ACTIVE_JOB_LIMIT` (2 running per organisation; try later) or `CREDIT_CEILING` (today's allowance used) | Distinct messages; only the first offers "Try again" |
| 409 `CONFLICT` | The same command is still being set up | Wait, then try again with the same key |
| 403 | The role lacks `generation:run` | Permission answer |
| 503 or a network error | Temporary | "Try again" with the **same** key |

`GET /assets/{id}` can return **503 `STORAGE_UNAVAILABLE`**. Show it as temporary ("try again"), not as "not found".

## 4. What NRC-21 adds to the web app (this PR)

| File | Contents |
|---|---|
| `src/api/jobs.ts` | `jobsApi.start` / `jobsApi.get`, `JOB_STAGES`, which mirror the backend's `JobStage` until the generated type exists, `jobProgress` (state and stage to step), `failureText`, `isJobTerminal` |
| `src/pages/create/useGeneration.ts` | `useJob` (polling with backoff and jitter, 15 s while UNKNOWN or NEEDS_REVIEW, stops 30 minutes after `created_at` and offers "Check again"), `useStartGeneration` (one key per command, reused after a lost or temporary failure), `startProblem` (error to copy), `generationSummary`, `jobPath` |
| `src/pages/create/generation.tsx` | `GenerationStatus`: the step 4 panel (progress, failed, unconfirmed, review, saved image with provenance) |
| `src/pages/create/parts.tsx` | `ReadinessCard` gains the Generation row and the **Generate image** button. It's enabled only for a saved version whose current validation passed, with `generation:run`, and no job running or unconfirmed. Generate becomes the primary button once validation has passed |
| `src/pages/create/Composer.tsx`, `CreatePage.tsx` | Wiring, and the route `/marketing/create/:creativeId/generation/:jobId`. The job id is in the **path** because sign-in keeps only the path, so a reload finds the same job |
| `src/mocks/api.ts`, `server.ts`, `types.ts` | Simulation: `POST /creative-jobs` and `GET /jobs/:id` follow the backend's states and codes. Jobs persist in sessionStorage. The Simulation tools card can make the next image be refused, stay unconfirmed, hit the daily limit or lose its answer |
| `e2e/generation.spec.ts` | Progress and reload recovery, double click (1 job), lost answer (same job), refused, unconfirmed, limit, edited brief |
| `e2e/create.spec.ts` | One assertion updated: Generate is now offered for a passed version, and turned off after an edit |

## 5. What you need to do or know

1. **Review this PR.** It's stacked on your branch and targets `feature/NRC-marketing-ui`.
2. **Final preview and export:** your preview reads `creative.asset_id`. The backend is changing so that `CreativeRead.asset_id` returns the newest generated image for the **current** version, and is empty after an edit. No change on your side. `GET /creatives/{id}/export` still returns 501 in the backend; that's Dinesh's.
3. **After the backend PRs merge:** regenerate `src/api/schema.d.ts`. `JobRead.stage` becomes the `JobStage` enum, so `JOB_STAGES` in `src/api/jobs.ts` can switch to the generated type.
4. **Your simulated validation conflict:** `POST /validations` returns 409 `VERSION_CONFLICT` in `src/mocks/api.ts`. The backend returns **412** for a stale version, so please align it.
5. **`docs/contracts/workspace.md`** still describes `application/problem+json` with `errors[]`. The agreed body is `{code, message, request_id, details, retryable}`.
6. **Known gap:** Generate's busy check only knows the job in the address. A second tab, or opening the draft without the job id, can start another job. The backend caps running jobs per organisation (2), so it's bounded, not prevented. A later fix needs an API for "the draft's active job".
7. **NRC-18 and NRC-20:** your Media and Rules pages overlap my tickets. Let's agree who finishes which. The demo needs a read-only rules view, and media upload needs an upload API that isn't built yet.
8. **Real API:** the web app's Cognito mode needs Prabhu's pool, with the `marketing/api` scope and the callbacks `/auth/callback` and `/signed-out` registered for `http://localhost:5173` and the staging URL. The API also needs `CORS_ORIGINS` to include the web origin. Already in place: the API allows `Authorization`, `Idempotency-Key`, `If-Match` and `X-Tenant-Id`, and exposes `Location` and `ETag`.

## 6. Things the backend guarantees, so the UI doesn't need to

- No provider key or provider URL ever reaches the browser. Images come only through our 15-minute links.
- Spend is bounded before any paid call: an estimate cap per image, a daily allowance per organisation and a global budget.
- A finished job never changes state again. An image that's paid for but can't be stored is never silently retried as a new paid job.
- Live Higgsfield generation stays off until Dinesh's validation gate (NRC-7) is in place. Until then the provider is a labelled simulator, and its images are marked as simulation.
