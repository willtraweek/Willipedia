# Willipedia — Claude working notes

Willipedia is a single-user personal wiki reader for Will's GBrain (personal knowledge graph), served over Tailscale. Astro multi-page app. Reader-only in v0 — writes happen in GBrain/Obsidian.

**Thesis:** Willipedia is the *input* layer to GBrain, not the output layer. Every hover, empty-result search, broken wikilink, re-read, and scroll-past is signal. Scope new features by "does this generate better signal for GBrain?", not just "does this make reading better?"

## Design

**All visual work must follow [`DESIGN.md`](./DESIGN.md).** The design was approved 2026-04-21 via `/design-consultation` and the mockup is Variant A (Private Broadsheet). Before writing any `.astro`, `.css`, or Tailwind config, read `DESIGN.md`. The banned-list at the bottom of `DESIGN.md` is non-negotiable — if a change would introduce a banned pattern, stop and raise it.

**Embarrassment test** (runs on every UI change): *"If I printed this at 300dpi on cream uncoated stock and handed it to a typographer, would they gasp — or politely nod?"* Polite nods are failures.

## Scope

**v0 (current):** reader-only end-to-end, minimum viable broadsheet. No telemetry, no `/stats`, no Cmd+K, no service worker. See `TODOS.md` for what was deliberately deferred and why.

**PR #2 (next, within 48h of v0):** Postgres telemetry layer (`willipedia` schema, `page_views` / `search_log` / `broken_links`, cookie-based `session_id`, throttled logger, degraded-mode probe). This is load-bearing for the GBrain thesis — without it, Willipedia can't collect signal.

## Skill routing

When the user's request matches an available skill, ALWAYS invoke it using the Skill
tool as your FIRST action. Do NOT answer directly, do NOT use other tools first.
The skill has specialized workflows that produce better results than ad-hoc answers.

Key routing rules:
- Product ideas, "is this worth building", brainstorming → invoke office-hours
- Bugs, errors, "why is this broken", 500 errors → invoke investigate
- Ship, deploy, push, create PR → invoke ship
- QA, test the site, find bugs → invoke qa
- Code review, check my diff → invoke review
- Update docs after shipping → invoke document-release
- Weekly retro → invoke retro
- Design system, brand → invoke design-consultation
- Visual audit, design polish → invoke design-review
- Architecture review → invoke plan-eng-review
- Save progress → invoke context-save
- Resume, restore context → invoke context-restore
- Code quality, health check → invoke health
