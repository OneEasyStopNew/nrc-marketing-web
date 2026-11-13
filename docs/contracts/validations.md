# Validation contract (NRC-19 frontend, NRC-7/NRC-8 backend)

Source of truth: `contracts/openapi.json` in `OneEasyStopNew/nrc-marketing-api` (commit `2c65c7e`); types in
`src/api/schemas.gen.ts` (`npm run gen:api`). The backend returns `501 NOT_IMPLEMENTED` for these endpoints until D2 ships; the UI then
says "Validation is not available yet". Paths are relative to `/v1/marketing`.

| Method and path | Use in the UI |
|---|---|
| `POST /validations` | Only on an explicit "Validate version N" for a **saved** version. Header `Idempotency-Key` (new per run, same on retry). Body `creative_id, creative_version, input_kind (brief, text or image)`, `asset_id` only for image. 202 → `validation_run_id`, then the results page opens |
| `GET /validations/{id}` | Polled from 1 s, ×1.5 each time, capped at 10 s, ±20% jitter; paused while the tab is hidden; stops at `SUCCEEDED`, `FAILED`, `NEEDS_REVIEW` or `CANCELLED`. The run id is in the URL (`/marketing/validation/{creative}/{run}`), so a reload picks the run up again |
| `GET /creatives/{id}/versions` | Text of the checked version when the draft has moved on, so highlights always match what was checked |

## How results are shown

- **Execution state** (queued, checking, could not finish) is shown apart from the **outcome** (PASS, FAIL, NEEDS_REVIEW).
- The four gates (`completeness, study_facts, policy, media`) are always listed. A gate the run did not report shows
  "Not assessed", never green. Human approval and publishing are listed as separate steps the validator does not decide.
- "Passed the assessed checks" appears only when the outcome is PASS, every reported gate passed and no mandatory rule is
  `UNABLE_TO_ASSESS`. An empty findings list alone never counts as a pass.
- A mandatory `UNABLE_TO_ASSESS` rule shows a blocking explanation with its `reason`.
- `is_current: false`, or a run for an older version than the draft, shows "This result is out of date": gates and the
  result read "Out of date", and "Validate version N" is offered.
- Findings: severity, `rule_id` v`rule_version`, explanation, quoted excerpt, suggested correction, source clause and
  excerpt, and "Show in text", which moves focus to the highlighted words. Filters: all, critical and major, minor,
  needs a decision.
- Highlights use `text_span` as **Unicode code points, end exclusive** (`src/lib/spans.ts`, unit-tested with emoji
  and Spanish).

## To confirm with the backend

- `input_kind: brief` checks `current_prompt` and `text` checks `caption` (the UI assumes this for highlights).
- A run for an older version: the UI expects `409 VERSION_CONFLICT` with `details.current_version` (not in the spec yet).
- Why a run `FAILED` (timeout, unreadable input): `ValidationRunRead` has no failure code; the UI shows the first
  `coverage_gaps` reason. A `failure_code`/`failure_message` on the run would let these show distinctly.
- A list of runs per creative beyond `validation_runs` on `CreativeRead`, if the Validation section needs one.

## Not in this slice

Image evidence (region overlays) waits for assets (D3/NRC-18); video (NRC-9) is later, per the 6 Nov plan.
