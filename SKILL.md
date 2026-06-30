---
name: atomic-website-clone
description: High-fidelity local-only visual website cloning workflow. Use when the user asks to 1:1 clone, pixel-perfect clone, atomically replicate, visually recreate, or locally mirror a public/authorized website page including unknown interaction discovery, CDP/browser state capture, live DOM/CSS/network extraction, assets, responsive states, trigger-gated/process-sensitive UI states, carousels, hover/menu interactions, animations, screenshots, visual diff, multi-agent review, and cleanup.
---

# Atomic Website Clone

## Purpose

Replicate an authorized website page as a local-only visual clone. Optimize for visual fidelity, responsive behavior, visible state transitions, key interactions, motion, and evidence-based verification.

Treat the clone target as a set of observable user states, not as a single HTML file or screenshot.

## Completion Standard

Define these criteria before fetching, editing, or generating anything:

- The requested page opens on a local server only.
- Deployment is forbidden unless the user explicitly asks for it.
- Desktop, mobile, and user-requested breakpoints visually match the source.
- Every user-provided screenshot has a matching local state at the same viewport, scroll position, selected item, carousel position, and visible crop.
- Key visible interactions match the source when present: menus, hover/active/focus states, tabs, carousels, sliders, sticky headers, modals, reveals, drawers, chat flows, product demos, preview panes, thumbnail strips, and transitions.
- Dynamic areas are implemented as local interactive states unless the user explicitly accepts a static image. A single screenshot must not replace a carousel, product demo, chat flow, preview pane, slide viewer, or other interactive surface.
- If the user explicitly accepts static replacement for a dynamic area, label it as a degraded exception in the final verification summary; do not call it 1:1 interaction fidelity.
- For each dynamic component, source state count equals local state count unless the user explicitly approves an exclusion.
- A discovery pass classifies high-confidence interactive, animated, media, and scrollable candidates before implementation. Unclassified candidates are blockers until inspected, excluded with evidence, or added to the state inventory.
- Every required dynamic state has a desktop result and a mobile/tablet result: reproduced, intentionally adapted, or user-approved out of scope.
- Required interactions have operation traces: action, selector or coordinates, source before/after evidence, local before/after evidence, and state values such as scrollLeft, transform, active index, selected tab, or slide number.
- Capture frame names must be unique per state. Do not overwrite tool-generated `before` frames or earlier `after` frames; use distinct names such as `start`, `mid`, `end`, `open`, `selected-2`, or mark an intentional overwrite explicitly.
- Source and local captures must record document mode evidence: doctype, `document.compatMode`, viewport, visual viewport, scrollHeight, and clientHeight. Standards/quirks mode mismatches are blockers when layout or scroll geometry differs.
- Process order is part of fidelity. Any trigger-gated surface must preserve its source lifecycle: initial state, trigger, intermediate/loading state, revealed state, selected/active state, and close/reset state when present. Examples include lazy panels, generated outputs, drawers, dialogs, slide previews, comparison sliders, media overlays, multi-step forms, checkout steps, map/list result panes, and app mockups.
- Scrollable internal panes must be verified by an actual wheel, drag, key, or programmatic scroll action that changes the pane's own scrollTop/scrollLeft, not by height checks alone.
- Video or animated media must be verified by playback progress, frame sampling, or start/mid/end screenshots. A loaded poster frame is not motion fidelity.
- When both source and local video/recorded motion files are available, compare them with SSIM/PSNR/VMAF or document why metric comparison is impossible.
- Required visual assets are local unless there is an explicit reason to link out.
- Out-of-scope links go to the original site or are intentionally disabled; they must not create local 404 traps.
- Browser checks show no console errors, page errors, failed requests, or HTTP 4xx/5xx for the local page.
- Verification covers the state inventory, not just default text visibility.
- Text-visible checks are smoke tests only; they cannot pass a carousel, preview pane, product demo, slide deck, thumbnail strip, or any other dynamic component.
- At least two independent reviewers PASS for atomic or 1:1 requests unless the user explicitly skips review.
- Temporary capture files, one-off scripts, downloaded experiments, discarded tools, and raw reference dumps are removed. Keep only the final runnable product, minimal start command, and compact final verification summary.

## Red Lines

Mark the task as not complete when any of these are true:

