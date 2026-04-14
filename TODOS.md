# TODOS

## P1: Tweet/X handler for brain ingest

**What:** Add a dedicated short-form social handler for Tweet/X URLs so `wiki brain ingest` can compile threads without pretending they are generic articles.

**Why:** Social posts have different structure, provenance, and rate-limit constraints than articles or YouTube transcripts. The compiler should not lose thread boundaries or quoted-post context.

**Pros:** Better extraction quality for a common source type. Cleaner routing into people/concepts/source pages.

**Cons:** Needs provider-specific fetch logic and probably another queue/rate-limit entry in `rate-limits.json`.

**Context:** The current compiler supports articles and YouTube only. This was explicitly left for the next pass in the compiler plan.

**Effort:** M (human) → S with CC | **Priority:** P1 | **Depends on:** brain ingest v0 | **Added:** 2026-04-13 (eng plan execution)

---

## P2: MECE schema evolution tooling

**What:** Add a workflow to audit, diff, and evolve category `README.md` routing rules as the wiki grows.

**Why:** The compiler now treats directory READMEs as routing schema. Once the wiki diversifies beyond `people`, `concepts`, and `sources`, those rules need explicit tooling instead of ad hoc edits.

**Pros:** Keeps routing intentional. Makes schema drift visible before it silently changes compilation output.

**Cons:** Needs UX design for previewing category changes and possibly re-compiling affected pages.

**Context:** `wiki brain schema` currently reads the filesystem and reports categories, but it does not help evolve them.

**Effort:** M (human) → S with CC | **Priority:** P2 | **Depends on:** real-world compiler usage | **Added:** 2026-04-13 (eng plan execution)

---

## P2: Automated sync (file watcher)

**What:** Add file watching to trigger indexing when compiled wiki pages under `COMPILED_PATH` change, instead of manual `wiki sync`.

**Why:** Manual sync means the index goes stale after manual edits or external writers. Agents could get outdated results. Completing the "flywheel" story (compile -> index -> search) requires automated sync for anything that bypasses `wiki brain ingest`.

**Pros:** Index always reflects current compiled wiki state. No manual step between edits and retrieval.

**Cons:** Adds fs.watch complexity, need to debounce rapid changes, handle partial writes, and avoid duplicate work when the compiler already reindexed.

**Context:** `wiki brain ingest` and `wiki brain drain` already reindex automatically. This follow-up is mainly for manual wiki edits and non-compiler writers. Consider using chokidar or Bun's built-in file watcher with a 2-3 second debounce after the last change.

**Effort:** M (human) → S with CC | **Priority:** P2 | **Depends on:** v0 indexer working | **Added:** 2026-04-11 (CEO review)

---

## P2: Curator agent design session (/office-hours REQUIRED)

**What:** Design the curator agent role for ai-orchestration: overnight gap analysis, freshness checks, research prioritization based on query_log data.

**Why:** The "wiki gets smarter while you sleep" vision depends on a dedicated curator agent that analyzes what's been asked, what returned zero results, and what pages are stale. This is a significant ai-orchestration architecture decision.

**Pros:** Transforms wiki from passive archive to active knowledge system. Query logging (v0) provides the signal the curator needs.

**Cons:** Needs its own design session. Touches ai-orchestration agent hierarchy, which is a separate repo. Must decide: is the curator a new agent role, or a scheduled task on an existing agent?

**Context:** Design doc Open Question #4 mentions Curator + Historian roles. Codex (outside voice) proposed "question-driven curator" where every query leaves behind gap artifacts. The query_log table in v0 is the foundation. **Run /office-hours before implementing** — this touches agent hierarchy design, not just code.

**Effort:** L (human) → M with CC | **Priority:** P2 | **Depends on:** v0 + query_log accumulating real data | **Added:** 2026-04-11 (CEO review)

---

## P2: Website for viewing compiled docs

**What:** Build a web frontend for browsing compiled wiki pages, with navigation, search, and cross-reference links rendered as clickable routes.

**Why:** The compiled markdown pages are currently only accessible through MCP tools or reading files on disk. A browsable website makes the wiki useful for humans, not just agents.

**Pros:** Makes the wiki a real product you can share and browse. Surfaces the MECE structure and cross-references visually. Could use Quartz, Astro, or a custom viewer.

**Cons:** Needs design decisions on static vs. dynamic, hosting, and how tightly to integrate with the existing search/indexer layer.

**Context:** The pipeline already produces clean markdown+frontmatter that static site generators consume. Quartz was mentioned in the original architecture. Flesh out the approach: static build from compiled/, or dynamic server reading from Postgres?

**Effort:** M (human) → S with CC | **Priority:** P2 | **Depends on:** brain compiler producing real content | **Added:** 2026-04-13

---

## P2: Investigate GBrain 0.8.0 voice mode

**What:** Look at GBrain 0.8.0's voice mode (https://github.com/garrytan/gbrain/blob/master/CHANGELOG.md) and decide whether to port voice capabilities into Willipedia or into ai-orchestration.

**Why:** Voice input could be a powerful ingest path — dictate notes, narrate observations, and have them compiled into wiki pages. But the right home for this might be ai-orchestration (as an agent skill) rather than the wiki compiler itself.

**Pros:** Natural capture method for ideas on the go. GBrain already solved the hard parts (transcription, structuring).

**Cons:** Voice is an input modality, not a compilation concern. May belong in ai-orchestration as a skill that calls `brain ingest` with transcribed content. Need to avoid scope creep in this repo.

**Context:** GBrain is the upstream reference architecture. Voice mode landed in 0.8.0. Evaluate: what did they build, what's reusable, and does it fit better as a Willipedia feature or an ai-orchestration agent capability?

**Effort:** S (research) → S with CC | **Priority:** P2 | **Depends on:** brain compiler stable | **Added:** 2026-04-13

---

## P3: Retrieval quality metrics / eval framework

**What:** Add metrics beyond latency: citation correctness, zero-result rate, false-positive rate. Possibly a `wiki eval` CLI command.

**Why:** Codex (outside voice) correctly pointed out that <500ms for 100 pages is trivial. The hard question is whether search results are actually useful to agents.

**Pros:** Know if the retrieval layer is working, not just running. Catch regression in search quality when chunking or schema changes.

**Cons:** Hard to fully automate. Needs either a set of test queries with expected results, or manual spot-checking.

**Context:** Could start simple: a `wiki eval` command that runs 10 test queries against fixtures, checks that expected pages appear in top-3 results. Graduate to LLM-judged relevance scoring later.

**Effort:** M (human) → S with CC | **Priority:** P3 | **Depends on:** v0 + real content indexed | **Added:** 2026-04-11 (CEO review)
