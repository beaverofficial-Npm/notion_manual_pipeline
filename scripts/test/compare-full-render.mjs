import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

function option(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function numberList(value) {
  return new Set(
    String(value ?? '')
      .split(',')
      .map((item) => Number(item.trim()))
      .filter((item) => Number.isInteger(item) && item > 0),
  );
}

function pagePath(directory, pageNumber) {
  return path.join(directory, `page-${String(pageNumber).padStart(3, '0')}.png`);
}

async function rawRgb(filePath) {
  return sharp(filePath).removeAlpha().raw().toBuffer({ resolveWithObject: true });
}

async function comparePage(baselineDirectory, candidateDirectory, pageNumber) {
  const [before, after] = await Promise.all([
    rawRgb(pagePath(baselineDirectory, pageNumber)),
    rawRgb(pagePath(candidateDirectory, pageNumber)),
  ]);
  if (
    before.info.width !== after.info.width
    || before.info.height !== after.info.height
    || before.info.channels !== after.info.channels
  ) {
    return {
      pageNumber,
      comparable: false,
      before: before.info,
      after: after.info,
    };
  }

  const pixelCount = before.info.width * before.info.height;
  let exactPixels = 0;
  let threshold5Pixels = 0;
  let threshold15Pixels = 0;
  let left = before.info.width;
  let top = before.info.height;
  let right = -1;
  let bottom = -1;

  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    const offset = pixel * before.info.channels;
    let maximum = 0;
    for (let channel = 0; channel < 3; channel += 1) {
      maximum = Math.max(maximum, Math.abs(before.data[offset + channel] - after.data[offset + channel]));
    }
    if (maximum > 0) exactPixels += 1;
    if (maximum > 5) {
      threshold5Pixels += 1;
      const x = pixel % before.info.width;
      const y = Math.floor(pixel / before.info.width);
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
    if (maximum > 15) threshold15Pixels += 1;
  }

  return {
    pageNumber,
    comparable: true,
    width: before.info.width,
    height: before.info.height,
    pixelCount,
    exactPixels,
    exactPct: Number(((exactPixels / pixelCount) * 100).toFixed(6)),
    threshold5Pixels,
    threshold5Pct: Number(((threshold5Pixels / pixelCount) * 100).toFixed(6)),
    threshold15Pixels,
    threshold15Pct: Number(((threshold15Pixels / pixelCount) * 100).toFixed(6)),
    threshold5BoundingBox: threshold5Pixels > 0 ? [left, top, right, bottom] : null,
  };
}

async function mapLimit(items, concurrency, mapper) {
  const results = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await mapper(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

function escapeXml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;',
  })[character]);
}

async function labeledPanel(filePath, label, width = 720) {
  const image = await sharp(filePath).resize({ width, fit: 'inside' }).png().toBuffer();
  const metadata = await sharp(image).metadata();
  const headerHeight = 48;
  const header = Buffer.from(
    `<svg width="${width}" height="${headerHeight}"><rect width="100%" height="100%" fill="#111827"/><text x="18" y="32" fill="white" font-family="Arial, sans-serif" font-size="21" font-weight="700">${escapeXml(label)}</text></svg>`,
  );
  return sharp({ create: { width, height: metadata.height + headerHeight, channels: 3, background: '#ffffff' } })
    .composite([
      { input: header, left: 0, top: 0 },
      { input: image, left: 0, top: headerHeight },
    ])
    .png()
    .toBuffer();
}

async function differenceImage(beforePath, afterPath) {
  const [before, after] = await Promise.all([rawRgb(beforePath), rawRgb(afterPath)]);
  const output = Buffer.alloc(before.data.length);
  for (let pixel = 0; pixel < before.info.width * before.info.height; pixel += 1) {
    const offset = pixel * before.info.channels;
    const delta = Math.max(
      Math.abs(before.data[offset] - after.data[offset]),
      Math.abs(before.data[offset + 1] - after.data[offset + 1]),
      Math.abs(before.data[offset + 2] - after.data[offset + 2]),
    );
    if (delta > 5) {
      output[offset] = 239;
      output[offset + 1] = 68;
      output[offset + 2] = 68;
    } else {
      const gray = Math.round((before.data[offset] + before.data[offset + 1] + before.data[offset + 2]) / 3);
      const muted = Math.round(230 + gray * 0.08);
      output[offset] = muted;
      output[offset + 1] = muted;
      output[offset + 2] = muted;
    }
  }
  return sharp(output, { raw: before.info }).png().toBuffer();
}