- A visible interactive source area is replaced by one static screenshot.
- A page with unknown behavior is implemented without an interaction discovery pass or without classifying high-confidence candidates.
- A site-specific failure is patched as a content-specific rule instead of a behavior class that applies only when a source region actually matches that behavior.
- A carousel or slider is shown but cannot move or does not update its active indicator.
- A product demo, app mockup, chat flow, slide deck, video preview, or generated artifact cannot switch between the visible source states.
- A trigger-gated surface is visible, active, loaded, selected, or advanced before the source reaches that same state.
- A scrollable pane is counted as verified without proving that the pane itself scrolls.
- Video or motion is represented only by a still image, poster, or animation-disabled screenshot.
- The source has more dynamic states, slides, cards, thumbnails, tabs, or task items than the local clone and the difference is not user-approved.
- User-provided reference screenshots cannot be reproduced locally one by one.
- Verification only checks that text exists or that the page has no errors.
- Reviewers are not given the source references, local references, and state inventory.
- Reviewers PASS without inspecting state counts, operation traces, and dynamic before/after evidence.
- Verification summaries or reviewer PASS results are written before the checks and reviewer reports actually exist.
- A looser visual threshold is used to hide state or layout mismatches. Strict comparison must run first; elastic thresholds are only acceptable for documented text rasterization, antialiasing, compression, or source volatility after the state inventory, local error checks, and reviewer inspection pass.

## Workflow

### 1. Establish Scope

Confirm the source URL, final local path, whether deployment is forbidden, and which states matter. If the user says "1:1", include at least:

- desktop viewport
- mobile viewport
- opened navigation/menu state
- above-the-fold and major sections
- obvious hover or motion behavior
- every carousel/slider state that is visible or user-mentioned
- every process-sensitive component that is visible, user-mentioned, or likely to affect perception: carousels, generated outputs, demos, media overlays, before/after sliders, multi-step flows, expandable panels, comparison controls, maps, calculators, carts, slide decks, chat-like flows, preview panes, or artifact viewers

State the acceptance criteria before implementation.

### 2. Build A State Inventory

Before implementing, create a state inventory. Use it as the verification checklist.

Start with an interaction discovery pass. Do not rely only on screenshots or memory of what the page "probably" does.

For each required viewport and major scroll position, enumerate and classify:

- visible controls: links, buttons, inputs, selects, summaries, role-based widgets, focusable elements, aria-expanded/controls/selected elements, and pointer-cursor elements
- motion surfaces: CSS animations, transitions, transforms, sticky/parallax layers, canvas, WebGL, SVG animation, video, and animated images
- scroll surfaces: horizontal strips, scroll-snap regions, overflow panes, draggable sliders, tables, code/document panes, maps, timelines, and thumbnail rails
- late surfaces: regions that are hidden, empty, disabled, loading, off-canvas, or visually secondary until a trigger changes them

Probe candidates non-destructively first: hover, focus, wait, wheel, drag, and controlled click where it will not submit destructive forms or leave the target page. Record whether the probe changed DOM text, visibility, URL, aria state, selected index, scrollTop/scrollLeft, transform, animation time, video time, or screenshot pixels.

Classify every candidate by behavior, then add the relevant states to the inventory. If a candidate is a plain outbound link, decorative animation, duplicate control, or intentionally out of scope, record that evidence. Repeat the discovery pass after scroll reveals, menu opens, tab switches, and process triggers because new candidates often appear late.

Use `scripts/discover-interactions.cjs` when the page is dynamic, unfamiliar, user-critical, or previously failed because an interaction was missed. For atomic work, run it with `--probe --deep-probe --motion-samples` across desktop and mobile. The script must produce probe before/after screenshots, trigger rescans, scroll probes, motion samples, and `inventory-seed.json`.

For each page region, record:

- source viewport size and scroll position
- local target route or anchor
- visible text and primary assets
- interactive controls
- selected item or active tab
- carousel/slider position
- source state count: cards, slides, thumbnails, tabs, task items, messages, generated artifacts, or pages
- local state count for the same component
- desktop, tablet, and mobile coverage status
- scroll container positions
- trigger conditions and state lifecycle for process-sensitive surfaces
- expected animation or transition
- operation trace path for clicks, hovers, drags, scrolls, waits, and keyboard interactions
- source screenshot path
- required local screenshot path

At minimum, inventory these surfaces when present:

