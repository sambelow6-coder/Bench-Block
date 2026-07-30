# Bench Block — Sam & Manny's coach-loop app

A deliberately dumb PWA. It displays the program Claude (the coach) prescribed,
records what actually happened, and ships the log back. All coaching
intelligence stays in the weekly Claude conversation.

## The loop
- **Coach → lifters:** `program.json` in this repo IS the program. Weekly
  update = Claude edits it, bumps `program_version`, commits, pushes. The app
  is network-first, so both phones show the new week on next open.
- **Lifters → coach:** every tap becomes an entry in localStorage. "Send to
  Coach" POSTs the unsynced ones to a Google Form Sam owns (one tap, no
  sign-in, no share sheet); the Form appends them to its response Sheet in
  Sam's Drive, which Claude reads at check-in via the Drive connector.
  Payloads over ~30k chars split into parts sharing one `batch` id.
  Fire-and-forget: a cross-origin form POST is opaque, so the app cannot
  confirm receipt — hence "resend everything" (duplicates are harmless, see
  dedup rules) and "save a file instead" as a manual escape hatch.

- **Shared log:** the same Sheet is read back as CSV (`gviz/tq?tqx=out:csv`)
  on boot, on `visibilitychange`, after a send, and via ↻ refresh, then merged
  by logical key so both lifters see one combined history on every device —
  the Sheet, not any one phone, is the durable store. Requires the Sheet set
  to "anyone with the link → Viewer" (link-sharing, NOT publish-to-web: fewer
  clicks, no multi-minute page cache). Un-sent local edits win locally and win
  in the Sheet too, since the coach resolves latest-ts-per-fact.

## Data rules (consumer = Claude)
- Latest record per `(person, date, type, ex, set/field)` wins.
- `rpe: null` / `value: null` = that fact was cleared.
- `skip` (whole day) / `exskip` (one exercise) / `add` with `retracted: true`
  = that record was undone/deleted after it synced.
- Entries are never edited in place across exports — corrections arrive as
  re-sent records with newer `ts`.

## Hosting
GitHub Pages, public repo (the site holds no personal data beyond first names
and prescribed weights — logs never touch the repo). Live at
https://sambelow6-coder.github.io/Bench-Block/ . Claude pushes updates from
Sam's PC; Pages redeploys itself and both phones update on next open.

## Files
- `program.json` — the current program (single source of truth, coach-written)
- `index.html` / `style.css` / `app.js` — the app (no build step, no deps)
- `sw.js` — network-first service worker (fresh online, functional offline)
- `manifest.webmanifest` + `icons/` — installability (add to home screen)
