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

## Deploy

Deploy this project from a Git-connected Netlify site. A drag-and-drop static
deploy does not build or publish the API function, so the app will not be able
to sign in or save data.

1. Connect the repository to a Netlify site. The included `netlify.toml` pins
   Node.js 22, runs `npm run build`, publishes `dist/`, and deploys the
   `netlify/functions` API. Install and log in to the Netlify CLI, link this
   project with `npx netlify link`, then initialize the site's Netlify
   Database once with `npx netlify database init`. Netlify applies the
   committed migrations in `netlify/database/migrations` during deploy.
2. Before the first API request, add `SYSTEM_ADMIN_PASSWORD` as a secret in the
   Netlify site's environment variables. `SYSTEM_ADMIN_EMAIL` defaults to
   `kheanlisondrafinal@gmail.com` and can optionally be set there as well.
   The app creates or promotes that account to System Administrator on its
   first API request. The password is hashed before it is stored in the
   database and is never included in the repository.
3. Trigger a deploy. Netlify builds the static site into `dist/` and deploys
   the `/api/*` function alongside it.

Each build embeds its UTC build timestamp as the app version, displayed below
the app name, so the version updates automatically on every Netlify deploy.

The configured admin password must be entered as a Netlify secret; do not put
it in source code or commit it. The local demo server and its demo accounts
remain separate from the deployed database.

## Host the frontend on AWS Amplify

Amplify Hosting can serve the static frontend while Netlify continues to run the
API, database, and file storage. Keep the Netlify site deployed and configured
as described above; Amplify does not replace those backend services.

1. Connect the repository to an Amplify Hosting app. Amplify uses `amplify.yml`
   to install dependencies, run the build, and publish `dist/`.
2. In the Amplify app's hosting rewrite and redirect rules, add this rule before
   any catch-all frontend rule:

   | Source | Target | Type |
   | --- | --- | --- |
   | `/api/<*>` | `https://YOUR-NETLIFY-SITE.netlify.app/api/<*>` | `200 (Rewrite)` |

   Replace `YOUR-NETLIFY-SITE` with the deployed Netlify site's subdomain. This
   keeps API calls on the Amplify origin while forwarding them to the Netlify
   function, including sign-in, data requests, and uploads.
3. Keep `SYSTEM_ADMIN_PASSWORD` configured as a Netlify secret. The frontend
   build does not need AWS credentials or the admin password.

If the rewrite is missing or still contains the placeholder, the Amplify-hosted
frontend will load but API-backed features such as sign-in and saving requests
will not work.
