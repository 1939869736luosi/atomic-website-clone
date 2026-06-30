# Atomic Website Clone

High-fidelity local-only website cloning workflow for agents.

This skill treats a page as a set of observable states instead of a single screenshot. It focuses on interaction discovery, source capture, local reconstruction, motion checks, state inventory, visual comparison, reviewer handoff, and cleanup.

## What It Is

- A reusable agent skill in `SKILL.md`
- Browser-based helper scripts in `scripts/`
- A compact OpenAI-facing agent card in `agents/openai.yaml`
- Local-only by default: it does not deploy cloned pages

## What It Is Not

- It is not a website scraper for unauthorized use.
- It is not a hosting or deployment tool.
- It is not a shortcut for publishing someone else's site.

Use it only for public pages, owned pages, internal pages you are authorized to inspect, or pages where you have explicit permission to create a local visual reference.

## Install

```bash
npm install
npx playwright install chromium
```

FFmpeg is optional and only needed for video quality comparison:

```bash
brew install ffmpeg
```

## Quick Start

Discover interactive and animated surfaces:

```bash
node scripts/discover-interactions.cjs \
  --url https://example.com \
  --out /tmp/atomic-discovery \
  --viewports 1440x1200,390x900 \
  --scrolls 0,0.5,1 \
  --probe \
  --deep-probe \
  --motion-samples
```

Capture source or local states:

```bash
node scripts/capture-motion.cjs --config path/to/capture-config.json
```

Compare matching source and local frame sets:

```bash
node scripts/compare-motion.cjs \
  --source /tmp/source-capture \
  --local /tmp/local-capture \
  --out /tmp/atomic-diff
```

Check a state inventory:

```bash
node scripts/check-state-inventory.cjs \
  --source /tmp/source-capture \
  --local /tmp/local-capture \
  --inventory state-inventory.json \
  --discovery /tmp/atomic-discovery \
  --require-discovery \
  --out /tmp/atomic-state-check
```

Scan a finished local clone for missing files and unexpected remote references:

```bash
node scripts/scan-local-assets.cjs \
  --root ./public \
  --out /tmp/atomic-assets-check
```

Build a reviewer package:

```bash
node scripts/review-pack.cjs \
  --source /tmp/source-capture \
  --local /tmp/local-capture \
  --discovery /tmp/atomic-discovery \
  --inventory state-inventory.json \
  --state-check /tmp/atomic-state-check \
  --diff /tmp/atomic-diff \
  --summary verification-summary.md \
  --out /tmp/atomic-review-pack \
  --strict
```

## Helper Scripts

| Script | Purpose |
| --- | --- |
| `discover-interactions.cjs` | Finds controls, motion surfaces, overflow panes, hover/click changes, scroll probes, and creates an inventory seed. |
| `capture-motion.cjs` | Captures browser states, screenshots, selector metrics, animation/video data, network status, and assertions. |
| `compare-motion.cjs` | Compares same-named PNG frames and writes diff images plus JSON/Markdown reports. |
| `check-state-inventory.cjs` | Checks source/local states, screenshots, selector counts, discovery coverage, exclusions, and assertions. |
| `compare-video-quality.cjs` | Uses FFmpeg metrics such as SSIM, PSNR, XPSNR, and VMAF when available. |
| `scan-local-assets.cjs` | Checks local references, unexpected remote references, and common leftover files. |
| `review-pack.cjs` | Packages evidence for visual/state and integrity review. |

## Important Safety Notes

- The scripts write reports into the `--out` or configured `outDir`.
- Several scripts clear their own output directory before writing fresh evidence. Do not pass an important directory as an output directory.
- Keep source captures and local captures separate.
- Do not call a clone complete until the state inventory, interaction traces, local error checks, visual comparison, and review evidence all exist.

## Repository Layout

```text
.
├── SKILL.md
├── agents/
│   └── openai.yaml
├── scripts/
├── package.json
├── LICENSE
└── README.md
```

## License

MIT
