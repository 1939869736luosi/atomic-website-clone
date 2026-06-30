#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");

function usage() {
  console.log(`Usage:
  node review-pack.cjs --source /tmp/source-capture --local /tmp/local-capture --compare /tmp/motion-compare --out /tmp/review-pack

Optional:
  --summary path/to/VERIFY.md
  --previous-failures path/to/failures.md
  --discovery /tmp/discovery-or-report.json
  --inventory path/to/state-inventory.json
  --state-check /tmp/state-check-or-report.json
  --compare /tmp/motion-compare
  --diff /tmp/motion-compare   Alias for --compare
  --strict                      Exit non-zero when supplied reports contain failures
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

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function readRequiredJson(label, file) {
  const resolved = path.resolve(file);
  if (!fs.existsSync(resolved)) throw new Error(`${label} file does not exist: ${resolved}`);
  return JSON.parse(fs.readFileSync(resolved, "utf8"));
}

function readRequiredText(label, file) {
  if (!file) return "";
  const resolved = path.resolve(file);
  if (!fs.existsSync(resolved)) throw new Error(`${label} file does not exist: ${resolved}`);
  return fs.readFileSync(resolved, "utf8");
}

function readOptionalJson(label, fileOrDir, defaultName = "report.json") {
  if (!fileOrDir) return null;
  const resolved = path.resolve(fileOrDir);
  const file = fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()
    ? path.join(resolved, defaultName)
    : resolved;
  if (!fs.existsSync(file)) throw new Error(`${label} file does not exist: ${file}`);
  return { file, data: JSON.parse(fs.readFileSync(file, "utf8")) };
}

function rel(from, to) {
  return path.relative(from, to).replaceAll(path.sep, "/");
}

function hasNonEmptyFile(file) {
  try {
    const stat = fs.statSync(file);
    return stat.isFile() && stat.size > 0;
  } catch (_error) {
    return false;
  }
}

function frameRows(captureDir, manifest, packDir, label) {
  return (manifest.frames || []).map((frame) => {
    const screenshot = path.join(captureDir, frame.screenshot || "");
    const link = frame.screenshot && hasNonEmptyFile(screenshot) ? `[image](${rel(packDir, screenshot)})` : "MISSING";
    const assertions = (frame.assertions || []).length ? `${frame.assertions.filter((item) => item.ok).length}/${frame.assertions.length}` : "n/a";
    const selectors = (frame.metrics?.selectors || []).map((item) => `${item.name}:${item.visible ? "visible" : "hidden"}#${item.count}`).join(", ");
    return `| ${label} | ${frame.id} | ${frame.frame} | ${assertions} | ${selectors.slice(0, 220)} | ${link} |`;
  });
}

