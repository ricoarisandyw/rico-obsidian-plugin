# Smart Connections — Feature Catalog

Source: `obsidian-smart-connections` v4.7.2 (`../obsidian-smart-connections`).

Every feature below is derived from the actual source (`smart_env.config.js`, `src/`, `migrations/`), not just the README. Tick the boxes for what you want in `rico-obsidian-plugin`.

**Legend**
- 🔑 = core / hard to drop (other features depend on it)
- 💰 = gated as "Pro" upstream (`scope_class: 'pro-setting'`) — free for you to build
- 🌐 = requires network or an external Smart* plugin

---

## A. Engine — retrieval & scoring

The heart of the plugin: given a note, rank every other note by semantic similarity.

- [ ] **A1. Embedding-based similarity search** 🔑 — cosine similarity over note vectors. `src/items/connections_list.js:filter_and_score`
- [ ] **A2. Adaptive top-k widening** — starts at `max(limit*4, limit+25, 50)` candidates and doubles `k` until enough survive filtering. Prevents short result lists on heavily-filtered vaults.
- [ ] **A3. Sources vs. Blocks results** 🔑 — return whole notes (`smart_sources`) or individual blocks/headings (`smart_blocks`). Setting: `results_collection_key`
- [ ] **A4. Results limit** 🔑 — default 20. Setting: `results_limit`
- [ ] **A5. Pluggable scoring algorithms** 💰 — `score_algo_key` swaps the ranking function; default is plain `similarity`. Upstream reserves alternates for Pro.
- [ ] **A6. Post-processing hook** 💰 — `connections_post_process` action reorders/filters the ranked window (e.g. a rerank stage). Cannot widen eligibility, only reorder.
- [ ] **A7. Request coalescing** — concurrent `get_results()` calls share one in-flight promise. Cheap, avoids duplicate compute on rapid note switching.
- [ ] **A8. Score normalization** — doubles scores until at least one exceeds 0.5, so custom algos render sane bars. (Upstream marks this for removal.)
- [ ] **A9. Retrieval timing events** — emits `connections:get_results` with `elapsed_ms` for perf profiling.

## B. Filtering

Applied *after* indexing — these hide results, they don't stop embedding.

- [ ] **B1. Include path filter** 💰 — comma-separated, case-sensitive substring match on note path. Setting: `include_filter`
- [ ] **B2. Exclude path filter** 💰 — same, but removes. **Exclude always beats include.** Setting: `exclude_filter`
- [ ] **B3. Frontmatter include filter** 💰 — newline-delimited `key` or `key:value` matchers, case-insensitive. Setting: `frontmatter_filter_include`
- [ ] **B4. Frontmatter exclude filter** 💰 — same, takes precedence over include. Setting: `frontmatter_filter_exclude`
- [ ] **B5. Exclude inlinks (backlinks)** 💰 — drop notes that already link *to* the current note. Setting: `exclude_inlinks`
- [ ] **B6. Exclude outlinks** 💰 — drop notes already linked *from* the current note. Rationale: you already know about them. Setting: `exclude_outlinks`
- [ ] **B7. Hide frontmatter blocks** 💰 — when in Blocks mode, suppress YAML-frontmatter blocks. Setting: `exclude_frontmatter_blocks` (default on)
- [ ] **B8. Self/dimension guards** 🔑 — never return the target itself; skip vectors of mismatched dimension (i.e. notes embedded under a different model).

## C. Connections view (sidebar)

The main UI surface.

