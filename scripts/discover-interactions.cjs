#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

let chromium;
try {
  ({ chromium } = require("playwright"));
} catch (_error) {
  console.error("Missing dependency: install Playwright with `npm install` and `npx playwright install chromium`.");
  process.exit(1);
}

function usage() {
  console.log(`Usage:
  node discover-interactions.cjs --url https://example.com --out /tmp/discovery

Options:
  --viewports 1440x1200,390x900   Default: 1440x1200
  --scrolls 0,0.25,0.5,0.75,1     Default: 0,0.5,1
  --probe                         Hover/focus and controlled-click candidates
  --deep-probe                    Re-scan after changed probes and create inventory seed
  --probe-limit 24                Default: 24 per viewport
  --scroll-probe-limit 16         Default: 16 per viewport/scroll
  --motion-samples                Capture start/mid/end viewport frames at each scroll
  --timeout 30000                 Default: 30000

The report is an inventory seed, not a final PASS. Classify every high-confidence
candidate into the state inventory, or exclude it with evidence.`);
}

function parseArgs(argv) {
  const args = {};
  for (let index = 2; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith("--")) continue;
    const name = key.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) args[name] = true;
    else {
      args[name] = next;
      index += 1;
    }
  }
  return args;
}

function parseViewports(value) {
  return String(value || "1440x1200")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      const match = item.match(/^(\d+)x(\d+)$/);
      if (!match) throw new Error(`Invalid viewport: ${item}`);
      return { width: Number(match[1]), height: Number(match[2]), id: item };
    });
}

function parseScrolls(value) {
  return String(value || "0,0.5,1")
    .split(",")
    .map((item) => Number(item.trim()))
    .filter((item) => Number.isFinite(item))
    .map((item) => Math.max(0, Math.min(1, item)));
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function slug(value) {
  return String(value || "item")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120) || "item";
}

function hash(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex").slice(0, 16);
}

function fileHash(file) {
  return fs.existsSync(file) ? hash(fs.readFileSync(file)) : "";
}

function candidateKey(candidate) {
  const viewport = candidate.viewport || candidate.viewportId || "";
  const scrollFraction = candidate.scrollFraction ?? "";
  return hash(`${viewport}|${scrollFraction}|${candidate.selector || ""}|${candidate.text || ""}|${candidate.reasons?.join(",") || ""}`);
}

function isHighConfidence(candidate) {
  return Boolean(
    candidate.confidence >= 4 ||
    candidate.probeChanged ||
    candidate.reasons?.includes("scroll-x") ||
    candidate.reasons?.includes("scroll-y")
  );
}

async function pageSignature(page) {
  const data = await page.evaluate(() => ({
    url: location.href,
    title: document.title,
    text: document.body ? document.body.innerText.slice(0, 120_000) : "",
    scrollX,
    scrollY,
    active: document.activeElement
      ? {
          tag: document.activeElement.tagName,
          id: document.activeElement.id,
          cls: document.activeElement.className,
          ariaExpanded: document.activeElement.getAttribute("aria-expanded"),
          ariaSelected: document.activeElement.getAttribute("aria-selected")
        }
      : null,
    expandedCount: document.querySelectorAll('[aria-expanded="true"]').length,
    selectedCount: document.querySelectorAll('[aria-selected="true"], .active, [data-active="true"]').length,
    visibleDialogs: Array.from(document.querySelectorAll('dialog,[role="dialog"],[aria-modal="true"]'))
      .filter((element) => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) > 0 && rect.width > 0 && rect.height > 0;
      }).length,
    visibleControls: Array.from(document.querySelectorAll('a,button,input,select,textarea,summary,[role],[tabindex],[aria-expanded],[aria-selected]'))
      .filter((element) => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) > 0 && rect.width > 0 && rect.height > 0;
      }).length,
    mediaCount: document.querySelectorAll("video,canvas,svg,iframe,lottie-player").length,
    animationCount: document.getAnimations ? document.getAnimations({ subtree: true }).length : 0
  }));
  return { ...data, textHash: hash(data.text) };
}

