#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

function usage() {
  console.log(`Usage:
  node compare-motion.cjs --source /tmp/source-capture --local /tmp/local-capture --out /tmp/motion-compare

Options:
  --max-mismatch-ratio 0.015   Fail image pair above this mismatch ratio
  --pixel-threshold 0.12       Per-pixel normalized color delta threshold
  --no-diff-images             Skip diff PNG generation
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

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function crcTable() {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
}

const CRC_TABLE = crcTable();

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function readUInt32(buffer, offset) {
  return buffer.readUInt32BE(offset);
}

function parsePng(file) {
  const buffer = fs.readFileSync(file);
  const signature = buffer.subarray(0, 8).toString("hex");
  if (signature !== "89504e470d0a1a0a") throw new Error(`${file} is not a PNG`);
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idat = [];
  while (offset < buffer.length) {
    const length = readUInt32(buffer, offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString("ascii");
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    offset += 12 + length;
    if (type === "IHDR") {
      width = readUInt32(data, 0);
      height = readUInt32(data, 4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      break;
    }
  }
  if (bitDepth !== 8) throw new Error(`${file} uses unsupported PNG bit depth ${bitDepth}`);
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 0 ? 1 : 0;
  if (!channels) throw new Error(`${file} uses unsupported PNG color type ${colorType}`);
  const inflated = zlib.inflateSync(Buffer.concat(idat));
  const bpp = channels;
  const stride = width * channels;
  const raw = Buffer.alloc(height * stride);
  let input = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = inflated[input++];
    const row = inflated.subarray(input, input + stride);
    input += stride;
    const outOffset = y * stride;
    const prevOffset = (y - 1) * stride;
    for (let x = 0; x < stride; x += 1) {
      const left = x >= bpp ? raw[outOffset + x - bpp] : 0;
      const up = y > 0 ? raw[prevOffset + x] : 0;
      const upLeft = y > 0 && x >= bpp ? raw[prevOffset + x - bpp] : 0;
      let value = row[x];
      if (filter === 1) value = (value + left) & 0xff;
      else if (filter === 2) value = (value + up) & 0xff;
      else if (filter === 3) value = (value + Math.floor((left + up) / 2)) & 0xff;
      else if (filter === 4) {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - upLeft);
        value = (value + (pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft)) & 0xff;
      } else if (filter !== 0) {
        throw new Error(`${file} uses unsupported PNG filter ${filter}`);
      }
      raw[outOffset + x] = value;
    }
  }
  const rgba = Buffer.alloc(width * height * 4);
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    const src = pixel * channels;
    const dst = pixel * 4;
    if (colorType === 6) {
      rgba[dst] = raw[src];
      rgba[dst + 1] = raw[src + 1];
      rgba[dst + 2] = raw[src + 2];
      rgba[dst + 3] = raw[src + 3];
    } else if (colorType === 2) {
      rgba[dst] = raw[src];
      rgba[dst + 1] = raw[src + 1];
      rgba[dst + 2] = raw[src + 2];
      rgba[dst + 3] = 255;
    } else {
      rgba[dst] = raw[src];
      rgba[dst + 1] = raw[src];
      rgba[dst + 2] = raw[src];
      rgba[dst + 3] = 255;
    }
  }
  return { width, height, data: rgba };
}

function makeChunk(type, data) {
  const name = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([name, data])), 0);
  return Buffer.concat([length, name, data, crc]);
}

function writePng(file, image) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(image.width, 0);
  header.writeUInt32BE(image.height, 4);
  header[8] = 8;
  header[9] = 6;
  header[10] = 0;
  header[11] = 0;
  header[12] = 0;
  const scanlines = Buffer.alloc(image.height * (image.width * 4 + 1));
  for (let y = 0; y < image.height; y += 1) {
    const rowStart = y * (image.width * 4 + 1);
    scanlines[rowStart] = 0;
    image.data.copy(scanlines, rowStart + 1, y * image.width * 4, (y + 1) * image.width * 4);
  }
  const png = Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    makeChunk("IHDR", header),
    makeChunk("IDAT", zlib.deflateSync(scanlines)),
    makeChunk("IEND", Buffer.alloc(0))
  ]);
  fs.writeFileSync(file, png);
}

function compareImages(sourceFile, localFile, diffFile, options) {
  const source = parsePng(sourceFile);
  const local = parsePng(localFile);
  const width = Math.min(source.width, local.width);
  const height = Math.min(source.height, local.height);
  const sizeMismatch = source.width !== local.width || source.height !== local.height;
  const diff = Buffer.alloc(width * height * 4);
  let mismatched = 0;
  let sumAbs = 0;
  let sumSquares = 0;
  let maxDelta = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const si = (y * source.width + x) * 4;
      const li = (y * local.width + x) * 4;
      const di = (y * width + x) * 4;
      const dr = Math.abs(source.data[si] - local.data[li]);
      const dg = Math.abs(source.data[si + 1] - local.data[li + 1]);
      const db = Math.abs(source.data[si + 2] - local.data[li + 2]);
      const da = Math.abs(source.data[si + 3] - local.data[li + 3]);
      const delta = (dr + dg + db + da) / (255 * 4);
      sumAbs += delta;
      sumSquares += delta * delta;
      maxDelta = Math.max(maxDelta, delta);
      if (delta > options.pixelThreshold) {
        mismatched += 1;
        diff[di] = 255;
        diff[di + 1] = 24;
        diff[di + 2] = 24;
        diff[di + 3] = 255;
      } else {
        const gray = Math.round((local.data[li] + local.data[li + 1] + local.data[li + 2]) / 3 * 0.55 + 255 * 0.45);
        diff[di] = gray;
        diff[di + 1] = gray;
        diff[di + 2] = gray;
        diff[di + 3] = 255;
      }
    }
  }
  const pixels = Math.max(width * height, 1);
  if (diffFile) writePng(diffFile, { width, height, data: diff });
  return {
    sourceFile,
    localFile,
    diffFile,
    width,
    height,
    sourceSize: { width: source.width, height: source.height },
    localSize: { width: local.width, height: local.height },
    sizeMismatch,
    mismatchRatio: mismatched / pixels,
    meanAbsDelta: sumAbs / pixels,
    rmsDelta: Math.sqrt(sumSquares / pixels),
    maxDelta,
    ok: !sizeMismatch && mismatched / pixels <= options.maxMismatchRatio
  };
}

function imageMap(captureDir) {
  const dir = path.join(captureDir, "screenshots");
  if (!fs.existsSync(dir)) return new Map();
  return new Map(fs.readdirSync(dir).filter((name) => name.endsWith(".png")).map((name) => [name, path.join(dir, name)]));
}

function failedAssertions(manifest) {
  return (manifest.frames || []).flatMap((frame) => (frame.assertions || [])
    .filter((assertion) => !assertion.ok)
    .map((assertion) => ({ frame: `${frame.id}__${frame.frame}`, assertion })));
}

function writeMarkdown(file, report) {
  const lines = [];
  lines.push("# Motion Compare Report", "");
  lines.push(`- Source: \`${report.sourceDir}\``);
  lines.push(`- Local: \`${report.localDir}\``);
  lines.push(`- Compared images: ${report.imagePairs.length}`);
  lines.push(`- Failed image pairs: ${report.imagePairs.filter((item) => !item.ok).length}`);
  lines.push(`- Source assertion failures: ${report.sourceAssertionFailures.length}`);
  lines.push(`- Local assertion failures: ${report.localAssertionFailures.length}`);
  lines.push(`- Console/page/request/http errors: ${report.errorCounts.total}`, "");
  lines.push("## Image Pairs", "");
  lines.push("| Frame | Result | Mismatch | RMS | Diff |");
  lines.push("| --- | ---: | ---: | ---: | --- |");
  for (const item of report.imagePairs) {
    const diff = item.diffFile ? path.relative(path.dirname(file), item.diffFile) : "";
    lines.push(`| ${path.basename(item.sourceFile)} | ${item.ok ? "PASS" : "FAIL"} | ${item.mismatchRatio.toFixed(5)} | ${item.rmsDelta.toFixed(5)} | ${diff ? `[diff](${diff})` : ""} |`);
  }
  if (report.missingLocalImages.length) {
    lines.push("", "## Missing Local Images", "");
    for (const name of report.missingLocalImages) lines.push(`- ${name}`);
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
const outDir = path.resolve(args.out || path.join(process.cwd(), ".motion-compare"));
const options = {
  pixelThreshold: Number(args["pixel-threshold"] || 0.12),
  maxMismatchRatio: Number(args["max-mismatch-ratio"] || 0.015),
  diffImages: !args["no-diff-images"]
};
fs.rmSync(outDir, { recursive: true, force: true });
ensureDir(outDir);
const diffDir = path.join(outDir, "diffs");
if (options.diffImages) ensureDir(diffDir);

const sourceManifest = readJson(path.join(sourceDir, "manifest.json"));
const localManifest = readJson(path.join(localDir, "manifest.json"));
const sourceImages = imageMap(sourceDir);
const localImages = imageMap(localDir);
const imagePairs = [];
const missingLocalImages = [];
for (const [name, sourceFile] of sourceImages.entries()) {
  const localFile = localImages.get(name);
  if (!localFile) {
    missingLocalImages.push(name);
    continue;
  }
  const diffFile = options.diffImages ? path.join(diffDir, name.replace(/\.png$/, ".diff.png")) : "";
  imagePairs.push(compareImages(sourceFile, localFile, diffFile, options));
}

const report = {
  tool: "compare-motion",
  version: 1,
  createdAt: new Date().toISOString(),
  sourceDir,
  localDir,
  outDir,
  options,
  sourceFrames: (sourceManifest.frames || []).length,
  localFrames: (localManifest.frames || []).length,
  missingLocalImages,
  imagePairs,
  sourceAssertionFailures: failedAssertions(sourceManifest),
  localAssertionFailures: failedAssertions(localManifest),
  errorCounts: {
    sourceConsoleErrors: (sourceManifest.consoleErrors || []).length,
    localConsoleErrors: (localManifest.consoleErrors || []).length,
    sourcePageErrors: (sourceManifest.pageErrors || []).length,
    localPageErrors: (localManifest.pageErrors || []).length,
    sourceFailedRequests: (sourceManifest.failedRequests || []).length,
    localFailedRequests: (localManifest.failedRequests || []).length,
    sourceHttpErrors: (sourceManifest.httpErrors || []).length,
    localHttpErrors: (localManifest.httpErrors || []).length
  }
};
report.errorCounts.total = Object.values(report.errorCounts).reduce((sum, value) => sum + value, 0);
report.failed = missingLocalImages.length
  + imagePairs.filter((item) => !item.ok).length
  + report.localAssertionFailures.length
  + report.errorCounts.localConsoleErrors
  + report.errorCounts.localPageErrors
  + report.errorCounts.localFailedRequests
  + report.errorCounts.localHttpErrors;
fs.writeFileSync(path.join(outDir, "report.json"), JSON.stringify(report, null, 2));
writeMarkdown(path.join(outDir, "report.md"), report);
console.log(JSON.stringify({
  outDir,
  compared: imagePairs.length,
  failed: report.failed,
  missingLocalImages: missingLocalImages.length,
  failedImagePairs: imagePairs.filter((item) => !item.ok).length,
  localAssertionFailures: report.localAssertionFailures.length,
  localErrors: report.errorCounts.localConsoleErrors + report.errorCounts.localPageErrors + report.errorCounts.localFailedRequests + report.errorCounts.localHttpErrors
}, null, 2));
if (report.failed) process.exit(1);