async function writeEvidence(baselineDirectory, candidateDirectory, outputDirectory, pageNumber) {
  const beforePath = pagePath(baselineDirectory, pageNumber);
  const afterPath = pagePath(candidateDirectory, pageNumber);
  const difference = await differenceImage(beforePath, afterPath);
  const differencePath = path.join(outputDirectory, `slide-${String(pageNumber).padStart(3, '0')}-diff.png`);
  await writeFile(differencePath, difference);

  const [beforePanel, afterPanel, differencePanel] = await Promise.all([
    labeledPanel(beforePath, `BEFORE | slide ${pageNumber}`),
    labeledPanel(afterPath, `AFTER | slide ${pageNumber}`),
    labeledPanel(differencePath, `DIFF > 5 | slide ${pageNumber}`),
  ]);
  const metadata = await Promise.all([beforePanel, afterPanel, differencePanel].map((panel) => sharp(panel).metadata()));
  const height = Math.max(...metadata.map((item) => item.height));
  const comparison = await sharp({ create: { width: 720 * 3 + 32, height, channels: 3, background: '#dbe3ef' } })
    .composite([
      { input: beforePanel, left: 0, top: 0 },
      { input: afterPanel, left: 736, top: 0 },
      { input: differencePanel, left: 1472, top: 0 },
    ])
    .png()
    .toBuffer();
  const comparisonPath = path.join(outputDirectory, `slide-${String(pageNumber).padStart(3, '0')}-comparison.png`);
  await writeFile(comparisonPath, comparison);
  return { pageNumber, differencePath, comparisonPath };
}

const baselineOption = option('--baseline');
const candidateOption = option('--candidate');
const baselineDirectory = baselineOption ? path.resolve(baselineOption) : null;
const candidateDirectory = candidateOption ? path.resolve(candidateOption) : null;
const outputPath = path.resolve(option('--output') ?? '/tmp/full-render-comparison.json');
const targets = numberList(option('--targets'));
const evidenceSlides = numberList(option('--evidence'));
const evidenceDirectory = path.resolve(option('--evidence-dir', path.join(path.dirname(outputPath), 'evidence')));
const pageCount = Number(option('--pages', '136'));

if (!baselineOption || !candidateOption || !Number.isInteger(pageCount) || pageCount <= 0) {
  throw new Error('Usage: --baseline <dir> --candidate <dir> [--pages 136] [--targets 1,2]');
}

const pageNumbers = Array.from({ length: pageCount }, (_, index) => index + 1);
const pages = await mapLimit(pageNumbers, 4, (pageNumber) => comparePage(baselineDirectory, candidateDirectory, pageNumber));
const targetPages = pages.filter((page) => targets.has(page.pageNumber));
const nonTargetPages = pages.filter((page) => !targets.has(page.pageNumber));
const targetChangeMisses = targetPages.filter((page) => !page.comparable || page.threshold5Pixels === 0).map((page) => page.pageNumber);
const unexpectedNonTargets = nonTargetPages.filter((page) => !page.comparable || page.threshold5Pixels > 0).map((page) => page.pageNumber);

let evidence = [];
if (evidenceSlides.size > 0) {
  await mkdir(evidenceDirectory, { recursive: true });
  evidence = await mapLimit([...evidenceSlides], 2, (pageNumber) => writeEvidence(
    baselineDirectory,
    candidateDirectory,
    evidenceDirectory,
    pageNumber,
  ));
}

const report = {
  generatedAt: new Date().toISOString(),
  baselineDirectory,
  candidateDirectory,
  pageCount,
  dimensions: [...new Set(pages.filter((page) => page.comparable).map((page) => `${page.width}x${page.height}`))],
  targetPages: [...targets].sort((a, b) => a - b),
  changedTargetCount: targetPages.length - targetChangeMisses.length,
  targetChangeMisses,
  unchangedNonTargetCount: nonTargetPages.length - unexpectedNonTargets.length,
  unexpectedNonTargets,
  passed: targetChangeMisses.length === 0 && unexpectedNonTargets.length === 0,
  evidence,
  pages,
};

await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({
  outputPath,
  passed: report.passed,
  pageCount,
  dimensions: report.dimensions,
  changedTargetCount: report.changedTargetCount,
  targetChangeMisses,
  unchangedNonTargetCount: report.unchangedNonTargetCount,
  unexpectedNonTargets,
  evidenceDirectory: evidence.length > 0 ? evidenceDirectory : null,
}, null, 2));
