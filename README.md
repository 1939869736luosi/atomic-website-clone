# Atomic Website Clone

Agent workflow for cloning a website page as a local, inspectable, high-fidelity visual copy.

It is built for the hard cases: animated landing pages, menus, carousels, media, scroll effects, responsive states, and pages where a screenshot is not enough.

## Why This Exists

Most website clone attempts fail for the same reason: they copy the first screen and miss the states.

This skill forces a better order:

1. Discover what moves, opens, scrolls, plays, or changes.
2. Capture source states in a real browser.
3. Build the local copy from real assets and observed behavior.
4. Compare source and local states.
5. Get a review package before calling it done.

The result is not just "an HTML file that looks close." The result is a local page with evidence for the important states.

## What You Get

- `SKILL.md` — the agent instruction file
- `scripts/discover-interactions.cjs` — finds controls, motion, media, scroll panes, and likely hidden states
- `scripts/capture-motion.cjs` — captures source/local browser states with screenshots and assertions
- `scripts/compare-motion.cjs` — compares matching PNG frames
- `scripts/check-state-inventory.cjs` — checks that the local clone covers the source state inventory
- `scripts/compare-video-quality.cjs` — compares source/local videos with FFmpeg metrics when available
- `scripts/scan-local-assets.cjs` — checks missing local files and unexpected remote references
- `scripts/review-pack.cjs` — builds a compact package for visual and integrity review

## Use It For

- Local visual clones of pages you own or are authorized to inspect
- UI reference captures
- Design reverse-engineering for internal study
- Regression checks between a live page and a local recreation
- Rebuilding interactive marketing pages without losing menus, tabs, video, or mobile states

## Do Not Use It For

- Publishing someone else's site as your own
- Scraping private or unauthorized pages
- Replacing a dynamic app with a single screenshot
- Claiming "1:1" without source/local evidence

This project is local-only by default. Deployment is out of scope unless the page owner explicitly authorizes it.

## Install

```bash
git clone https://github.com/1939869736luosi/atomic-website-clone.git
cd atomic-website-clone
npm install
npx playwright install chromium
```

Optional, only for video comparison:

```bash
brew install ffmpeg
```

## Add As A Skill

Copy or symlink this folder into your agent's skills directory.

Example:

```bash
mkdir -p ~/.codex/skills
ln -s "$PWD" ~/.codex/skills/atomic-website-clone
```

Then ask your agent to use `atomic-website-clone` for a local-only website clone.

## Fast Path

Start with discovery:

```bash
node scripts/discover-interactions.cjs \
  --url https://example.com \
  --out /tmp/awc-discovery \
  --viewports 1440x1200,390x900 \
  --scrolls 0,0.5,1 \
  --probe \
  --deep-probe \
  --motion-samples
```

The discovery report is not a pass/fail result. It is the raw list of things the clone must handle or explicitly exclude.

Then capture source states:

```bash
node scripts/capture-motion.cjs --config source-capture.json
```

Capture the matching local states:

```bash
node scripts/capture-motion.cjs --config local-capture.json
```

Compare frames:

```bash
node scripts/compare-motion.cjs \
  --source /tmp/source-capture \
  --local /tmp/local-capture \
  --out /tmp/awc-diff
```

Check the state inventory:

```bash
node scripts/check-state-inventory.cjs \
  --source /tmp/source-capture \
  --local /tmp/local-capture \
  --inventory state-inventory.json \
  --discovery /tmp/awc-discovery \
  --require-discovery \
  --out /tmp/awc-state-check
```

Build a reviewer package:

```bash
node scripts/review-pack.cjs \
  --source /tmp/source-capture \
  --local /tmp/local-capture \
  --discovery /tmp/awc-discovery \
  --inventory state-inventory.json \
  --state-check /tmp/awc-state-check \
  --diff /tmp/awc-diff \
  --summary verification-summary.md \
  --out /tmp/awc-review-pack \
  --strict
```

## Minimal Capture Config

```json
{
  "url": "https://example.com/",
  "outDir": "/tmp/source-capture",
  "label": "source",
  "viewport": { "width": 1440, "height": 1200 },
  "selectors": [
    { "name": "hero", "selector": "main" }
  ],
  "states": [
    {
      "id": "default",
      "waitFor": "main",
      "actions": [],
      "frames": [
        { "name": "start", "delay": 0 },
        { "name": "mid", "delay": 250 },
        { "name": "end", "delay": 900 }
      ]
    }
  ]
}
```

## What Counts As Done

A clone is not done just because it opens.

For a serious clone, you need:

- A source URL and local URL
- A state inventory
- Desktop and mobile coverage
- Screenshots for source and local states
- Evidence for menus, tabs, carousels, modals, media, and internal scroll areas when present
- Local asset checks
- Browser checks with no unexpected console errors, page errors, failed requests, or local 404s
- A visual comparison or reviewer package
- Written exclusions for anything intentionally not cloned

## Output Directory Warning

Several scripts clear their output directory before writing fresh evidence.

Do not pass a valuable folder as `--out` or `outDir`.

Good:

```bash
--out /tmp/awc-discovery
```

Bad:

```bash
--out ~/Desktop
```

## License

MIT
