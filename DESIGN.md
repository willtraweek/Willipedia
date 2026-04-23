# Willipedia Design System

*Approved 2026-04-21 via `/design-consultation`. Source mockup: [`variant-A-broadsheet.png`](../../.gstack/projects/willtraweek-Willipedia/designs/design-system-20260421-005800/mockups/round2/variant-A-broadsheet.png). Voices: Codex + Claude subagent (see `voices/` in the design dir).*

## Thesis

**Willipedia is a privately printed intellectual broadsheet.** Letterpress on warm rag paper, displayed on a screen. A reader picks up a slim weekly on the subway; that's what every page is trying to feel like.

**North star (user, literal words):** *"If we're doing this well enough: I'm reading it printed. They'll at minimum gasp at the beauty of the page."*

**Embarrassment test for every page:** if this were printed at 300dpi on uncoated cream stock and handed to a typographer, would they gasp — or politely nod? Nothing ships at polite-nod quality.

**Why it matters for GBrain:** Willipedia is the input layer, not the output layer. The broadsheet aesthetic is not decoration — it's a signal-quality amplifier. A reader who loves the page reads more deeply, which generates better attention signal (hovers, re-reads, scroll depth, empty-result searches) for GBrain to consume.

## Color

Warm, printed, no pure black, no blue, no gradients. One accent color.

### Light (default)

| Token | Hex | Usage |
|---|---|---|
| `paper` | `#F4EDE0` | page background (warm cream rag) |
| `ink` | `#1A1510` | body text (bistre, never `#000`) |
| `oxblood` | `#8B1A1A` | section kickers, drop caps, rules, wikilink underlines, marginalia |
| `muted` | `#6B5D4D` | metadata, timestamps, captions |
| `rule` | `#1A1510` @ 12% | hairline rules between sections |

### Dark

| Token | Hex | Usage |
|---|---|---|
| `paper` | `#14110D` | page background |
| `ink` | `#E8DFCE` | body text (warm cream) |
| `terracotta` | `#C67B5C` | accent (replaces oxblood in dark mode) |
| `oxblood` | `#A54A3E` | hairline rules only |
| `muted` | `#9A8D7A` | metadata |

Both modes are **warm**. Dark mode is candlelight on a desk, not a dashboard.

### Hard rules

- No `#0000FF`. No link-blue anywhere. Wikilinks are body-color.
- No pure black. Ink is bistre (`#1A1510`).
- Exactly one accent color on any given page.
- No gradients. No drop shadows. No `backdrop-filter`.

## Typography

Self-host every face. **All-serif stack. No sans-serif anywhere.** Total cost: $75 (Berkeley Mono personal-use license). Everything else is SIL OFL.

Stack locked in 2026-04-22 after live-specimen review — see `fonts/specimen.html` in the design dir for the side-by-side comparison that drove the call.

### Stack

| Role | Face | Config | License | Cost |
|---|---|---|---|---|
| Masthead, article titles | **EB Garamond** | `wght: 500` for masthead (92px) and titles (48px); italic for decks | SIL OFL (Google Fonts) | free |
| Body, deck | **Fraunces** variable | `font-variation-settings: "opsz" 20, "wght" 400, "SOFT" 50, "WONK" 0` | SIL OFL (Google Fonts) | free |
| Drop cap | **Fraunces** variable | `font-variation-settings: "opsz" 144, "wght" 200, "SOFT" 50` | SIL OFL | free |
| Small caps (kickers, metadata, marginalia, wikilink rendering) | **EB Garamond SC** | `wght: 400`, `letter-spacing: 0.08em` | SIL OFL | free |
| Code, inline and fenced | **Berkeley Mono** | Regular 400 inline; Medium 500 for emphasis. IBM Plex Mono is the fallback while the license is pending. | commercial personal-use | $75 |

### Why this stack

