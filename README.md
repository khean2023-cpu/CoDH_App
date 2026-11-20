# CoDH App

## Run a local demo

Start the local demo server:

```sh
npm run dev
```

Open [http://127.0.0.1:4173](http://127.0.0.1:4173) and sign in with:

- Email: `admin@codh.local`
- Password: `123456`

- Email: 'kheanlisondrafinal@gmail.com'
- Temporary password: DoPgZoq6OchsDKG3HUdzxFGi

The local demo also includes a Human Resource reviewer:

- Email: `hr@hospital.gov`
- Password: `password123`

Requests move through Department Head, Human Resource, Administrative Officer V,
and Chief of Hospital review in that order. On a deployed app, an administrator
must approve a Human Resource account before requests can be routed to it.
Supporting documents, profile photos, and e-signatures accept PNG and JPEG files
(up to 4 MB). Profile photos and e-signatures are uploaded when you save profile
changes. Their file metadata is stored in the `profile_media` database table,
and their image data is stored in private Vercel Blob storage.

Registration records a user's last, first, and optional middle name and position.
Deployed registration also collects requested role, department, and employment
type. These are requests only: new accounts remain pending Contract of Service
Employees without a department until an administrator reviews and assigns them.
Permanent accounts can update their position and salary from My Profile; salary
changes are recorded in the profile's salary adjustment history.
All accounts can open the salary portal inside the app from the navigation or
My Profile to check their salary and payroll details.

Leave applications use the CSC Form No. 6 for Permanent accounts. Contract of
Service accounts use a separate leave form with unpaid leave types, purpose,
inclusive dates, and optional temporary-reliever details. The account's
employment type determines which form is shown, and the selected form details
are included in request views and printouts.

Exchange-of-duty requests include the exchange date and an approved employee
selected to cover the duty. The selected employee must accept the request before
it proceeds to the Department Head and the remaining approval stages.

My Profile includes Tetris, controlled with the arrow keys or on-screen buttons.
Clear lines to score points; every 500 points advances a level and increases the
falling speed from Easy through Medium to Hard. Use Up/X to rotate, Space to hard
drop, and P to pause. Game sounds can be muted or enabled, including movement,
piece-lock, line-clear, and Game Over sounds. When the game ends, a Game Over
screen shows the final score and lets you play again without closing the app.
Its live leaderboard shows approved accounts, refreshes every 15 seconds, and
stores each account's best score in the deployed database or the local demo
data file. On mobile,
starting a game opens a screen-filling layout; use Full screen to open that
layout on other devices. Exit pauses the game and Resume returns to the game.

Request slips can be printed or saved as PDF from the print dialog. The slip is
formatted for quarter-letter portrait (one quarter of an 8.5 × 11-inch bond
sheet) with borderless request details and evenly aligned approval and
signature sections. PDF output is constrained to one page.

The local demo API runs only on this computer and saves its data in
`local-demo-data.json`; uploads are stored in `local-demo-blobs/`. Both paths are
ignored by Git.

## Offline access

While signed in, the app saves a device-local copy of the account's authorized
users, requests, notifications, and archives in IndexedDB. If the API becomes
unavailable, a previously signed-in account can view this saved data in
read-only mode; the app refreshes the copy when it reconnects. Attachments and
profile photos/signatures and the external salary portal are not available
offline. Logging out removes the saved data for that account from the device.
Protect devices that contain cached employee information, and clear the
browser or app data when retiring a device.

## Deploy from GitHub to Vercel

The Vercel configuration builds the static app into `dist/` and routes `/api/*`
to a Vercel Function. The API uses PostgreSQL provisioned through a Vercel
Marketplace integration and private Vercel Blob storage for uploaded documents
and profile media.

1. Import this repository in Vercel and select the branch to deploy. Set the
   build command to `npm run build`, output directory to `dist`, and Node.js to
   version 22.
2. Add a PostgreSQL database through the Vercel project's **Storage** or
   **Marketplace** page (for example, Neon) and connect it to the project for
   Production and Preview. The app reads `POSTGRES_URL` or `DATABASE_URL`.
3. Create a **private** Blob store and connect it to the project for Production
   and Preview. This supplies the function's Blob credentials. Do not make the
   store public.
4. Add `SYSTEM_ADMIN_PASSWORD` as a secret before the first API request.
   Optionally set `SYSTEM_ADMIN_EMAIL`; if omitted, the existing default
   administrator email is used. Keep these values out of Git and source code.
5. Deploy the project. The API creates its tables and indexes on the first
   request after connecting to PostgreSQL. Existing records and uploaded files
   are not copied automatically; import them separately if they must remain
   available.

### Manual prebuilt deployment from VS Code

If Git-triggered deployments are blocked by a remote build limit, run **Tasks:
Run Task → Manual deploy to Vercel (prebuilt)** in VS Code. This task pulls the
Production settings, builds locally with the Vercel CLI, then uploads the
prebuilt output. The first run may ask you to authenticate with Vercel. The
`.vercel` directory stores local project settings and is ignored by Git; do
not commit it or any deployment credentials. Prebuilding can avoid Vercel's
remote build step, but cannot bypass account-level deployment or usage limits.

The deployed API uses expiring, HttpOnly sessions. New registrations are
Employees with no department assignment until an administrator reviews the
requested role, department, and employment type, assigns the final values, and
approves the account. Administrators manage all accounts and records; other
roles are limited to their own data and the requests assigned to their approval
workflow.

The app version is displayed below the app name as a short `major.minor`
number. The VS Code auto-sync task increments the minor number before each
automatic commit and push to `main` (for example, `1.0`, `1.1`, `1.2`); Vercel
deploys the pushed version. Changes pushed outside that auto-sync task do not
increment the version automatically.

## Download the Android app

On Android, the Vercel site shows a **Download APK** button. It asks for
confirmation before downloading the latest APK attached to the GitHub
repository's release; Android separately asks before installing it. The
Android package opens the live Vercel site inside the app and needs an internet
connection, using the same API and database as the website.

The `Build Android APK` GitHub Actions workflow builds and publishes the APK
when changes are pushed to `main`. The repository must be public for people
without GitHub accounts to download its release asset. After the first
successful workflow run, `/download-app` on Vercel redirects to the APK.
Android may ask the user to allow app installs from their browser before
installing the downloaded APK. The workflow retains its debug signing key so
future APK builds can update the installed app; these builds are for direct
testing/download, not Google Play distribution.

The configured admin password must be entered as a Vercel secret; it cannot be
securely supplied by a GitHub pull or stored in source code. The local demo
server and its demo accounts remain separate from the deployed database.
