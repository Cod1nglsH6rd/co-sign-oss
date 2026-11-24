## Cô Sign – AI Form Assistant for Vietnamese Speakers

> A web app that helps Vietnamese speakers understand and fill out English‑language forms, with AI guidance and multi‑language support.

[![Next.js](https://img.shields.io/badge/Next.js-15-black)](https://nextjs.org/)
[![React](https://img.shields.io/badge/React-18-blue)](https://reactjs.org/)

---

### Overview

Cô Sign is a **Next.js** app that lets users:

- **Upload** PDFs or images of forms.
- **Detect form fields** automatically with AI (labels, field types, and bounding boxes).
- **Translate field labels** into any of 9 languages (Vietnamese, Spanish and more), with simple explanations in English.
- **Fill the form in a split‑view viewer**, DocuSign‑style, with inline hints.
- **Export a filled PDF**, drawing answers back onto the original file using the detected positions.

It also has an **enterprise portal** (`/enterprise/*`): a company uploads a PDF or a phone photo (JPEG or PNG; a sideways photo is turned upright in the browser first, a HEIC is refused), staff position the detected fields once (when none are found, the setup screen says so with the add-field form open, and each field added by hand gets a box on the current page to drag into place), then send secure signing links (`/{locale}/fill`, `/embed/[token]`, `/api/sessions/*`) that clients fill and sign in the browser. The enterprise portal is the current focus; see [docs/PRD.md](docs/PRD.md), which is the source of truth for product decisions.

### Your first signed document

From nothing to a signed PDF on your own machine. You need Docker and git; no account and no key.

1. **Clone and start it.**

   ```bash
   git clone https://github.com/yourusername/co-sign.git
   cd co-sign
   docker compose up
   ```

2. **Open http://localhost:3000 and get the setup code.** A fresh install sends you to `/setup`, which asks for the setup code first. Find it in another terminal with `docker compose logs app` (the line `[setupLock] Setup code: …`).
3. **Fill in the setup screen.** For Mail choose 'No mail: copy the signing link', so you send each link yourself. The Anthropic API key can wait: without an Anthropic API key no fields are found for you, so you place each field by hand. Make the first admin with an email and a password, and save.
4. **Sign in and upload.** Sign in at `/enterprise/login` as that admin, then upload a PDF or a JPEG/PNG photo of a form on Documents. Check the fields it found, or place them by hand on the page, and save them.
5. **Send it and sign it.** On Send Links, make a link for the document with the recipient's email and last name, then Copy link. Open the link in a private window, verify with the same email and last name, fill in the fields, sign and submit.
6. **Download the signed PDF.** Back on Send Links, the link shows as signed; its Signed PDF button downloads the signed PDF.

### Run the end-to-end test

`tests/e2e/mainFlow.e2e.js` drives Chromium (Playwright) through the main flow on a fresh Docker stack: first-run setup with the setup code, sign in, upload, fields read by the stub, a signing link, an expired link refused, signing through the link, the used link refused, and the signed PDF downloaded and checked against its saved fingerprint. Jest does not run it; the `e2e` CI job does, and so can you on a machine with Docker:

```bash
docker compose -f docker-compose.yml -f tests/e2e/compose.e2e.yml up -d --build
npx playwright install chromium
node tests/e2e/mainFlow.e2e.js
docker compose -f docker-compose.yml -f tests/e2e/compose.e2e.yml down -v
```

It needs a fresh stack (setup runs once), reads the setup code from `docker compose logs app`, makes a new admin password each run and prints neither. `COSIGN_URL` points it at another address (the expired-link step is then skipped).

**Warning:** `tests/e2e/compose.e2e.yml` sets `OCR_PROVIDER=stub`, which makes up fields instead of reading the document. `OCR_PROVIDER=stub` is for tests only: never set it on a stack people use.

### Status

- **Not a hosted product.** Nobody runs Cô Sign for you: you self-host your own copy, on your own machine and with your own keys.
- **Self-host with Docker:** `docker compose up` runs the whole app on one machine; see [Run it at home](#run-it-at-home). It also runs with `npm run build` and `npm start` against a Supabase project; see [Getting Started](#getting-started) and [Deployment](#deployment).
- **License:** MIT; see [License](#license). Every feature is free to use, for everyone; no payments are taken.
- **Health:** `GET /api/health` reports whether Supabase, Anthropic and cron are configured, whether the database answers, and which adapters are on.
- **CI:** `.github/workflows/ci.yml` has three checks. The `quality` job runs lint, Jest with coverage, and `next build` on every push to `main` and every pull request. The `e2e` job runs the end-to-end test (`tests/e2e/mainFlow.e2e.js`) against the Docker stack with the stub field reader, with no keys and no repository settings. The `schema` job builds an empty database from the repository alone and runs the schema and access checks on it (see [Schema and access checks](#schema-and-access-checks)). Pushes to `main` run all three. On pull requests a `changes` job decides: `e2e` runs only when the change touches more than documentation and unit tests, and `schema` only when it touches `SUPABASE-SETUP.sql`, `supabase/migrations/`, `scripts/db/`, `docker-compose.yml`, the workflow or the schema job's own test.
- **Where CI runs:** with no repository variables set, every job runs on GitHub's own runners (`quality` and `changes` on `ubuntu-latest`, `e2e` and `schema` on `ubuntu-24.04`). Two repository variables, set in the repository's Actions settings with no code change, move jobs to a self-hosted runner: `CI_RUNS_ON`, a JSON list of runner labels such as `["self-hosted","linux"]`, for `quality` and `changes`, and `CI_E2E_RUNS_ON` for `e2e` and `schema`. While `CI_RUNS_ON` is set and `CI_E2E_RUNS_ON` is not, `changes`, `e2e` and `schema` are skipped, pushes to `main` included. On a self-hosted runner (taken to have no sudo and rootless Docker) the end-to-end test runs inside the official Playwright image for the lock file's version (`tests/e2e/runner.Dockerfile`), in the gateway's network namespace at `http://localhost:3000`, and the stack publishes no port (`tests/e2e/compose.selfhosted.yml`); each run is its own Compose project and is removed with its volumes and built images. To go back to GitHub's runners, delete the variables under Settings > Secrets and variables > Actions > Variables.

### Known limits

- Each signing link is its own signing: the signed PDF from a link holds only that signer's answers and signature, even when you send the same document to several people. Cô Sign has no signing group yet, so it cannot produce one PDF with every signer on it, and it has no signing order. Send each signer their own link and keep each signed PDF.
- The Docker stack has no Supabase Realtime service, so the Documents, Send Links, Recipients and Admin pages don't update when a link is opened or a document is signed; reload the page to see it. While a document is being prepared, the Documents page still refreshes every 4 seconds. On Supabase cloud, live updates also need Realtime turned on for the `documents` and `fill_sessions` tables, which the repository's SQL doesn't do.
- Retention runs only where something calls `/api/cron/retention`: on Vercel, `vercel.json` schedules it; nothing in the Docker stack calls it, so completed signings are kept until something does (see [Retention](#retention) for a cron line and a systemd timer).
- Reading fields from scanned PDFs uses Supabase edge functions (`pdf-to-image`, in `supabase/functions/`) that the Docker stack does not run. At home, fields are read from a PDF's own form fields, from the text of a PDF with no form fields (the app reads the text layer itself and the AI picks the fields from it, so it needs `ANTHROPIC_API_KEY`), and from JPEG or PNG photos; for a scanned PDF none are found and you place them by hand.

---

### Run it at home

From a clean clone, with Docker installed, one command brings up the app, its own database, the local auth, data and storage APIs, and a gateway in front. No account is needed and no `.env` file: every setting in `docker-compose.yml` has a default.

```bash
docker compose up
```

- **Address:** open http://localhost:3000 once the `app` service is healthy. Only that port is published, and only on this machine (`127.0.0.1`); set `COSIGN_PORT` to use another port. `COSIGN_BIND` sets the address it is published on: `COSIGN_BIND=0.0.0.0` opens it on every IPv4 address of the machine, and then anyone on your network reaches the app and its auth, data and storage APIs over plain HTTP, with passwords and documents unencrypted. To let other machines in, keep `127.0.0.1` and put your own HTTPS reverse proxy on this machine in front (see [Deployment](#deployment)); with a proxy in front, `COSIGN_TRUSTED_PROXY_HOPS` may need to change (`lib/clientIp.js`). Either way, set `COSIGN_SITE_URL` to the address people open, scheme, host and port with nothing after them (`https://sign.example.com` behind your proxy, or `http://<this machine's LAN name or IP>:3000` with `COSIGN_BIND=0.0.0.0`), for example `COSIGN_SITE_URL=https://sign.example.com docker compose up -d`, and run that again after changing it. The auth service builds its addresses from it (see What the invite link does), and the app gets it as its Site address (`NEXT_PUBLIC_APP_URL`), where it wins over the one saved at `/setup` (that field then shows 'Set on the host'). Without it the auth service stays at `http://localhost:3000` (or your `COSIGN_PORT`) even when a Site address is saved at `/setup`, and the app keeps the saved one. Set the address there, not as `NEXT_PUBLIC_APP_URL` in `docker-compose.override.yml`, which reaches the app only.
- **Where the data lives:** in named Docker volumes. `db-data` holds the database, `storage-data` holds uploaded files, `keys` holds the signing secret, the API keys and the database password made on first boot, and `settings` holds the owner's saved setup answers (`/app/.cosign` in the app). `docker compose down` stops the stack and keeps them; `docker compose down -v` deletes all four, and with them every account, document, upload and saved setting.
- **Sign-up is off.** Nobody can create their own account. The first admin is created at `/setup` with the setup code (see [First-run setup](#first-run-setup)), and setup saves that email as the owner (`ADMIN_DASHBOARD_EMAILS` in the saved settings). The browser asks the server who is an owner (`GET /api/admin/me`), so that admin gets Owner Usage (`/enterprise/owner`), the page that adds more people (see Owners under [Deployment](#deployment)). Setting `COSIGN_ALLOW_SIGNUP=true` turns sign-up on, and then anyone who can reach the port can create a confirmed account (no mail checks the email) and use the owner's AI key.
- **Adding a person.** The owner signs in at `/enterprise/login`, opens Owner Usage from the sidebar, enters the person's email and a role (Member or Admin) under Add User, and adds them. The app makes the account with a one-time invite link and mails the link itself only when Resend is on and a From address is set (`sendMemberInviteEmail` in `lib/email.js`); otherwise, as at home with 'No mail', the page shows the invite link with a Copy button, and the owner copies it and passes it on (`pages/api/admin/users.js`, `pages/enterprise/owner.js`).
- **Member or Admin.** Both work with the organisation's documents and signing links. An Admin may also rename the organisation (Settings, `/api/account/update`) and set whether every signing link must name its recipient (`/api/enterprise/org-settings`); a Member is refused both. Neither role makes someone an owner: Owner Usage, adding people and changing the setup settings stay with the owner list, whatever the role (see Owners under [Deployment](#deployment)), so an Admin gets no Owner Usage and is refused those calls.
- **What the invite link does.** It goes to the stack's auth service at `COSIGN_SITE_URL` followed by `/auth/v1/verify` (`API_EXTERNAL_URL`, built in `docker-compose.yml`, and the auth service's link paths, `GOTRUE_MAILER_URLPATHS_*`, set there to `/auth/v1/verify`). With `COSIGN_SITE_URL` set, the link opens at your address from any machine that can reach it; without it, the link is `http://localhost:3000/auth/v1` (with your `COSIGN_PORT`) and opens only in a browser on this machine, as before. The auth service then sends the person to the sign-in page, `/enterprise/login` at the Site address (with none set, at the address the owner's request came to), when that address is under the site address (`GOTRUE_URI_ALLOW_LIST`, the site address followed by `/**`), and to the site address itself otherwise. With `COSIGN_SITE_URL` set, the Site address is that same address, so the person lands on the sign-in page there. The app reads the session the link carries (`detectSessionInUrl` in `lib/supabaseClient.js`), and the sign-in page takes them on to Documents (`pages/enterprise/login.js`). Before that, the sign-in page asks them to choose a password (at least 10 characters, `components/enterprise/InvitePasswordForm.js`), and until they do, the enterprise pages send them back to it in any browser where they are signed in. The end-to-end job (`tests/e2e/inviteFlow.e2e.js`) runs this on the Docker stack with mail off and `COSIGN_SITE_URL` not set, in a browser on the same machine: the owner adds a Member and copies the link; opened in a new browser, it comes back to the sign-in page with the password form for that address; All Documents opened directly sends them back to the form; they choose a password and arrive on All Documents, stay there after a reload, and after logging out sign in with that password with no form. If they lose the link's session before choosing one (a private window closed, or another account signed in on that browser), the owner adds their email again under Add User: since they are already a member and have not chosen a password, the app makes a new one-time sign-in link and mails it or shows it to copy, as for an invite, and the sign-in page asks them to choose a password; an account that has a password, or is not yet a member of the owner's organisation, gets no new link. The end-to-end job also runs this: a member added again before opening their invite link gets a new link that brings them to the password form, and they choose a password and arrive; a member who has chosen a password, added again, gets no link. Then the job brings the same stack up again with `COSIGN_SITE_URL` set to an address that is not localhost and runs `tests/e2e/siteAddress.e2e.js` in a browser whose own localhost is not the app (on its self-hosted runner, a container of its own on the stack's network at `http://cosign.test:3000`; on GitHub's runners, the runner's own network address with `COSIGN_BIND`): the invite link opens at that address, the person chooses a password there and signs in with it, and the Admin role is checked against a Member and the owner (`tests/e2e/adminRole.e2e.js`).
- **An install made before 2026-11-21** (when the compose file still had a fixed default database password): the database keeps the password it was first started with, while the services now log in with the database password made on first boot, so after you update, the app does not start (auth cannot log in, and the `keys` service's log says why). Once, give the database the new password, with the old one in `OLD_DB_PASSWORD` (`change-me-local-only`, or the `POSTGRES_PASSWORD` you had set, which the compose file no longer reads):

  ```bash
  docker compose up -d db
  docker compose run --rm --no-deps -e OLD_DB_PASSWORD='change-me-local-only' migrate node scripts/docker/set-db-password.js
  docker compose up -d
  ```

  Or start over with `docker compose down -v`, which deletes every account, document and setting.
- **AI features need `ANTHROPIC_API_KEY`.** Without it the app runs, but OCR field detection and chat do not work. Paste it at `/setup` (see [First-run setup](#first-run-setup)) or give it to the `app` service as below.
- **Parked OCR jobs resume after a restart.** A job's progress is saved in the database, so after `docker compose up` again the in-app OCR worker adopts a parked job once it has been idle for the stale window (4.5 minutes, `lib/ocrResume.js`) and checks every `OCR_WORKER_INTERVAL_MS` (default 30 s).
- **Turning adapters on:** every adapter is off by default and `GET /api/health` says which are on. Settings for the `app` service go in a `docker-compose.override.yml` next to `docker-compose.yml` (Compose reads it on its own), under `services: app: environment:`.
  - **Sentry:** set `SENTRY_DSN` for server errors. Off means errors go to the logs only.
  - **Resend:** set `EMAIL_PROVIDER=resend` and `RESEND_API_KEY`. Off means no mail is sent and one line is logged instead.
  - **Upstash:** set `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`. Off means in-memory rate limits for one process.
  - **Supabase cloud:** on when `SUPABASE_URL` is a `*.supabase.co` project. The compose stack always uses its own local Supabase and its own keys, so to use Supabase cloud run the app outside the stack with the project's URL and keys (see Getting Started).
  - **Vercel:** on when the app runs on Vercel, which sets `VERCEL` itself; see Deployment.

#### First-run setup

- **You are sent to `/setup`.** On a fresh install, open http://localhost:3000 and you are sent to `/setup`; signing links and embeds keep working. The app asks `GET /api/setup/state` once each time it loads whether setup is still needed.
- **The setup code.** While setup is needed, the server makes it once when it starts (`ensureSetupCodeAtBoot` in `lib/setupBoot.js`, called from `instrumentation.js`). Find it in the log line `[setupLock] Setup code: …` with `docker compose logs app`, or in `.cosign/setup-code` (`/app/.cosign/setup-code` in the `settings` volume). `/setup` asks for it before it shows any settings; it is sent in the `x-setup-code` header and never kept in browser storage or the URL.
- **What it asks.** AI: the Anthropic API key. Mail: Resend (a Resend API key and a From address) or 'No mail: copy the signing link'. Site: the Site address. First admin: an admin email and password.
- **Each answer is checked live before saving.** Save sends only the answers that changed. The Anthropic key is checked by listing models and the Resend key by listing domains, each with a 10 s limit; the Site address is cleaned. If any answer fails, nothing is saved and its message shows under its field.
- **Where keys live.** Saved answers go in `.cosign/settings.json` on the `settings` volume, readable by the owner only. A saved key is shown masked, the last 4 characters at most (nothing when the key is shorter than 12). Keys are never logged or returned by any API.
- **Which one wins.** A value set in the host environment (under `services: app: environment:` in `docker-compose.override.yml`) wins over a saved one. That field shows as 'Set on the host', has no input, and is never saved over.
- **'No mail'** means no email is sent: you copy the signing link and send it to the client yourself.
- **After the first admin** is made, the setup code file is deleted and the code is refused, even if the saved settings are lost later. Changes then need an owner's sign-in: `/api/setup/settings` takes only the session of someone on the owner list, and refuses an Admin added on Owner Usage. `/setup` asks for a sign-in, with a link to `/enterprise/login`, but sends only the setup code, never a session, so once the first admin is made it does not open the settings for anyone.
- **Deleting it.** `docker compose down -v` also deletes the `settings` volume, and with it the saved settings and keys; values set in the host environment are not touched.

#### Retention

- **What it does.** `/api/cron/retention` deletes completed signings (the signing session and its signed PDF in the `filled-documents` bucket) older than their organisation's `retention_days`, 365 days when unset. The uploaded documents themselves are kept.
- **Only when called.** Retention runs only where something calls `/api/cron/retention` with `CRON_SECRET` (or `RETENTION_CRON_SECRET`): on Vercel, `vercel.json` calls it every day at 3 AM UTC. Nothing in the Docker stack calls it, so at home you schedule the call yourself. Without either secret the route answers 503, and with a wrong one 401.
- **The secret.** Give the `app` service a `CRON_SECRET` in `docker-compose.override.yml`, under `services: app: environment:` (a long random value, such as the output of `openssl rand -hex 32`), and run `docker compose up -d` again. Then put the header the call sends in a file only root can read, so the secret never sits on a command line:

  ```bash
  sudo install -d -m 700 /etc/cosign
  sudo sh -c 'umask 077; printf "Authorization: Bearer %s\n" "<your CRON_SECRET>" > /etc/cosign/retention-header'
  ```

- **A host cron line**, in root's crontab (`sudo crontab -e`), every day at 3 AM (use your `COSIGN_PORT` if you changed it):

  ```cron
  0 3 * * * curl -fsS -X POST -H @/etc/cosign/retention-header http://localhost:3000/api/cron/retention > /dev/null
  ```

- **Or a systemd timer.** `/etc/systemd/system/cosign-retention.service`:

  ```ini
  [Unit]
  Description=Co Sign retention

  [Service]
  Type=oneshot
  ExecStart=/usr/bin/curl -fsS -X POST -H @/etc/cosign/retention-header http://localhost:3000/api/cron/retention
  ```

  and `/etc/systemd/system/cosign-retention.timer`:

  ```ini
  [Unit]
  Description=Run Co Sign retention every day

  [Timer]
  OnCalendar=*-*-* 03:00:00
  Persistent=true

  [Install]
  WantedBy=timers.target
  ```

  then `sudo systemctl daemon-reload` and `sudo systemctl enable --now cosign-retention.timer`.

---

### Current Feature Set (What’s Actually Implemented)

- **Multi‑language marketing site**
  - Localized landing page at `/{locale}` using `next-intl`, in 9 languages: English, Vietnamese, Spanish, Portuguese, French, Chinese, Cantonese, Haitian Creole and Nepali (`lib/i18n.js`).
  - Hero, drag‑and‑drop upload CTA and “how it works” sections.
  - Global navigation with a language switcher (`components/layout/Navigation.js`); the landing page has its own footer (`pages/[locale]/index.js`).

- **Auth & dashboard (Supabase Auth)**
- `/[locale]/login` implements **Supabase email/password** for testing:
  - Email: `admin@example.com`, or `NEXT_PUBLIC_DEV_LOGIN_EMAIL` when set (on `/enterprise/login`, the shortcut username `admin` maps to it when dev login is enabled)
  - Password: `Test123!`
  - The same account works on both the personal portal (`/[locale]/login`) and the enterprise portal (`/enterprise/login`).
- Successful login uses Supabase Auth and redirects to `/[locale]/dashboard`.
  - `/[locale]/dashboard` shows:
    - The current user (from local session).
    - A **document list** loaded from Supabase when configured.
    - A drag‑and‑drop upload zone + “Upload” button.
    - A choice of **translation language for this document**, from the nine languages in `lib/i18n.js` (English means no translation).

- **Document upload & storage**
  - `hooks/useDocuments` handles:
    - Uploading files to the Supabase **`documents`** storage bucket.
    - Creating rows in the `documents` table with metadata:
      - `user_id`, `file_name`, `file_path`, `file_url`, `file_size`, `file_type`, `status`, `preferred_language`.
    - Listing user documents and deleting them (including storage cleanup).
  - Supabase client (`lib/supabaseClient`) is configured in the browser from the running server first: `pages/_document.js` loads `/api/runtime-config.js`, which sets `window.__COSIGN_PUBLIC__` to `PUBLIC_SUPABASE_URL` (or null) and the anon key, never the service key. A set runtime value wins over the build-time `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY`; a null runtime url falls back to the build-time url, and to the page's own origin when the build has none. Helper functions for:
    - Basic auth operations (sign in/out, get session).
    - CRUD on `documents`, `fields`, and `chat_history`.

- **AI‑powered OCR & field extraction**
  - Active endpoint: `POST /api/ocr` (`pages/api/ocr.js`).
  - Pipeline:
    - Loads the uploaded file from `documents.file_url` or storage.
    - Calls **Anthropic Claude Sonnet Vision** with the original PDF or image.
    - Claude returns an array of **form fields** with:
      - `field_name`, `field_type` (`text`, `date`, `email`, `checkbox`, `signature`, etc.).
      - Translations into the document's language, saved in per-language columns (`field_name_<code>`, `explanation_<code>`, `position_hint_<code>`, such as `field_name_vi`).
      - English `explanation`.
      - Rough `position` (page + x/y/width/height in percentages) for the **writable area**, not the label.
    - If the file is a PDF:
      - `lib/pdfTextExtraction` asks Supabase edge functions for the PDF's own form fields (`extract-form-fields`; `lib/pdfjsWidgets` reads them with `pdfjs-dist` in the app when that finds none) and its text layer (`extract-text-layer`, not in this repository; see [Known limits](#known-limits)), and uses the text layer to:
        - Precisely match labels in the PDF.
        - Compute better writable boxes (`computeWritablePosition`).
      - Each field’s `position` is tagged with a `source` (e.g. `text-layer` or `ai-estimated`).
    - All fields are inserted into the `fields` table with:
      - Names, types, translations, explanations, sort order, and position JSON.
    - The document `status` is updated (`uploaded` → `processing` → `completed` or `error`).

- **Document viewer & form filling**
  - Route: `/[locale]/documents/[id]`.
  - Uses:
    - `PdfViewer` (dynamic import) to render the original PDF or image.
    - `FieldConfigurer` for **manual field positioning** when `positioningMode === 'manual'`.
    - A right‑hand sidebar that:
      - Lists all fields with labels, translations (according to view language), and explanations.
      - Renders appropriate input controls (text, checkbox, signature canvas).
      - Debounces and persists field values back to Supabase (`fields.field_value`).
    - A language toggle between English and the document's language, controlling which translation to show per field.
    - A “Scan for Fields” button to re‑trigger `/api/ocr` if nothing was detected.
  - **PDF export**:
    - `lib/exportPdf.generateFilledPdf`:
      - Loads the original document (or embeds an image into a PDF).
      - Optionally fills AcroForm fields if present.
      - Draws user answers back into the appropriate boxes using the saved `position` percentages.
      - Supports text, checkboxes, and signature images (data URLs) with automatic wrapping and font sizing.
    - The viewer offers an **“Export PDF”** button that downloads the filled PDF.

- **Chat UI**
  - The document viewer sidebar includes a **chat tab** with a friendly “Cô” assistant UI.
  - The in‑viewer chat uses the live `/api/chat` endpoint (Anthropic Claude through `lib/anthropic.chatWithCo`, with document context from `lib/chatContext`). Signing sessions have their own `/api/sessions/[token]/chat`.

---

### Architecture & Tech Stack

- **Frontend**
  - **Framework**: Next.js 15 (Pages Router).
  - **UI**: React 18, Tailwind CSS 3, React Icons, React Hot Toast.
  - **i18n**: `next-intl` + `middleware.js` for locale prefixes, one for each of the nine languages in `lib/i18n.js` (`/en`, `/vi`, `/es`, `/pt`, `/fr`, `/zh`, `/yue`, `/ht`, `/ne`).
  - **PDF rendering**: `react-pdf`, `pdfjs-dist`, custom `PdfViewer` and `FieldConfigurer`.

- **Backend & data**
  - **Database & storage**: Supabase (PostgreSQL + Storage), built by `npm run db:migrate` from `SUPABASE-SETUP.sql` and every migration in `supabase/migrations/`.
  - **Supabase client**: `lib/supabaseClient` with public and service‑role helpers.
  - **OCR & field detection**:
    - Anthropic Claude (`lib/anthropic`: Claude Sonnet 4.5 for extraction, Claude Haiku 4.5 for lighter calls) behind `/api/ocr`. Parked OCR jobs are resumed by the in-app OCR worker: a dense document that outruns one call parks its progress, and the worker, which `instrumentation.js` starts at server boot (`lib/ocrWorkerBoot.js`), re-invokes `/api/ocr` on 127.0.0.1 with a per-process token every `OCR_WORKER_INTERVAL_MS` (default 30 s). `OCR_WORKER=off` turns it off. There is no OCR cron.
    - PDF text-layer and AcroForm widget positioning (`lib/pdfTextExtraction`, `lib/textLayerPositioning`, `lib/pdfjsWidgets`, `lib/checkboxWidgets`).
  - **Payments**: none. No payments are taken; there is no payment package, billing route or payment setting.
  - **Retention**: `/api/cron/retention` deletes completed signings older than their organisation's `retention_days`. It runs only where something calls it with `CRON_SECRET`; at home, schedule the call (see [Retention](#retention)).

- **Testing & tooling**
  - **Testing**: Jest + `@testing-library/react`; tests under `tests/api` (chat, signing sessions) and `tests/lib` (OCR, positioning, export, session auth and more). Coverage thresholds live in `jest.config.js`.
  - **Linting**: ESLint + `eslint-config-next`.
  - **Styling**: Tailwind + PostCSS + Autoprefixer.

---

### Project Status

- **UI & core pipeline**:
  - Landing page, login, dashboard, upload, OCR, field storage, viewer, manual positioning, and PDF export are **implemented and wired together**.
- **Auth**:
  - Supabase Auth sessions with org memberships (`hooks/useAuth.js`, `lib/auth.js`); a user can belong to several orgs and switch between them.
- **Enterprise portal**:
  - Setup, templates, recipients, send-links, owner and admin pages under `/enterprise/*`; signing sessions under `/api/sessions/*`.
- **Chat**:
  - Viewer and signing-session chat are live (Anthropic Claude).
- **Payments**:
  - No payments are taken: there are no billing routes.

---

### Getting Started

#### Prerequisites

- **Node.js 20.19 or later** and **npm** (`package.json` asks for `>=20.19`; `pdfjs-dist` 5 needs it).
- Accounts & keys (for full backend functionality):
  - A new, empty Supabase project (step 4).
  - Anthropic API key.
  - No OpenAI API key: the app uses Anthropic only.

#### Quick Start (Local Development)

1. **Clone the repository**

   ```bash
   git clone https://github.com/yourusername/co-sign.git
   cd co-sign
   ```

2. **Run the setup script (installs deps + copies env template)**

   ```bash
   chmod +x scripts/setup.sh
   ./scripts/setup.sh
   ```

   It checks that Node.js and npm are there, runs `npm install`, and copies `.env.example` to `.env.local` when there is no `.env.local` yet. It does not touch the database (step 4).

3. **Configure environment variables**

   Edit `.env.local` (created from `.env.example`) with your real values. The sample below is the core set; `.env.example` is the full list (email, Sentry, OCR tuning, embed and session-token flags, cron secrets, script-only settings), each with a `required|optional · adapter · purpose` line above it. `npm test` fails when the code reads a setting `.env.example` does not list.

   ```env
   # Supabase
   NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
   SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

   # Anthropic (Claude)
   ANTHROPIC_API_KEY=sk-ant-...

   # App
   NEXT_PUBLIC_APP_URL=http://localhost:3000
   NODE_ENV=development
   NEXT_PUBLIC_ENABLE_DEV_LOGIN=true
   # Optional: dev login / seed account email (default admin@example.com)
   # NEXT_PUBLIC_DEV_LOGIN_EMAIL=admin@example.com
   # Support contact shown on the legal, home, fill and embed pages (default support@example.com)
   NEXT_PUBLIC_SUPPORT_EMAIL=support@example.com
   ENABLE_DEV_SEED=true

   # Owner allowlist, read by the server (no built-in default; the browser asks /api/admin/me)
   ADMIN_DASHBOARD_EMAILS=you@example.com

   # Upstash rate limiting (optional; leave both out for in-memory limits)
   # UPSTASH_REDIS_REST_URL=https://your-upstash-rest-url
   # UPSTASH_REDIS_REST_TOKEN=your-upstash-rest-token
   ```

   **Adapters (outside services) are off by default.** `lib/adapters.js` (`adapterStatus(env)`) is the one place that says which are on, and each falls back to a local behaviour while off:

   | Adapter | On when | Off (local fallback) |
   |---------|---------|----------------------|
   | `supabaseCloud` | the Supabase URL (`SUPABASE_URL`, else `NEXT_PUBLIC_SUPABASE_URL`) is a `*.supabase.co` host | a local or self-hosted Supabase at that URL |
   | `sentry` | `SENTRY_DSN` is set | errors go to the server logs only |
   | `resend` | `EMAIL_PROVIDER=resend` and `RESEND_API_KEY` are both set | no mail is sent; one stdout line names the subject and the recipient's domain (no address, no body) |
   | `upstash` | `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` are both set | in-memory, per-instance rate limits |
   | `vercel` | `VERCEL` is set (the platform sets it) | a plain `next start` host |

   A blank value counts as not set. `GET /api/health` shows the result as `adapters`.

4. **Set up the database on a new, empty Supabase project**

   This builds the whole schema on a new, empty Supabase project. Never run it against a database that already holds data: it is a first install, not an upgrade.

   - **Copy the connection string.** In the Supabase dashboard, open the project's **Connect** panel and copy a Postgres connection string (the direct connection, or the session pooler if your network has no IPv6), with the project's database password in place of its placeholder. Paste it only into the command below, never into a file you commit.
   - **Build the schema:**

     ```bash
     MIGRATE_ALLOW_REMOTE=1 DATABASE_URL=<the project's connection string> npm run db:migrate
     ```

     `npm run db:migrate` runs `scripts/db/migrate.js`: it applies `SUPABASE-SETUP.sql` and then every file in `supabase/migrations/`, in name order, each in its own transaction, records each by name in `cosign_meta.schema_migrations`, and stops at the first file that fails, naming it. That makes the tables with their row-level security, the `app_config` table `GET /api/health` reads, and the two private storage buckets (`documents` and `filled-documents`) with their policies. It refuses a `*.supabase.co` host unless `MIGRATE_ALLOW_REMOTE=1` is set.
   - **Set by hand in the dashboard.** The Docker stack configures its own auth service (the `auth` service in `docker-compose.yml`); on Supabase cloud you set the same things yourself:
     - **Sign-up:** the stack turns sign-up off. On Supabase cloud it is on until you turn off new user sign-ups in the project's Authentication settings; while it is on, anyone can make an account at `/en/login`, get an organisation of their own on first sign-in (`/api/orgs/bootstrap`) and use your Anthropic key.
     - **Site URL and redirect URLs:** the stack sets them to `COSIGN_SITE_URL`, else `http://localhost:3000` or the `COSIGN_PORT` you chose (`GOTRUE_SITE_URL`, `GOTRUE_URI_ALLOW_LIST`). Set the Site URL to the app's address (`NEXT_PUBLIC_APP_URL`) and allow that address followed by `/**` as a redirect URL: invites come back to `/enterprise/login`, sign-up confirmations to `/<locale>/login` and password resets to `/<locale>/reset-password`.
     - **Mail:** the stack sends no auth mail and confirms new accounts at once. On Supabase cloud, sign-up confirmations and password resets are mailed by Supabase Auth with the project's own email settings. Invites from Owner Usage are not: the app asks Supabase Auth for the invite link without mail and sends it through its own mailer (Resend with `EMAIL_FROM`), or, when that mail does not go out, shows it to the owner to copy (`pages/api/admin/users.js`), so they do not depend on the project's email settings. The first admin made at `/setup` and the account `npm run seed:dev` makes are confirmed when they are made.
     - **Keys:** the URL of the Supabase project, its anon key and its service role key (the project's API settings) go in `.env.local` (step 3). The service role key is for the server only.
     - **Edge functions:** reading fields from a PDF calls Supabase edge functions at `<project URL>/functions/v1/`. Deploy `extract-form-fields` and `pdf-to-image` from `supabase/functions/` with the Supabase CLI (each has a README). `lib/pdfTextExtraction.js` also calls `extract-text-layer`, which this repository does not have; without it a PDF's text layer is not read, and a PDF with no form fields of its own is read from page images (`pdf-to-image`) instead.
     - **Live updates:** turn on Realtime for the `documents` and `fill_sessions` tables if you want pages to update without a reload; the repository's SQL does not.

5. **Make the test account**

   ```bash
   ENABLE_DEV_SEED=true npm run seed:dev
   ```

   `scripts/seed-dev.js` reads `.env.local` and creates the **Enterprise Test** org and the `admin@example.com` user with the password `Test123!`, an admin of that org (set `NEXT_PUBLIC_DEV_LOGIN_EMAIL` to use another email). It refuses to run unless `ENABLE_DEV_SEED=true`, and always when `NODE_ENV=production`. To skip it, leave `ADMIN_DASHBOARD_EMAILS` and `NEXT_PUBLIC_OWNER_EMAILS` blank instead: the app then asks for the first admin at `/setup`, with the setup code from the dev server's log (see [First-run setup](#first-run-setup)).

6. **Start the development server**

   ```bash
   npm run dev
   ```

7. **Open the app and sign in**

   Visit `http://localhost:3000`. It sends you to `/enterprise/login` when an owner list is set (the sample above sets `ADMIN_DASHBOARD_EMAILS`), and to `/setup` when none is (`pages/index.js`). Sign in at `/enterprise/login` with the test account from step 5 (`admin@example.com`, or your `NEXT_PUBLIC_DEV_LOGIN_EMAIL`, and `Test123!`); with `NEXT_PUBLIC_ENABLE_DEV_LOGIN=true` the username `admin` also works. You land on Documents (`/enterprise/documents`): upload a PDF or a photo of a form there. The same account signs in to the personal portal at `/en/login`, which leads to `/en/dashboard`.

   Two more pages: `http://localhost:3000/enterprise` is the enterprise landing page, and `http://localhost:3000/enterprise/admin` is the organisation dashboard (sign-in needed).

---

### API Overview

#### Active routes (by default)

- **GET `/api/health`**
  - Health check: reports which of Supabase, Anthropic and cron are configured, whether the database answers, and an `adapters` object (`on`/`off` for `supabaseCloud`, `sentry`, `resend`, `upstash`, `vercel`). `status` is `ok` when Supabase is configured and the database answers; cron and the adapters do not count.

- Also live (see `pages/api/`): `/api/setup/*`, `/api/runtime-config.js`, `/api/chat`, `/api/pdf-to-image`, `/api/reprocess-positions`, `/api/account/*`, `/api/admin/*`, `/api/cron/*`, `/api/documents/[id]/*`, `/api/enterprise/*`, `/api/orgs/bootstrap`, `/api/sessions/*`.

- **POST `/api/ocr`**
  - Triggers Anthropic Claude Vision to analyze the document and create `fields` rows.
  - **Body (JSON)**:

    ```json
    {
      "documentId": "uuid",
      "userId": "uuid-or-test-id",
      "preferredLanguage": "vi"
    }
    ```

  - **Response**:

    ```json
    {
      "success": true,
      "fields": [ /* field objects with translations & positions */ ],
      "fieldsCount": 15
    }
    ```

---

### Project Structure

```text
co-sign/
├── pages/
│   ├── _app.js                    # Next.js app wrapper + intl wiring
│   ├── index.js                   # Root redirect → /setup (fresh install) or /enterprise/login
│   ├── [locale]/index.js          # Localized landing page (nine languages), with its footer
│   ├── [locale]/login.js          # Supabase email/password login
│   ├── [locale]/dashboard.js      # Document dashboard + upload
│   ├── [locale]/documents/[id].js # Doc viewer: OCR fields + chat + export
│   ├── enterprise/                # Enterprise portal pages
│   ├── embed/[token].js           # Embedded signing session
│   └── api/
│       ├── ocr.js                 # Anthropic Claude OCR + field extraction
│       ├── chat.js                # Live document chat (Anthropic)
│       ├── cron/ sessions/ enterprise/ documents/ ...
│       └── health.js              # Health/status endpoint
├── components/
│   ├── layout/Navigation.js       # Top nav with locale switcher
│   ├── layout/AppLayout.js        # Shared chrome for authed personal pages
│   ├── dashboard/DocumentCard.js  # Cards for documents grid
│   ├── PdfViewer.js               # PDF/image viewer (react-pdf)
│   ├── FieldConfigurer.js         # Manual field positioning UI
│   └── SignatureCanvas.js         # Signature capture for signature fields
├── hooks/
│   ├── useAuth.js                 # Supabase Auth + org memberships
│   └── useDocuments.js            # Supabase-backed documents CRUD
├── lib/
│   ├── supabaseClient.js          # Supabase client + helpers
│   ├── anthropic.js               # Anthropic Claude field extractor + chat
│   ├── pdfTextExtraction.js       # Text-layer analysis for precise field boxes
│   ├── exportPdf.js               # Draws filled values onto original PDF
│   ├── i18n.js                    # Locale config (9 languages)
│   └── ...                        # auth, sessions, positioning, rate limit, CSP
├── locales/                       # en, vi, es, pt, fr, zh, yue, ht, ne
├── tests/
│   ├── api/                       # chat and signing-session tests
│   └── lib/                       # OCR, positioning, export and more
├── scripts/
│   └── setup.sh                   # npm install + .env.local from .env.example
├── supabase/
│   ├── migrations/                # Applied in name order after the baseline (npm run db:migrate)
│   └── functions/                 # Edge functions: extract-form-fields, pdf-to-image
├── docker-compose.yml             # The home stack: app, database, auth, data and storage APIs, gateway
├── SUPABASE-SETUP.sql             # Baseline schema, applied first by npm run db:migrate
├── middleware.js                  # Locale prefix middleware
├── styles/globals.css             # Global styles (Tailwind base)
└── ...
```

---

### Testing

Run tests with Jest:

```bash
# Run all tests
npm test

# Watch mode
npm run test:watch

# Coverage
npm run test:coverage
```

CI runs `npm run test:coverage -- --runInBand`; the thresholds in `jest.config.js` must hold.

#### End-to-end test

Jest does not run the Playwright test of the main flow; see [Run the end-to-end test](#run-the-end-to-end-test).

#### Schema and access checks

The `schema` CI job builds the database from the repository alone: an empty database from the stack's own `db`, `auth` and `storage` services, then `SUPABASE-SETUP.sql` and every migration in `supabase/migrations/` through the stack's `migrate` service (`scripts/db/migrate.js`, as a new install gets them). It then runs `scripts/db/schemaCheck.js` (the tables, columns, functions and buckets the app uses, with row-level security) and `scripts/db/rlsCheck.js` (anonymous visitors and a user of another organisation reach none of an organisation's rows; it writes inside one transaction and rolls it back), fails on any problem or leak, and removes the stack with its volumes. The access check tries, as an anonymous visitor and as a user of another organisation, to select, update and delete the organisation's documents, fields, fill sessions, session fields, audit log, chat history, organisation row, memberships and objects in both storage buckets, to insert rows into all of these but session fields (a membership making that user the organisation's admin among them), to move their own document or fill session into the organisation, to read or write `app_config` and `beta_signups` at all, and to call the database functions only the service role may run, and it checks that the user still sees their own document, organisation, membership and chat history. The same on a machine with Docker:

```bash
docker compose up -d --build db auth storage migrate
docker wait "$(docker compose ps -aq migrate)"   # prints migrate's exit code: 0
docker compose run --rm --no-deps -T migrate node scripts/db/schemaCheck.js
docker compose run --rm --no-deps -T migrate node scripts/db/rlsCheck.js
docker compose down -v
```

The migrations are for fresh installs only: a local database like this one, or a new, empty Supabase project (Getting Started, step 4). Never run them, or these checks, against a hosted database that already holds data. `migrate.js` and `rlsCheck.js` refuse a `*.supabase.co` host unless `MIGRATE_ALLOW_REMOTE=1` is set.

#### Private-detail scan

`npm run scan:private` scans every tracked file for private details and prints `path:line rule` for each finding, never the matched text, leaving out the hits listed in `scripts/privacy-scan/known-hits.json`; it exits 1 on any other finding or on a listed entry that no longer hits. It checks the SHA-256 hashes in `scripts/privacy-scan/terms.json` and any plaintext terms you pass at run time:

```bash
PRIVATE_SCAN_TERMS='first term,second term' npm run scan:private
```

To add a hashed term, append the lowercase hex SHA-256 of the lowercased term to `terms.json`, for example from the output of `printf %s 'term' | tr '[:upper:]' '[:lower:]' | sha256sum`. Only project terms (a domain, host, handle or team) go there: names, emails and addresses of people are never committed, hashed or not, and are passed in `PRIVATE_SCAN_TERMS` instead. `npm test` runs the same scan over the tree (`tests/privacy/trackedTreeScan.test.js`) and fails on any hit not listed in `scripts/privacy-scan/known-hits.json`, or on a listed entry that no longer hits. See `scripts/privacy-scan/README.md` for the rules and limits.

---

### Deployment

You self-host Cô Sign, in one of two ways.

- **The Docker stack:** `docker compose up` on one machine, with its own database, auth and storage (see [Run it at home](#run-it-at-home)). The gateway serves plain HTTP on one port (`COSIGN_PORT`, default 3000) and sets up no TLS and no public domain (`docker/gateway/Caddyfile`). The port is published on this machine only (`127.0.0.1`, `COSIGN_BIND`). To let other machines reach it, put your own HTTPS reverse proxy on this machine in front and set `COSIGN_SITE_URL` to the address people use: the auth service's links (invite links among them) and the app's Site address, which signing links are built from, follow it (see [Run it at home](#run-it-at-home)).
- **`npm run build` and `npm start`** on a host with Node.js 20.19 or later, against a Supabase project set up as in [Getting Started](#getting-started) (step 4). Settings come from the environment (Next.js also reads `.env.local`); `.env.example` lists them all.
  - **Needed:** the Supabase URL and keys, `ANTHROPIC_API_KEY`, and `NEXT_PUBLIC_APP_URL`, the app's public address: signing links, invite redirects and links in emails are built from it (`pages/api/sessions/create.js` reads it first, then `NEXT_PUBLIC_SITE_URL`, and falls back to the request's host only when no address is configured).
  - **Mail:** `EMAIL_PROVIDER=resend` with `RESEND_API_KEY` and `EMAIL_FROM`. There is no built-in sender: with no `EMAIL_FROM`, no mail is sent and the server logs why, and an invitation from Owner Usage shows the owner its link to copy instead.
  - **First admin:** with no owner list set, first-run setup runs here too: the setup code is in the server's log, and `/setup` saves its answers in `.cosign/` in the folder the server runs in.
  - **Fixed at build time:** `next build` writes the CORS origin from the site address into the build (`next.config.js`), and Next.js writes every `NEXT_PUBLIC_*` value the browser code reads into the bundle. Set `NEXT_PUBLIC_APP_URL` before you build, and build again after changing it. The browser reads no owner list; `ADMIN_DASHBOARD_EMAILS` is read when the server runs, while a `NEXT_PUBLIC_OWNER_EMAILS` set at build time is written into the build like any `NEXT_PUBLIC_*` value.
  - **Behind a proxy:** `COSIGN_TRUSTED_PROXY_HOPS` is how many proxies in front of the app append to `X-Forwarded-For` (default 1; 0 when nothing is in front). The client address for rate limits and the signing audit trail is the entry that many places from the right (`lib/clientIp.js`).
  - **More than one instance:** set Upstash (`UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`); without it rate limits, signer chat's daily cap among them, are in memory, per process.
- **Owners:** the owner allowlist (`ADMIN_DASHBOARD_EMAILS` and `NEXT_PUBLIC_OWNER_EMAILS`, comma-separated) has no built-in default. The server's owner list is `ADMIN_DASHBOARD_EMAILS` from env, then `NEXT_PUBLIC_OWNER_EMAILS` from env, then the `ADMIN_DASHBOARD_EMAILS` saved on the host by first-run setup, the first that names someone (`getServerOwnerEmails` in `lib/ownerEmails.js`); only when none of the three names anyone is nobody an owner, and `/api/admin/usage` and `/api/admin/users` answer 403 to every user. The browser carries no owner list: it asks `GET /api/admin/me`, which answers `{ owner }` for the signed-in caller by that same rule (`hooks/useIsOwner.js`), and the Owner Usage entry in the sidebar and its page (`/enterprise/owner`) appear for whoever the server says is an owner. So the admin made at `/setup` gets them with nothing else set, at home too.
- **Retention** needs a scheduled call to `/api/cron/retention` with `CRON_SECRET`, from cron, a systemd timer or any scheduler you run; see [Retention](#retention).
- The code also runs on Vercel (the `vercel` adapter; `vercel.json` schedules retention there), which this README does not cover.

---

### Roadmap (High Level)

Every feature is free to use, for everyone, and stays that way through each stage below.

- **Short‑term** (the launch items are in [docs/GO-LIVE-CHECKLIST.md](docs/GO-LIVE-CHECKLIST.md))
  - Finish the enterprise portal launch items in [docs/PRD.md](docs/PRD.md).
  - Done since the first version of this README: Supabase Auth, live chat on Anthropic, 9 languages.

- **Mid‑term**
  - Richer inline field validation.
  - More languages via `next-intl`.
  - Tighten the Supabase schema and its documentation.

- **Long‑term**
  - Mobile‑optimized experience and/or standalone mobile app.
  - Team / organization workspaces and shared document libraries.
  - Partner portal for immigration lawyers and nonprofits.

---

### License

This project is open source under the MIT License. See [`LICENSE`](LICENSE) for the full text.

Dependencies and bundled assets (fonts, the pdf.js worker, images) keep their own licences; they are listed in [`THIRD-PARTY-LICENSES.md`](THIRD-PARTY-LICENSES.md).
