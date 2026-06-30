#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

function usage() {
  console.log(`Usage:
  node compare-video-quality.cjs --source source.mp4 --local local.mp4 --out /tmp/video-quality

Options:
  --fps 30
  --width 1280
  --height 720
  --ssim-threshold 0.98
  --psnr-threshold 30
  --vmaf-threshold 90
  --require-vmaf
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

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", maxBuffer: 1024 * 1024 * 24, ...options });
  return {
    command,
    args,
    status: result.status,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    ok: result.status === 0
  };
}

function ffprobe(file) {
  const result = run("ffprobe", [
    "-v", "error",
    "-select_streams", "v:0",
    "-show_entries", "stream=width,height,r_frame_rate,duration",
    "-of", "json",
    file
  ]);
  if (!result.ok) return null;
  try {
    const data = JSON.parse(result.stdout);
    return data.streams?.[0] || null;
  } catch (_error) {
    return null;
  }
}

function hasFilter(name) {
  const result = run("ffmpeg", ["-hide_banner", "-filters"]);
  return result.stdout.includes(` ${name} `) || result.stdout.includes(` ${name.padEnd(17, " ")}`);
}

function escapeFilterPath(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/'/g, "\\'");
}

function prepFilter(width, height, fps) {
  const common = `settb=AVTB,setpts=PTS-STARTPTS,fps=${fps},scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black,format=yuv420p`;
  return `[0:v]${common}[ref];[1:v]${common}[dist]`;
}

function parseLastFloat(regex, text) {
  let match;
  let value = null;
  while ((match = regex.exec(text))) {
    const raw = String(match[1] || "");
    value = raw.toLowerCase() === "inf" ? Infinity : Number(raw);
  }
  return Number.isFinite(value) || value === Infinity ? value : null;
}

function isMetricValue(value) {
  return Number.isFinite(value) || value === Infinity;
}

function displayMetricValue(value, decimals = 2) {
  if (value === Infinity) return "inf";
  return Number.isFinite(value) ? value.toFixed(decimals) : "n/a";
}

function metricCommand(source, local, filter, reportFile) {
  const result = run("ffmpeg", [
    "-hide_banner",
    "-nostats",
    "-i", source,
    "-i", local,
    "-lavfi", filter,
    "-an",
    "-f", "null",
    "-"
  ]);
  fs.writeFileSync(reportFile, `${result.stdout}\n${result.stderr}`);
  return result;
}

function runSsim(source, local, outDir, width, height, fps) {
  const stats = path.join(outDir, "ssim.log");
  const log = path.join(outDir, "ssim.stderr.log");
  const filter = `${prepFilter(width, height, fps)};[ref][dist]ssim=stats_file='${escapeFilterPath(stats)}'`;
  const result = metricCommand(source, local, filter, log);
  return {
    ok: result.ok,
    value: parseLastFloat(/All:([0-9.]+)/g, result.stderr),
    stats,
    log,
    stderrTail: result.stderr.split("\n").slice(-8).join("\n")
  };
}

function runPsnr(source, local, outDir, width, height, fps) {
  const stats = path.join(outDir, "psnr.log");
  const log = path.join(outDir, "psnr.stderr.log");
  const filter = `${prepFilter(width, height, fps)};[ref][dist]psnr=stats_file='${escapeFilterPath(stats)}'`;
  const result = metricCommand(source, local, filter, log);
  return {
    ok: result.ok,
    value: parseLastFloat(/average:([0-9.]+|inf)/gi, result.stderr),
    stats,
    log,
    stderrTail: result.stderr.split("\n").slice(-8).join("\n")
  };
}

function runXpsnr(source, local, outDir, width, height, fps) {
  const log = path.join(outDir, "xpsnr.stderr.log");
  const filter = `${prepFilter(width, height, fps)};[ref][dist]xpsnr`;
  const result = metricCommand(source, local, filter, log);
  return {
    ok: result.ok,
    value: parseLastFloat(/average:([0-9.]+|inf)/gi, result.stderr) ?? parseLastFloat(/XPSNR.*?([0-9]+(?:\.[0-9]+)?|inf)/gi, result.stderr),
    log,
    stderrTail: result.stderr.split("\n").slice(-8).join("\n")
  };
}

function runVmaf(source, local, outDir, width, height, fps) {
  const json = path.join(outDir, "vmaf.json");
  const log = path.join(outDir, "vmaf.stderr.log");
  const filter = `${prepFilter(width, height, fps)};[ref][dist]libvmaf=log_path='${escapeFilterPath(json)}':log_fmt=json`;
  const result = metricCommand(source, local, filter, log);
  let value = null;
  let parsed = null;
  if (fs.existsSync(json)) {
    try {
      parsed = JSON.parse(fs.readFileSync(json, "utf8"));
      value = parsed.pooled_metrics?.vmaf?.mean;
      if (!Number.isFinite(value) && Array.isArray(parsed.frames) && parsed.frames.length) {
        const values = parsed.frames.map((frame) => frame.metrics?.vmaf).filter(Number.isFinite);
        value = values.length ? values.reduce((sum, item) => sum + item, 0) / values.length : null;
      }
    } catch (_error) {}
  }
  return {
    ok: result.ok,
    value: Number.isFinite(value) ? value : null,
    json,
    log,
    stderrTail: result.stderr.split("\n").slice(-8).join("\n")
  };
}

function writeMarkdown(file, report) {
  const lines = [];
  lines.push("# Video Quality Report", "");
  lines.push(`- Source: \`${report.source}\``);
  lines.push(`- Local: \`${report.local}\``);
  lines.push(`- Normalized size: ${report.normalized.width}x${report.normalized.height} @ ${report.normalized.fps}fps`);
  lines.push(`- Failed: ${report.failed}`, "");
  lines.push("| Metric | Value | Threshold | Result |");
  lines.push("| --- | ---: | ---: | ---: |");
  for (const metric of report.metrics) {
    const value = displayMetricValue(metric.value, metric.name === "ssim" ? 5 : 2);
    const threshold = Number.isFinite(metric.threshold) ? metric.threshold : "n/a";
    lines.push(`| ${metric.name} | ${value} | ${threshold} | ${metric.passed ? "PASS" : "FAIL"} |`);
  }
  if (report.notes.length) {
    lines.push("", "## Notes", "");
    for (const note of report.notes) lines.push(`- ${note}`);
  }
  fs.writeFileSync(file, `${lines.join("\n")}\n`);
}

