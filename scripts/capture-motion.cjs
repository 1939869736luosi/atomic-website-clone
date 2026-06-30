#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");

let chromium;
try {
  ({ chromium } = require("playwright"));
} catch (_error) {
  console.error("Missing dependency: install Playwright with `npm install` and `npx playwright install chromium`.");
  process.exit(1);
}

const STYLE_PROPS = [
  "display",
  "visibility",
  "opacity",
  "transform",
  "transitionDuration",
  "transitionTimingFunction",
  "animationName",
  "animationDuration",
  "animationTimingFunction",
  "position",
  "zIndex",
  "overflow",
  "overflowX",
  "overflowY",
  "width",
  "height",
  "margin",
  "padding",
  "borderRadius",
  "boxShadow",
  "backgroundColor",
  "color",
  "fontFamily",
  "fontSize",
  "fontWeight",
  "lineHeight"
];

function usage() {
  console.log(`Usage:
  node capture-motion.cjs --config path/to/config.json
  node capture-motion.cjs --config-json '{"url":"http://127.0.0.1:4175/","outDir":"/tmp/capture","states":[{"id":"default"}]}'

Config shape:
{
  "url": "https://example.com/",
  "outDir": "/tmp/source-capture",
  "label": "source",
  "viewport": { "width": 1440, "height": 1200 },
  "trace": true,
  "recordVideo": false,
  "disableServiceWorkers": true,
  "selectors": [
    { "name": "studio", "selector": ".studio" },
    { "name": "video", "selector": "video", "kind": "video" }
  ],
  "states": [
    {
      "id": "default",
      "waitFor": ".studio",
      "actions": [
        { "type": "click", "selector": ".tab" },
        { "type": "wheel", "selector": ".scroll-pane", "deltaY": 360 },
        { "type": "cdpAnimationSetPaused", "paused": true },
        { "type": "cdpAnimationSeek", "currentTime": 250 },
        { "type": "wait", "ms": 250 }
      ],
      "frames": [
        { "name": "start", "delay": 0 },
        { "name": "mid", "delay": 180 },
        { "name": "end", "delay": 500 }
      ],
      "assertions": [
        { "selector": ".artifact", "visible": false },
        { "selector": ".thumb", "count": 12 },
        { "selector": ".scroll-pane", "scrollTopGt": 0 }
      ]
    }
  ]
}`);
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

function readConfig(args) {
  if (args.help || (!args.config && !args["config-json"])) {
    usage();
    process.exit(args.help ? 0 : 1);
  }
  if (args.config) {
    return JSON.parse(fs.readFileSync(path.resolve(args.config), "utf8"));
  }
  return JSON.parse(args["config-json"]);
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function slug(value) {
  return String(value || "state")
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120) || "state";
}

function selectorList(config, state) {
  return [...(config.selectors || []), ...(state.selectors || [])].map((item) => {
    if (typeof item === "string") return { name: slug(item), selector: item };
    return { name: item.name || slug(item.selector), ...item };
  }).filter((item) => item.selector);
}

async function maybeCdp(page) {
  try {
    const session = await page.context().newCDPSession(page);
    await session.send("Animation.enable").catch(() => {});
    await session.send("DOM.enable").catch(() => {});
    await session.send("CSS.enable").catch(() => {});
    return session;
  } catch (_error) {
    return null;
  }
}

function cdpAnimationIds(cdpState, action = {}) {
  if (!cdpState) return [];
  if (Array.isArray(action.animationIds)) return action.animationIds;
  if (typeof action.animationId === "string") return [action.animationId];
  return Array.from(cdpState.animationIds || []);
}

async function getCdpAnimationSnapshot(cdpState) {
  if (!cdpState?.session) return [];
  const ids = Array.from(cdpState.animationIds || []);
  const results = [];
  for (const id of ids) {
    try {
      const current = await cdpState.session.send("Animation.getCurrentTime", { id });
      results.push({ id, currentTime: current.currentTime });
    } catch (error) {
      results.push({ id, error: String(error.message || error) });
    }
  }
  return results;
}

function hookPage(page, manifest) {
  page.on("console", (msg) => {
    if (msg.type() === "error") manifest.consoleErrors.push({ text: msg.text(), location: msg.location() });
  });
  page.on("pageerror", (error) => manifest.pageErrors.push(String(error.message || error)));
  page.on("requestfailed", (request) => {
    manifest.failedRequests.push({ url: request.url(), error: request.failure()?.errorText || "" });
  });
  page.on("response", (response) => {
    const item = {
      url: response.url(),
      status: response.status(),
      contentType: response.headers()["content-type"] || "",
      requestType: response.request().resourceType()
    };
    manifest.network.push(item);
    if (response.status() >= 400) manifest.httpErrors.push(item);
  });
}

async function runAction(page, action, cdpState) {
  const type = action.type || "wait";
  const locator = action.selector ? page.locator(action.selector).nth(action.nth || 0) : null;
  if (type === "wait") {
    await page.waitForTimeout(action.ms ?? 250);
  } else if (type === "waitFor") {
    await page.waitForSelector(action.selector, { state: action.state || "visible", timeout: action.timeout || 10_000 });
  } else if (type === "click") {
    await locator.click({ timeout: action.timeout || 10_000, force: Boolean(action.force) });
  } else if (type === "hover") {
    await locator.hover({ timeout: action.timeout || 10_000, force: Boolean(action.force) });
  } else if (type === "press") {
    await page.keyboard.press(action.key);
  } else if (type === "type" || type === "fill") {
    if (type === "fill") await locator.fill(action.text || "");
    else await locator.type(action.text || "", { delay: action.delay || 0 });
  } else if (type === "wheel") {
    if (locator) await locator.hover({ timeout: action.timeout || 10_000 });
    await page.mouse.wheel(action.deltaX || 0, action.deltaY || 0);
  } else if (type === "scrollWindow") {
    await page.evaluate(({ x, y }) => window.scrollTo(x || 0, y || 0), action);
  } else if (type === "scrollElement") {
    await locator.evaluate((element, item) => {
      if (Number.isFinite(item.left)) element.scrollLeft = item.left;
      if (Number.isFinite(item.top)) element.scrollTop = item.top;
      if (Number.isFinite(item.deltaX)) element.scrollLeft += item.deltaX;
      if (Number.isFinite(item.deltaY)) element.scrollTop += item.deltaY;
    }, action);
  } else if (type === "drag") {
    const from = action.from ? await page.locator(action.from).nth(action.fromNth || 0).boundingBox() : null;
    const to = action.to ? await page.locator(action.to).nth(action.toNth || 0).boundingBox() : null;
    const start = action.start || (from && { x: from.x + from.width / 2, y: from.y + from.height / 2 });
    const end = action.end || (to && { x: to.x + to.width / 2, y: to.y + to.height / 2 });
    if (!start || !end) throw new Error(`drag action requires from/to selectors or start/end coordinates`);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: action.steps || 12 });
    await page.mouse.up();
  } else if (type === "evaluate") {
    await page.evaluate(action.source || action.fn || "() => undefined", action.arg);
  } else if (type === "cdpAnimationSetPlaybackRate") {
    if (!cdpState?.session) {
      if (action.required) throw new Error("CDP Animation session is unavailable");
    } else {
      await cdpState.session.send("Animation.setPlaybackRate", { playbackRate: Number(action.playbackRate ?? action.rate ?? 1) });
    }
  } else if (type === "cdpAnimationSetPaused") {
    const ids = cdpAnimationIds(cdpState, action);
    if (!cdpState?.session || !ids.length) {
      if (action.required) throw new Error("No CDP animations available to pause");
    } else {
      await cdpState.session.send("Animation.setPaused", { animations: ids, paused: action.paused !== false });
    }
  } else if (type === "cdpAnimationSeek") {
    const ids = cdpAnimationIds(cdpState, action);
    if (!cdpState?.session || !ids.length) {
      if (action.required) throw new Error("No CDP animations available to seek");
    } else {
      await cdpState.session.send("Animation.seekAnimations", { animations: ids, currentTime: Number(action.currentTime ?? action.ms ?? 0) });
    }
  } else if (type === "cdpAnimationRelease") {
    const ids = cdpAnimationIds(cdpState, action);
    if (cdpState?.session && ids.length) await cdpState.session.send("Animation.releaseAnimations", { animations: ids });
  } else {
    throw new Error(`Unsupported action type: ${type}`);
  }
}

