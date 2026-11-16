# CoDH App

## Run a local demo

Start the local demo server:

```sh
npm run dev
```

Open [http://127.0.0.1:4173](http://127.0.0.1:4173) and sign in with:

- Email: `admin@codh.local`
- Password: `123456`

The local demo also includes a Human Resource reviewer:

- Email: `hr@hospital.gov`
- Password: `password123`

Requests move through Department Head, Human Resource, Administrative Officer V,
and Chief of Hospital review in that order. On a deployed app, an administrator
must approve a Human Resource account before requests can be routed to it.
Supporting documents, profile photos, and e-signatures accept PNG and JPEG files
(up to 4 MB). Profile photos and e-signatures are uploaded when you save profile
changes. Their file metadata is stored in the `profile_media` database table,
and their image data is stored in Netlify Blobs.

Registration records a user's last, first, and optional middle name, position,
and tags the account as Contract of Service or Permanent. Only administrators
can change a user's employment type. Permanent accounts can update their position
and salary from My Profile; salary changes are recorded in the profile's salary
adjustment history.
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
`local-demo-data.json`. It does not connect to the Netlify database. The file is
ignored by Git.

## Deploy from GitHub to Netlify

Netlify's Git integration keeps the deployed app up to date with the selected
GitHub branch. After linking the repository, each push to the production
branch triggers a build and deploy; pull requests can also get deploy previews.
This syncs the app's source code, not local demo data or uploaded files. A
drag-and-drop static deploy does not publish the API function, so the app will
not be able to sign in or save data.

1. Push this project to a GitHub repository. In Netlify, choose **Add new
   project** → **Import an existing project** → **GitHub**, authorize Netlify
   to access the account/repository, and select the repository and production
   branch. Keep the build settings from `netlify.toml`: Node.js 22,
   `npm run build`, publish directory `dist`, and functions directory
   `netlify/functions`.
2. Create an Atlas database user with access to the application database, and
   configure Atlas Network Access to allow the Netlify Functions' outbound
   connections. In the Netlify site's **Environment variables** settings, add
   `MONGODB_URI` as a secret containing the Atlas connection string and set
   `MONGODB_DATABASE` to `codh_app`. Never put the URI in GitHub or in this
   repository. The API creates the database and collections on its first
   request after connecting.
3. Add `SYSTEM_ADMIN_PASSWORD` as a secret available to Functions. Optionally
   set `SYSTEM_ADMIN_EMAIL` to the administrator's sign-in email; if omitted,
   the existing default administrator email is used. Do not put either value
   in GitHub or in this repository. Netlify keeps these values as site
   configuration across GitHub-triggered deploys, so this is a one-time setup
   unless you change the password or create a different Netlify site. If you
   add or change a variable after a deploy, trigger a new deploy for the
   function to pick up the updated configuration. The app creates or promotes
   that account to System Administrator on its first API request. The password
   is hashed before it is stored in MongoDB Atlas.
4. Trigger the initial deploy. Afterward, pushes to the selected production
   branch automatically build `dist/` and deploy the `/api/*` function
   alongside it.

Switching to Atlas does not migrate records from the previous Netlify
PostgreSQL database. The old data remains in that database, but the app starts
with empty MongoDB collections until records are created or migrated
separately. File bytes for attachments and profile media continue to use
Netlify Blobs.

Each build embeds its UTC build timestamp as the app version, displayed below
the app name, so the version updates automatically on every Netlify deploy.

## Download the Android app

On Android, the Netlify site shows a **Download APK** button. It links to the
latest APK attached to the GitHub repository's release. The Android package
loads the live site at `https://codhapp2026.netlify.app/`, so it needs an
internet connection and uses the same Netlify API and database as the website.

The `Build Android APK` GitHub Actions workflow builds and publishes the APK
when changes are pushed to `main`. The repository must be public for people
without GitHub accounts to download its release asset. After the first
successful workflow run, `/download-app` on Netlify redirects to the APK.
Android may ask the user to allow app installs from their browser before
installing the downloaded APK. The workflow retains its debug signing key so
future APK builds can update the installed app; these builds are for direct
testing/download, not Google Play distribution.

The configured admin password must be entered as a Netlify secret; it cannot be
securely supplied by a GitHub pull or stored in source code. The local demo
server and its demo accounts remain separate from the deployed database.