- [ ] **C1. Connections sidebar view** 🔑 — ranked list for the active note. `src/views/connections_item_view.js`
- [ ] **C2. Sidebar location** — open in left or right sidebar; live-relocates the leaf when changed. Setting: `connections_view_location`
- [ ] **C3. Open view** — command + ribbon icon. `actions/connections-list/open_view.js`
- [ ] **C4. Auto-follow active note** 🔑 — results refresh as you navigate.
- [ ] **C5. Pause / freeze results** ⭐ — pin the view to one note and keep browsing elsewhere. A v4 headline feature. `actions/connections-list/toggle_paused.js`
- [ ] **C6. Manual refresh** — re-run retrieval on demand.
- [ ] **C7. Select target** — crosshair action: point the view at an arbitrary note instead of the active one. `actions/connections-list/select_target.js`
- [ ] **C8. Target history** — navigate back through previously-targeted notes. `actions/connections-target/history.js`
- [ ] **C9. Drill into blocks** — switch the target to a specific block within a note. `actions/connections-target/blocks.js`
- [ ] **C10. Drag-and-drop target** — drop a note onto the view to target it. `utils/resolve_dropped_connections_targets.js`
- [ ] **C11. Open settings from view** — shortcut into the settings tab.
- [ ] **C12. Open help / getting-started** 🌐 — opens a hosted walkthrough.

## D. Result item presentation

- [ ] **D1. Score display** 🔑 — similarity shown per result.
- [ ] **D2. Expand / collapse result** — inline preview of note content. `actions/connections-list/toggle_expanded.js`
- [ ] **D3. Rendered markdown in previews** — show links/headings/bold formatted vs. plain text. Setting: `components.connections_list_item_v3.render_markdown` (default on)
- [ ] **D4. Show full path** — include folder path in each result label. Setting: `components.connections_list_item_v3.show_full_path` (default off)
- [ ] **D5. Hover preview popover** — native Obsidian page preview on hover.
- [ ] **D6. Drag result into editor** — drag a result out to create a link.
- [ ] **D7. Pluggable item renderer** — components named `connections_list_item_*` are auto-discovered and offered as a dropdown. Lets you ship multiple result styles.

## E. Feedback — pin & hide

Per-target user attribution stored on the source note (`data.connections`).

- [ ] **E1. Hide a connection** — remove a specific result for this note. `actions/connections-list-item/hide.js`
- [ ] **E2. Pin a connection** — always show it, regardless of score. `actions/connections-list-item/toggle_pinned.js`
- [ ] **E3. Unhide all / Unpin all** — bulk reset.
- [ ] **E4. Feedback as a ranking signal** 💰 — upstream feeds pin/hide into Pro scoring algorithms. The data model supports it; wiring it to scoring is yours to build.
- [ ] **E5. Eligibility-checked feedback** — pinned/hidden items still pass the hard filters before being surfaced, so a pin can't resurrect an excluded note.

## F. Graph visualization

- [ ] **F1. 2D similarity map** ⭐🌐 — D3 force layout placing results around the center note by semantic similarity. Lazy-loads D3 v7 from CDN. `src/components/connections-graph/v1.js`
- [ ] **F2. k-means clustering** — cosine k-means groups results into quadrants. `v1.util.js:kmeans_cosine_unit`
- [ ] **F3. Score-driven radius** — stronger matches sit nearer the center; node size scales with score.
- [ ] **F4. Pin/hide state on nodes** — visual classes for pinned/hidden/center nodes.
- [ ] **F5. Node interactions** — click to open, hover preview, drag out to link, right-click menu.
- [ ] **F6. Graph style selector** — components named `connections_graph_*` auto-populate a dropdown, plus "None" to hide. Setting: `connections_graph_component_key`
- [ ] **F7. Truncated labels** — middle-ellipsis labels with anchor offsets to reduce overlap.

> Note: this overlaps your existing `docs/todo-canvas-network-graph.md` work.

## G. Inline & footer connections

- [ ] **G1. Footer connections** 💰 — persistent connections panel at the bottom of each note, updating as you type. Setting: `footer_connections` + toggle command/ribbon. `src/views/connections_footer_view.js`
- [ ] **G2. Footer graph style** 💰 — independent graph style selection for the footer (defaults to none). Setting: `footer_connections_graph_component_key`
- [ ] **G3. Inline connections** 💰 — CodeMirror decorations: a per-block badge showing match count, with a hover popover listing related blocks. Setting: `inline_connections`. `src/views/connections_footer_deco.js`

## H. Embedded codeblocks