async function collectMetrics(page, selectors) {
  return page.evaluate(({ selectors: selectorSpecs, styleProps }) => {
    function isVisible(element) {
      const box = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return box.width > 0 && box.height > 0 && style.visibility !== "hidden" && style.display !== "none" && Number(style.opacity || 1) !== 0;
    }
    const selectorMetrics = selectorSpecs.map((spec) => {
      const nodes = Array.from(document.querySelectorAll(spec.selector));
      const first = nodes[spec.nth || 0] || null;
      const styles = {};
      const attrs = {};
      let box = null;
      if (first) {
        const computed = getComputedStyle(first);
        for (const prop of spec.styles || styleProps) styles[prop] = computed[prop] || "";
        for (const attr of spec.attrs || ["aria-selected", "aria-pressed", "data-active", "data-state", "src", "href"]) {
          const value = first.getAttribute(attr);
          if (value !== null) attrs[attr] = value;
        }
        const rect = first.getBoundingClientRect();
        box = { x: rect.x, y: rect.y, width: rect.width, height: rect.height, top: rect.top, left: rect.left, right: rect.right, bottom: rect.bottom };
      }
      return {
        name: spec.name,
        selector: spec.selector,
        count: nodes.length,
        exists: Boolean(first),
        visible: first ? isVisible(first) : false,
        text: first ? (first.textContent || "").replace(/\s+/g, " ").trim().slice(0, 500) : "",
        box,
        scroll: first ? {
          scrollTop: first.scrollTop,
          scrollLeft: first.scrollLeft,
          scrollHeight: first.scrollHeight,
          scrollWidth: first.scrollWidth,
          clientHeight: first.clientHeight,
          clientWidth: first.clientWidth
        } : null,
        attrs,
        dataset: first ? { ...first.dataset } : {},
        styles,
        video: first && first.tagName === "VIDEO" ? {
          currentTime: first.currentTime,
          duration: first.duration,
          readyState: first.readyState,
          paused: first.paused,
          videoWidth: first.videoWidth,
          videoHeight: first.videoHeight
        } : null
      };
    });
    const animations = document.getAnimations({ subtree: true }).map((animation) => {
      const effect = animation.effect;
      const target = effect && effect.target;
      let timing = {};
      try {
        timing = effect ? effect.getTiming() : {};
      } catch (_error) {}
      let keyframes = [];
      try {
        keyframes = effect && effect.getKeyframes ? effect.getKeyframes().slice(0, 8) : [];
      } catch (_error) {}
      return {
        playState: animation.playState,
        currentTime: animation.currentTime,
        playbackRate: animation.playbackRate,
        target: target ? {
          tagName: target.tagName,
          id: target.id || "",
          className: typeof target.className === "string" ? target.className : ""
        } : null,
        timing,
        keyframes
      };
    });
    return {
      url: location.href,
      title: document.title,
      viewport: { width: innerWidth, height: innerHeight, devicePixelRatio },
      visualViewport: window.visualViewport ? {
        width: window.visualViewport.width,
        height: window.visualViewport.height,
        offsetLeft: window.visualViewport.offsetLeft,
        offsetTop: window.visualViewport.offsetTop,
        scale: window.visualViewport.scale
      } : null,
      documentMode: {
        compatMode: document.compatMode,
        doctype: document.doctype ? {
          name: document.doctype.name,
          publicId: document.doctype.publicId,
          systemId: document.doctype.systemId
        } : null,
        readyState: document.readyState
      },
      pageScroll: { x: scrollX, y: scrollY },
      documentSize: {
        scrollWidth: document.documentElement.scrollWidth,
        scrollHeight: document.documentElement.scrollHeight,
        clientWidth: document.documentElement.clientWidth,
        clientHeight: document.documentElement.clientHeight
      },
      activeElement: document.activeElement ? {
        tagName: document.activeElement.tagName,
        id: document.activeElement.id || "",
        className: typeof document.activeElement.className === "string" ? document.activeElement.className : ""
      } : null,
      selectors: selectorMetrics,
      animations
    };
  }, { selectors, styleProps: STYLE_PROPS });
}