async function discoverAtPosition(page) {
  return page.evaluate(() => {
    const viewport = { width: innerWidth, height: innerHeight };
    const doc = document.documentElement;

    function visible(element, rect) {
      const style = getComputedStyle(element);
      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        Number(style.opacity) > 0.01 &&
        rect.width >= 2 &&
        rect.height >= 2 &&
        rect.bottom >= 0 &&
        rect.right >= 0 &&
        rect.top <= viewport.height &&
        rect.left <= viewport.width
      );
    }

    function cssPath(element) {
      if (!(element instanceof Element)) return "";
      if (element.id && !/\s/.test(element.id)) return `#${CSS.escape(element.id)}`;
      const parts = [];
      let node = element;
      while (node && node.nodeType === Node.ELEMENT_NODE && parts.length < 5) {
        let part = node.nodeName.toLowerCase();
        const cls = Array.from(node.classList || [])
          .filter((item) => /^[a-zA-Z0-9_-]+$/.test(item))
          .slice(0, 2);
        if (cls.length) part += `.${cls.map((item) => CSS.escape(item)).join(".")}`;
        const parent = node.parentElement;
        if (parent) {
          const siblings = Array.from(parent.children).filter((item) => item.nodeName === node.nodeName);
          if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(node) + 1})`;
        }
        parts.unshift(part);
        node = parent;
      }
      return parts.join(" > ");
    }

    function textOf(element) {
      return (element.innerText || element.getAttribute("aria-label") || element.getAttribute("title") || element.alt || "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 140);
    }

    const all = Array.from(document.querySelectorAll("*")).slice(0, 3500);
    const items = [];
    for (const element of all) {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      const tag = element.tagName.toLowerCase();
      const role = element.getAttribute("role") || "";
      const href = element.getAttribute("href") || "";
      const controls = element.getAttribute("aria-controls") || "";
      const expanded = element.getAttribute("aria-expanded");
      const selected = element.getAttribute("aria-selected");
      const tabindex = element.getAttribute("tabindex");
      const onClick = Boolean(element.onclick || element.getAttribute("onclick"));
      const pointer = style.cursor === "pointer";
      const overflowX = style.overflowX;
      const overflowY = style.overflowY;
      const scrollableX = ["auto", "scroll", "overlay"].includes(overflowX) && element.scrollWidth > element.clientWidth + 4;
      const scrollableY = ["auto", "scroll", "overlay"].includes(overflowY) && element.scrollHeight > element.clientHeight + 4;
      const animated =
        style.animationName !== "none" ||
        parseFloat(style.animationDuration) > 0 ||
        parseFloat(style.transitionDuration) > 0 ||
        style.transform !== "none" ||
        style.willChange !== "auto";
      const media = ["video", "canvas", "iframe", "svg", "lottie-player"].includes(tag);
      const focusable =
        ["a", "button", "input", "select", "textarea", "summary"].includes(tag) ||
        role ||
        tabindex !== null ||
        controls ||
        expanded !== null ||
        selected !== null;
      if (!visible(element, rect)) continue;
      if (!(focusable || pointer || scrollableX || scrollableY || animated || media || onClick)) continue;

      const reasons = [];
      if (focusable) reasons.push("control");
      if (pointer) reasons.push("pointer");
      if (scrollableX) reasons.push("scroll-x");
      if (scrollableY) reasons.push("scroll-y");
      if (animated) reasons.push("motion");
      if (media) reasons.push("media");
      if (onClick) reasons.push("onclick");
      if (expanded !== null || selected !== null || controls) reasons.push("aria-state");

      const confidence =
        (focusable ? 2 : 0) +
        (scrollableX || scrollableY ? 3 : 0) +
        (media ? 2 : 0) +
        (onClick || pointer ? 1 : 0) +
        (animated ? 1 : 0) +
        (expanded !== null || selected !== null || controls ? 2 : 0);

      items.push({
        selector: cssPath(element),
        tag,
        role,
        text: textOf(element),
        href,
        aria: { controls, expanded, selected, label: element.getAttribute("aria-label") || "" },
        bbox: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) },
        scroll: {
          scrollWidth: element.scrollWidth,
          scrollHeight: element.scrollHeight,
          clientWidth: element.clientWidth,
          clientHeight: element.clientHeight,
          scrollLeft: element.scrollLeft,
          scrollTop: element.scrollTop
        },
        style: {
          cursor: style.cursor,
          overflowX,
          overflowY,
          animationName: style.animationName,
          animationDuration: style.animationDuration,
          transitionDuration: style.transitionDuration,
          transform: style.transform
        },
        reasons,
        confidence
      });
    }

    const seen = new Set();
    return items
      .sort((a, b) => b.confidence - a.confidence || (b.bbox.width * b.bbox.height) - (a.bbox.width * a.bbox.height))
      .filter((item) => {
        const key = `${item.selector}|${item.reasons.join(",")}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 160)
      .map((item, index) => ({ id: `candidate-${index + 1}`, ...item }));
  });
}