- header and sticky state
- desktop navigation
- mobile navigation/drawer
- modals and overlays
- hover/focus states for prominent buttons/cards
- carousels, sliders, pagination dots, and scroll snap regions
- tab/segmented controls
- accordions/dropdowns
- chat/message flows
- product demo panels
- generated artifact previews
- document/image/video viewers
- thumbnail strips and horizontal scroll areas
- footer and language/menu controls

Do not hard-code one site's special pattern into the checklist. First classify each source region by behavior, then apply only the relevant checks. If a site has no generated preview, do not invent one; if it has a different trigger-gated surface, capture that lifecycle instead.

Use this behavior taxonomy:

- Static content: visible without interaction; verify layout, assets, typography, responsive behavior, and links.
- Toggle/open content: menu, drawer, modal, accordion, dropdown, tooltip, popover; verify closed, opening trigger, open, focus/hover, and close states.
- Selection content: tabs, segmented controls, filters, pricing toggles, galleries, map/list switches; verify every selected state or a justified representative set plus count.
- Scroll/drag content: carousel, horizontal strip, timeline, slider, before/after control, pan/zoom area; verify initial, middle when available, end, indicator, and actual scroll/drag values.
- Process content: onboarding, checkout, calculator, app demo, chat-like flow, AI generation, upload, search, form wizard; verify initial, trigger, loading/progress, result, selection, error/empty state if visible or reachable.
- Media/motion content: video, canvas, WebGL, animation, parallax, scroll reveal; verify playback/progress, sampled frames, or CDP animation seek.
- Responsive-only content: hamburger nav, mobile drawer, collapsed cards, stacked tables; verify the state appears only at the same breakpoint behavior as the source.

For any region that appears, changes, loads, selects, scrolls, or advances only after a trigger, preserve the source lifecycle generically: initial visibility/state, trigger, transition/loading/progress, revealed or selected state, advanced states, and reset/close state when present. This rule applies whether the surface is a product demo, menu, map, calculator, preview pane, media overlay, code viewer, slide deck, gallery, or any other late-changing region.

Do not start detailed implementation until the inventory lists all dynamic surfaces visible in the source or supplied references.

### 3. Capture The Source With Browser And CDP

Use browser tooling first. For each inventory item:

- Load the live page and save reference screenshots at required breakpoints.
- Capture before/after screenshots for each required click, hover, drag, scroll, and wait state.
- For trigger-gated surfaces, capture at least: default state, trigger action, intermediate/loading state when present, revealed/active state, selected-item changes after reveal when present, and close/reset state when present.
- Use CDP or browser evaluation to collect DOM snapshots, computed styles, bounding boxes, scroll positions, active elements, transform values, and animation-related CSS.
- Use CDP `DOMSnapshot.captureSnapshot` or browser-side evaluation when useful to record computed styles, layout bounds, text boxes, and transform-related state.
- Use CDP sessions for browser-only domains such as Animation when motion timing, playback rate, keyframes, or in-flight transitions matter. Pause and seek animation timelines when needed to capture deterministic start/mid/end frames.
- Record document mode and geometry in every capture: doctype, `document.compatMode`, viewport, visual viewport, scrollHeight, clientHeight, and terminal scroll position. A "bottom" or "final" state is valid only when the numbers prove the target scroll container reached its end.
- Use Network logs to classify required fonts, images, videos, JSON, Next/RSC data, and dynamic media. If service workers hide requests, block service workers during capture and note the setting.
- Save an operation trace for each required interaction with: action, selector or coordinates, before/after source screenshots, before/after local screenshots, before/after scroll positions, active index, selected tab, transform, URL, and timestamp.
- Capture source failures separately; do not reproduce broken source behavior unless it is visually intentional.
- Compare the discovery report against the state inventory. Every high-confidence candidate must be represented in the inventory or documented as excluded with evidence. Use `check-state-inventory.cjs --discovery ... --require-discovery` so missed candidates become failures.
- Exclusions must include a reason and evidence such as a real screenshot/proof file path, URL, or explicit approval artifact. Bare candidate ids, selectors, or "decorative" notes are not enough for atomic work.

For carousels and sliders, capture:

- total source item count
- initial position
- at least one middle position when available
- last/rightmost position
- active indicator state
- card crop and side peeking
- drag/click/scroll behavior

For process-sensitive components such as product demos, app previews, generated outputs, multi-step flows, slide decks, chat-like flows, maps, calculators, carts, before/after sliders, or artifact viewers, capture:

