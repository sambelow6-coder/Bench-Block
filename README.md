# Bench Block — Sam & Manny's coach-loop app

A deliberately dumb PWA. It displays the program Claude (the coach) prescribed,
records what actually happened, and ships the log back. All coaching
intelligence stays in the weekly Claude conversation.

## The loop
- **Coach → lifters:** `program.json` in this repo IS the program. Weekly
  update = Claude edits it, bumps `program_version`, commits, pushes. The app
  is network-first, so both phones show the new week on next open.
- **Lifters → coach:** every tap in the app becomes an entry in localStorage.
  "Send to Coach" bundles unsynced entries into `coachlog_<person>_<stamp>.json`
  and opens the share sheet → save to `OneDrive/WorkoutCoach/logs/`.
  Claude reads that folder from Sam's PC at the start of each weekly session.

## Data rules (consumer = Claude)
- Latest record per `(person, date, type, ex, set/field)` wins.
- `rpe: null` / `value: null` = that fact was cleared.
- `skip` (whole day) / `exskip` (one exercise) / `add` with `retracted: true`
  = that record was undone/deleted after it synced.
- Entries are never edited in place across exports — corrections arrive as
  re-sent records with newer `ts`.

## Hosting
GitHub Pages, public repo (the site holds no personal data beyond first names
and prescribed weights — logs never touch the repo). One-time setup: install
GitHub CLI, `gh auth login`, then Claude handles repo/pages/pushes.

## Files
- `program.json` — the current program (single source of truth, coach-written)
- `index.html` / `style.css` / `app.js` — the app (no build step, no deps)
- `sw.js` — network-first service worker (fresh online, functional offline)
- `manifest.webmanifest` + `icons/` — installability (add to home screen)
