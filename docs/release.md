# Frontend release and demo readiness (NRC-27)

Status on 10 November 2026: **simulation only.** Every journey below passes against the local fake API and dummy
data. None of it is staging or live-provider evidence. Staging runs replace it once the backend is deployed (Prabhu)
and Cognito is set up (Bhushan).

## Build

```powershell
$env:VITE_AUTH_MODE='cognito'; npm run build   # static files in dist/
npm run check:build                              # no source maps, simulation code, dummy data or secrets
```

- Configuration is in `.env.example`. Every value is public; no secrets at build time.
- A production build contains **no simulation code** (fake sign-in, fake API, local dummy data): `SIMULATION_BUILD`
  in `src/config/env.ts` is a build-time constant. `npm run check:build` fails if any of it, a source map or an obvious
  secret appears in `dist/`.
- The app is a single page with deep links (`/marketing/create/{id}`, `/marketing/validation/{id}/{run}`): the host must
  answer unknown paths with `index.html` (CloudFront custom error response, 403/404 → `/index.html`, status 200).
- Cache: `assets/*` are content-hashed and can be cached for a year; `index.html` must not be cached
  (`Cache-Control: no-cache`). Roll back by re-uploading the previous `dist/` and invalidating `/index.html`.
  S3/CloudFront setup and the rollback demonstration are with Prabhu (NRC-26).

## Baseline (10 Nov, `npm run build`, before gzip; gzip in brackets)

| File | Size |
|---|---|
| Main bundle (`index-*.js`) | 390 kB (127 kB) |
| Cognito sign-in (loaded at start in production) | 69 kB (18 kB) |
| Create page | 39 kB |
| Validation (shared) and page | 21 kB + 14 kB |
| Styles | 51 kB (11 kB) |

Measured route load, layout shift and device/network timings are not recorded yet: they need the staging URL.

## Automated checks

| Command | What it covers |
|---|---|
| `npm run typecheck` | Strict TypeScript, including the types generated from the backend spec (`src/api/schema.d.ts`) |
| `npm test` | Unit tests: HTTP/401 refresh, return paths, Unicode highlights, diff, poll backoff, export clean-up |
| `npm run test:e2e` | Playwright at desktop, laptop and mobile widths: sign-in and session (NRC-16), drafts (NRC-17), validation (NRC-19), revisions (NRC-22), final preview (NRC-23), the demo journey and crash recovery (NRC-27), plus an axe WCAG 2.1 AA and layout audit of every screen, light and dark |

Failure states covered in simulation: session expiry and refresh (401), no access (403), not found (404), idempotency
and closed study (409), version conflict (412), field errors (422), save failure with retry (503), not built yet
(405/501), validation timeout and unreadable input, page crash (error boundary with a reference, shell keeps working).

## Demo rehearsal checklist (12 Nov)

1. Sign in (Cognito test user) → choose the organisation.
2. Create → pick the study → write a brief with a phrase the rules flag → Create draft.
3. Validate → show execution state vs result, gates, findings, source, highlight.
4. Revise the brief → findings beside the editor → fix → Versions → Compare with the earlier version.
5. Validate again → passes the assessed checks (not an approval).
6. Generate the image (Firoz's component) → Final preview → Download review draft.
7. Sign out.

## Blockers for staging evidence

| Needed | From | Blocks |
|---|---|---|
| Cognito pool, app client, domain, test users | Bhushan | Real sign-in (step 1) |
| Staging URL, S3/CloudFront, deployed backend | Prabhu, Dinesh | Every integrated run; deployment and rollback |
| Validation endpoints (D2) | Dinesh | Steps 3–5 on real data |
| Image generation (D3) and Firoz's generation component (NRC-21) | Dinesh, Firoz | Step 6 and the export |
| Approved real study snapshot | Dinesh | Demo content |
