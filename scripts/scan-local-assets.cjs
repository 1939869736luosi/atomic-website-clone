#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");

function usage() {
  console.log(`Usage:
  node scan-local-assets.cjs --root path/to/public --out /tmp/asset-scan

Options:
  --allow-remote example.com,fonts.gstatic.com
  --allow-pwa-leftovers
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

function walk(dir, files = []) {
  for (const name of fs.readdirSync(dir)) {
    const file = path.join(dir, name);
    const stat = fs.statSync(file);
    if (stat.isDirectory()) walk(file, files);
    else files.push(file);
  }
  return files;
}

function shouldRead(file) {
  return /\.(html?|css|js|mjs|cjs|json|svg|txt|md)$/i.test(file);
}

function stripFragment(value) {
  return value.split("#")[0].split("?")[0];
}

function isIgnored(value) {
  return !value
    || value.startsWith("#")
    || value.startsWith("data:")
    || value.startsWith("mailto:")
    || value.startsWith("tel:")
    || value.startsWith("javascript:")
    || value.startsWith("blob:")
    || value.startsWith("about:");
}

function remoteHost(value) {
  try {
    if (/^\/\//.test(value)) return new URL(`https:${value}`).host;
    if (/^https?:\/\//i.test(value)) return new URL(value).host;
  } catch (_error) {}
  return "";
}

function extractRefs(content) {
  const refs = [];
  const patterns = [
    /\b(?:src|href|poster|data-src|data-href)=["']([^"']+)["']/gi,
    /url\(\s*["']?([^"')]+)["']?\s*\)/gi,
    /\b(?:import|from)\s+["']([^"']+)["']/gi,
    /\b(?:fetch|import)\(\s*["']([^"']+)["']\s*\)/gi
  ];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(content))) refs.push(match[1]);
  }
  const srcsetPattern = /\b(?:srcset|imagesrcset)=["']([^"']+)["']/gi;
  let srcsetMatch;
  while ((srcsetMatch = srcsetPattern.exec(content))) {
    for (const candidate of srcsetMatch[1].split(",")) {
      const ref = candidate.trim().split(/\s+/)[0];
      if (ref) refs.push(ref);
    }
  }
  return refs;
}

function resolveLocal(root, sourceFile, ref) {
  const clean = stripFragment(ref);
  if (!clean || isIgnored(clean)) return null;
  if (remoteHost(clean)) return null;
  if (clean.startsWith("/")) return path.join(root, clean.slice(1));
  return path.resolve(path.dirname(sourceFile), clean);
}

function writeMarkdown(file, report) {
  const lines = [];
  lines.push("# Local Asset Scan", "");
  lines.push(`- Root: \`${report.root}\``);
  lines.push(`- Files scanned: ${report.filesScanned}`);
  lines.push(`- References found: ${report.references.length}`);
  lines.push(`- Missing local references: ${report.missing.length}`);
  lines.push(`- Unexpected remote references: ${report.remote.length}`);
  lines.push(`- PWA/feed leftovers: ${report.pwaLeftovers.length}`, "");
  if (report.missing.length) {
    lines.push("## Missing", "");
    for (const item of report.missing) lines.push(`- ${item.ref} in \`${item.source}\``);
    lines.push("");
  }
  if (report.remote.length) {
    lines.push("## Remote", "");
    for (const item of report.remote) lines.push(`- ${item.ref} in \`${item.source}\``);
    lines.push("");
  }
  if (report.pwaLeftovers.length) {
    lines.push("## PWA Or Feed Leftovers", "");
    for (const item of report.pwaLeftovers) lines.push(`- \`${item}\``);
    lines.push("");
  }
  fs.writeFileSync(file, `${lines.join("\n")}\n`);
}

const args = parseArgs(process.argv);
if (args.help || !args.root) {
  usage();
  process.exit(args.help ? 0 : 1);
}

const root = path.resolve(args.root);
const outDir = path.resolve(args.out || path.join(process.cwd(), ".asset-scan"));
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
const allowRemote = new Set(String(args["allow-remote"] || "").split(",").map((item) => item.trim()).filter(Boolean));
const files = walk(root);
const report = {
  tool: "scan-local-assets",
  version: 1,
  createdAt: new Date().toISOString(),
  root,
  filesScanned: 0,
  references: [],
  missing: [],
  remote: [],
  pwaLeftovers: []
};

for (const file of files) {
  const rel = path.relative(root, file).replaceAll(path.sep, "/");
  if (!args["allow-pwa-leftovers"] && /(^|\/)(manifest\.json|site\.webmanifest|sw\.js|service-worker\.js|rss\.xml|feed\.xml|atom\.xml)$/i.test(rel)) {
    report.pwaLeftovers.push(rel);
  }
  if (!shouldRead(file)) continue;
  report.filesScanned += 1;
  const content = fs.readFileSync(file, "utf8");
  for (const ref of extractRefs(content)) {
    if (isIgnored(ref)) continue;
    const host = remoteHost(ref);
    const item = { source: rel, ref };
    report.references.push(item);
    if (host) {
      if (!allowRemote.has(host)) report.remote.push({ ...item, host });
      continue;
    }
    const target = resolveLocal(root, file, ref);
    if (target && !fs.existsSync(target)) report.missing.push({ ...item, resolved: path.relative(root, target).replaceAll(path.sep, "/") });
  }
}

report.failed = report.missing.length + report.remote.length + (args["allow-pwa-leftovers"] ? 0 : report.pwaLeftovers.length);
fs.writeFileSync(path.join(outDir, "report.json"), JSON.stringify(report, null, 2));
writeMarkdown(path.join(outDir, "report.md"), report);
console.log(JSON.stringify({
  outDir,
  failed: report.failed,
  filesScanned: report.filesScanned,
  refs: report.references.length,
  missing: report.missing.length,
  remote: report.remote.length,
  pwaLeftovers: report.pwaLeftovers.length
}, null, 2));
if (report.failed) process.exit(1);