const args = parseArgs(process.argv);
if (args.help || !args.source || !args.local) {
  usage();
  process.exit(args.help ? 0 : 1);
}

const source = path.resolve(args.source);
const local = path.resolve(args.local);
const outDir = path.resolve(args.out || path.join(process.cwd(), ".video-quality"));
fs.rmSync(outDir, { recursive: true, force: true });
ensureDir(outDir);

const sourceInfo = ffprobe(source);
const localInfo = ffprobe(local);
const width = Number(args.width || sourceInfo?.width || localInfo?.width || 1280);
const height = Number(args.height || sourceInfo?.height || localInfo?.height || 720);
const fps = Number(args.fps || 30);
const thresholds = {
  ssim: Number(args["ssim-threshold"] || 0.98),
  psnr: Number(args["psnr-threshold"] || 30),
  vmaf: Number(args["vmaf-threshold"] || 90),
  xpsnr: args["xpsnr-threshold"] ? Number(args["xpsnr-threshold"]) : null
};

const filters = {
  ssim: hasFilter("ssim"),
  psnr: hasFilter("psnr"),
  libvmaf: hasFilter("libvmaf"),
  xpsnr: hasFilter("xpsnr")
};

const notes = [];
const metrics = [];
if (filters.ssim) {
  const metric = runSsim(source, local, outDir, width, height, fps);
  metrics.push({ name: "ssim", threshold: thresholds.ssim, ...metric, passed: Number.isFinite(metric.value) && metric.value >= thresholds.ssim });
} else notes.push("FFmpeg ssim filter is unavailable.");
if (filters.psnr) {
  const metric = runPsnr(source, local, outDir, width, height, fps);
  metrics.push({ name: "psnr", threshold: thresholds.psnr, ...metric, passed: isMetricValue(metric.value) && metric.value >= thresholds.psnr });
} else notes.push("FFmpeg psnr filter is unavailable.");
if (filters.libvmaf) {
  const metric = runVmaf(source, local, outDir, width, height, fps);
  metrics.push({ name: "vmaf", threshold: thresholds.vmaf, ...metric, passed: Number.isFinite(metric.value) && metric.value >= thresholds.vmaf });
} else {
  notes.push("FFmpeg libvmaf filter is unavailable.");
  if (args["require-vmaf"]) metrics.push({ name: "vmaf", threshold: thresholds.vmaf, ok: false, value: null, passed: false });
}
if (filters.xpsnr) {
  const metric = runXpsnr(source, local, outDir, width, height, fps);
  metrics.push({ name: "xpsnr", threshold: thresholds.xpsnr, ...metric, passed: thresholds.xpsnr === null ? metric.ok : isMetricValue(metric.value) && metric.value >= thresholds.xpsnr });
}

const report = {
  tool: "compare-video-quality",
  version: 1,
  createdAt: new Date().toISOString(),
  source,
  local,
  outDir,
  sourceInfo,
  localInfo,
  normalized: { width, height, fps },
  filters,
  thresholds,
  metrics,
  notes
};
report.failed = metrics.filter((metric) => !metric.passed).length;
fs.writeFileSync(path.join(outDir, "report.json"), JSON.stringify(report, (key, value) => value === Infinity ? "inf" : value, 2));
writeMarkdown(path.join(outDir, "report.md"), report);
console.log(JSON.stringify({
  outDir,
  failed: report.failed,
  metrics: metrics.map((metric) => ({ name: metric.name, value: metric.value, threshold: metric.threshold, passed: metric.passed }))
}, (key, value) => value === Infinity ? "inf" : value, 2));
if (report.failed) process.exit(1);