async function runAssertions(page, assertions) {
  const results = [];
  for (const assertion of assertions || []) {
    const selector = assertion.selector;
    const item = { ...assertion, ok: true, actual: {} };
    const locator = page.locator(selector);
    const count = await locator.count();
    item.actual.count = count;
    const first = count ? locator.nth(assertion.nth || 0) : null;
    if ("count" in assertion && count !== assertion.count) item.ok = false;
    if ("minCount" in assertion && count < assertion.minCount) item.ok = false;
    if ("maxCount" in assertion && count > assertion.maxCount) item.ok = false;
    if (first) {
      const visible = await first.isVisible().catch(() => false);
      item.actual.visible = visible;
      if ("visible" in assertion && visible !== assertion.visible) item.ok = false;
      const text = await first.textContent().catch(() => "");
      item.actual.text = (text || "").replace(/\s+/g, " ").trim().slice(0, 500);
      if (assertion.textIncludes && !item.actual.text.includes(assertion.textIncludes)) item.ok = false;
      if ("scrollTopGt" in assertion || "scrollLeftGt" in assertion) {
        const scroll = await first.evaluate((element) => ({ scrollTop: element.scrollTop, scrollLeft: element.scrollLeft }));
        item.actual.scrollTop = scroll.scrollTop;
        item.actual.scrollLeft = scroll.scrollLeft;
        if ("scrollTopGt" in assertion && !(scroll.scrollTop > assertion.scrollTopGt)) item.ok = false;
        if ("scrollLeftGt" in assertion && !(scroll.scrollLeft > assertion.scrollLeftGt)) item.ok = false;
      }
      if (assertion.attrEquals) {
        for (const [attr, expected] of Object.entries(assertion.attrEquals)) {
          const value = await first.getAttribute(attr);
          item.actual[attr] = value;
          if (value !== expected) item.ok = false;
        }
      }
      if ("videoCurrentTimeGt" in assertion || "videoReadyStateGte" in assertion || "videoDurationGt" in assertion || "videoPaused" in assertion) {
        const video = await first.evaluate((element) => element.tagName === "VIDEO" ? {
          currentTime: element.currentTime,
          readyState: element.readyState,
          duration: element.duration,
          paused: element.paused
        } : null);
        item.actual.video = video;
        if (!video) item.ok = false;
        else {
          if ("videoCurrentTimeGt" in assertion && !(video.currentTime > assertion.videoCurrentTimeGt)) item.ok = false;
          if ("videoReadyStateGte" in assertion && !(video.readyState >= assertion.videoReadyStateGte)) item.ok = false;
          if ("videoDurationGt" in assertion && !(video.duration > assertion.videoDurationGt)) item.ok = false;
          if ("videoPaused" in assertion && video.paused !== assertion.videoPaused) item.ok = false;
        }
      }
    } else if (assertion.visible || assertion.textIncludes || assertion.attrEquals) {
      item.ok = false;
    }
    results.push(item);
  }
  return results;
}

