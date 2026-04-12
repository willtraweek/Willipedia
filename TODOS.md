# TODOS

## P2: Automated sync (file watcher)

**What:** Add file watching to trigger indexing when compiled/ pages change, instead of manual `wiki sync`.

**Why:** Manual sync means the index goes stale between syncs. Agents could get outdated results. Completing the "flywheel" story (compile → index → search) requires automated sync.

**Pros:** Index always reflects current compiled/ state. No manual step between compiler and retrieval.

**Cons:** Adds fs.watch complexity, need to debounce rapid changes (compiler may write multiple files), handle partial writes (don't index half-written files).

**Context:** v0 is manual CLI (`wiki sync`). This is the #1 UX improvement after v0 ships. Consider using chokidar or Bun's built-in file watcher. Debounce with 2-3 second delay after last change detected.

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

## P3: Retrieval quality metrics / eval framework

**What:** Add metrics beyond latency: citation correctness, zero-result rate, false-positive rate. Possibly a `wiki eval` CLI command.

**Why:** Codex (outside voice) correctly pointed out that <500ms for 100 pages is trivial. The hard question is whether search results are actually useful to agents.

**Pros:** Know if the retrieval layer is working, not just running. Catch regression in search quality when chunking or schema changes.

**Cons:** Hard to fully automate. Needs either a set of test queries with expected results, or manual spot-checking.

**Context:** Could start simple: a `wiki eval` command that runs 10 test queries against fixtures, checks that expected pages appear in top-3 results. Graduate to LLM-judged relevance scoring later.

**Effort:** M (human) → S with CC | **Priority:** P3 | **Depends on:** v0 + real content indexed | **Added:** 2026-04-11 (CEO review)
