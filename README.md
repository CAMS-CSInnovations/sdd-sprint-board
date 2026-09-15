# SDD Capstone Sprint Board — Setup Guide

One page (`index.html`) serves all 8 teams — each team gets a link like
`.../?team=1` through `.../?team=8`. Data lives in a Google Sheet. Clicking
**Commit Update** on any team's board emails you a full snapshot of that
team's board automatically.

Two parts to set up: the **backend** (Google Sheet + Apps Script) and the
**site** (GitHub Pages). Do them in this order — the site needs the backend's
URL before it'll work.

---

## Part 1 — Backend (Google Sheet + Apps Script)

1. Go to [sheets.google.com](https://sheets.google.com) and create a **new,
   blank spreadsheet**. Name it something like "SDD Sprint Board Data."
2. In the menu: **Extensions → Apps Script**. This opens the script editor
   in a new tab.
3. Delete everything in the default `Code.gs` file, and paste in the full
   contents of **`Code.gs`** from this folder.
4. Near the top of the pasted code, find this line:
   ```js
   const TEACHER_EMAIL = 'you@example.com'; // <-- CHANGE THIS
   ```
   Replace `'you@example.com'` with your real email address, in quotes.
5. Click the **Save** icon (or Ctrl/Cmd+S).
6. Click **Deploy → New deployment**.
   - Click the gear icon next to "Select type" and choose **Web app**.
   - **Execute as:** Me (your account)
   - **Who has access:** Anyone
   - Click **Deploy**.
7. Google will ask you to **authorize** the script — this is normal; it
   needs permission to read/write the Sheet and send email *on your
   behalf*. Click through the consent screens (you may see an "unverified
   app" warning since this is your own private script — click **Advanced →
   Go to [project name] (unsafe)** to proceed; it's safe because you wrote
   and control the code).
8. After deploying, copy the **Web app URL** it gives you — it looks like:
   ```
   https://script.google.com/macros/s/AKfycb.../exec
   ```
   You'll need this in Part 2.

The Sheet will automatically grow two tabs the first time a student uses a
board: `BoardState` (current state per team) and `CommitLog` (a permanent
record of every commit, in case you ever want to look back further than
your inbox).

**If you ever edit `Code.gs` again:** you must go to **Deploy → Manage
deployments → edit (pencil icon) → New version → Deploy** for changes to
take effect. Saving alone isn't enough.

---

## Part 2 — Site (GitHub Pages)

1. On GitHub, create a **new repository** — public (GitHub Pages on a free
   plan needs a public repo unless your account has Pages-on-private
   enabled). Something like `sdd-sprint-board`.
2. Upload these three files from this folder into the repo's root:
   - `index.html`
   - `config.js`
   - (you can skip uploading `Code.gs` and this `README.md` here, or include
     them for your own reference — they don't affect the site)
3. Open `config.js` **in the GitHub web editor** (click the file, then the
   pencil/edit icon) and replace the placeholder with the Web app URL from
   Part 1, step 8:
   ```js
   const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycb.../exec";
   ```
   Commit the change.
4. In the repo: **Settings → Pages**. Under "Build and deployment," set
   **Source: Deploy from a branch**, branch **main**, folder **/ (root)**.
   Save.
5. GitHub will give you a URL like:
   ```
   https://<your-username>.github.io/sdd-sprint-board/
   ```
   It can take a minute or two to go live the first time.

## Team links

Once the site is live, each team's link is the site URL plus `?team=N`:

```
https://<your-username>.github.io/sdd-sprint-board/?team=1
https://<your-username>.github.io/sdd-sprint-board/?team=2
... through team=8
```

Send me your final site URL once it's live and I'll generate a labeled PDF
of all 8 links, the same way I did for the earlier version.

---

## How it works, briefly

- Every edit a student makes saves to the Sheet within about half a second.
- The board re-checks the Sheet every 6 seconds, so teammates on other
  devices see updates without refreshing.
- **Commit Update** sends you an email immediately with that team's full
  board — goals, blockers, retro actions, and every card in every column —
  plus logs a permanent copy in the `CommitLog` tab.
- Nothing here depends on students having a Claude account — it's a plain
  webpage, so this sidesteps the district-authentication question entirely.

## Known limitation worth knowing

Google Apps Script Web Apps occasionally add a second or two of latency on
the first request after being idle, and MailApp has a daily sending quota
(150 emails/day on a standard Google Workspace account) — worth knowing if
you ever have a day with an unusually high number of commits across all 8
teams, though ordinary classroom use won't come close to that limit.