- total source task, tab, message, artifact, slide, thumbnail, or page counts
- each selected task/tab/item
- visible conversation, form, selection, or step state when applicable
- generated output, preview, result, media, or artifact state when applicable
- whether each process surface is initially hidden, visible, disabled, selected, empty, loading, or lazy-loaded
- the exact trigger that changes each process surface
- selected slide/page index
- thumbnail strip position
- internal scroll positions before and after actual scroll actions
- completion/loading states
- all visible buttons and disabled/active states

These are examples, not requirements for every site. Do not invent generated outputs, document viewers, slide decks, maps, calculators, or artifact panes when the source does not have them.

Use network fetchers, CDP dumps, SingleFile-style capture, Firecrawl-style crawlers, or direct asset downloads only when they reduce uncertainty or recover assets. Avoid broad crawling that downloads unrelated app state, videos, PWA screenshots, feeds, or historical pages.

Use `scripts/capture-motion.cjs` when a page has process-sensitive interactions, motion, carousels, internal scroll panes, videos, generated outputs, or reviewer-visible uncertainty. Capture the source and local page with the same state ids and actions so they can be compared.

### 4. Prefer Shortcuts That Preserve Fidelity

Do not rebuild by imagination when the source already exposes usable SSR HTML, CSS, fonts, data, or images.

Recommended order:

1. Reuse source HTML/CSS/assets when available and allowed.
2. Preserve source runtime scripts only when they can safely run locally and materially preserve behavior.
3. Staticize only the runtime parts that are not needed for visible fidelity.
4. Download and relink required fonts, images, icons, CSS, JSON, and media thumbnails.
5. Rebuild dynamic surfaces with small local state machines when the original runtime cannot run locally.
6. Hand-code only the pieces that cannot be captured cleanly.

When a source chunk or data blob contains the exact state data, extract that state and rebuild from it. Do not approximate from memory.

### 5. Asset Discipline

Treat resource cleanup as part of the clone, not an afterthought:

- Keep assets that are referenced by the final HTML/CSS/JS.
- Delete RSS feeds, app manifests, PWA screenshots, source maps, analytics, service workers, unused videos, and unrelated crawl output unless needed for visible fidelity.
- Rewrite internal links that are outside the cloned page to the original site, or disable them deliberately.
- Preserve exact font files where possible.
- Verify local paths with a static scanner after every large rewrite.
- Keep captured source references only until final review is complete, then remove them unless the user asks to keep evidence.

### 6. Recreate Responsive Behavior

Check at least the user-requested breakpoints. If none are specified, use:

- 390 or 430 mobile
- 768 tablet
- 1024 small desktop
- 1440 desktop

For each breakpoint, check:

- page width and container rails
- section spacing
- typography scale
- image crop and aspect ratio
- navigation behavior
- horizontal overflow
- scroll containers
- dynamic surface usability
- whether the same source states still exist or adapt on mobile

### 7. Recreate Motion And Interaction

For visible motion, implement the smallest local equivalent that matches the perception:

- menu open/close state
- arrow/icon rotation
- opacity fade
- scroll snap
- hover zoom
- sticky header changes
- modal or drawer enter/exit
- background grid or canvas updates
- carousel glide and active indicator update
- chat/task state transitions
- preview pane item switching
- thumbnail strip scrolling and selection
- loading/completion state changes
- trigger-gated lifecycle for generated outputs, previews, artifacts, overlays, wizards, comparison controls, and other process surfaces
- video playback progress or sampled frame change

If the original motion depends on a large framework runtime, prefer a small local script that recreates the observable behavior from captured source states.

### 8. Verify With Browser Evidence

Run both static and browser checks.

Static checks should include:

- all local references exist and are non-empty
- no unexpected remote app/static media references remain
- no local anchor links point to unimplemented pages
- no RSS/feed/PWA leftovers unless intentionally kept
- every high-confidence candidate in the interaction discovery report is classified, implemented, or explicitly excluded with evidence
- every source/local frame in the state check has a real non-empty screenshot file, and triggered inventory states have corresponding source/local action traces
- every discovered scroll candidate has actual source/local scrollTop or scrollLeft change unless excluded with evidence
- every discovered motion/media candidate has action traces, changed frame samples, video/animation assertions, or an evidenced exclusion
- the final state inventory is checked against the discovery report; a source/local capture pair that omits the same discovered candidate on both sides must fail
- every state inventory item has either a local implementation or an explicit out-of-scope note approved by the user
- source and local dynamic state counts match for every non-excluded component
- required operation traces exist and reference real source/local screenshots