async function captureFrame(page, dirs, state, frame, config, manifest, cdpState) {
  const id = slug(state.id);
  const name = slug(frame.name || "frame");
  const imagePath = path.join(dirs.screenshots, `${id}__${name}.png`);
  const jsonPath = path.join(dirs.states, `${id}__${name}.json`);
  if (!frame.allowOverwrite && (fs.existsSync(imagePath) || fs.existsSync(jsonPath))) {
    throw new Error(`Refusing to overwrite existing capture frame "${id}__${name}". Use a unique frame name or set allowOverwrite:true intentionally.`);
  }
  if (Number.isFinite(frame.cdpAnimationSeekMs)) {
    if (!cdpState?.session && frame.cdpAnimationRequired) throw new Error("CDP Animation session is unavailable for required frame seek");
    const ids = cdpAnimationIds(cdpState, frame);
    if (!ids.length && frame.cdpAnimationRequired) throw new Error("No CDP animations available for required frame seek");
    if (ids.length) {
      await cdpState.session.send("Animation.setPaused", { animations: ids, paused: true }).catch(() => {});
      await cdpState.session.send("Animation.seekAnimations", { animations: ids, currentTime: frame.cdpAnimationSeekMs }).catch(() => {});
      await page.waitForTimeout(frame.afterSeekDelay ?? 50);
    }
  }
  await page.screenshot({ path: imagePath, fullPage: Boolean(frame.fullPage || state.fullPage || config.fullPage), animations: frame.disableAnimations ? "disabled" : "allow" });
  const metrics = await collectMetrics(page, selectorList(config, state));
  const cdpAnimations = await getCdpAnimationSnapshot(cdpState);
  const assertions = await runAssertions(page, frame.assertions || state.assertions || []);
  const record = {
    id,
    frame: name,
    label: config.label || "",
    timestamp: new Date().toISOString(),
    screenshot: path.relative(dirs.outDir, imagePath),
    metrics,
    cdpAnimations,
    assertions,
    assertionsOk: assertions.every((item) => item.ok)
  };
  fs.writeFileSync(jsonPath, JSON.stringify(record, null, 2));
  manifest.frames.push(record);
  return record;
}

