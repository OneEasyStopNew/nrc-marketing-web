# Study snapshot and creative drafts contract

Status: **backend contract published by Dinesh (NRC-2), 9 November 2026.**
The source of truth is `contracts/openapi.json` in `OneEasyStopNew/nrc-marketing-api` (commit `2c65c7e`).
`src/api/schemas.gen.ts` (zod schemas and types) is generated from a copy of it in `src/api/openapi.json`; after every contract change copy the new file there and run
`npm run gen:api`, then run
`npm run typecheck`. Paths are relative to `/v1/marketing`.

## Studies, inside `GET /context`

Each study (`StudySnapshotRead`): `study_id, study_title, study_external_ref, snapshot_id, version (integer),
recruitment_status (recruiting | closed), language, facts, source_ref, approved_by, approved_at, is_synthetic`.
`facts`: `condition, eligibility_summary, min_age, max_age (integer or null), sites, approved_claims,
required_disclosures (string arrays), compensation_statement, contact_url (string or null)`.

- `studies: []` → "No study set up for Marketing". Only closed studies → "No study is recruiting right now"; their drafts open read-only.
- Facts and required disclosures are displayed read-only, exactly as received.
- `is_synthetic` studies carry a "Demo study" badge.

`post_formats`: `{ channel, post_format, aspect_ratio, width_px, height_px }`. The enums allow only `en`, `facebook`, `feed_image` for now.

Limits (Unicode characters): prompt **4,000**, caption **2,200**.

## Creatives

| Method and path | Behaviour |
|---|---|
| `POST /creatives` | **Only on an explicit "Create draft".** Header `Idempotency-Key` (8–128 of letters, digits, `_`, `-`; a new key per save, the same key on retry). Body `study_id, prompt, language, channel, post_format`, optional `caption`. 201 with `id` and `version`, plus `ETag` and `Location` |
| `GET /creatives/{id}` | Current version + `ETag` |
| `GET /creatives/{id}/versions` | History, newest first, cursor paging (used later by NRC-22) |
| `PATCH /creatives/{id}` | `If-Match: "3"` (quotes included). Body `current_prompt` and/or `caption`; `caption: null` clears it. Language, channel and format cannot be changed (`CreativeUpdate` has only these two fields) |
| `GET /creatives` | Draft list: **not in the contract**. The API answers 405, shown as "not available yet". The local fake API still serves a list so drafts can be reopened |

`CreativeRead`: `id, study_id, version, original_prompt, current_prompt, caption, language, channel, post_format,
study_snapshot_id, study_snapshot_version, asset_id, created_by, created_at, updated_at, validation_runs`.
Each validation run summary: `validation_run_id, input_kind, creative_version, state, outcome, is_current,
evaluated_at`. The UI uses the run with `is_current` for the current version; anything else is "Out of date".
Generation eligibility is **not in the contract**; the UI shows "Not available yet" and never enables Generate.

## Errors

| Status / code | UI |
|---|---|
| 412 `VERSION_CONFLICT`, `details.current_version` | Side-by-side: use their version, save mine as the next version, or copy my text. Never overwrites silently |
| 428 `PRECONDITION_REQUIRED` | Missing `If-Match`; should not happen |
| 409 `IDEMPOTENCY_KEY_REUSED` | Same key, different body; should not happen (a new key per intended save) |
| 422 `VALIDATION_FAILED`, `details.fields: [{ loc, msg, type }]` | Message under each field (`loc` ending in `current_prompt` maps to the brief); focus moves to the first |
| 409 `STUDY_CLOSED` | Draft shown as read-only history |
| 404 | "Draft not found"; never reveals another tenant's draft |
| 503 with `retryable: true` | "Save failed", text kept, one automatic retry |

## Revisions (NRC-22 demo slice)

- The draft page lists every version from `GET /creatives/{id}/versions` (10 per page, "Show older versions"), with
  author, time and what validation said about that exact version (from `validation_runs`).
- "Compare with now" shows a word-level diff (removed struck through, added underlined, with screen-reader labels).
  "Use version N text" copies the older text into the editor; autosave stores it as a **new** version through
  `If-Match`. No version is ever changed or deleted.
- Findings from the latest validation sit beside the editor as a to-do list, labelled with the version they were for.
- Not in this slice: AI-suggested corrections (needs the revision API, NRC-11) and image/video edits (NRC-21).

## Final preview and review-draft export (NRC-23 demo slice)

| Method and path | Use in the UI |
|---|---|
| `GET /assets/{asset_id}` | The image for `CreativeRead.asset_id`. `download_url` is short-lived: shown, never stored or logged; refetched a minute before `download_url_expires_at` |
| `GET /creatives/{id}/export` | "Download review draft": the `ExportManifest` (status `DRAFT`) saved as `nrc-review-draft-<id>-v<version>.json`, with `download_url` and its expiry **removed** from the file |

- `/marketing/create/{id}/preview` shows the exact saved version: caption in full, the image, channel, format,
  language, study snapshot version, validation freshness with a link to the evidence, policy bundle, image origin and
  checksum reference, and the required wording in full. Nothing is editable; unsaved edits cannot be previewed.
- It always says "Draft for review, not approved, not posted". Reviewer approval (NRC-12/NRC-23 full scope) is later.
- Warnings: the study snapshot changed since the draft; the brief changed after the image was made (editing the brief
  never changes the image).
- `ExportManifest.image` is required, so the download is disabled until the draft has an image. *To confirm:* the
  status code when there is none (the fake API answers 422).
- Firoz's optional evidence download (NRC-20/21) mounts on this page when it is ready.
