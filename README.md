# SK Bagumbong 171 Hub

A static (no build step, no framework) web app for the Sangguniang Kabataan of Barangay 171, Bagumbong. Residents can register, view announcements and events, register for events, message the SK office, and request/download their SK Barangay ID and event certificates. Admins manage all of the above from an admin panel.

Backend is entirely Firebase: **Authentication** (email/password), **Firestore** (data), and **Storage** (certificate template image). There is no server code — everything runs client-side in `app.js` against the Firebase Web SDK (v8, loaded via `<script>` tags, no bundler).

## Tech stack

- Plain HTML/CSS/JS, one shared [app.js](app.js) (~2,900 lines) driving every page by feature-detecting which DOM elements exist on the current page.
- Firebase JS SDK **v8** (compat, script-tag style — not the modular v9+ SDK) via `gstatic.com` CDN.
- No `package.json` / npm build. `package-lock.json` is an empty leftover and can be ignored or deleted.
- No `firebase.json` / `.firebaserc` in the repo — Firestore/Storage rules are deployed manually (Firebase Console or ad-hoc CLI), not via `firebase deploy`.
- Hosting target: **Netlify** (Git-connected auto-deploy — no `netlify.toml` in the repo, so it's relying on Netlify's default static-site detection, publishing the repo root as-is). The GitHub remote (see [git remote add origin httpsgithub.c.txt](git%20remote%20add%20origin%20httpsgithub.c.txt), scratch notes from initial repo setup) is what Netlify watches for deploys — GitHub Pages was the original plan in [ProjectDev.txt](ProjectDev.txt) but is not what's actually used.

## Pages

| Page | Purpose |
|---|---|
| [index.html](index.html) | Public landing page: Log In / Create Account (registration collects name, email, password, address, birthdate, contact number, photo, and a valid ID image) |
| [complete-profile.html](complete-profile.html) | Prompts legacy/incomplete accounts to fill in missing profile fields |
| [dashboard.html](dashboard.html) | User home: announcements feed, upcoming events, event registration |
| [profile.html](profile.html) | User's own profile, SK Barangay ID status/download, certificates, profile-change requests |
| [messages.html](messages.html) | User-side messaging thread with the SK office |
| [admin.html](admin.html) | Admin home: stats overview + links into every admin tool |
| [admin-add-events.html](admin-add-events.html) / [admin-manage-events.html](admin-manage-events.html) | Create / edit / archive events |
| [admin-add-announcement.html](admin-add-announcement.html) / [admin-manage-announcements.html](admin-manage-announcements.html) | Post / edit / delete announcements |
| [admin-manage-id-applications.html](admin-manage-id-applications.html) / [admin-id-template.html](admin-id-template.html) | Approve/reject SK ID applications; manage the ID card template image |
| [admin-certificate-template.html](admin-certificate-template.html) | Upload/replace the certificate template image |
| [admin-manage-users.html](admin-manage-users.html) | User directory, role management, profile-change-request approvals |
| [admin-messages.html](admin-messages.html) | Inbox of all user message threads |

Admin can also switch into "User View" (`dashboard.html?preview=admin`) to preview the resident-facing UI without logging out.

## Firestore data model

- **`users/{uid}`** — profile (name, email, address, birthdate, contact number, photo), `role` (`user` | `admin`, default `user`), `idStatus` (`pending`/approved/etc.), `idNumber`.
- **`profileChangeRequests/{uid}`** — one doc per user (doc ID = uid). Holds a pending edit to name/birthdate/contact/address plus a proof photo, awaiting admin approval. A user can't have two pending requests at once.
- **`events/{eventId}`** — title, description, date, creator ID, timestamp. Admin-authored only.
- **`registrations/{registrationId}`** — links `eventId` + `userId` + timestamp; one per user/event pair; immutable (no client deletes), doubles as attendance record once admin marks it.
- **`announcements/{announcementId}`** — admin-authored posts shown on the dashboard feed.
- **`settings/{docId}`** — shared config docs: `certificateTemplate`, `idTemplate`, `idCounter` (for sequential ID numbers).
- **`threads/{threadId}` → `messages/{messageId}`** — one thread per user conversation with the SK office (thread has a random ID, not the uid, so a user can have multiple/re-opened threads); messages are immutable once sent.