function canControlledClick(candidate) {
  if (candidate.href && !candidate.href.startsWith("#")) return false;
  if (["input", "textarea", "select"].includes(candidate.tag)) return false;
  if (candidate.text && /download|log in|login|sign in|contact sales|submit|buy|checkout/i.test(candidate.text)) return false;
  if (candidate.reasons.includes("control") || candidate.reasons.includes("aria-state") || candidate.reasons.includes("pointer")) return true;
  return false;
}

async function screenshot(page, outDir, name) {
  const relative = `probe-screenshots/${slug(name)}.png`;
  const absolute = path.join(outDir, relative);
  ensureDir(path.dirname(absolute));
  await page.screenshot({ path: absolute, fullPage: false, animations: "allow" });
  return { relative, absolute, hash: fileHash(absolute) };
}

async function restoreProbeBaseline(page, targetUrl, scrollTop) {
  await page.keyboard.press("Escape").catch(() => {});
  await page.mouse.click(8, 8).catch(() => {});
  if (page.url() !== targetUrl) {
    await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 10_000 }).catch(() => {});
    await page.waitForTimeout(250);
  }
  await page.evaluate((y) => scrollTo(0, y), scrollTop || 0).catch(() => {});
  await page.waitForTimeout(160);
}

function signatureChanged(before, after) {
  return (
    before.url !== after.url ||
    before.textHash !== after.textHash ||
    before.expandedCount !== after.expandedCount ||
    before.selectedCount !== after.selectedCount ||
    before.visibleDialogs !== after.visibleDialogs ||
    before.visibleControls !== after.visibleControls ||
    before.mediaCount !== after.mediaCount ||
    Math.abs(before.scrollY - after.scrollY) > 8
  );
}

