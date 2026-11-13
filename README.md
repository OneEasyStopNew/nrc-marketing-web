# NRC Marketing web

React 18 + TypeScript + Vite frontend for the NRC Marketing module (HLD v1.1: React/TypeScript → API Gateway → FastAPI on EKS). Static build served from S3 + CloudFront.

## Run

```bash
npm install
cp .env.example .env   # VITE_AUTH_MODE=simulation for local work
npm run dev                  # http://localhost:5173
npm run typecheck            # app, build config and browser tests
npm run lint                 # ESLint, type-aware (eslint.config.js)
npm run format               # Prettier (CI check follows the one-time reformat)
npm test                     # unit tests (vitest)
npm run test:e2e             # browser tests (Playwright, simulation mode, 3 widths + dark); not in CI, see below
npm run build                # production build into dist/
npm run check:build          # scans dist/ for source maps, simulation code, dummy data and secrets
npm run gen:api              # regenerates src/api/schemas.gen.ts from src/api/openapi.json

CI (`.github/workflows/web-ci.yml`) runs audit, lint, typecheck, unit tests, build and the
build check on every pull request. Every API response is checked against the generated zod schemas; a
response that does not match fails as `CONTRACT_MISMATCH`. Installs only take package versions that are
at least 7 days old (`.npmrc`).
```

## Sign-in and session (OR-102)

- **Cognito managed login, authorization code + PKCE** (`src/auth/cognito.ts`). Password, MFA, federation and reset forms all live on the Cognito pages.
- **Tokens stay in memory.** A reload goes back through Cognito once; an active Cognito session signs the user straight back in. Nothing that grants access is written to localStorage or IndexedDB.
- **One session state machine** (`src/auth/AuthProvider.tsx`): booting, signed out (with reason), loading, choose organisation, ready, blocked (disabled / no access / MFA), failed (network or server, with retry). Each state has its own screen, so the user never sees a blank page.
- **`/me` then `/context`** decide the organisation, roles and capabilities. The sidebar and route guards use capabilities; the API authorizes every request again.
- **HTTP** (`src/api/http.ts`): Bearer token and `X-Tenant-Id`. A 401 triggers one shared refresh and one retry, and only then ends the session. A 403 is shown as a permission answer and never signs the user out.
- **Cache isolation:** switching organisation, a session expiring and signing out all clear the query cache. Signing out also reloads the page, which drops all in-memory state, and tells other tabs to sign out.
- **Return path:** only `/marketing…` paths survive sign-in (`src/auth/returnTo.ts`). The query string and hash are dropped.

Contract with the backend: [docs/contracts/session.md](docs/contracts/session.md).

## Create: composer, study selection and versioned drafts (NRC-17)

- **Studies come from `/context`.** Approved facts, required wording and sites are shown read-only. Separate states for no studies configured, none recruiting, and closed-study drafts, which open as read-only history.
- **Nothing is created by opening the page.** `POST /creatives` runs only on *Create draft*; the address then becomes `/marketing/create/{id}`, so a reload restores the draft.
- **Versioned saves.** Autosave runs about 1.5 s after typing stops, one request at a time, always with `If-Match`. The status shows unsaved, saving, saved with the version number, or failed. A failed save keeps the text and retries once automatically.
- **Conflicts (412)** open a side-by-side comparison: use their version, save mine as the next version, or copy my text. Nothing is overwritten silently.
- **Leaving with unsaved work** asks first, for in-app links and the back button (`useBlocker`, which needs the data router in `main.tsx`) and for tab close or reload.
- **Readiness** shows the brief, caption and image checks and the backend's generation eligibility for the current version. Any edit marks the last result out of date immediately.
- **Image** is generated only when `GET /creatives/{id}/generation-eligibility` allows it for the current version. The job is followed until it ends; a reload follows the same job and never starts another.
- **Limits count Unicode characters**, so Spanish, other scripts and emoji are counted the way people count them.

Contract proposal: [docs/contracts/creatives.md](docs/contracts/creatives.md).

### Simulation mode and dummy data

`VITE_AUTH_MODE=simulation` swaps Cognito and the Marketing API for labelled dummy data, so screens can be built before the backend endpoints exist.