(async () => {
  const args = parseArgs(process.argv);
  const config = readConfig(args);
  if (!config.url) throw new Error("config.url is required");
  const outDir = path.resolve(config.outDir || path.join(process.cwd(), ".motion-capture"));
  fs.rmSync(outDir, { recursive: true, force: true });
  const dirs = {
    outDir,
    screenshots: path.join(outDir, "screenshots"),
    states: path.join(outDir, "states"),
    videos: path.join(outDir, "videos")
  };
  ensureDir(dirs.screenshots);
  ensureDir(dirs.states);
  if (config.recordVideo) ensureDir(dirs.videos);

  const manifest = {
    tool: "capture-motion",
    version: 1,
    label: config.label || "",
    url: config.url,
    createdAt: new Date().toISOString(),
    viewport: config.viewport || null,
    frames: [],
    actions: [],
    cdpAnimations: [],
    videos: [],
    network: [],
    consoleErrors: [],
    pageErrors: [],
    failedRequests: [],
    httpErrors: []
  };

  const browser = await chromium.launch({ headless: config.headless !== false });
  const context = await browser.newContext({
    viewport: config.viewport || { width: 1440, height: 1200 },
    deviceScaleFactor: config.deviceScaleFactor || 1,
    serviceWorkers: config.disableServiceWorkers === false ? "allow" : "block",
    recordVideo: config.recordVideo ? { dir: dirs.videos, size: config.viewport || { width: 1440, height: 1200 } } : undefined
  });
  if (config.trace) await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
  const page = await context.newPage();
  hookPage(page, manifest);
  const recordedVideo = page.video ? page.video() : null;
  const cdp = await maybeCdp(page);
  const cdpState = cdp ? { session: cdp, animationIds: new Set() } : null;
  if (cdp) {
    cdp.on("Animation.animationStarted", (event) => {
      if (event.animation?.id) cdpState.animationIds.add(event.animation.id);
      manifest.cdpAnimations.push({ type: "animationStarted", timestamp: new Date().toISOString(), event });
    });
  }

  await page.goto(config.url, { waitUntil: config.waitUntil || "networkidle", timeout: config.timeout || 45_000 });
  if (config.waitFor) await page.waitForSelector(config.waitFor, { state: "visible", timeout: config.timeout || 45_000 });

  for (const state of config.states || [{ id: "default" }]) {
    const stateId = slug(state.id);
    if (state.waitFor) await page.waitForSelector(state.waitFor, { state: state.waitForState || "visible", timeout: state.timeout || 10_000 });
    await captureFrame(page, dirs, state, { name: "before", assertions: state.beforeAssertions || [] }, config, manifest, cdpState);
    for (let index = 0; index < (state.actions || []).length; index += 1) {
      const action = state.actions[index];
      const before = await collectMetrics(page, selectorList(config, state));
      const cdpBefore = await getCdpAnimationSnapshot(cdpState);
      const startedAt = new Date().toISOString();
      await runAction(page, action, cdpState);
      const after = await collectMetrics(page, selectorList(config, state));
      const cdpAfter = await getCdpAnimationSnapshot(cdpState);
      manifest.actions.push({ state: stateId, index, action, startedAt, endedAt: new Date().toISOString(), before, after, cdpBefore, cdpAfter });
      if (action.capture) await captureFrame(page, dirs, state, { name: action.capture === true ? `after-action-${index + 1}` : action.capture }, config, manifest, cdpState);
    }
    const frames = state.frames || [{ name: "after", delay: 0 }];
    for (const frame of frames) {
      if (frame.delay) await page.waitForTimeout(frame.delay);
      await captureFrame(page, dirs, state, frame, config, manifest, cdpState);
    }
  }

  if (config.trace) await context.tracing.stop({ path: path.join(outDir, "trace.zip") });
  await context.close();
  if (recordedVideo) {
    try {
      const videoPath = await recordedVideo.path();
      manifest.videos.push({ path: path.relative(outDir, videoPath), absolutePath: videoPath });
    } catch (error) {
      manifest.videos.push({ error: String(error.message || error) });
    }
  }
  await browser.close();
  fs.writeFileSync(path.join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2));
  const summary = {
    outDir,
    frames: manifest.frames.length,
    assertionsFailed: manifest.frames.flatMap((frame) => frame.assertions.filter((item) => !item.ok)).length,
    consoleErrors: manifest.consoleErrors.length,
    pageErrors: manifest.pageErrors.length,
    failedRequests: manifest.failedRequests.length,
    httpErrors: manifest.httpErrors.length
  };
  console.log(JSON.stringify(summary, null, 2));
  if (!config.allowFailures && (summary.assertionsFailed || summary.consoleErrors || summary.pageErrors || summary.failedRequests || summary.httpErrors)) process.exit(1);
})();