- **EB Garamond** for display gives the classical book-face masthead the user approved in the live specimen. Pattern-match: NYT's Cheltenham display + modern body; The New York Review of Books' antique masthead + running body. Willipedia keeps it all-serif so the letterpress illusion doesn't break at the metadata line.
- **Fraunces** at `opsz 20, wght 400, SOFT 50` is the "thicker, easier to read" body candidate from the specimen. SOFT 50 dials in warmth without losing serif contrast. One variable family covers body + drop-cap + deck by re-configuring axes.
- **Serif-only** means dropping sans-serif from the stack entirely. Section kickers, metadata ("VOL. MMXXVI · NO. 111"), and wikilinks all render in EB Garamond SC. Sans-serif metadata would slightly break the 1962-weekly illusion — this is the deepest letterpress move we can make.
- **Berkeley Mono** is the one paid face. Hand-drawn, warm, pairs well with editorial serifs. $75 is the right weight of investment — real enough to feel intentional, small enough that it's not a budgetary decision.

### Loading

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=EB+Garamond:ital,wght@0,400..700;1,400..700&family=EB+Garamond+SC&family=Fraunces:ital,opsz,wght,SOFT,WONK@0,9..144,200..700,0..100,0..1;1,9..144,200..700,0..100,0..1&display=swap" rel="stylesheet">
```

Before launch, **self-host all three free faces** (grab WOFF2 subsets via `google-webfonts-helper`) — no third-party CDN fetches at runtime.

Berkeley Mono is already self-hosted at `public/fonts/BerkeleyMono-Variable.woff2` (gitignored — licensed, drop the file in manually per clone). Declare it:

```css
@font-face {
  font-family: "Berkeley Mono";
  src: url("/fonts/BerkeleyMono-Variable.woff2") format("woff2-variations");
  font-weight: 100 900;
  font-style: normal;
  font-display: swap;
}
```

### Body copy rules (non-negotiable)

- **Indented paragraphs.** First-line indent `1.2em` (~24px at 20px body). No blank line between paragraphs.
- **Measure:** 66–72ch per column.
- **Hyphenation** on: `hyphens: auto`.
- **Orphans/widows:** 3.
- **Oldstyle numerals** in body: `font-feature-settings: "onum" 1, "kern" 1, "liga" 1`. Body text of a book uses oldstyle; tabular numerals only appear in data tables.
- **Small caps:** always the real EB Garamond SC file, never the faux `font-variant-caps: small-caps` synthesis — faked small caps are thinner and read wrong at metadata sizes.
- **Dark mode:** same faces. Drop `SOFT` from 50 to 30 on dark backgrounds to reduce the optical "heaviness" of warm-cream serifs against bistre paper.

### Body copy rules (non-negotiable)

- **Indented paragraphs.** First line indent `1.2em`. No blank line between paragraphs.
- Measure: **66–72ch** per column.
- Hyphenation on (`hyphens: auto`).
- Widows/orphans: `orphans: 3; widows: 3;` where supported.
- Line-height `1.62` for articles, `1.45` for sidebar blurbs.
- Italics are italic (not oblique-faked). Small caps are true small caps (`font-feature-settings: "smcp"` or true SC file).

### Display sizes (fluid, but centered around)

| Role | Size | Tracking |
|---|---|---|
| Masthead wordmark | 92px | `letter-spacing: 0.02em` |
| Article title | 48–56px | `letter-spacing: -0.005em` |
| Section headline | 32px | tight |
| Deck / standfirst | 20–22px italic | normal |
| Body | 19–20px | normal |
| Small caps kicker / marginalia | 11px, letterspaced `0.12em` | uppercase |

## Layout

### Home page = newspaper front page

Literal broadsheet, 6-column grid, visible gutters.

```
┌─── A PRIVATE READER ────────────────────────────────────┐
│                   W I L L I P E D I A                   │
│─────────────────────────────────────────────────────────│
│  VOL. MMXXVI · NO. 111 │ TUE · APR 21 · 2026 │ PRIVATE  │
│═════════════════════════════════════════════════════════│ (oxblood double rule)
│                                                          │
│  CONTINUE READING ── LOGIC       │  RECENTLY UPDATED    │
│  Gödel's Incompleteness Theorem  │  ─────────────────   │
│  A foundational limit on...      │  LOGIC / TOPOS-THY   │
│  ┌───┐ In the autumn of 1931...  │  A Generalized Space │
│  │ I │ ...[indented body, 2 col] │  — 2 DAYS AGO        │
│  └───┘ ...wikilink GÖDEL...      │                      │
│                      —also cited │  PHILOSOPHY / ...    │
│                       VIENNA C.  │  The Socratic Method │
│                                  │  — 4 DAYS AGO        │
│                                  │                      │
│                                  │  FROM THE MORGUE     │
│                                  │  HAVEN'T VISITED...  │
│─────────────────────────────────────────────────────────│
│  FROM THE MORGUE ── HAVEN'T VISITED IN A WHILE          │
│  Shannon's Inf... │ The Y Comb. │ Cantor's Diag... │ ...│
│  LAST READ FEB 14 │ LAST READ DEC 9 │ ...                │
│─────────────────────────────────────────────────────────│
│         INDEX · RANDOM · RECENT · SEARCH · A–Z          │
└─────────────────────────────────────────────────────────┘
```

**Sections (all driven by PR#2 Postgres telemetry once it ships):**

1. **CONTINUE READING** — lead story, 4 cols. Pulled from the most recent active session's last-read page. Drop cap, indented 2-col body, marginalia in right gutter.
2. **RECENTLY UPDATED** — right 2-col sidebar. Filesystem mtime scan, cached 60s. Three stacked items.
3. **FROM THE MORGUE — HAVEN'T VISITED IN A WHILE** — bottom strip spanning full width. Oldest `MAX(ts) GROUP BY slug`. Four article cards.

Each section has per-section failure isolation: one broken query does not kill the home.

**Masthead**: `VOL. MMXXVI` (year in Roman), `NO. {day-of-year}`, full date centered, `PRIVATE CIRCULATION` right. Updates daily. The issue number is load-bearing: it makes every visit feel like a *new edition*.

### Article page

- Single column, **680px measure** (roughly 68–72ch at 20px body).
- Content well starts at **38% from left** on desktop (not centered). The left negative space is silence; the right margin is working space.
- **Right marginalia gutter: 240px.** Backlinks render here, anchored to the paragraph where the concept is mentioned.
- Mobile: marginalia collapses inline below the paragraph, muted and italic.
- Drop cap on the first paragraph: **5 lines tall**, oxblood, Fraunces variable (`opsz 144, wght 200, SOFT 50`).
- Heading hierarchy: `h2` = 32px EB Garamond 500, `h3` = 24px EB Garamond italic 500, `h4` = 19px EB Garamond SC.

### Search / index / other pages

Same masthead. Same typographic rules. Same oxblood rule strategy. Don't invent new structures per page — every page is "a page of the weekly."

## Wikilinks & external links

### Wikilinks (internal)

**Never blue. Never underlined in the conventional sense.**

- Proper-noun targets (capitalized slug): render as **small caps** in body color.
  - `[[Gödel]]` → `G͟Ö͟D͟E͟L͟` — small caps with a `1px dotted oxblood` underline, offset `0.18em`.
- Common-noun targets: render as body color with the same dotted oxblood hairline; case preserved.
- Hover: underline color deepens to full oxblood, no layout shift.
- Broken wikilink (target `.md` absent): render as small caps with a dotted **muted** underline and log to `broken_links` table. Do not show a question mark or bracket glyph.

### External links

- Render with a trailing `⁋` (pilcrow) or superscript `§` in oxblood, inline. No arrow icons.
- `target="_blank" rel="noopener noreferrer"`.

## Ornamentation

Etching-style fine-line illustrations are **part of the system, not decoration**. Reserve them for:

- Section dividers on the About/Colophon page.
- Chapter-opening ornaments at the top of long articles (optional, per-page flag).
- The 404 / empty-search page (a small etched "out of stock" ornament).
- Seasonal: occasional masthead flourish on the home page (a small engraved mark left or right of the wordmark).

**Style:** black on cream, fine-line with cross-hatching. Objects should feel Renaissance-or-Industrial: chisel on marble, a robot arm, a sculpted bust in profile, a Doric column, a book-arch, a pair of calipers. Not icons from an icon library — illustrations that look etched onto copper.

**Hard rule:** no illustration is ever required on a content page. The typography carries the page; ornaments garnish it. If the illustration is doing the heavy lifting, the typography is wrong.

## Things that are banned

If any of these ship, something is off:

- Pure black (`#000`, `#111`, etc.) anywhere.
- Blue anywhere except as a deliberate, single-page accident we discussed.
- Purple, teal, lime, gradient anything.
- Rounded corners over `4px` on anything larger than a form field.
- Drop shadows. `box-shadow`. `backdrop-filter`.
- `font-family: system-ui, -apple-system, Inter, ...` in body copy.
- Tailwind's default `prose` applied unchanged.
- Emoji in product chrome.
- Icon fonts (Font Awesome, Material Icons).
- Hero photographs. Stock imagery of any kind.
- Cards with `border-radius` larger than a postage stamp would tolerate.
- Tech-stack badges, "Built with Astro" ribbons, gradient CTAs.
- A dark-mode toggle button (OS-level `prefers-color-scheme` is sufficient per v0 TODO).