| File | Holds |
|---|---|
| `src/mocks/data.ts` | **All dummy data**, as data only. **Local only: git-ignored, never committed or pushed** |
| `src/mocks/types.ts` | The shape `data.ts` must export (`MockData`), committed so code and data agree |
| `src/mocks/load.ts` | Loads `data.ts` if it exists; without it the app still builds and the sign-in page says the file is missing |
| `src/mocks/api.ts` | The fake Marketing API: a route table (`'GET /me'`, `'GET /creatives/:id'`, …) answering from `data.ts` |
| `src/mocks/server.ts` | In-memory state shared by fake sign-in and fake API (issued tokens) |
| `src/auth/simulation.ts` | Simulation sign-in (same redirect and callback flow as Cognito) |

The fake API replaces `fetch` inside `src/api/http.ts`. Pages call the same `src/api/*` functions in both modes, so the Bearer header, refresh and 403 handling run unchanged. Switching to the real API is a configuration change, not a code change.

To add dummy data for a new endpoint, add its type to `MockData` in `types.ts`, the data to your local `data.ts`, then one entry to `ROUTES` in `api.ts`. On a fresh clone, create `src/mocks/data.ts` that exports `TENANTS` and `USERS` matching `types.ts`; the browser tests need it. Values must be visibly fake. Never add real study facts, people or patient data.

The dummy users are a creator, a reviewer with two organisations, an administrator, a user with no access, a disabled account and a user missing MFA. The account menu adds *Expire access token* and *End session* for testing the refresh and expiry paths. A production build refuses simulation mode unless `VITE_ALLOW_SIMULATION=true`. Simulation results never count as live evidence.

### Development against the real API (`devtoken`)

Until Cognito is set up, the backend accepts a local development token. `VITE_AUTH_MODE=devtoken` runs the real screens against the real Marketing API in `npm run dev`:

```
# .env (git-ignored)
VITE_AUTH_MODE=devtoken
DEV_API_TARGET=http://<host>:8001      # where the Marketing API runs, without a path
DEV_API_TOKEN=<development access token from the backend, lasts up to 24 hours>
```

- The Vite dev server forwards `/v1/...` to `DEV_API_TARGET` and adds the token there (`vite.config.ts`). The browser never holds the token and sends no `Authorization` header; the two `DEV_` names cannot reach a bundle because they do not start with `VITE_`.
- The mode exists only in `npm run dev`. A build refuses it, and `npm run check:build` fails if its code or any token is in `dist/`.
- When calls start answering 401, the token has expired: put a new one in `.env` and restart `npm run dev`.
- The browser tests always run in simulation mode, whatever `.env` says.
- `npm run dev:sim` starts a second dev server on port 5174 that is always in simulation mode, so the dummy sign-ins for every role stay one command away while `npm run dev` talks to the real API.

What the screens do where the demo API does not fill a field yet:

| API today | The screen |
|---|---|
| `CreativeRead.validation_runs` is always empty | Remembers the runs started in this tab (ids only, `sessionStorage`) and reads them back; the brief's state also comes from `generation-eligibility` |
| `CreativeRead.asset_id` stays null after generation | Finds the image of the current version from the job, then from `GET /creatives/{id}/export` |
| No `GET /creatives` (answers 405) | Draft lists say "not available yet"; a draft opens from its link |

## Design

The UI is built with Astryx (`@astryxdesign/core`, neutral theme with the NRC brand blue as accent) and follows its page templates; there is no custom CSS or utility-class styling. The thin wrappers in `src/components/ui` render Astryx components. Icons are Heroicons. `design-system/` holds the earlier NRC Connect design system, for reference only.

## Layout

```
src/
  api/          http.ts (fetch client), errors.ts (error contract), session.ts (/me, /context)
  auth/         AuthProvider (session state machine), cognito.ts, simulation.ts, returnTo.ts
  mocks/        data.ts (local-only dummy data, git-ignored), types.ts, load.ts, api.ts (fake API routes), server.ts
  config/       env.ts (build config), nav.ts (sections and capabilities)
  components/   ui/ (design-system kit), layout/AppLayout.tsx (TopBar + sidebar)
  pages/        auth/ (sign-in, choose organisation, blocked, failed), Home, Section, NoPermission, NotFound
e2e/            Playwright: auth.spec.ts (OR-102 acceptance), layout.spec.ts (axe + design rules)
```