async function probeCandidates(page, candidates, limit, options = {}) {
  const results = [];
  const selected = candidates
    .filter((item) => item.confidence >= 3 && item.selector)
    .slice(0, limit);
  for (const candidate of selected) {
    const key = candidate.candidateKey || candidateKey(candidate);
    const prefix = `${options.viewportId || "viewport"}-${String(options.scrollFraction ?? "0").replace(".", "_")}-${key}`;
    const result = { candidateKey: key, selector: candidate.selector, text: candidate.text, reasons: candidate.reasons, hover: null, click: null, rescans: [] };
    const locator = page.locator(candidate.selector).first();
    try {
      await restoreProbeBaseline(page, options.url || page.url(), options.scrollTop || 0);
      const before = await pageSignature(page);
      const beforeShot = await screenshot(page, options.outDir, `${prefix}-hover-before`);
      await locator.hover({ timeout: 2000, force: true });
      await page.waitForTimeout(160);
      const after = await pageSignature(page);
      const afterShot = await screenshot(page, options.outDir, `${prefix}-hover-after`);
      result.hover = {
        changed: signatureChanged(before, after) || beforeShot.hash !== afterShot.hash,
        before: { textHash: before.textHash, expandedCount: before.expandedCount, selectedCount: before.selectedCount, visibleDialogs: before.visibleDialogs, visibleControls: before.visibleControls, screenshot: beforeShot.relative, screenshotHash: beforeShot.hash },
        after: { textHash: after.textHash, expandedCount: after.expandedCount, selectedCount: after.selectedCount, visibleDialogs: after.visibleDialogs, visibleControls: after.visibleControls, screenshot: afterShot.relative, screenshotHash: afterShot.hash }
      };
      if (options.deepProbe && result.hover.changed) {
        const discovered = await discoverAtPosition(page);
        result.rescans.push({ trigger: "hover", candidateCount: discovered.length, highConfidence: discovered.filter((item) => item.confidence >= 4).length });
        const enriched = discovered.slice(0, 80).map((item) => {
          const candidate = { ...item, origin: "after-hover", parentCandidateKey: key, viewport: options.viewportId, viewportId: options.viewportId, scrollFraction: options.scrollFraction, scrollTop: options.scrollTop };
          candidate.candidateKey = candidateKey(candidate);
          return candidate;
        });
        for (const item of enriched) options.afterCandidates?.push(item);
        const scrollResults = await probeScrollables(page, enriched, options.scrollProbeLimit || 8, {
          ...options,
          skipRestore: true,
          labelSuffix: `after-hover-${key}`
        });
        if (scrollResults.length) options.afterScrollProbes?.push({ trigger: "hover", parentCandidateKey: key, results: scrollResults });
      }
    } catch (error) {
      result.hover = { error: String(error.message || error) };
    }
    if (canControlledClick(candidate)) {
      try {
        await restoreProbeBaseline(page, options.url || page.url(), options.scrollTop || 0);
        const before = await pageSignature(page);
        const beforeShot = await screenshot(page, options.outDir, `${prefix}-click-before`);
        await locator.click({ timeout: 2000, force: true });
        await page.waitForTimeout(350);
        const after = await pageSignature(page);
        const afterShot = await screenshot(page, options.outDir, `${prefix}-click-after`);
        result.click = {
          changed: signatureChanged(before, after) || beforeShot.hash !== afterShot.hash,
          before: { url: before.url, textHash: before.textHash, scrollY: before.scrollY, expandedCount: before.expandedCount, selectedCount: before.selectedCount, visibleDialogs: before.visibleDialogs, visibleControls: before.visibleControls, screenshot: beforeShot.relative, screenshotHash: beforeShot.hash },
          after: { url: after.url, textHash: after.textHash, scrollY: after.scrollY, expandedCount: after.expandedCount, selectedCount: after.selectedCount, visibleDialogs: after.visibleDialogs, visibleControls: after.visibleControls, screenshot: afterShot.relative, screenshotHash: afterShot.hash }
        };
        if (options.deepProbe && result.click.changed) {
          const discovered = await discoverAtPosition(page);
          result.rescans.push({ trigger: "click", candidateCount: discovered.length, highConfidence: discovered.filter((item) => item.confidence >= 4).length });
          const enriched = discovered.slice(0, 80).map((item) => {
            const candidate = { ...item, origin: "after-click", parentCandidateKey: key, viewport: options.viewportId, viewportId: options.viewportId, scrollFraction: options.scrollFraction, scrollTop: options.scrollTop };
            candidate.candidateKey = candidateKey(candidate);
            return candidate;
          });
          for (const item of enriched) options.afterCandidates?.push(item);
          const scrollResults = await probeScrollables(page, enriched, options.scrollProbeLimit || 8, {
            ...options,
            skipRestore: true,
            labelSuffix: `after-click-${key}`
          });
          if (scrollResults.length) options.afterScrollProbes?.push({ trigger: "click", parentCandidateKey: key, results: scrollResults });
        }
      } catch (error) {
        result.click = { error: String(error.message || error) };
      }
    }
    await restoreProbeBaseline(page, options.url || page.url(), options.scrollTop || 0);
    results.push(result);
  }
  return results;
}