function writePack(args) {
  const sourceDir = path.resolve(args.source);
  const localDir = path.resolve(args.local);
  const compareArg = args.compare || args.diff || "";
  const compareDir = compareArg ? path.resolve(compareArg) : "";
  const outDir = path.resolve(args.out || path.join(process.cwd(), ".review-pack"));
  fs.rmSync(outDir, { recursive: true, force: true });
  ensureDir(outDir);

  const sourceManifest = readRequiredJson("source manifest", path.join(sourceDir, "manifest.json"));
  const localManifest = readRequiredJson("local manifest", path.join(localDir, "manifest.json"));
  const compareReport = compareDir ? readRequiredJson("compare report", path.join(compareDir, "report.json")) : null;
  const discoveryReport = readOptionalJson("discovery report", args.discovery);
  const inventoryReport = args.inventory ? readOptionalJson("inventory", args.inventory, path.basename(args.inventory)) : null;
  const stateCheckReport = readOptionalJson("state-check report", args["state-check"]);
  const summary = readRequiredText("summary", args.summary);
  const failures = readRequiredText("previous-failures", args["previous-failures"]);
  const blocking = [];
  const sourceMissingScreenshots = (sourceManifest.frames || []).filter((frame) => !frame.screenshot || !hasNonEmptyFile(path.join(sourceDir, frame.screenshot)));
  const localMissingScreenshots = (localManifest.frames || []).filter((frame) => !frame.screenshot || !hasNonEmptyFile(path.join(localDir, frame.screenshot)));
  if (args.strict && !discoveryReport) blocking.push("strict mode requires --discovery");
  if (args.strict && !inventoryReport) blocking.push("strict mode requires --inventory");
  if (args.strict && !stateCheckReport) blocking.push("strict mode requires --state-check");
  if (args.strict && !compareReport) blocking.push("strict mode requires --compare or --diff");
  if (args.strict && !summary.trim()) blocking.push("strict mode requires non-empty --summary");
  if (compareReport?.failed) blocking.push(`visual compare failed=${compareReport.failed}`);
  if (stateCheckReport?.data?.failed) blocking.push(`state check failed=${stateCheckReport.data.failed}`);
  if (discoveryReport && !inventoryReport) blocking.push("discovery supplied without inventory");
  if (discoveryReport && !stateCheckReport) blocking.push("discovery supplied without state-check report");
  if (sourceMissingScreenshots.length) blocking.push(`source missing screenshot evidence=${sourceMissingScreenshots.length}`);
  if (localMissingScreenshots.length) blocking.push(`local missing screenshot evidence=${localMissingScreenshots.length}`);
  if ((localManifest.consoleErrors || []).length || (localManifest.pageErrors || []).length || (localManifest.failedRequests || []).length || (localManifest.httpErrors || []).length) {
    blocking.push("local browser/runtime errors present");
  }

  const lines = [];
  lines.push("# Atomic Website Clone Review Pack", "");
  lines.push("## Inputs", "");
  lines.push(`- Source capture: \`${sourceDir}\``);
  lines.push(`- Local capture: \`${localDir}\``);
  if (compareDir) lines.push(`- Compare report: \`${compareDir}\``);
  if (discoveryReport) lines.push(`- Discovery report: \`${discoveryReport.file}\``);
  if (inventoryReport) lines.push(`- State inventory: \`${inventoryReport.file}\``);
  if (stateCheckReport) lines.push(`- State check report: \`${stateCheckReport.file}\``);
  if (args.summary) lines.push(`- Verification summary: \`${path.resolve(args.summary)}\``);
  if (args["previous-failures"]) lines.push(`- Previous failures: \`${path.resolve(args["previous-failures"])}\``);
  lines.push("");

  lines.push("## Blocking Gates", "");
  if (blocking.length) {
    for (const item of blocking) lines.push(`- FAIL: ${item}`);
  } else {
    lines.push("- PASS: supplied compare/state/discovery gates do not report blocking failures");
  }
  lines.push("");

  lines.push("## PASS/FAIL Questions For Reviewers", "");
  lines.push("- Did the discovery report run before implementation and did all high-confidence candidates enter inventory or exclusions?");
  lines.push("- Do trigger-after states have source/local screenshots and operation traces, not just text smoke tests?");
  lines.push("- Do source and local dynamic state counts match?");
  lines.push("- Do lazy panels remain hidden until the same trigger reveals them?");
  lines.push("- Do internal scroll panes actually scroll, with scrollTop/scrollLeft evidence?");
  lines.push("- Do videos or animations show playback/frame progress?");
  lines.push("- Do key screenshots and diff images support the claimed match?");
  lines.push("- Are there console, page, request, or HTTP errors?");
  lines.push("- Are temporary files excluded from the final product?");
  lines.push("");

  lines.push("## Capture Summary", "");
  lines.push("| Capture | Frames | Missing screenshots | Console errors | Page errors | Failed requests | HTTP errors |");
  lines.push("| --- | ---: | ---: | ---: | ---: | ---: | ---: |");
  lines.push(`| Source | ${(sourceManifest.frames || []).length} | ${sourceMissingScreenshots.length} | ${(sourceManifest.consoleErrors || []).length} | ${(sourceManifest.pageErrors || []).length} | ${(sourceManifest.failedRequests || []).length} | ${(sourceManifest.httpErrors || []).length} |`);
  lines.push(`| Local | ${(localManifest.frames || []).length} | ${localMissingScreenshots.length} | ${(localManifest.consoleErrors || []).length} | ${(localManifest.pageErrors || []).length} | ${(localManifest.failedRequests || []).length} | ${(localManifest.httpErrors || []).length} |`);
  lines.push("");

  if (compareReport) {
    lines.push("## Visual Diff Summary", "");
    lines.push(`- Compared image pairs: ${compareReport.imagePairs.length}`);
    lines.push(`- Failed image pairs: ${compareReport.imagePairs.filter((item) => !item.ok).length}`);
    lines.push(`- Missing local images: ${compareReport.missingLocalImages.length}`);
    lines.push(`- Local assertion failures: ${compareReport.localAssertionFailures.length}`);
    lines.push("");
    lines.push("| Frame | Result | Mismatch | RMS | Diff |");
    lines.push("| --- | ---: | ---: | ---: | --- |");
    for (const item of compareReport.imagePairs) {
      const diff = item.diffFile && fs.existsSync(item.diffFile) ? `[diff](${rel(outDir, item.diffFile)})` : "";
      lines.push(`| ${path.basename(item.sourceFile)} | ${item.ok ? "PASS" : "FAIL"} | ${item.mismatchRatio.toFixed(5)} | ${item.rmsDelta.toFixed(5)} | ${diff} |`);
    }
    lines.push("");
  }

  if (discoveryReport) {
    const data = discoveryReport.data;
    lines.push("## Discovery Summary", "");
    lines.push(`- Candidates: ${data.summary?.candidates ?? (data.candidates || []).length}`);
    lines.push(`- High-confidence: ${data.summary?.highConfidence ?? "n/a"}`);
    lines.push(`- Probe changed: ${data.summary?.probeChanged ?? "n/a"}`);
    lines.push(`- Unique probe changed: ${data.summary?.uniqueProbeChanged ?? "n/a"}`);
    lines.push(`- Trigger rescans: ${data.summary?.triggerRescans ?? "n/a"}`);
    lines.push(`- Scroll probes changed: ${data.summary?.scrollProbeChanged ?? "n/a"}`);
    lines.push(`- Motion samples changed: ${data.summary?.motionSamplesChanged ?? "n/a"}`);
    lines.push(`- Inventory seed states: ${data.summary?.inventorySeedStates ?? "n/a"}`);
    lines.push("");
    lines.push("| Candidate | Viewport | Scroll | Reasons | Probe | Selector |");
    lines.push("| --- | --- | ---: | --- | --- | --- |");
    for (const item of (data.candidates || []).filter((candidate) => candidate.probeChanged || candidate.confidence >= 4).slice(0, 80)) {
      const probe = item.probeChanged ? "changed" : item.probed ? "no-change" : "not-probed";
      lines.push(`| ${item.candidateKey || item.id || ""} | ${item.viewport || ""} | ${item.scrollFraction ?? ""} | ${(item.reasons || []).join(", ")} | ${probe} | \`${String(item.selector || "").replaceAll("|", "\\|").slice(0, 160)}\` |`);
    }
    lines.push("");
  }

  if (inventoryReport) {
    const data = inventoryReport.data;
    lines.push("## State Inventory Summary", "");
    lines.push(`- States: ${(data.states || []).length}`);
    lines.push(`- Excluded discovery candidates: ${(data.excludedDiscoveryCandidates || []).length}`);
    lines.push("");
  }

  if (stateCheckReport) {
    const data = stateCheckReport.data;
    lines.push("## State Check Summary", "");
    lines.push(`- Failed: ${data.failed}`);
    lines.push(`- Checks: ${(data.checks || []).length}`);
    lines.push("");
    lines.push("| Check | Result | Details |");
    lines.push("| --- | ---: | --- |");
    for (const item of (data.checks || []).filter((check) => !check.ok).slice(0, 80)) {
      lines.push(`| ${item.check.replaceAll("|", "\\|")} | FAIL | ${item.details.replaceAll("|", "\\|").slice(0, 260)} |`);
    }
    lines.push("");
  }

  lines.push("## Frame Evidence", "");
  lines.push("| Capture | State | Frame | Assertions | Selector snapshot | Screenshot |");
  lines.push("| --- | --- | --- | ---: | --- | --- |");
  lines.push(...frameRows(sourceDir, sourceManifest, outDir, "source"));
  lines.push(...frameRows(localDir, localManifest, outDir, "local"));
  lines.push("");

  if (failures) {
    lines.push("## Previous Failures", "");
    lines.push(failures.trim(), "");
  }
  if (summary) {
    lines.push("## Current Verification Summary", "");
    lines.push(summary.trim(), "");
  }

  lines.push("## Reviewer Decision", "");
  lines.push("- Visual/state reviewer: PASS / FAIL");
  lines.push("- Integrity reviewer: PASS / FAIL");
  lines.push("- Blocking issues:");
  lines.push("");

  fs.writeFileSync(path.join(outDir, "REVIEW_PACK.md"), `${lines.join("\n")}\n`);
  fs.writeFileSync(path.join(outDir, "review-pack.json"), JSON.stringify({
    sourceDir,
    localDir,
    compareDir,
    discovery: discoveryReport ? discoveryReport.file : "",
    inventory: inventoryReport ? inventoryReport.file : "",
    stateCheck: stateCheckReport ? stateCheckReport.file : "",
    blocking,
    sourceFrames: (sourceManifest.frames || []).length,
    localFrames: (localManifest.frames || []).length,
    compareFailed: compareReport ? compareReport.failed : null
  }, null, 2));
  console.log(JSON.stringify({ outDir, reviewPack: path.join(outDir, "REVIEW_PACK.md") }, null, 2));
  if (args.strict && blocking.length) process.exit(1);
}

const args = parseArgs(process.argv);
if (args.help || !args.source || !args.local) {
  usage();
  process.exit(args.help ? 0 : 1);
}
writePack(args);