## Dark mode

- Driven by `prefers-color-scheme: dark` only (no toggle in v0).
- Preserves the broadsheet aesthetic — same grid, same masthead, same body rules.
- Oxblood → terracotta. Cream paper → `#14110D`. Bistre ink → warm cream.
- Drop cap in terracotta. Marginalia in muted cream.

## Accessibility (without compromising the aesthetic)

- Contrast targets: body text on paper is **9.8:1** (ink `#1A1510` on paper `#F4EDE0`) — well above WCAG AAA. Meta text (muted on paper) must hit 4.5:1.
- Focus rings: `2px oxblood dotted outline` offset `2px`. Never removed.
- Wikilink dotted underline is the affordance — do not rely on color alone.
- `prefers-reduced-motion`: honored for any future hover-preview animation.
- Headings in proper order (`h1 → h2 → h3`, no skips). Masthead wordmark is **not** an `h1` — the article title is.

## Print stylesheet (deferred, see `TODOS.md`)

When we pick up the print stylesheet, the broadsheet aesthetic already translates. Hide nav/TOC, 1in margins, 11–12pt serif body, proper page breaks at headings, slug + date footer. The design system is already print-friendly; the print CSS is mostly "remove the screen furniture."

## Open questions for implementation

- **Berkeley Mono license.** Body + display are now SIL OFL (EB Garamond + Fraunces), so the only commercial font in the stack is Berkeley Mono at $75 personal-use. Purchase from berkeleygraphics.com before shipping real markup. Until purchased, the `font-family` stack falls back to IBM Plex Mono (also free, already loaded in the specimen). Personal-use license covers Willipedia (single-user, Tailscale-only); if scope ever expands to public hosting, upgrade to the commercial web-font license.
- **Issue number source of truth.** `NO. {day-of-year}` is cute, but on 2026-12-31 it reads `NO. 365`. Fine. First issue of 2027 resets to `NO. 1`. Confirm behavior is desired (it is — a new year is a new volume).
- **Marginalia on mobile.** Inline-below-paragraph vs. footnote-drawer is a real choice. Inline-below is simpler; drawer is nicer. Decide during implementation.

## Reference

- Approved mockup: `~/.gstack/projects/willtraweek-Willipedia/designs/design-system-20260421-005800/mockups/round2/variant-A-broadsheet.png`
- Comparison board (round 2): `design-board-r2.html` in the same dir
- Voice docs (Codex, subagent): `voices/` in the same dir
- Research screenshots (NYT, New Yorker, Guardian, Harper's, Nautilus, Wikipedia, Stripe Press, Monumental Labs): `research/` + `/tmp/wilipedia-research/`