async function probeScrollables(page, candidates, limit, options = {}) {
  const selected = candidates
    .filter((item) => (item.reasons.includes("scroll-x") || item.reasons.includes("scroll-y")) && item.selector)
    .slice(0, limit);
  const results = [];
  for (const candidate of selected) {
    const key = candidate.candidateKey || candidateKey(candidate);
    const suffix = options.labelSuffix ? `-${slug(options.labelSuffix)}` : "";
    const prefix = `${options.viewportId || "viewport"}-${String(options.scrollFraction ?? "0").replace(".", "_")}-${key}${suffix}-scroll`;
    const item = { candidateKey: key, selector: candidate.selector, text: candidate.text, reasons: candidate.reasons, before: null, after: null, changed: false };
    try {
      if (!options.skipRestore) await restoreProbeBaseline(page, options.url || page.url(), options.scrollTop || 0);
      const beforeShot = await screenshot(page, options.outDir, `${prefix}-before`);
      const before = await page.locator(candidate.selector).first().evaluate((element) => ({
        scrollTop: element.scrollTop,
        scrollLeft: element.scrollLeft,
        scrollHeight: element.scrollHeight,
        scrollWidth: element.scrollWidth,
        clientHeight: element.clientHeight,
        clientWidth: element.clientWidth
      }));
      const after = await page.locator(candidate.selector).first().evaluate((element) => {
        element.scrollTop = Math.min(element.scrollTop + Math.max(80, element.clientHeight * 0.5), element.scrollHeight);
        element.scrollLeft = Math.min(element.scrollLeft + Math.max(80, element.clientWidth * 0.5), element.scrollWidth);
        return {
          scrollTop: element.scrollTop,
          scrollLeft: element.scrollLeft,
          scrollHeight: element.scrollHeight,
          scrollWidth: element.scrollWidth,
          clientHeight: element.clientHeight,
          clientWidth: element.clientWidth
        };
      });
      await page.waitForTimeout(180);
      const afterShot = await screenshot(page, options.outDir, `${prefix}-after`);
      item.before = { ...before, screenshot: beforeShot.relative, screenshotHash: beforeShot.hash };
      item.after = { ...after, screenshot: afterShot.relative, screenshotHash: afterShot.hash };
      item.scrollChanged = before.scrollTop !== after.scrollTop || before.scrollLeft !== after.scrollLeft;
      item.visualChanged = beforeShot.hash !== afterShot.hash;
      item.changed = item.scrollChanged;
    } catch (error) {
      item.error = String(error.message || error);
    }
    results.push(item);
  }
  return results;
}

async function captureMotionSample(page, outDir, name) {
  const frames = [];
  for (const frame of [
    { name: "start", delay: 0 },
    { name: "mid", delay: 250 },
    { name: "end", delay: 900 }
  ]) {
    if (frame.delay) await page.waitForTimeout(frame.delay);
    const shot = await screenshot(page, outDir, `${name}-motion-${frame.name}`);
    const signature = await pageSignature(page);
    frames.push({ ...frame, screenshot: shot.relative, screenshotHash: shot.hash, animationCount: signature.animationCount, mediaCount: signature.mediaCount });
  }
  return {
    frames,
    changed: new Set(frames.map((frame) => frame.screenshotHash)).size > 1
  };
}

