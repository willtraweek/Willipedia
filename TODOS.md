# Willipedia TODOs

Deferred from the v0 plan — combination of the CEO plan's scope-expansion ceremony (`~/.gstack/projects/willtraweek-Willipedia/ceo-plans/2026-04-20-gbrain-wiki-reader.md`) and the follow-up eng-review scope split (2026-04-21, Issues 15–17).

Priority buckets reflect plan intent, not commitments.

## PR #2 (target: within 48h of v0 ship)

- **Postgres telemetry layer** — the full system the CEO review accepted and the eng review split out. Bundle: schema `willipedia` on the wrapper's Postgres instance; `willipedia_app` role with USAGE on schema + CRUD on tables only; `schema_migrations(version, applied_at)` tracking table; versioned, transactional migrations (BEGIN/body/COMMIT per file, second boot is no-op); `page_views(ts, slug, session_id)`, `search_log(ts, query, results_count, session_id)`, `broken_links(ts, from_slug, target_slug)` — all schema-qualified; indexes: `(ts DESC)` on page_views and search_log, `(slug, ts)` on page_views, `(target_slug)` on broken_links; cookie-based `session_id` (HttpOnly, Path=/wiki, 24h-inactivity TTL, reset on bearer change); Bun native SQL client with an injectable handle so integration tests can wrap in per-test BEGIN/ROLLBACK; fire-and-forget telemetry helpers (`recordPageView`, `recordSearch`, `recordBrokenLink`) that swallow errors and call the throttled logger on failure; throttled stderr logger (`src/lib/logger.ts`, module-level Map<errorCode, lastLoggedAt>, first-call logs, within-60s silent, after-60s logs with count); module-level degraded flag (`src/lib/degraded.ts`); background 30s probe that heartbeats Postgres, re-runs migrations idempotently, and clears the degraded flag on success (with race guards against concurrent boot migration); smart home 3-section (Continue reading via `SELECT DISTINCT ON (slug)` from page_views, Recently updated via filesystem mtime scan cached 60s, Haven't visited via oldest `MAX(ts) GROUP BY slug`) with per-section failure isolation so one broken query doesn't kill the home; broken-link insert fires inside the wikilink rewriter when target `.md` is absent; dedicated integration test harness (shared `willipedia_test` DB, per-test BEGIN/ROLLBACK) and migration-runner test (fresh, idempotent, partial-failure rollback). Why: the "Willipedia is the input layer to GBrain" thesis requires the SYSTEM to exist before v1 can be designed. Shipping risk for tonight was the reason to split; the schema's strategic value is the reason not to skip.

- **Service Worker offline cache** — Workbox + stale-while-revalidate on `/page/*` and `/assets/*`, LRU ~100MB, version-stamped SW name with unregister-on-version-mismatch, offline banner on home/search. Deferred from v0 after the CEO-plan outside-voice trim (single biggest ship-tonight landmine). Revisit once v0 is stable and the subway-use case actually starts failing on Safari's native cache.

- **`/stats` observability dashboard** — 30-day activity chart, top-visited pages (7/30d), last 50 zero-result searches, top 20 broken wikilinks by frequency. Bearer-gated like the rest of the app. Unblocks once PR #2 telemetry ships with zero data loss.

- **Nudge channel** — the feedback pipe that makes Willipedia the input layer to GBrain rather than just a reader. Gated on the GBrain wrapper's scope expansion (writes, not just reads). Activation trigger: the wrapper exposes a `draft_page(slug)` tool. Shipping a half-wire nudge channel without the wrapper side would be technical debt. v0 ships the 404 card visually with the button `aria-disabled="true"` + `[QUEUED FOR v0.2]` small-caps muted marker. Activation = swap the href/aria-disabled for a real POST + the full job-submission state model (loading, queued, already-queued, success, write-failure, wrapper-down, auth-expired, duplicate-slug, rate-limit) documented in the plan-design-review P1-3. See `docs/designs/2026-04-20-gbrain-wiki-reader.md` Plan File Review Report.

