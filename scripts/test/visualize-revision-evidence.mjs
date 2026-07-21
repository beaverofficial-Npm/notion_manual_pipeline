import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { createClient } from '@supabase/supabase-js';
import sharp from 'sharp';
import { downloadSource } from '../worker/source-storage.mjs';

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} 환경변수가 필요합니다.`);
  return value;
}

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
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

async function assetsForTask(supabase, taskId) {
  const { data: slides, error: slideError } = await supabase
    .from('manual_slides')
    .select('id,slide_number')
    .eq('task_id', taskId)
    .order('slide_number');
  if (slideError) throw slideError;

  const slideNumberById = new Map((slides ?? []).map((slide) => [slide.id, slide.slide_number]));
  const slideIds = [...slideNumberById.keys()];
  const assets = [];
  for (let index = 0; index < slideIds.length; index += 100) {
    const { data, error } = await supabase
      .from('manual_assets')
      .select('id,slide_id,storage_path,kind')
      .in('slide_id', slideIds.slice(index, index + 100))
      .eq('kind', 'group_bake');
    if (error) throw error;
    assets.push(...(data ?? []));
  }

  return new Map(assets.map((asset) => [slideNumberById.get(asset.slide_id), asset]));
}

async function borderMetrics(bytes) {
  const { data, info } = await sharp(bytes).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const colorBuckets = new Map();
  for (let x = 0; x < info.width; x += 1) {
    const offset = x * info.channels;
    const key = `${data[offset] >> 4},${data[offset + 1] >> 4},${data[offset + 2] >> 4}`;
    colorBuckets.set(key, (colorBuckets.get(key) ?? 0) + 1);
  }
  return { width: info.width, height: info.height, topBorderRatio: Math.max(...colorBuckets.values()) / info.width };
}

async function pixelDifference(beforeBytes, afterBytes) {
  const [before, after] = await Promise.all([
    sharp(beforeBytes).removeAlpha().raw().toBuffer({ resolveWithObject: true }),
    sharp(afterBytes).removeAlpha().raw().toBuffer({ resolveWithObject: true }),
  ]);
  if (before.info.width !== after.info.width || before.info.height !== after.info.height || before.info.channels !== after.info.channels) {
    return { comparable: false };
  }
  let absoluteDifference = 0;
  let changedChannels = 0;
  let maxChannelDifference = 0;
  for (let index = 0; index < before.data.length; index += 1) {
    const difference = Math.abs(before.data[index] - after.data[index]);
    absoluteDifference += difference;
    if (difference > 2) changedChannels += 1;
    maxChannelDifference = Math.max(maxChannelDifference, difference);
  }
  return {
    comparable: true,
    meanAbsoluteDifference: absoluteDifference / before.data.length,
    changedChannelRatio: changedChannels / before.data.length,
    maxChannelDifference,
  };
}

async function labeledPanel(bytes, label, width) {
  const image = sharp(bytes).resize({ width, fit: 'inside' });
  const imageInfo = await image.metadata();
  const height = imageInfo.height;
  const headerHeight = 54;
  const header = Buffer.from(
    `<svg width="${width}" height="${headerHeight}"><rect width="100%" height="100%" fill="#111827"/><text x="20" y="36" fill="white" font-family="Arial, sans-serif" font-size="24" font-weight="700">${label}</text></svg>`,
  );
  return sharp({ create: { width, height: height + headerHeight, channels: 3, background: '#ffffff' } })
    .composite([
      { input: header, top: 0, left: 0 },
      { input: await image.png().toBuffer(), top: headerHeight, left: 0 },
    ])
    .png()
    .toBuffer();
}

const beforeTask = option('--before-task');
const afterTask = option('--after-task');
const outputDirectory = path.resolve(option('--output') ?? '/tmp/manual-revision-visual');
const requestedSlides = (option('--slides') ?? '5,11,50,100,134')
  .split(',')
  .map((value) => Number(value.trim()))
  .filter((value) => Number.isInteger(value) && value > 0);
const scanBorder = process.argv.includes('--scan-border');

if (!beforeTask || !afterTask) {
  throw new Error('사용법: --before-task <id> --after-task <id> [--slides 5,11] [--output <dir>]');
}

await mkdir(outputDirectory, { recursive: true });
const supabase = createClient(required('NEXT_PUBLIC_SUPABASE_URL'), required('SUPABASE_SERVICE_ROLE_KEY'), {
  auth: { persistSession: false },
});
const [beforeAssets, afterAssets] = await Promise.all([
  assetsForTask(supabase, beforeTask),
  assetsForTask(supabase, afterTask),
]);

if (scanBorder) {
  const metrics = await mapLimit([...afterAssets.entries()], 8, async ([slideNumber, asset]) => {
    const bytes = await downloadSource(asset.storage_path);
    return { slideNumber, ...(await borderMetrics(bytes)) };
  });
  const failures = metrics.filter((item) => item.topBorderRatio < 0.95).sort((a, b) => a.slideNumber - b.slideNumber);
  console.log(JSON.stringify({ checked: metrics.length, failures }, null, 2));
  process.exit(0);
}

const evidence = [];
for (const slideNumber of requestedSlides) {
  const beforeAsset = beforeAssets.get(slideNumber);
  const afterAsset = afterAssets.get(slideNumber);
  if (!beforeAsset || !afterAsset) {
    evidence.push({ slideNumber, skipped: true, reason: 'group_bake asset missing' });
    continue;
  }
  const [beforeBytes, afterBytes] = await Promise.all([
    downloadSource(beforeAsset.storage_path),
    downloadSource(afterAsset.storage_path),
  ]);
  const [beforeMetrics, afterMetrics] = await Promise.all([borderMetrics(beforeBytes), borderMetrics(afterBytes)]);
  const difference = await pixelDifference(beforeBytes, afterBytes);
  const [beforePanel, afterPanel] = await Promise.all([
    labeledPanel(beforeBytes, `BEFORE  |  slide ${slideNumber}`, 900),
    labeledPanel(afterBytes, `AFTER  |  slide ${slideNumber}`, 900),
  ]);
  const beforeInfo = await sharp(beforePanel).metadata();
  const afterInfo = await sharp(afterPanel).metadata();
  const height = Math.max(beforeInfo.height, afterInfo.height);
  const comparison = await sharp({ create: { width: 1820, height, channels: 3, background: '#e5e7eb' } })
    .composite([
      { input: beforePanel, left: 0, top: 0 },
      { input: afterPanel, left: 920, top: 0 },
    ])
    .png()
    .toBuffer();
  const outputPath = path.join(outputDirectory, `slide-${String(slideNumber).padStart(3, '0')}-before-after.png`);
  await writeFile(outputPath, comparison);
  evidence.push({ slideNumber, outputPath, before: beforeMetrics, after: afterMetrics, difference });
}

await writeFile(path.join(outputDirectory, 'evidence.json'), `${JSON.stringify(evidence, null, 2)}\n`);
console.log(JSON.stringify({ outputDirectory, evidence }, null, 2));
