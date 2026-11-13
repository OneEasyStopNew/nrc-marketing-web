# Workspace endpoints: proposed contracts

**Status: proposal from the web app, not in `contracts/openapi.json`.** The
Media, Rules, Approvals, Publications, Connected accounts and Team pages, plus
the role dashboards, call these endpoints. The real API answers 404/405/501
today, and each page then shows "Not available yet" instead of failing. In
simulation (`VITE_AUTH_MODE=simulation`) the mock server in `src/mocks/api.ts`
implements them, including the rules below.

Types are in `src/api/workspace.ts`. Field names follow the existing
contracts: snake_case, ISO 8601 UTC timestamps, and errors as
`application/problem+json` with `code`, `request_id` and `errors[]`
(`loc`/`msg`/`type`), the same as `/creatives`.

Common to every endpoint:

- `Authorization: Bearer …` and `X-Tenant-Id`, as today. Every list is scoped
  to the tenant.
- A missing capability returns **403** `FORBIDDEN`. The page then shows the
  "not available with your role" state.
- `POST` that creates something takes an `Idempotency-Key`. A repeat with the
  same key returns the first result.
- Lists are returned whole for now. Add `limit`/`cursor` when a tenant has
  more than about 200 rows. The UI pages client-side until then.

## Dashboards

| Method | Path | Capability | Returns |
|---|---|---|---|
| GET | `/creatives` | `creative:read` | `DraftSummary[]`, newest first |
| GET | `/activity` | `creative:read` | `ActivityItem[]`, newest first, last 50 |

`DraftSummary` extends today's `CreativeSummary` (id, study_id, version,
prompt_preview, updated_at) with `study_title`, `created_by`, `validation`,
`review` and `has_image`. Existing callers keep working.

- `validation` is one of `NOT_RUN | RUNNING | PASS | FAIL | NEEDS_REVIEW | STALE`.
- `STALE` means the latest run is for an older version.

## Media (NRC-18)

| Method | Path | Capability | Notes |
|---|---|---|---|
| GET | `/media` | `creative:read` | `MediaAsset[]` |
| POST | `/media` | `creative:write` | Body `MediaUpload`; returns `MediaAsset` with status `PENDING_CHECK` |
| DELETE | `/media/{id}` | `creative:write` | 409 `IN_USE` while a draft uses it |

Rules the server must enforce:

1. `people_shown: true` requires `consent_on_file: true`. Otherwise return 422 on `consent_on_file`.
2. `source` and `licence` are required.
3. `preview_url` is short-lived and never stored by the client.

Upload of the bytes themselves is out of scope here. We expect a signed
upload URL step; please propose the shape.

## Rules (NRC-20)

| Method | Path | Capability | Notes |
|---|---|---|---|
| GET | `/rules` | `creative:read` | `PolicyRule[]`, all statuses |
| POST | `/rules` | `policy:manage` | Body `RuleDraft`; creates status `DRAFT`, version 1 |
| PATCH | `/rules/{id}` | `policy:manage` | `If-Match: "<version>"`; body is part of `RuleDraft` and/or `status` |

Rules the server must enforce:

- A changed active rule becomes a new version. Earlier validation runs keep the version they used.
- A missing `If-Match` returns 428. A stale one returns 412 `VERSION_CONFLICT` with `current_version`.
- `source.clause` is required. Every rule must trace to a clause.
- Allowed status changes: `DRAFT → ACTIVE` and `ACTIVE → RETIRED`. Anything else returns 409.

## Approvals

| Method | Path | Capability | Notes |
|---|---|---|---|
| GET | `/approvals` | `approval:decide` or `creative:read` | `ApprovalRequest[]` |
| GET | `/approvals/{id}` | same | one request |
| POST | `/approvals/{id}/decision` | `approval:decide` | Body `{ decision, reason, creative_version }` |

Rules the server must enforce. The UI already blocks these cases, but it cannot be trusted to.

- **403 `SELF_APPROVAL`:** the decider submitted the post. `is_own` tells the UI in advance.
- **409 `NOT_PENDING`:** already decided, or `STALE`.
- **409 `VERSION_CONFLICT`:** `creative_version` is not the version under review.
- **409 `NOT_ELIGIBLE`:** `APPROVE` when validation for that version is not a current `PASS`.
- **422 on `reason`:** `REQUEST_CHANGES` or `REJECT` sent without a reason.
- A new draft version makes open requests `STALE`.

## Connected accounts (NRC-13)

| Method | Path | Capability | Notes |
|---|---|---|---|
| GET | `/accounts` | `creative:read` | `SocialAccount[]` |
| POST | `/accounts` | `publication:manage` | Starts Meta OAuth; see below |
| POST | `/accounts/{id}/reconnect` | `publication:manage` | Same OAuth flow for an existing account |
| DELETE | `/accounts/{id}` | `publication:manage` | 409 `HAS_SCHEDULED` while posts are scheduled to it |

- Access tokens never reach the browser.
- In production, `POST /accounts` should return a redirect URL to Meta's consent screen. The callback is handled server-side, then returns to `/marketing/integrations`.
- The simulation skips this and creates a `TEST_ONLY` account.
- `state` tells the UI what the person must fix: `PERMISSION_MISSING`, `EXPIRED`, `REVOKED` or `PENDING_APP_REVIEW`. Put the human sentence in `state_reason`.

## Publications (NRC-14, NRC-15)

| Method | Path | Capability | Notes |
|---|---|---|---|
| GET | `/publications` | `publication:manage` | `Publication[]` |
| POST | `/publications` | `publication:manage` | Body `PublicationRequest`; `Idempotency-Key` required |
| POST | `/publications/{id}/cancel` | `publication:manage` | 409 `NOT_CANCELLABLE` unless `SCHEDULED` or `QUEUED` |

Rules the server must enforce:

- Only an `APPROVED` version can be scheduled. Anything else returns 409 `NOT_APPROVED`.
- Every account must be `CONNECTED` or `TEST_ONLY`. Otherwise return 422 on `account_ids`.
- `publish_at: null` means as soon as possible. The response state is then `QUEUED`, never `PUBLISHED`. `PUBLISHED` is set only after the provider confirms.
- If the provider does not answer, the state is `UNKNOWN`. Do not auto-retry, because that risks a double post.
- If the draft changes after scheduling, the publication is `CANCELLED` with a reason before sending.
- `publish_at` is local wall time (`YYYY-MM-DDTHH:mm`) in `timezone` (IANA name). The server resolves it, including DST.

## Team

| Method | Path | Capability | Notes |
|---|---|---|---|
| GET | `/members` | `membership:manage` | `Member[]` |
| POST | `/members` | `membership:manage` | Body `{ name, email, roles }`; returns status `INVITED` |
| PATCH | `/members/{id}` | `membership:manage` | Body `{ roles }` |

Rules the server must enforce:

- At least one role is required (422 on `roles`).
- A duplicate email returns 422 on `email`.
- You cannot remove your own `admin` role: 409 `LAST_ADMIN`.
- Roles here map to the capabilities the session endpoint returns. Sign-in itself stays with the identity provider.

## Open questions for the backend

1. Does the approval queue live in this service or in a separate workflow service?
2. What is the signed-upload flow for media bytes?
3. What do we return to the browser for the Meta OAuth start (a redirect URL, or a 303)?
4. What is the retention for `/activity`, and should it be the audit log itself or a view of it?
