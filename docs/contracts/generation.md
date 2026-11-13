# Image generation, jobs and generated images (NRC-6, NRC-3, NRC-10, NRC-21)

What the backend provides for generation, what the web app does with it, and what the rest of the UI needs to know. Owner: Firoz (NRC-21). Backend PRs: nrc-marketing-api #1 (jobs), #2 (storage), #3 (Higgsfield), #5 (feed size), #7 (eligibility).

The Generate flow on `main` (Praneeth's `GenerationStep` and `useGeneration`) is the base. NRC-21 (PR #2) hardens it: response checks, timeouts, UUID ids, backend terminal states, progress by known steps, every refusal code, and an always-mounted status region.

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
- **`stage`** (the backend's `JobStage`, still a plain string in the contract): `submitting`, `retry_wait`, `reconcile`, `waiting_provider`, `output_ready`, `fetching_output`, `stored`. Show progress from these. There's no time estimate, because the provider gives none. A stage the web app doesn't know keeps the state's own step.
- **Finished states** are only `SUCCEEDED`, `FAILED` and `CANCELLED` (the backend's `TERMINAL_STATES`). `UNKNOWN` and `NEEDS_REVIEW` can still be settled, so the web app keeps reading them slowly (every 15 s) with Generate off.
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
| 409 `VALIDATION_NOT_PASSED` or 409 `GENERATION_NOT_ELIGIBLE` | This version may not be generated; the server's `message` says why | The server's message; eligibility is read again |
| 412 `VERSION_CONFLICT`, `details.current_version` | A newer version exists | Reload, validate, then generate; eligibility is read again |
| 429 `GENERATION_LIMIT_REACHED`, `details.reason` | `ACTIVE_JOB_LIMIT` (2 running per organisation; try later) or `CREDIT_CEILING` (today's allowance used) | Distinct messages; only the first offers "Try again" |
| 409 `CONFLICT` | The same command is still being set up | Wait, then try again with the same key |
| 403 | The role lacks `generation:run` | Permission answer |
| 503, a network error or a timeout (15 s) | Temporary, or the answer was lost | "Generate again" resends the **same** key |
| 202 whose body can't be read | The job may exist | Same key on the next Generate |

`GET /assets/{id}` can return **503 `STORAGE_UNAVAILABLE`**. Show it as temporary ("try again"), not as "not found".

## 4. What the web app does (main plus NRC-21)

| File | Contents |
|---|---|
| `src/api/jobs.ts` | `jobsApi.startImage` / `jobsApi.get` on the generated schemas. On top of `S.JobRead`/`S.JobAccepted`: `job_id` must be a UUID, and a state this build doesn't know reads as `UNKNOWN`. `get` refuses a non-UUID id as not found, without a request. Each request times out after 15 s; a timeout counts as a lost answer. Also `JOB_STAGES`, `jobProgress` (state and stage to a known step), `failureText` (known `failure_code` first, then the server's `failure_message`), `isJobDone` (backend terminal states), `isJobUnsettled`, `jobKeys` |
| `src/pages/create/generationRules.ts` | Pure rules: `startProblem` (every code `POST /creative-jobs` returns, and whether the next Generate resends the same key), `commandFor`/`commandAfterProblem`, `jobPollDelay` (backoff while running, 15 s while unsettled, stop when done or 30 minutes after `created_at`), `generationAnnouncement` |
| `src/pages/create/useDraftChecks.ts` | `useGeneration`: the job id is kept per tab in sessionStorage (only a UUID is accepted back), so a reload follows the same job. A synchronous guard stops a double click; the start is aborted when the page goes away; refusals are toasts. Returns `active`, `unsettled`, `pollingStopped` and `checkAgain` |
| `src/pages/create/Generation.tsx` | `GenerationStep`: progress by known steps, the failed, unconfirmed, review and cancelled states, "Check again" after the polling window, the saved image with provenance and "still needs its final validation". One screen-reader status region stays mounted for the step's life |
| `src/mocks/api.ts` | Simulated job ids are UUIDs like the API's |
| Tests | `src/api/jobs.test.ts`, `src/pages/create/generationRules.test.ts`, `useDraftChecks.generation.test.tsx` (hook, MSW), `Generation.test.tsx` (component), `e2e/generation.spec.ts` (double click makes one job; a tampered job reference is ignored) |

## 5. What you need to know

1. **Busy check per tab:** the stored job is per browser tab, so a second tab can start another job. The backend caps running jobs per organisation (2), so it's bounded, not prevented. A later fix needs an API for "the draft's active job".
2. **After the contract types `stage` as `JobStage`:** regenerate the schemas (`npm run gen:api`) and switch `JOB_STAGES` to the generated type.
3. **Not in the demo:** cancel, video, model and cost choices, and the final-image validation result.

## 6. Things the backend guarantees, so the UI doesn't need to

- No provider key or provider URL ever reaches the browser. Images come only through our 15-minute links.
- Spend is bounded before any paid call: an estimate cap per image, a daily allowance per organisation and a global budget.
- A finished job never changes state again. An image that's paid for but can't be stored is never silently retried as a new paid job.
- Live Higgsfield generation stays off until Dinesh's validation gate (NRC-7) is in place. Until then the provider is a labelled simulator, and its images are marked as simulation.