function writeInventorySeed(outDir, report) {
  const byKey = new Map();
  for (const candidate of report.candidates) {
    if (!isHighConfidence(candidate)) continue;
    const key = candidate.candidateKey || candidateKey(candidate);
    if (!byKey.has(key)) byKey.set(key, candidate);
  }
  const probeByKey = new Map();
  const changedBySelector = new Map();
  for (const group of report.probes || []) {
    for (const item of group.results || []) {
      probeByKey.set(item.candidateKey, item);
      if (item.hover?.changed || item.click?.changed) changedBySelector.set(item.selector, item);
    }
  }
  const states = [];
  for (const [key, candidate] of byKey) {
    const probe = probeByKey.get(key) || changedBySelector.get(candidate.selector);
    const scrollProbe = (report.scrollProbes || [])
      .flatMap((group) => group.results || [])
      .find((item) => item.candidateKey === key || item.selector === candidate.selector);
    const motionProbe = (report.motionSamples || [])
      .find((item) => item.viewport === candidate.viewport && item.scrollFraction === candidate.scrollFraction && item.changed && candidate.reasons?.some((reason) => reason === "motion" || reason === "media"));
    const action =
      probe?.click?.changed ? { type: "click", selector: candidate.selector, force: true } :
      probe?.hover?.changed ? { type: "hover", selector: candidate.selector, force: true } :
      null;
    states.push({
      id: `discovery-${key}`,
      source: "discover-interactions",
      viewport: candidate.viewport,
      scrollFraction: candidate.scrollFraction,
      scrollTop: candidate.scrollTop,
      behaviorHints: candidate.reasons,
      trigger: action || null,
      actions: action ? [action] : [],
      frames: ["before", "after"],
      discoveryCandidateIds: [key],
      selectors: [{ name: `candidate-${key}`, selector: candidate.selector, countMatch: true }],
      evidence: {
        discoveryScreenshot: candidate.screenshot || "",
        probeBefore: probe?.click?.before?.screenshot || probe?.hover?.before?.screenshot || "",
        probeAfter: probe?.click?.after?.screenshot || probe?.hover?.after?.screenshot || "",
        scrollBefore: scrollProbe?.before?.screenshot || "",
        scrollAfter: scrollProbe?.after?.screenshot || "",
        motionFrames: motionProbe?.frames?.map((frame) => frame.screenshot) || []
      },
      requiredAssertions: [
        ...(candidate.reasons?.includes("scroll-x") ? [{ selector: candidate.selector, scrollLeftGt: 0 }] : []),
        ...(candidate.reasons?.includes("scroll-y") ? [{ selector: candidate.selector, scrollTopGt: 0 }] : [])
      ]
    });
  }
  const inventory = {
    tool: "discover-interactions",
    version: 1,
    createdAt: new Date().toISOString(),
    url: report.url,
    notes: [
      "This is a seed, not a final inventory.",
      "Keep states that represent real source behavior.",
      "Move duplicates or decorative-only candidates to excludedDiscoveryCandidates with evidence."
    ],
    states,
    excludedDiscoveryCandidates: []
  };
  fs.writeFileSync(path.join(outDir, "inventory-seed.json"), JSON.stringify(inventory, null, 2));
  return inventory;
}