Certificates and ID cards are generated **client-side on a `<canvas>`** (see `generateCertificateCanvas` / `generateIdCardCanvas` in [app.js](app.js)) by drawing the admin-uploaded template image plus the user's data, then offered as a PNG download — there's no server-side PDF/image generation.

## Security model (Firestore/Storage rules)

Rules live in [firestore.rules](firestore.rules) and [storage.rules](storage.rules) — **not deployed automatically**; push them by hand whenever they change (Firebase Console → Firestore/Storage → Rules, or `firebase deploy --only firestore:rules,storage` if you set up the Firebase CLI locally). Key points to remember:

- Every collection defaults to **deny-all** (`match /{document=**} { allow read, write: if false }` at the bottom of `firestore.rules`) — new collections need an explicit rule or they're unreadable/unwritable.
- `isAdmin()` works by reading the requester's own `users/{uid}` doc and checking `role == 'admin'` — admin role is **never** trusted from the client, only from what's already stored in Firestore.
- Users **cannot self-assign** `role` or `idStatus`/`idNumber` at signup or via later updates — those fields only change through the `isAdmin()` branch. Sensitive profile fields (name, birthdate, contact, address) can only be set once directly by the owner; changing them afterward requires going through `profileChangeRequests` and admin approval.
- `registrations` and thread `messages` are **immutable** (`allow delete: if false` / `allow update, delete: if false`) — they're treated as permanent records, not editable state.
- Storage currently only has a rule for `certificateTemplate/` (readable by any signed-in user, writable only by admins); everything else in Storage is default-deny, so a new upload feature (e.g. ID application photos) needs its own rule block added before it'll work.

**The Firebase config (`apiKey`, `projectId`, etc.) in [connectfirebaseconfig.txt](connectfirebaseconfig.txt) and hardcoded at the top of [app.js](app.js) is a public, client-side identifier — not a secret.** All real access control is enforced by the rules files above, so protecting this repo's contents doesn't depend on hiding that config.

## Dev vs. Production Firebase projects

The original plan ([ProjectDev.txt](ProjectDev.txt)) calls for two separate Firebase projects (Development and Production) with a config switch, so features can be tested without touching real user data. **As currently checked in, `app.js` hardcodes a single project's config** (`sk-web-dev-41979`) — there is no dev/prod toggle in the code yet. If you want to follow the original plan:

1. Create a second Firebase project for Production (enable Email/Password auth + Firestore there too).
2. Add a way to select which `firebaseConfig` object gets passed to `firebase.initializeApp()` (e.g. two config objects + a flag, or separate files loaded per environment) instead of the single hardcoded object at the top of `app.js`.
3. Deploy the same `firestore.rules` / `storage.rules` to both projects.
4. Manually assign the `admin` role to specific users' Firestore docs in each project (there's no self-service admin signup, by design).

## Deploying

This is a static site — there is no build step. To ship a change:

1. Test against the Development Firebase project first (see above) if you've split dev/prod; otherwise test locally.
2. If `firestore.rules` or `storage.rules` changed, publish them in the Firebase Console (or via `firebase deploy` if the CLI is configured — not currently set up in this repo).
3. Commit and push to `main`:
   ```bash
   git push origin main
   ```
4. **Netlify auto-deploys from this GitHub repo on push to `main`** — no manual deploy step needed. Check the deploy status/log in the Netlify dashboard (site → Deploys) if the live site doesn't update as expected.
5. Load the live Netlify URL and do a smoke test with a real (non-admin) account and, separately, an admin account — check login, dashboard feed, event registration, and at least one admin action.

Note: since this is a plain static site (no build command needed), Netlify's build settings should have an empty/no build command with the publish directory set to the repo root (`.`). If a Netlify build step is ever added (bundler, minifier, etc.), that would need a `netlify.toml` checked into the repo — there isn't one today.

## Notes / stray files

- [package-lock.json](package-lock.json) — empty lockfile with no `package.json` behind it; harmless leftover, safe to delete if you're not planning to add npm tooling.
- [for instructional purposes.txt](for%20instructional%20purposes.txt) — unrelated scratch notes (lab equipment calibration), not part of this project. Safe to ignore/remove.
- [git remote add origin httpsgithub.c.txt](git%20remote%20add%20origin%20httpsgithub.c.txt) — one-time setup commands used when this repo was first pushed to GitHub; kept only as a record of the remote/GitHub Pages URL.
