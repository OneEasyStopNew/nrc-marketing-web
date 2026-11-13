# Session contract: sign-in, `/me`, `/context`

Status: **backend contract published by Dinesh (NRC-1 / NRC-2), 9 November 2026.**
The source of truth is `contracts/openapi.json` in `OneEasyStopNew/nrc-marketing-api` (commit `2c65c7e`); `src/api/schemas.gen.ts` is generated from it (`npm run gen:api`), and every response is checked against those schemas at runtime. This page records what the frontend relies on. Paths are relative to `/v1/marketing`.

## Identity (Cognito, owned by Prabhu)

| Item | Value |
|---|---|
| Flow | Managed login, authorization code + PKCE, public app client (no secret) |
| Callback / sign-out URLs | `<origin>/auth/callback`, `<origin>/signed-out` (localhost:5173 plus the staging web URL) |
| Scopes | `openid email profile marketing/api` (`marketing/api` to be confirmed by Prabhu) |
| Token sent to the API | **Access token** as `Authorization: Bearer …`. ID tokens are rejected |
| Name and email | From the **ID token**; the access token carries neither |
| Lifetime | Set on the app client (Cognito default: 1 hour). Revoking the refresh token on sign-out does not end the current access token |
| Disabled account, MFA required | Stopped by Cognito at sign-in; arrive as a callback error, never from the API |

Pending from Prabhu: user pool ID, app client ID, Hosted UI domain, test accounts and the staging URL.

## Tenant

Send `X-Tenant-Id`. The backend checks it against the user's current membership on every request, so removing access works straight away.

## `GET /me`

```json
{ "sub": "…", "username": "…", "memberships": [{ "tenant_id": "…", "tenant_name": "…", "roles": ["…"], "capabilities": ["…"] }] }
```

No membership → 200 with `memberships: []` → "No access to Marketing".

## `GET /context` (with `X-Tenant-Id`)

```json
{ "tenant_id": "…", "tenant_name": "…", "roles": [], "capabilities": [], "studies": [], "languages": ["en"], "post_formats": [] }
```

Study and format fields: see creatives.md.

## Errors

Shape: `{ code, message, request_id, details, retryable }`.

| Status / code | UI |
|---|---|
| 401 `UNAUTHENTICATED` | One token refresh and one retry; still 401 → "Your session ended", sign in again, return to the same page |
| 403 `FORBIDDEN` on `/context` | Not a member, or the role does not allow Marketing → back to the organisation chooser |
| 403 `FORBIDDEN` elsewhere | Shown as a permission answer; never signs the user out |
| 501 `NOT_IMPLEMENTED` | In the spec but not built yet → "not available yet" |

## Roles and capabilities

Roles (display only): `creator, reviewer, policy_admin, publisher, admin`.

| Capability | UI use |
|---|---|
| `creative:write` | Create section; create and edit drafts |
| `creative:read` | Validation and Media sections |
| `validation:run`, `generation:run` | Validate / Generate buttons (later tickets) |
| `approval:decide` | Approvals |
| `policy:manage` | Rules |
| `publication:manage` | Publications, Connected accounts |
| `membership:manage` | Not used yet |

The section mapping is the frontend's choice; the API checks every request itself.
