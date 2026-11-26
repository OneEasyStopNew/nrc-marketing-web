# Demo branch: web app against the validation-flow API

`demo/NRC-29-validation-flow` (web) is a throwaway branch so the backend team can run the
current screens against the API demo branch of the same name
(`nrc-marketing-api`, `demo/NRC-29-validation-flow`) before staging. Never open a PR from it and
never merge it. The real work goes to `main` through the normal feature branches.

## What to test

| Screen | How | API |
|---|---|---|
| Validate a brief | Create post → write a brief → **Create draft** → **Validate version N** | `POST /validations` (`input_kind: brief`), then polling `GET /validations/{id}` |
| Validate a caption | Same draft → **Check caption** | `POST /validations` (`input_kind: text`) |
| Results | Opens after either button: verdict, the checks per gate, findings with severity, highlighted text, suggested correction, source rule | `GET /validations/{id}`, `GET /validations/{id}/context` |
| Active rules | Rules in the menu | `GET /policies/active` |
| Rulebooks (NRC-20) | Rules → **Rulebooks**: every version with its status; open one for details, blocking problems, rules with their links, coverage and history | `GET /policy-bundles`, `.../{id}`, `/rule-records`, `/nodes`, `/edges`, `/checks`, `/audit` |
| Status buttons | On a version: **Send for review**, **Approve**, **Reject**, **Return to draft**, **Build again**, **Activate**, **Roll back**, **Retire**, each only for the role the API allows; the others are named ("Approve: only the policy owner can do this") | `POST .../transitions` with If-Match |
| Review | **Approve** / **Reject** on each unreviewed rule, wording, exception, disclosure or link, for the role that reviews that kind | `POST .../review-decisions` |
| Edit a draft | **Add a rule**, **Edit**, **Add wording**; **New draft from version N** on any version | `POST .../rules`, `PATCH .../rules/{id}`, `POST .../wordings`, `POST /policy-bundles` |
| Policy files | Rulebooks → **Policy files**: list, upload (PDF, text, Markdown up to 50 MB), clauses per file | `/policy-sources/uploads…`, `POST/GET /policy-sources`, `/clauses` |

Handled from the contract: per-rule `NEEDS_REVIEW`, 429 `VALIDATION_LIMIT_REACHED` (shown as a
retryable message), `suggested_correction` on findings, 409 `POLICY_BUNDLE_STATE` and
`POLICY_BUNDLE_HAS_ISSUES` (the issues are listed in the dialog), 412 on a stale revision.

The image download (`GET /creatives/{id}/export`) answers 501 on the API branch; the screens carry
on without it.

For the policy screens, also run `python -m app.workers.policy` (index builds and clause
reading) and `python -m app.workers.media` (file scans), with `POLICY_SOURCE_BUCKET` set in the
API's `.env` (locally the SeaweedFS bucket, e.g. `nrc-local-media`). Sign in as `dev-admin`
(policy_admin) or `dev-approver` (policy_approver) to see each role's buttons.

## Run it

Needs Node 24 (`.nvmrc`).

1. Start the API branch as its `DEMO_BRANCH.md` says: `docker compose up -d --wait`,
   `alembic upgrade head`, `scripts.seed_demo` with the four members, the API on port 8000 **and**
   `python -m app.workers.connector` (without the worker, validations stay QUEUED). Use dev tokens
   (`scripts.dev_token init`, `DEV_JWKS_FILE` in the API's `.env`) and
   `VALIDATION_MODEL_MODE=simulator`.
2. Issue a token for the user to test with, for example
   `uv run python -m scripts.dev_token issue --sub dev-creator` (valid 12 hours).
3. In this repo:

   ```powershell
   npm ci
   Copy-Item .env.example .env
   ```

   and set these three lines in `.env` (git-ignored; never commit a token):

   ```
   VITE_AUTH_MODE=devtoken
   DEV_API_TARGET=http://127.0.0.1:8000
   DEV_API_TOKEN=<the token from step 2>
   ```

4. `npm run dev`, open http://localhost:5173 and click **Continue**.

The Vite dev server forwards `/v1/...` to the API and adds the token there, so the browser never
holds it and the API needs no CORS entry for localhost. To act as another role, issue a token for
that user (`dev-reviewer`, `dev-approver`, `dev-admin`), put it in `.env` and restart
`npm run dev`. When calls start answering 401, the token has expired: issue a new one.

`npm run dev:sim` (the dummy-data mode) does not work from this branch: its local dummy data is
not in git.

## Checked locally on 26 Nov 2026

With the API branch at `7c65471`, simulator mode, signed in as `dev-creator`, the sample briefs from
the API's `DEMO_BRANCH.md`:

| Sample | Expected there | Shown |
|---|---|---|
| 1. Full disclosure | PASS | Passed the assessed checks |
| 2. Missing disclosure | FAIL on REC-07 | Passed as a brief; **Failed on REC-07 as a caption** (see below) |
| 3. Ages 18 to 90 | FAIL on REC-08 | Failed, REC-08, suggested "aged 18 to 75", text highlighted |
| 4. "Lowers blood pressure quickly" | Simulator passes | Passed |
| 5. "Why settle for ordinary medication" | Simulator passes | Passed |

Sample 2: `scripts/seed_demo.py` gives REC-07 `applies_to: ["text"]`, so a brief is never checked
for the disclosure. Either the sample table should say "check as caption", or REC-07 should also
apply to `brief`.

Policy screens, same day, against the API branch with the policy and media workers running:

- As `dev-admin`: list, open a version, **New draft**, **Add a rule**, review it, **Send for
  review**, and uploading a Markdown file (sent, scanned, registered, clauses read) all worked.
- As `dev-approver`: **Approve** on the version in review was refused with 409
  `POLICY_BUNDLE_HAS_ISSUES` (*Source missing*, *Language es is not supported*). That came from the
  test rules added to that draft; the dialog listed the issues as intended. A successful approve
  and activate were not run end to end on this branch yet.
- The policy lists answer 422 above `limit=50`; the screens ask for 50.
