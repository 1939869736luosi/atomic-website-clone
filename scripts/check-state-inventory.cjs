#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");

function usage() {
  console.log(`Usage:
  node check-state-inventory.cjs --source /tmp/source-capture --local /tmp/local-capture --out /tmp/state-check

Optional:
  --inventory path/to/state-inventory.json
  --discovery /tmp/discovery-or-report.json
  --require-discovery
  --allow-extra-local

Inventory shape:
{
  "states": [
    {
      "id": "hero-menu-open",
      "frames": ["before", "after"],
      "selectors": [
        { "name": "menu", "count": 1, "visible": true },
        { "name": "slides", "countMatch": true }
      ]
    }
  ]
}
`);
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

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function frameKey(frame) {
  return `${frame.id}__${frame.frame}`;
}

function indexFrames(manifest) {
  return new Map((manifest.frames || []).map((frame) => [frameKey(frame), frame]));
}

function frameIds(manifest) {
  return new Set((manifest.frames || []).map((frame) => frame.id));
}

function selectorByName(frame, name) {
  return (frame.metrics?.selectors || []).find((item) => item.name === name || item.selector === name) || null;
}

function screenshotExists(captureDir, frame) {
  if (!frame?.screenshot) return false;
  const resolved = path.resolve(captureDir, frame.screenshot);
  try {
    const stat = fs.statSync(resolved);
    return stat.isFile() && stat.size > 0;
  } catch (_error) {
    return false;
  }
}

function actionStates(manifest) {
  return new Set((manifest.actions || []).map((item) => item.state).filter(Boolean));
}

function normalizeInventory(file) {
  if (!file) return [];
  const data = readJson(path.resolve(file));
  if (Array.isArray(data)) return data;
  if (Array.isArray(data.states)) return data.states;
  throw new Error("inventory must be an array or an object with a states array");
}

function normalizeInventoryObject(file) {
  if (!file) return { states: [], excludedDiscoveryCandidates: [] };
  const data = readJson(path.resolve(file));
  if (Array.isArray(data)) return { states: data, excludedDiscoveryCandidates: [] };
  if (Array.isArray(data.states)) return data;
  throw new Error("inventory must be an array or an object with a states array");
}

function normalizeDiscovery(fileOrDir) {
  if (!fileOrDir) return null;
  const resolved = path.resolve(fileOrDir);
  const file = fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()
    ? path.join(resolved, "report.json")
    : resolved;
  const data = readJson(file);
  if (!Array.isArray(data.candidates)) throw new Error("discovery report must contain candidates[]");
  return { file, data };
}

function isHighConfidenceDiscovery(candidate) {
  return Boolean(
    candidate.probeChanged ||
    candidate.confidence >= 4 ||
    candidate.reasons?.includes("scroll-x") ||
    candidate.reasons?.includes("scroll-y")
  );
}

function evidenceExists(baseDir, evidence) {
  if (!evidence) return false;
  if (/^https?:\/\//i.test(evidence)) return true;
  const resolved = path.resolve(baseDir || process.cwd(), evidence);
  try {
    const stat = fs.statSync(resolved);
    return stat.isFile() && stat.size > 0;
  } catch (_error) {
    return false;
  }
}

function normalizeExclusion(item, baseDir) {
  if (typeof item === "string") {
    return { id: item, valid: false, reason: "", evidence: "", raw: item };
  }
  const reason = String(item.reason || item.why || "").trim();
  const evidence = String(item.evidence || item.screenshot || item.proof || item.approvedBy || item.note || "").trim();
  return {
    id: item.id || "",
    candidateKey: item.candidateKey || "",
    selector: item.selector || "",
    valid: Boolean(reason && evidence && evidenceExists(baseDir, evidence)),
    reason,
    evidence,
    raw: item
  };
}

function inventoryDiscoveryCoverage(inventoryObject, inventoryFile) {
  const selectors = new Set();
  const ids = new Set();
  const excluded = new Set();
  const exclusions = [];
  const states = inventoryObject.states || [];
  const baseDir = inventoryFile ? path.dirname(path.resolve(inventoryFile)) : process.cwd();
  for (const state of states) {
    for (const selector of state.selectors || []) {
      if (selector.selector) selectors.add(selector.selector);
      if (selector.name) selectors.add(selector.name);
    }
    for (const selector of state.discoverySelectors || []) selectors.add(selector);
    for (const id of state.discoveryCandidateIds || []) ids.add(id);
    if (state.discoveryCandidateId) ids.add(state.discoveryCandidateId);
  }
  for (const item of inventoryObject.excludedDiscoveryCandidates || []) {
    const exclusion = normalizeExclusion(item, baseDir);
    exclusions.push(exclusion);
    if (!exclusion.valid) continue;
    if (exclusion.id) excluded.add(exclusion.id);
    if (exclusion.candidateKey) excluded.add(exclusion.candidateKey);
    if (exclusion.selector) excluded.add(exclusion.selector);
  }
  return { selectors, ids, excluded, exclusions };
}

function discoveryScrollProbeMap(discoveryData) {
  const map = new Map();
  for (const group of discoveryData.scrollProbes || []) {
    for (const item of group.results || []) {
      if (item.candidateKey) map.set(item.candidateKey, item);
      if (item.selector) map.set(item.selector, item);
    }
  }
  return map;
}

function writeMarkdown(file, report) {
  const lines = [];
  lines.push("# State Inventory Check", "");
  lines.push(`- Source: \`${report.sourceDir}\``);
  lines.push(`- Local: \`${report.localDir}\``);
  lines.push(`- Failed: ${report.failed}`, "");
  lines.push("| Check | Result | Details |");
  lines.push("| --- | ---: | --- |");
  for (const item of report.checks) {
    lines.push(`| ${item.check} | ${item.ok ? "PASS" : "FAIL"} | ${item.details.replaceAll("\n", " ")} |`);
  }
  fs.writeFileSync(file, `${lines.join("\n")}\n`);
}

const args = parseArgs(process.argv);
if (args.help || !args.source || !args.local) {
  usage();
  process.exit(args.help ? 0 : 1);
}

const sourceDir = path.resolve(args.source);
const localDir = path.resolve(args.local);
const outDir = path.resolve(args.out || path.join(process.cwd(), ".state-inventory-check"));
fs.rmSync(outDir, { recursive: true, force: true });
ensureDir(outDir);

const sourceManifest = readJson(path.join(sourceDir, "manifest.json"));
const localManifest = readJson(path.join(localDir, "manifest.json"));
const sourceFrames = indexFrames(sourceManifest);
const localFrames = indexFrames(localManifest);
const sourceStateIds = frameIds(sourceManifest);
const localStateIds = frameIds(localManifest);
const sourceActionStates = actionStates(sourceManifest);
const localActionStates = actionStates(localManifest);
const inventoryObject = normalizeInventoryObject(args.inventory);
const inventory = inventoryObject.states || normalizeInventory(args.inventory);
const discovery = normalizeDiscovery(args.discovery);
const checks = [];

if (args["require-discovery"]) {
  checks.push({
    check: "discovery report provided",
    ok: Boolean(discovery),
    details: discovery ? discovery.file : "missing --discovery"
  });
  checks.push({
    check: "inventory provided for discovery gate",
    ok: Boolean(args.inventory),
    details: args.inventory ? path.resolve(args.inventory) : "missing --inventory"
  });
}

for (const key of sourceFrames.keys()) {
  const sourceFrame = sourceFrames.get(key);
  const localFrame = localFrames.get(key);
  checks.push({
    check: `local frame exists: ${key}`,
    ok: localFrames.has(key),
    details: localFrames.has(key) ? "matching local frame found" : "missing matching local frame"
  });
  checks.push({
    check: `source screenshot evidence exists: ${key}`,
    ok: screenshotExists(sourceDir, sourceFrame),
    details: sourceFrame?.screenshot ? sourceFrame.screenshot : "missing screenshot path"
  });
  checks.push({
    check: `local screenshot evidence exists: ${key}`,
    ok: screenshotExists(localDir, localFrame),
    details: localFrame?.screenshot ? localFrame.screenshot : "missing screenshot path"
  });
  if (sourceFrame) {
    checks.push({
      check: `source frame assertions ok: ${key}`,
      ok: sourceFrame.assertionsOk !== false && !(sourceFrame.assertions || []).some((item) => item.ok === false),
      details: `${(sourceFrame.assertions || []).filter((item) => item.ok === false).length} failed assertions`
    });
  }
  if (localFrame) {
    checks.push({
      check: `local frame assertions ok: ${key}`,
      ok: localFrame.assertionsOk !== false && !(localFrame.assertions || []).some((item) => item.ok === false),
      details: `${(localFrame.assertions || []).filter((item) => item.ok === false).length} failed assertions`
    });
  }
}

if (!args["allow-extra-local"]) {
  for (const key of localFrames.keys()) {
    checks.push({
      check: `no extra local frame: ${key}`,
      ok: sourceFrames.has(key),
      details: sourceFrames.has(key) ? "frame exists in source capture" : "local frame has no matching source frame"
    });
  }
}

for (const stateId of sourceStateIds) {
  checks.push({
    check: `local state exists: ${stateId}`,
    ok: localStateIds.has(stateId),
    details: localStateIds.has(stateId) ? "matching local state found" : "missing matching local state"
  });
}

if (!args["allow-extra-local"]) {
  for (const stateId of localStateIds) {
    checks.push({
      check: `no extra local state: ${stateId}`,
      ok: sourceStateIds.has(stateId),
      details: sourceStateIds.has(stateId) ? "state exists in source capture" : "local state has no matching source state"
    });
  }
}

for (const state of inventory) {
  const id = state.id;
  if (!id) {
    checks.push({ check: "inventory state id", ok: false, details: "state entry is missing id" });
    continue;
  }
  checks.push({
    check: `inventory source state exists: ${id}`,
    ok: sourceStateIds.has(id),
    details: sourceStateIds.has(id) ? "found in source capture" : "missing in source capture"
  });
  checks.push({
    check: `inventory local state exists: ${id}`,
    ok: localStateIds.has(id),
    details: localStateIds.has(id) ? "found in local capture" : "missing in local capture"
  });
  for (const frameName of state.frames || []) {
    const key = `${id}__${frameName}`;
    checks.push({
      check: `inventory frame exists: ${key}`,
      ok: sourceFrames.has(key) && localFrames.has(key),
      details: `source=${sourceFrames.has(key)} local=${localFrames.has(key)}`
    });
  }
  for (const selector of state.selectors || []) {
    const selectorName = selector.name || selector.selector;
    if (!selectorName) {
      checks.push({ check: `inventory selector for ${id}`, ok: false, details: "selector entry is missing name or selector" });
      continue;
    }
    const keys = (state.frames || []).length
      ? state.frames.map((frameName) => `${id}__${frameName}`)
      : Array.from(sourceFrames.keys()).filter((key) => key.startsWith(`${id}__`));
    for (const key of keys) {
      const sourceFrame = sourceFrames.get(key);
      const localFrame = localFrames.get(key);
      const sourceSelector = sourceFrame ? selectorByName(sourceFrame, selectorName) : null;
      const localSelector = localFrame ? selectorByName(localFrame, selectorName) : null;
      checks.push({
        check: `selector exists: ${key} ${selectorName}`,
        ok: Boolean(sourceSelector && localSelector),
        details: `source=${Boolean(sourceSelector)} local=${Boolean(localSelector)}`
      });
      if (!sourceSelector || !localSelector) continue;
      if ("count" in selector) {
        checks.push({
          check: `selector count expected: ${key} ${selectorName}`,
          ok: sourceSelector.count === selector.count && localSelector.count === selector.count,
          details: `expected=${selector.count} source=${sourceSelector.count} local=${localSelector.count}`
        });
      }
      if (selector.countMatch !== false) {
        checks.push({
          check: `selector count match: ${key} ${selectorName}`,
          ok: sourceSelector.count === localSelector.count,
          details: `source=${sourceSelector.count} local=${localSelector.count}`
        });
      }
      if ("visible" in selector) {
        checks.push({
          check: `selector visible expected: ${key} ${selectorName}`,
          ok: sourceSelector.visible === selector.visible && localSelector.visible === selector.visible,
          details: `expected=${selector.visible} source=${sourceSelector.visible} local=${localSelector.visible}`
        });
      }
    }
  }
  if ((state.actions || []).length) {
    checks.push({
      check: `source action trace exists: ${id}`,
      ok: sourceActionStates.has(id),
      details: sourceActionStates.has(id) ? "action trace found" : "missing source manifest action trace"
    });
    checks.push({
      check: `local action trace exists: ${id}`,
      ok: localActionStates.has(id),
      details: localActionStates.has(id) ? "action trace found" : "missing local manifest action trace"
    });
  }
  for (const assertion of state.requiredAssertions || []) {
    const selectorName = assertion.name || assertion.selector;
    const afterKey = `${id}__after`;
    const sourceFrame = sourceFrames.get(afterKey);
    const localFrame = localFrames.get(afterKey);
    const sourceSelector = sourceFrame ? selectorByName(sourceFrame, selectorName) : null;
    const localSelector = localFrame ? selectorByName(localFrame, selectorName) : null;
    if ("scrollTopGt" in assertion) {
      checks.push({
        check: `required source scrollTop: ${id} ${selectorName}`,
        ok: Boolean(sourceSelector?.scroll && sourceSelector.scroll.scrollTop > assertion.scrollTopGt),
        details: `expected>${assertion.scrollTopGt} actual=${sourceSelector?.scroll?.scrollTop}`
      });
      checks.push({
        check: `required local scrollTop: ${id} ${selectorName}`,
        ok: Boolean(localSelector?.scroll && localSelector.scroll.scrollTop > assertion.scrollTopGt),
        details: `expected>${assertion.scrollTopGt} actual=${localSelector?.scroll?.scrollTop}`
      });
    }
    if ("scrollLeftGt" in assertion) {
      checks.push({
        check: `required source scrollLeft: ${id} ${selectorName}`,
        ok: Boolean(sourceSelector?.scroll && sourceSelector.scroll.scrollLeft > assertion.scrollLeftGt),
        details: `expected>${assertion.scrollLeftGt} actual=${sourceSelector?.scroll?.scrollLeft}`
      });
      checks.push({
        check: `required local scrollLeft: ${id} ${selectorName}`,
        ok: Boolean(localSelector?.scroll && localSelector.scroll.scrollLeft > assertion.scrollLeftGt),
        details: `expected>${assertion.scrollLeftGt} actual=${localSelector?.scroll?.scrollLeft}`
      });
    }
  }
}

if (discovery) {
  const coverage = inventoryDiscoveryCoverage(inventoryObject, args.inventory);
  for (const exclusion of coverage.exclusions) {
    checks.push({
      check: `excluded discovery candidate has evidence: ${exclusion.id || exclusion.candidateKey || exclusion.selector || exclusion.raw}`,
      ok: exclusion.valid,
      details: exclusion.valid ? exclusion.reason : "exclusions require reason and a real evidence file/url"
    });
  }
  const scrollProbeMap = discoveryScrollProbeMap(discovery.data);
  const highCandidates = discovery.data.candidates.filter(isHighConfidenceDiscovery);
  const unique = new Map();
  for (const candidate of highCandidates) {
    const key = candidate.candidateKey || candidate.id || `${candidate.viewport || ""}|${candidate.scrollFraction ?? ""}|${candidate.selector || ""}`;
    if (!unique.has(key)) unique.set(key, candidate);
  }
  checks.push({
    check: "discovery high-confidence candidates present",
    ok: unique.size > 0,
    details: `high-confidence unique candidates=${unique.size}`
  });
  for (const [key, candidate] of unique) {
    const covered =
      coverage.ids.has(key) ||
      coverage.ids.has(candidate.id) ||
      coverage.selectors.has(candidate.selector) ||
      coverage.excluded.has(key) ||
      coverage.excluded.has(candidate.id) ||
      coverage.excluded.has(candidate.selector);
    checks.push({
      check: `discovery candidate classified: ${key}`,
      ok: covered,
      details: covered
        ? `selector=${candidate.selector || ""}`
        : `missing from inventory selectors/discoveryCandidateIds/excludedDiscoveryCandidates; selector=${candidate.selector || ""}`
    });
    if ((candidate.reasons || []).includes("scroll-x") || (candidate.reasons || []).includes("scroll-y")) {
      const scrollProbe = scrollProbeMap.get(key) || scrollProbeMap.get(candidate.selector);
      const excluded = coverage.excluded.has(key) || coverage.excluded.has(candidate.id) || coverage.excluded.has(candidate.selector);
      checks.push({
        check: `scroll discovery has scroll probe or valid exclusion: ${key}`,
        ok: Boolean(excluded || scrollProbe?.changed),
        details: scrollProbe ? `changed=${scrollProbe.changed}` : "missing scroll probe"
      });
    }
    if ((candidate.reasons || []).includes("motion") || (candidate.reasons || []).includes("media")) {
      const idCovered = Array.from(coverage.ids).includes(key) || Array.from(coverage.ids).includes(candidate.id);
      const selectorCovered = coverage.selectors.has(candidate.selector);
      const excluded = coverage.excluded.has(key) || coverage.excluded.has(candidate.id) || coverage.excluded.has(candidate.selector);
      const matchedStates = (inventoryObject.states || []).filter((state) =>
        (state.discoveryCandidateIds || []).includes(key) ||
        (state.discoveryCandidateIds || []).includes(candidate.id) ||
        (state.selectors || []).some((selector) => selector.selector === candidate.selector)
      );
      const hasMotionEvidence = matchedStates.some((state) =>
        (state.actions || []).length ||
        (state.evidence?.motionFrames || []).length >= 2 ||
        (state.requiredAssertions || []).some((assertion) =>
          "videoCurrentTimeGt" in assertion ||
          "videoReadyStateGte" in assertion ||
          "videoDurationGt" in assertion ||
          "animationCountGt" in assertion ||
          "motionFrameChanged" in assertion
        )
      );
      checks.push({
        check: `motion/media discovery has state evidence or valid exclusion: ${key}`,
        ok: Boolean(excluded || ((idCovered || selectorCovered) && hasMotionEvidence)),
        details: excluded ? "valid exclusion" : `covered=${idCovered || selectorCovered} motionEvidence=${hasMotionEvidence}`
      });
    }
  }
  const probeChanged = discovery.data.candidates.filter((candidate) => candidate.probeChanged);
  const triggerRescans = (discovery.data.probes || []).flatMap((group) => group.results || []).flatMap((item) => item.rescans || []);
  const scrollProbeChanged = (discovery.data.scrollProbes || []).flatMap((group) => group.results || []).filter((item) => item.changed);
  const motionChanged = (discovery.data.motionSamples || []).filter((item) => item.changed);
  checks.push({
    check: "discovery probe evidence exists",
    ok: probeChanged.length > 0 || !args["require-discovery"],
    details: `probeChanged=${probeChanged.length}`
  });
  checks.push({
    check: "discovery trigger rescan evidence exists",
    ok: triggerRescans.length > 0 || !args["require-discovery-deep"],
    details: `triggerRescans=${triggerRescans.length}`
  });
  checks.push({
    check: "scroll probes recorded",
    ok: (discovery.data.scrollProbes || []).length > 0 || !args["require-discovery"],
    details: `scrollProbeGroups=${(discovery.data.scrollProbes || []).length} changed=${scrollProbeChanged.length}`
  });
  checks.push({
    check: "motion samples recorded",
    ok: (discovery.data.motionSamples || []).length > 0 || !args["require-motion-samples"],
    details: `motionSamples=${(discovery.data.motionSamples || []).length} changed=${motionChanged.length}`
  });
}

const report = {
  tool: "check-state-inventory",
  version: 1,
  createdAt: new Date().toISOString(),
  sourceDir,
  localDir,
  inventory: args.inventory ? path.resolve(args.inventory) : "",
  discovery: discovery ? discovery.file : "",
  sourceFrames: sourceFrames.size,
  localFrames: localFrames.size,
  checks
};
report.failed = checks.filter((item) => !item.ok).length;
fs.writeFileSync(path.join(outDir, "report.json"), JSON.stringify(report, null, 2));
writeMarkdown(path.join(outDir, "report.md"), report);
console.log(JSON.stringify({
  outDir,
  failed: report.failed,
  checks: checks.length,
  sourceFrames: sourceFrames.size,
  localFrames: localFrames.size
}, null, 2));
if (report.failed) process.exit(1);