function writeMarkdown(file, report) {
  const lines = [];
  lines.push("# Interaction Discovery", "");
  lines.push(`- URL: ${report.url}`);
  lines.push(`- Failed: ${report.failed}`);
  lines.push(`- Candidate count: ${report.summary.candidates}`);
  lines.push(`- High-confidence count: ${report.summary.highConfidence}`);
  lines.push(`- Probe changed count: ${report.summary.probeChanged}`);
  lines.push(`- Trigger rescans: ${report.summary.triggerRescans}`);
  lines.push(`- Scroll probes changed: ${report.summary.scrollProbeChanged}`);
  lines.push(`- Motion samples changed: ${report.summary.motionSamplesChanged}`);
  lines.push(`- Inventory seed states: ${report.summary.inventorySeedStates}`);
  lines.push("");
  lines.push("## High-Confidence Candidates", "");
  lines.push("| Viewport | Scroll | Selector | Reasons | Text | Confidence | Probe |");
  lines.push("| --- | ---: | --- | --- | --- | ---: | --- |");
  for (const item of report.candidates.filter((candidate) => candidate.confidence >= 4 || candidate.probeChanged).slice(0, 120)) {
    const probe = item.probeChanged ? "changed" : item.probed ? "no-change" : "not-probed";
    lines.push(`| ${item.viewport} | ${item.scrollFraction} | \`${item.selector.replaceAll("|", "\\|")}\` | ${item.reasons.join(", ")} | ${item.text.replaceAll("|", "\\|")} | ${item.confidence} | ${probe} |`);
  }
  lines.push("");
  lines.push("## Evidence Files", "");
  lines.push("- Full report: `report.json`");
  lines.push("- Inventory seed: `inventory-seed.json`");
  lines.push("- Viewport screenshots: `screenshots/`");
  lines.push("- Probe before/after and motion sample screenshots: `probe-screenshots/`");
  lines.push("");
  lines.push("## Required Follow-Up", "");
  lines.push("- Add every high-confidence candidate that changes state to the state inventory.");
  lines.push("- Add every trigger rescan candidate that is not a duplicate or decorative-only.");
  lines.push("- Use probe screenshots to decide visual-only hover/click states, not text hash alone.");
  lines.push("- Convert real scroll and media/motion probes into capture-motion states with assertions.");
  lines.push("- Exclude duplicates, decorative motion, and outbound links only with evidence.");
  lines.push("- Re-run after opening menus, drawers, tabs, process triggers, and late-loaded sections.");
  fs.writeFileSync(file, `${lines.join("\n")}\n`);
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help || !args.url || !args.out) {
    usage();
    process.exit(args.help ? 0 : 1);
  }

  const outDir = path.resolve(args.out);
  fs.rmSync(outDir, { recursive: true, force: true });
  ensureDir(outDir);
  ensureDir(path.join(outDir, "screenshots"));
  ensureDir(path.join(outDir, "probe-screenshots"));

  const viewports = parseViewports(args.viewports);
  const scrolls = parseScrolls(args.scrolls);
  const probe = Boolean(args.probe);
  const deepProbe = Boolean(args["deep-probe"]);
  const motionSamples = Boolean(args["motion-samples"]);
  const probeLimit = Number(args["probe-limit"] || 24);
  const scrollProbeLimit = Number(args["scroll-probe-limit"] || 16);
  const timeout = Number(args.timeout || 30_000);
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ serviceWorkers: "block" });
  const report = {
    tool: "discover-interactions",
    version: 1,
    createdAt: new Date().toISOString(),
    url: args.url,
    viewports: viewports.map(({ id }) => id),
    scrolls,
    probe,
    deepProbe,
    motionSamples,
    failed: false,
    errors: [],
    candidates: [],
    probes: [],
    scrollProbes: [],
    motionSamples: []
  };

  for (const viewport of viewports) {
    const page = await context.newPage();
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    try {
      await page.goto(args.url, { waitUntil: "domcontentloaded", timeout });
      await page.waitForTimeout(900);
      const pageSize = await page.evaluate(() => ({
        scrollHeight: document.documentElement.scrollHeight,
        viewportHeight: innerHeight
      }));
      for (const fraction of scrolls) {
        const top = Math.round(Math.max(0, pageSize.scrollHeight - pageSize.viewportHeight) * fraction);
        await page.evaluate((y) => scrollTo(0, y), top);
        await page.waitForTimeout(350);
        const shotName = `${slug(viewport.id)}-${String(fraction).replace(".", "_")}.png`;
        await page.screenshot({ path: path.join(outDir, "screenshots", shotName), fullPage: false });
        const candidates = await discoverAtPosition(page);
        const enrichedCandidates = candidates.map((candidate) => {
          const enriched = { ...candidate, viewport: viewport.id, viewportId: viewport.id, scrollFraction: fraction, scrollTop: top, screenshot: `screenshots/${shotName}`, origin: "viewport-scroll" };
          enriched.candidateKey = candidateKey(enriched);
          return enriched;
        });
        for (const enriched of enrichedCandidates) report.candidates.push(enriched);
        if (motionSamples && candidates.some((item) => item.reasons.includes("motion") || item.reasons.includes("media"))) {
          const sample = await captureMotionSample(page, outDir, `${slug(viewport.id)}-${String(fraction).replace(".", "_")}`);
          report.motionSamples.push({ viewport: viewport.id, scrollFraction: fraction, scrollTop: top, ...sample });
        }
        if (probe) {
          const afterCandidates = [];
          const afterScrollProbes = [];
          const probeResults = await probeCandidates(page, enrichedCandidates, probeLimit, {
            url: args.url,
            outDir,
            viewportId: viewport.id,
            scrollFraction: fraction,
            scrollTop: top,
            deepProbe,
            afterCandidates,
            afterScrollProbes,
            scrollProbeLimit
          });
          report.probes.push({ viewport: viewport.id, scrollFraction: fraction, scrollTop: top, results: probeResults });
          const scrollResults = await probeScrollables(page, enrichedCandidates, scrollProbeLimit, {
            url: args.url,
            outDir,
            viewportId: viewport.id,
            scrollFraction: fraction,
            scrollTop: top
          });
          report.scrollProbes.push({ viewport: viewport.id, scrollFraction: fraction, scrollTop: top, results: scrollResults });
          for (const group of afterScrollProbes) {
            report.scrollProbes.push({ viewport: viewport.id, scrollFraction: fraction, scrollTop: top, parentCandidateKey: group.parentCandidateKey, trigger: group.trigger, results: group.results });
          }
          for (const candidate of afterCandidates) {
            const enriched = { ...candidate, viewport: viewport.id, viewportId: viewport.id, scrollFraction: fraction, scrollTop: top, screenshot: candidate.screenshot || `screenshots/${shotName}` };
            enriched.candidateKey = enriched.candidateKey || candidateKey(enriched);
            report.candidates.push(enriched);
          }
        }
      }
    } catch (error) {
      report.failed = true;
      report.errors.push({ viewport: viewport.id, error: String(error.message || error) });
    } finally {
      await page.close().catch(() => {});
    }
  }

  const probeChangedKeys = new Set();
  const probeChangedSelectors = new Set();
  for (const group of report.probes) {
    for (const item of group.results) {
      if (item.hover?.changed || item.click?.changed) {
        probeChangedKeys.add(item.candidateKey);
        probeChangedSelectors.add(item.selector);
      }
    }
  }
  for (const candidate of report.candidates) {
    candidate.probed = report.probes.some((group) => group.results.some((item) => item.candidateKey === candidate.candidateKey || item.selector === candidate.selector));
    candidate.probeChanged = probeChangedKeys.has(candidate.candidateKey) || probeChangedSelectors.has(candidate.selector);
  }
  const inventorySeed = writeInventorySeed(outDir, report);
  report.summary = {
    candidates: report.candidates.length,
    highConfidence: report.candidates.filter((item) => isHighConfidence(item)).length,
    probeChanged: report.candidates.filter((item) => item.probeChanged).length,
    uniqueProbeChanged: probeChangedKeys.size,
    triggerRescans: report.probes.flatMap((group) => group.results || []).flatMap((item) => item.rescans || []).length,
    scrollProbes: report.scrollProbes.flatMap((group) => group.results || []).length,
    scrollProbeChanged: report.scrollProbes.flatMap((group) => group.results || []).filter((item) => item.changed).length,
    motionSamples: report.motionSamples.length,
    motionSamplesChanged: report.motionSamples.filter((item) => item.changed).length,
    inventorySeedStates: inventorySeed.states.length,
    screenshots: fs.readdirSync(path.join(outDir, "screenshots")).length
  };

  fs.writeFileSync(path.join(outDir, "report.json"), JSON.stringify(report, null, 2));
  writeMarkdown(path.join(outDir, "report.md"), report);
  await browser.close();
  console.log(JSON.stringify({ outDir, failed: report.failed, summary: report.summary, report: path.join(outDir, "report.md") }, null, 2));
  if (report.failed) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