Use `scripts/scan-local-assets.cjs` for generic local reference checks when the project does not already have an equivalent scanner.

Use `scripts/check-state-inventory.cjs` when a source/local capture pair or explicit state inventory exists. It checks that local states, frames, selector counts, required visible states, real screenshot files, action traces, scroll assertions, and discovery coverage match the source inventory, and it fails extra local states/frames unless explicitly allowed. When a discovery report exists, pass `--discovery` and `--require-discovery`; every high-confidence discovered candidate must appear in inventory selectors, `discoveryCandidateIds`, or `excludedDiscoveryCandidates` with reason and evidence.

Browser checks should include:

- local page returns 200
- desktop screenshot renders expected sections
- mobile screenshot renders expected sections
- required interaction screenshots render expected states
- trigger-gated surfaces match the source lifecycle: initial, trigger, intermediate/loading, revealed/active, selected/advanced, and close/reset states when present
- carousels/sliders move and update active indicators
- process-sensitive components switch states and preserve the source order of appearance
- thumbnail strips scroll and update selection
- internal scroll panes change their own scrollTop/scrollLeft after an actual scroll action
- videos or animated media show playback progress or frame change
- hover/focus/modal/menu states work
- console errors are empty
- page errors are empty
- failed requests are empty
- HTTP 4xx/5xx responses are empty

Do not claim pixel-level success from eyesight alone. Use screenshots, overlay/diff, perceptual comparison, SSIM/pixelmatch, or reviewer comparison. When masking volatile source areas, record exactly what was masked and why. Do not disable animations as the only motion check; capture start, mid, and end frames or an operation trace for visible motion.

Run strict visual diff first and keep that report even when the final decision uses an elastic threshold. Elastic acceptance must name the failing states, mismatch ratios, threshold used, and why each failure is not a missing state, premature reveal, wrong scroll position, wrong selected item, wrong asset, or invented motion.

Use `scripts/compare-motion.cjs` after source/local motion capture. It compares same-named PNG frames without external npm dependencies, writes diff images, and reports mismatch ratio, RMS delta, missing frames, assertion failures, and runtime errors.

Use `scripts/check-state-inventory.cjs` before reviewer handoff on complex pages so missing source/local states or selector count mismatches become explicit failures.

Use `scripts/compare-video-quality.cjs` when source/local video files or browser recording files exist. It runs FFmpeg SSIM, PSNR, XPSNR when available, and VMAF when `libvmaf` is available.

### 9. Use Review Loops

For "atomic", "1:1", or high-stakes visual clone requests, use at least two independent reviewers:

- Visual/state reviewer: compare source screenshots, local screenshots, interactions, and state inventory. Require PASS/FAIL per state.
- Integrity reviewer: check local assets, links, server behavior, missing files, remote leftovers, verification coverage, and cleanup boundary.

Give reviewers raw paths, local URL, source screenshots, local screenshots, verification results, discovery report, state inventory, state check report, final verification summary draft, and the precise previous failures. Do not ask for vague feedback. Require PASS or FAIL per state. Fix every blocking FAIL and re-review until both PASS.

Reviewer PASS is invalid when the reviewer did not inspect the state inventory, state counts, operation traces, or required dynamic states.

Reviewer PASS is also invalid when it is prewritten in the verification summary before the reviewer report exists, or when the summary claims cleanup happened before directory checks prove it.

Use `scripts/review-pack.cjs` to assemble source capture, local capture, discovery report, state inventory, state check report, diff report, previous failures, and current verification summary into one reviewer-facing package before asking for PASS/FAIL. Use `--strict` for atomic work so missing discovery, inventory, state-check, visual compare, summary, or screenshot evidence fails the package.

### Motion Tooling

Keep these scripts as reusable helpers, not final product files:

- `scripts/capture-motion.cjs`: open a source or local URL, perform configured clicks, hovers, wheels, drags, waits, and scrolls, then save screenshots, selector metrics, animation data, video element state, optional recorded video paths, network status, trace zip, and assertions.
- `scripts/discover-interactions.cjs`: crawl specified viewports and scroll positions to list visible controls, animated/media surfaces, overflow panes, pointer elements, hover/click probe deltas, trigger-after rescans, scroll probes, motion samples, screenshots, and an inventory seed before building the final state inventory.
- `scripts/compare-motion.cjs`: compare two capture folders with same state/frame names, generate PNG diffs and a JSON/Markdown report.
- `scripts/check-state-inventory.cjs`: compare source/local capture manifests and optional inventory JSON for missing or extra states/frames, selector count mismatches, and visibility mismatches.
- `scripts/compare-video-quality.cjs`: compare source/local motion video files with FFmpeg SSIM, PSNR, XPSNR, and VMAF where available.
- `scripts/scan-local-assets.cjs`: scan final public assets for missing local references, unexpected remote references, and RSS/PWA/service-worker leftovers.
- `scripts/review-pack.cjs`: generate a compact review package that links screenshots, diffs, assertions, previous failures, and the verification summary.

Minimal capture config:

```json
{
  "url": "http://127.0.0.1:4175/",
  "outDir": "/tmp/local-capture",
  "viewport": { "width": 1440, "height": 1200 },
  "selectors": [{ "name": "demo", "selector": ".studio" }],
  "states": [
    {
      "id": "demo-default",
      "waitFor": ".studio",
      "actions": [],
      "frames": [{ "name": "after", "delay": 0, "cdpAnimationSeekMs": 250 }]
    }
  ]
}
```

### 10. Clean Final State

After reviewers pass:

- Delete capture work directories, raw reference screenshots, one-off scripts, discarded downloads, and bulky reports.
- Keep only the final local product, the minimal start command, and a compact final verification summary with state counts, commands, reviewer PASS/FAIL, exclusions, and remaining risk.
- Re-run a final smoke test after cleanup.
- Update the final verification summary only after cleanup and smoke test evidence exists.
- Report final URL, kept files, deleted categories, reviewer PASS status, and verification summary.

## Common Pitfalls

- Rebuilding from scratch too early instead of reusing source structure.
- Treating the clone as one screenshot instead of a set of observable states.
- Letting crawlers download unrelated app data and then treating it as part of the product.
- Keeping RSS feeds, manifests, service workers, or source maps that were only capture residue.
- Forgetting menu/open states and only comparing closed-page screenshots.
- Forgetting doctype/standards mode and then chasing layout differences caused by quirks mode.
- Reusing the same state/frame name in capture configs, which overwrites the real before/after evidence.
- Building from remembered examples instead of first discovering the current page's behavior classes.
- Fixing a missed interaction by hard-coding that one site's content shape instead of adding a generic discovery/classification rule.
- Forgetting carousel middle/end states or active indicators.
- Replacing any process-sensitive component with a static screenshot.
- Passing verification before checking local links, which leaves 404 traps.
- Fading or hiding decorative grid/canvas layers when recreating menu overlays.
- Letting a single self-check stand in for independent review.
- Letting reviewers pass without state-by-state evidence.
- Letting reviewers pass before they inspect earlier failed clone attempts and the exact failure mode that caused the redo.
- Prewriting reviewer PASS or cleanup claims, then asking reviewers to rubber-stamp them.
- Cleaning evidence before reviewers finish, which makes the PASS unverifiable.
- Missing dynamic media because service workers, client routers, or lazy-loaded JSON hid the actual request.
- Relying only on animation-disabled screenshots when the visible mismatch is motion, drag, scroll, or transition behavior.
- Treating screenshot frame diff as enough when source/local videos are available for SSIM/PSNR/VMAF comparison.
- Treating a discovery candidate list as evidence without converting it to inventory states or exclusions.
- Probing only the first scroll position when controls, cards, drawers, galleries, videos, or generated surfaces appear later.
- Asking reviewers to judge screenshots without the discovery report and state-inventory gate that proves no high-confidence candidate was omitted.
- Letting an empty manifest, missing screenshot path, missing action trace, or unevidenced exclusion count as proof.
- Treating internal scroll as verified because content is taller than its viewport, without actually scrolling the pane.
- Showing, selecting, loading, or advancing any trigger-gated surface before the source trigger produces that state.
- Cleaning files before a final post-cleanup smoke test.
- Treating an elastic visual pass as atomic success without preserving the strict failures and reviewer rationale.

## Practical Rule

The browser, CDP, state inventory, and review loop do most of the work. This skill exists to force the order: capture visible states first, shortcut where fidelity is preserved, rebuild missing interactions, verify with source/local state screenshots, get independent PASS, then clean.