## PR #2+ (after Postgres layer lands)

- **Cmd+K command palette** — Astro island bound to global Cmd+K. Modal with focus trap, Escape closes; empty input shows 10 most recent visited slugs (server-backed via PR #2 session-aware telemetry, not localStorage); typed input debounces 150ms then hits `/api/search`; arrow keys move selection, Enter navigates, Cmd+Enter opens in new tab. On touch devices: a visible "Search" button opens the same modal (Cmd+K is undiscoverable on mobile). Why: speed layer for frequent readers. Context: deferred from v0 because three search surfaces (SearchBar + Cmd+K + /search) was overbuilt for tonight's reader; re-entry after telemetry provides server-side recent-viewed. If SearchBar + /search proves sufficient post-v0, this stays deferred.

- **Scroll memory + session breadcrumb** — localStorage `readPosition:{slug}` throttled 2s on scroll; restore on page load after `document.fonts.ready` + 1 rAF, clamped to `scrollHeight`, only if saved < 24h. Session breadcrumb in sessionStorage keyed per tab session, ring-buffered at 50 entries, renders in header after 2nd page visit. Why: the subway-reading use case is the whole motivation; losing scroll on every tap kills it. Context: deferred from v0 under the reader-first split; arguably belongs in v0 since it's purely client-side, but CEO-split discipline says ship the minimum tonight.

- **Print stylesheet** — `@media print` in global.css hides nav/TOC/sidebars; 1in margins, 11–12pt serif body, orphans/widows tuned, proper page breaks at headings. Subtle footer with slug + date. "Print this page" link in article header. Image sizing: `max-width: 100%`, `page-break-inside: avoid`. Why: typography-as-product extends to clean document output; a Wikipedia article printed is still a great document. Context: deferred from v0 — doesn't reduce launch risk. ~15 min CC effort when picked up.

## v1+ (intentional omissions from v0)

- **Graph view** — visual map of the knowledge graph. Nice to have, not load-bearing for the "read it like a book" thesis.
- **Edit functionality** — v0 is read-only end-to-end. Writes live in GBrain / Obsidian for now.
- **Category nav / left-column browsing** — search + wikilinks suffice for v0. If navigation breaks down as the graph grows, revisit.
- **Dark mode toggle** — `prefers-color-scheme` is enough for v0. Add an explicit toggle only if the OS-level setting proves insufficient.
- **Backlinks count + last-updated in hover preview** — marginal value in v0; would require either extra wrapper calls or a denormalized cache.

## Backlog refinements

- **Backlink-weighted "Haven't visited in a while" sort on the smart home page** — v0 ships a simple oldest-last-visited sort. Backlink-weighting (prioritize well-connected pages you've neglected) requires either a full backlink index or many wrapper calls; revisit when the naive sort proves insufficient.

## From /plan-design-review (2026-04-22) — additions

- **Self-host Fraunces + EB Garamond + EB Garamond SC locally.** v0 ships with Google Fonts + `<link rel="preload">` + a tuned fallback stack (`'Fraunces', ui-serif, Georgia, 'Times New Roman', serif`), which covers the cold-boot failure mode. Long-term: vendor the .woff2 files into `/public/fonts` and drop the CDN dependency. Sub-hour effort when picked up.

- **Hover preview card visual spec** (link: `docs/designs/2026-04-20-gbrain-wiki-reader.md` P1-3). 360px card with paper fill + 1px ink-40% border + 300ms hover delay + loading/error states. Already in DESIGN.md as the concept; this adds the full visual spec to apply when implementation starts.

- **DESIGN.md editing pass** — close the five ambiguities named in the review (P2-1): dark-mode SOFT scope, deck-size breakpoints, kicker letter-spacing scope, article-title tracking numerics, dotted-underline offset reference. Also add versioned sections for the home page (v0 vs PR #2). 15-30 min edit pass; do once DESIGN.md is being touched for PR #2 anyway.

- **DESIGN.md: pilcrow (¶) pinned as external-link glyph.** Update DESIGN.md:194 to name the choice unambiguously.