- [ ] **H1. `smart-connections` codeblock** ⭐ — embed a live connections list inside any note. Body is JSON config. `src/views/connections_codeblock.js`
- [ ] **H2. Per-codeblock setting overrides** — any retrieval setting (limit, filters, results type, scoring) can be overridden in the block's JSON. `utils/build_connections_query_params.js`
- [ ] **H3. Insert-codeblock command** — builds and inserts the block at the cursor. `actions/env/insert_connections_codeblock.js`
- [ ] **H4. Isolated retrieval per block** — each block gets its own unregistered list so it never shares in-flight state with the sidebar.
- [ ] **H5. Live re-render on settings change** + retry button when the environment isn't ready yet.

## I. Export & AI context

- [ ] **I1. Copy all as links** ⭐ — copy the whole result set as markdown links. `actions/connections-list/copy_as_links.js`
- [ ] **I2. Send to Smart Context** 🌐 — ship full content of all results to the Smart Context plugin for AI prompting.
- [ ] **I3. Send to Smart Graph** 🌐 — hand results to the Smart Graph plugin.
- [ ] **I4. AI tool / function-calling schema** ⭐ — `connections_list_get_results` is exposed as a tool with JSON input/output schemas, so an LLM agent can query connections itself. `utils/connections_tool_schemas.js`

## J. Discovery & serendipity

- [ ] **J1. Open random connection** ⭐ — jump to a random note from the current results. Command + dice ribbon icon + menu. `actions/connections-list/open_random_connection.js`

## K. Settings & plumbing

- [ ] **K1. Grouped settings tab** 🔑 — groups: Display, Inline, Footer, Connections filters.
- [ ] **K2. Dynamic settings injection** — component-provided `settings_config` is spliced in after its parent control. `utils/insert_settings_after.js`
- [ ] **K3. Debounced text settings** — 500ms debounce on filter text inputs.
- [ ] **K4. Conditional settings** — e.g. the Sources/Blocks dropdown is replaced with a hint when block embedding is off.
- [ ] **K5. Settings-change event bus** — `settings:changed` events drive live re-render and leaf relocation.
- [ ] **K6. Settings migrations** — versioned migration scripts for renamed/moved settings. `migrations/`

## L. Lifecycle & housekeeping

- [ ] **L1. Custom icons** — registers `smart-dice` etc. `utils/add_icons.js`
- [ ] **L2. Release-notes modal** 🌐 — shown on version bump.
- [ ] **L3. Update checker** 🌐 — polls the GitHub releases API. *(Your CLAUDE.md forbids URL calls — skip or make opt-in.)*
- [ ] **L4. New-user onboarding modal** 🌐 — auto-opens the view and a getting-started story on first run.
- [ ] **L5. Auto-add `.smart-env` to .gitignore**
- [ ] **L6. Events / notifications modal** — surfaces indexing-complete, re-import, and exclusion warnings in one place instead of spamming Obsidian notices.

---

## Suggested starter sets

| Set | Features | Why |
| --- | --- | --- |
| **Minimum viable** | A1, A3, A4, B8, C1, C3, C4, D1, D2, K1 | A working connections sidebar, nothing more. |
| **Daily driver** | + C5, C6, E1, E2, E3, D3, D4, I1, J1 | Adds the controls you'll actually reach for. |
| **Power user** | + B1–B7, A5, A6, H1–H3, C7–C10 | Full filtering and embeddable blocks. |
| **Visual** | + F1–F6 | Overlaps your canvas network-graph TODO. |
| **Agent-ready** | + I4 | Lets an LLM query your connections as a tool. |

## Things worth doing differently

Your stated goal is *configurability*, which is where upstream v4 deliberately pulled back — it moved filters, scoring, inline, and footer behind Pro. Concretely:

1. **Un-gate the 💰 items.** They're the bulk of the configurability and none are technically hard; they're a business decision upstream.
2. **Settings presets/profiles.** Upstream has one global config. Named profiles ("research mode" = blocks + tight filters; "writing mode" = sources + footer) would be a genuine improvement, and the codeblock override mechanism (H2) already proves per-context config works.
3. **Per-folder or per-note config.** Frontmatter-driven overrides, reusing the same param-building path as H2.
4. **Skip the network features** (L2, L3, L4, I2, I3) given your no-URL-calls rule.
