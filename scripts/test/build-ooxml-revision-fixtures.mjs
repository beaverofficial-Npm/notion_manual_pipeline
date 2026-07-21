import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import sharp from 'sharp';
import { FIXED_CAPTURE_BOX } from '../worker/group-bake.mjs';
import { classifyRole, parseSlideShapes } from '../worker/ppt-parse.mjs';
import { isHiddenSlideXml } from '../worker/slide-visibility.mjs';

const execFileAsync = promisify(execFile);

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function sha256File(filePath) {
  const hash = createHash('sha256');
  const bytes = await readFile(filePath);
  return hash.update(bytes).digest('hex');
}

function relationshipTargetByMedia(relsXml, currentMedia, target) {
  const relation = [...relsXml.matchAll(/<Relationship\b[^>]*\bTarget="[^"]*"[^>]*\/?>/g)]
    .map((match) => match[0])
    .find((candidate) => candidate.match(/\bTarget="([^"]*)"/)?.[1].endsWith(`/media/${currentMedia}`));
  if (!relation) throw new Error(`Image relationship for ${currentMedia} not found.`);
  return relsXml.replace(relation, relation.replace(/\bTarget="[^"]*"/, `Target="${target}"`));
}

function relationshipById(relsXml, relationshipId) {
  return [...relsXml.matchAll(/<Relationship\b[^>]*\/?>/g)]
    .map((match) => match[0])
    .find((candidate) => candidate.match(/\bId="([^"]*)"/)?.[1] === relationshipId) ?? null;
}

function relationshipTargetById(relsXml, relationshipId, target) {
  const relation = relationshipById(relsXml, relationshipId);
  if (!relation) throw new Error(`Relationship ${relationshipId} not found.`);
  if (!/\bTarget="[^"]*"/.test(relation)) throw new Error(`Relationship ${relationshipId} has no Target.`);
  return relsXml.replace(relation, relation.replace(/\bTarget="[^"]*"/, `Target="${target}"`));
}

function lineWithStyle(lineXml, next) {
  const width = Math.max(1, Math.round(Number(next.width ?? 5) * 12700));
  let output = /\bw="\d+"/.test(lineXml)
    ? lineXml.replace(/\bw="\d+"/, `w="${width}"`)
    : lineXml.replace(/<a:ln\b/, `<a:ln w="${width}"`);

  const fill = '<a:solidFill><a:srgbClr val="00A86B"/></a:solidFill>';
  if (/<a:(?:solidFill|gradFill|pattFill|noFill)>[\s\S]*?<\/a:(?:solidFill|gradFill|pattFill)>/.test(output)) {
    output = output.replace(/<a:(?:solidFill|gradFill|pattFill)>[\s\S]*?<\/a:(?:solidFill|gradFill|pattFill)>/, fill);
  } else if (/<a:noFill\s*\/>/.test(output)) {
    output = output.replace(/<a:noFill\s*\/>/, fill);
  } else {
    output = output.replace(/<a:ln\b[^>]*>/, (opening) => `${opening}${fill}`);
  }

  if (/<a:prstDash\b[^>]*\/>/.test(output)) {
    output = output.replace(/<a:prstDash\b[^>]*\/>/, '<a:prstDash val="dash"/>');
  } else {
    output = output.replace(/<\/a:ln>/, '<a:prstDash val="dash"/></a:ln>');
  }
  return output;
}

function connectorWithStyle(slideXml, targetId, next) {
  const idPattern = new RegExp(`<p:cNvPr\\b[^>]*\\bid="${escapeRegExp(String(targetId))}"[^>]*>`);
  const candidates = [
    ...slideXml.matchAll(/<p:cxnSp\b[\s\S]*?<\/p:cxnSp>/g),
    ...slideXml.matchAll(/<p:sp\b[\s\S]*?<\/p:sp>/g),
  ];
  const shape = candidates.find((match) => idPattern.test(match[0]))?.[0];
  if (!shape) throw new Error(`Connector/shape ${targetId} not found.`);
  const line = shape.match(/<a:ln\b[\s\S]*?<\/a:ln>/)?.[0];
  if (!line) throw new Error(`Connector/shape ${targetId} has no line properties.`);
  return slideXml.replace(shape, shape.replace(line, lineWithStyle(line, next)));
}

function overlapsCaptureBox(pic) {
  const box = {
    left: FIXED_CAPTURE_BOX.xFrac * 100,
    top: FIXED_CAPTURE_BOX.yFrac * 100,
    right: (FIXED_CAPTURE_BOX.xFrac + FIXED_CAPTURE_BOX.wFrac) * 100,
    bottom: (FIXED_CAPTURE_BOX.yFrac + FIXED_CAPTURE_BOX.hFrac) * 100,
  };
  return pic.bbox.left < box.right
    && pic.bbox.top < box.bottom
    && pic.bbox.left + pic.bbox.width > box.left
    && pic.bbox.top + pic.bbox.height > box.top;
}

async function applyWideImageSwaps(workDir, requestedCount, requestedRatio = 0) {
  const presentationXml = await readFile(path.join(workDir, 'ppt', 'presentation.xml'), 'utf8');
  const slideSize = {
    cx: Number(presentationXml.match(/<p:sldSz[^>]*cx="(\d+)"/)?.[1]),
    cy: Number(presentationXml.match(/<p:sldSz[^>]*cy="(\d+)"/)?.[1]),
  };
  const slideDir = path.join(workDir, 'ppt', 'slides');
  const slideNumbers = (await readdir(slideDir))
    .map((name) => Number(name.match(/^slide(\d+)\.xml$/)?.[1] ?? 0))
    .filter(Boolean)
    .sort((a, b) => a - b);
  const candidates = [];
  const contentSlideNumbers = new Set();
  const renderedSlideNumbersByMedia = new Map();

  for (const slideNumber of slideNumbers) {
    const slidePath = path.join(slideDir, `slide${slideNumber}.xml`);
    const slideXml = await readFile(slidePath, 'utf8');
    if (isHiddenSlideXml(slideXml)) continue;
    const parsed = parseSlideShapes(slideXml, slideSize);
    const relsPath = path.join(slideDir, '_rels', `slide${slideNumber}.xml.rels`);
    const relsXml = await readFile(relsPath, 'utf8').catch(() => '');
    for (const pic of parsed.pics) {
      if (!pic.relationshipId) continue;
      const relation = relationshipById(relsXml, pic.relationshipId);
      const target = relation?.match(/\bTarget="([^"]*)"/)?.[1] ?? null;
      if (!target || !/\/media\//.test(target)) continue;
      const mediaName = path.basename(target);
      const referencedSlides = renderedSlideNumbersByMedia.get(mediaName) ?? new Set();
      referencedSlides.add(slideNumber);
      renderedSlideNumbersByMedia.set(mediaName, referencedSlides);
    }
    if (classifyRole(parsed, slideNumber) !== 'content') continue;
    contentSlideNumbers.add(slideNumber);
    const picture = parsed.pics
      .filter((pic) => pic.relationshipId && overlapsCaptureBox(pic))
      .sort((left, right) => right.areaRatio - left.areaRatio)[0];
    if (!picture) continue;
    const relation = relationshipById(relsXml, picture.relationshipId);
    const currentTarget = relation?.match(/\bTarget="([^"]*)"/)?.[1] ?? null;
    if (!currentTarget || !/\/media\//.test(currentTarget)) continue;
    candidates.push({
      slideNumber,
      relationshipId: picture.relationshipId,
      relsPath,
      currentTarget,
      mediaName: path.basename(currentTarget),
      mediaPath: path.join(workDir, 'ppt', 'media', path.basename(currentTarget)),
      extension: path.extname(currentTarget).toLowerCase(),
    });
  }

  const byExtension = new Map();
  for (const candidate of candidates) {
    const list = byExtension.get(candidate.extension) ?? [];
    list.push(candidate);
    byExtension.set(candidate.extension, list);
  }

  const supportedCandidates = candidates.filter((candidate) => ['.png', '.jpg', '.jpeg', '.webp'].includes(candidate.extension));
  const targetCount = requestedCount > 0
    ? requestedCount
    : Math.ceil(contentSlideNumbers.size * requestedRatio);
  const originalMedia = new Map();
  for (const candidate of candidates) {
    if (!originalMedia.has(candidate.mediaPath)) originalMedia.set(candidate.mediaPath, await readFile(candidate.mediaPath));
  }

  const changedSlides = new Set();
  const changedContentSlides = new Set();
  const modifiedMedia = new Set();
  for (const candidate of supportedCandidates) {
    if (changedContentSlides.size >= targetCount) break;
    if (modifiedMedia.has(candidate.mediaName)) continue;
    const donors = byExtension.get(candidate.extension) ?? [];
    const start = donors.indexOf(candidate);
    let donor = null;
    for (let offset = 1; offset < donors.length; offset += 1) {
      const next = donors[(start + offset) % donors.length];
      if (next.currentTarget !== candidate.currentTarget) {
        donor = next;
        break;
      }
    }
    if (!donor) continue;
    const targetBytes = originalMedia.get(candidate.mediaPath);
    const donorBytes = originalMedia.get(donor.mediaPath) ?? await readFile(donor.mediaPath);
    const targetInfo = await sharp(targetBytes).metadata();
    if (!targetInfo.width || !targetInfo.height) continue;
    const insetX = Math.max(8, Math.round(targetInfo.width * 0.01));
    const insetY = Math.max(8, Math.round(targetInfo.height * 0.01));
    const width = Math.max(1, targetInfo.width - insetX * 2);
    const height = Math.max(1, targetInfo.height - insetY * 2);
    const donorReplacement = await sharp(donorBytes)
      .resize(width, height, { fit: 'fill' })
      .toBuffer();
    let output = sharp(targetBytes).composite([{ input: donorReplacement, left: insetX, top: insetY }]);
    if (candidate.extension === '.png') output = output.png({ compressionLevel: 9, palette: true, quality: 95 });
    else if (candidate.extension === '.webp') output = output.webp({ quality: 85 });
    else output = output.jpeg({ quality: 85 });
    await writeFile(candidate.mediaPath, await output.toBuffer());
    modifiedMedia.add(candidate.mediaName);
    for (const slideNumber of renderedSlideNumbersByMedia.get(candidate.mediaName) ?? [candidate.slideNumber]) {
      changedSlides.add(slideNumber);
      if (contentSlideNumbers.has(slideNumber)) changedContentSlides.add(slideNumber);
    }
  }

  if (changedContentSlides.size < targetCount) {
    throw new Error(`Only ${changedContentSlides.size} content screenshot swaps were possible; requested ${targetCount}.`);
  }
  return [...changedSlides].sort((a, b) => a - b);
}

async function patchDeck(deck, outputPath, wideReplaceCount = 0, wideReplaceRatio = 0) {
  const workDir = await mkdtemp(path.join(os.tmpdir(), `manual-ooxml-deck-${deck.deck}-`));
  try {
    await execFileAsync('unzip', ['-q', deck.sourcePptx, '-d', workDir], { timeout: 300000 });
    const changedSlides = new Set();

    if (wideReplaceCount > 0 || wideReplaceRatio > 0) {
      for (const slideNumber of await applyWideImageSwaps(workDir, wideReplaceCount, wideReplaceRatio)) changedSlides.add(slideNumber);
    } else {
      for (const change of deck.imageChanges ?? []) {
        const relsPath = path.join(workDir, 'ppt', 'slides', '_rels', `slide${change.slide}.xml.rels`);
        const relsXml = await readFile(relsPath, 'utf8');
        const donorTarget = `../media/${path.basename(change.newReference)}`;
        await writeFile(
          relsPath,
          relationshipTargetByMedia(relsXml, path.basename(change.oldReference), donorTarget),
        );
        changedSlides.add(change.slide);
      }
    }

    const connectorChangesBySlide = new Map();
    for (const change of deck.connectorChanges ?? []) {
      const list = connectorChangesBySlide.get(change.slide) ?? [];
      list.push(change);
      connectorChangesBySlide.set(change.slide, list);
    }
    for (const [slideNumber, changes] of connectorChangesBySlide) {
      const slidePath = path.join(workDir, 'ppt', 'slides', `slide${slideNumber}.xml`);
      let slideXml = await readFile(slidePath, 'utf8');
      for (const change of changes) slideXml = connectorWithStyle(slideXml, change.targetId, change.next ?? {});
      await writeFile(slidePath, slideXml);
      changedSlides.add(slideNumber);
    }

    await mkdir(path.dirname(outputPath), { recursive: true });
    const entries = await readdir(workDir);
    await execFileAsync('zip', ['-q', '-X', '-9', '-r', outputPath, ...entries], {
      cwd: workDir,
      timeout: 900000,
      maxBuffer: 1024 * 1024 * 8,
    });
    await execFileAsync('unzip', ['-t', outputPath], { timeout: 300000, maxBuffer: 1024 * 1024 * 8 });
    return [...changedSlides].sort((a, b) => a - b);
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

async function caseRecord({ id, filePath, logicalDeck, variant, changedSlides }) {
  const info = await stat(filePath);
  return {
    id,
    filePath,
    logicalDeck,
    variant,
    expectedSourceSha256: await sha256File(filePath),
    expectedFileSize: info.size,
    changedSlides,
  };
}

async function padZipToExactSize(sourcePath, targetPath, targetSize) {
  const sourceSize = (await stat(sourcePath)).size;
  if (sourceSize > targetSize) throw new Error(`Cannot pad ${sourceSize} bytes down to ${targetSize} bytes.`);
  if (sourceSize === targetSize) {
    await cp(sourcePath, targetPath);
    return;
  }

  const padRoot = await mkdtemp(path.join(os.tmpdir(), 'manual-ooxml-padding-'));
  const entry = 'ppt/_padding.xml';
  try {
    await mkdir(path.join(padRoot, 'ppt'), { recursive: true });
    let payloadSize = Math.max(19, targetSize - sourceSize - 128);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await cp(sourcePath, targetPath);
      const innerSize = Math.max(0, payloadSize - 19);
      await writeFile(path.join(padRoot, entry), `<padding>${'x'.repeat(innerSize)}</padding>`);
      await execFileAsync('zip', ['-q', '-X', '-0', targetPath, entry], {
        cwd: padRoot,
        timeout: 300000,
        maxBuffer: 1024 * 1024,
      });
      const actualSize = (await stat(targetPath)).size;
      if (actualSize === targetSize) return;
      payloadSize += targetSize - actualSize;
      if (payloadSize < 19) break;
    }
    throw new Error(`Could not pad ZIP to exact size ${targetSize}.`);
  } finally {
    await rm(padRoot, { recursive: true, force: true });
  }
}

const sourceManifestPath = path.resolve(process.argv[2] ?? '');
const outputRoot = path.resolve(process.argv[3] ?? '');
if (!process.argv[2] || !process.argv[3]) {
  throw new Error('Usage: node build-ooxml-revision-fixtures.mjs <artifact fixture-manifest.json> <output-root>');
}
if (!outputRoot.startsWith('/tmp/')) throw new Error('Fixture output root must be under /tmp/.');

const sourceManifest = JSON.parse(await readFile(sourceManifestPath, 'utf8'));
await mkdir(outputRoot, { recursive: true });
const cases = [];
const deckFilter = Number(process.env.FIXTURE_DECK ?? 0);
const wideReplaceCount = Number(process.env.WIDE_REPLACE_COUNT ?? 0);
const wideReplaceRatio = Number(process.env.WIDE_REPLACE_RATIO ?? 0);
if (wideReplaceRatio < 0 || wideReplaceRatio > 1) throw new Error('WIDE_REPLACE_RATIO must be between 0 and 1.');

for (const deck of sourceManifest.decks.filter((item) => !deckFilter || item.deck === deckFilter)) {
  const logicalDeck = `deck-${deck.deck}`;
  const sourceName = path.basename(deck.sourcePptx);
  const deckRoot = path.join(outputRoot, logicalDeck);
  const sameNameSameBytesPath = path.join(deckRoot, 'same-name-same-bytes', sourceName);
  const sameNamePath = path.join(deckRoot, 'same-name', sourceName);
  const renamedPath = path.join(deckRoot, 'renamed', `${path.basename(sourceName, path.extname(sourceName))}_RENAMED_SAME_BYTES.pptx`);
  const renamedModifiedPath = path.join(deckRoot, 'renamed-modified', `${path.basename(sourceName, path.extname(sourceName))}_RENAMED_MODIFIED.pptx`);
  const sameSizePath = path.join(deckRoot, 'same-size', `${path.basename(sourceName, path.extname(sourceName))}_MODIFIED_SAME_SIZE.pptx`);

  const changedSlides = await patchDeck(deck, sameNamePath, wideReplaceCount, wideReplaceRatio);
  await mkdir(path.dirname(sameNameSameBytesPath), { recursive: true });
  await cp(deck.sourcePptx, sameNameSameBytesPath);
  await mkdir(path.dirname(renamedPath), { recursive: true });
  await cp(deck.sourcePptx, renamedPath);
  await mkdir(path.dirname(renamedModifiedPath), { recursive: true });
  await cp(sameNamePath, renamedModifiedPath);
  await mkdir(path.dirname(sameSizePath), { recursive: true });
  const [sourceInfo, modifiedInfo] = await Promise.all([stat(deck.sourcePptx), stat(sameNamePath)]);
  if (modifiedInfo.size > sourceInfo.size) {
    throw new Error(`${logicalDeck} compressed modified fixture is larger than original (${modifiedInfo.size} > ${sourceInfo.size}).`);
  }
  await padZipToExactSize(sameNamePath, sameSizePath, sourceInfo.size);
  await execFileAsync('unzip', ['-t', sameSizePath], { timeout: 300000, maxBuffer: 1024 * 1024 * 8 });

  cases.push(await caseRecord({
    id: `${logicalDeck}-baseline`,
    filePath: deck.sourcePptx,
    logicalDeck,
    variant: 'baseline',
    changedSlides: [],
  }));
  cases.push(await caseRecord({
    id: `${logicalDeck}-same-name-same-bytes`,
    filePath: sameNameSameBytesPath,
    logicalDeck,
    variant: 'same_name_same_bytes',
    changedSlides: [],
  }));
  cases.push(await caseRecord({
    id: `${logicalDeck}-same-name-modified`,
    filePath: sameNamePath,
    logicalDeck,
    variant: 'same_name_modified',
    changedSlides,
  }));
  cases.push(await caseRecord({
    id: `${logicalDeck}-different-name-modified`,
    filePath: renamedModifiedPath,
    logicalDeck,
    variant: 'different_name_modified',
    changedSlides,
  }));
  cases.push(await caseRecord({
    id: `${logicalDeck}-different-name-same-bytes`,
    filePath: renamedPath,
    logicalDeck,
    variant: 'different_name_same_bytes',
    changedSlides: [],
  }));
  cases.push(await caseRecord({
    id: `${logicalDeck}-same-size-modified`,
    filePath: sameSizePath,
    logicalDeck,
    variant: 'same_size_modified',
    changedSlides,
  }));
}

const manifest = {
  generatedAt: new Date().toISOString(),
  expectedRenderProvider: 'microsoft_graph',
  sourceManifest: sourceManifestPath,
  cases,
};
const manifestPath = path.join(outputRoot, 'e2e-cases.json');
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(manifestPath);
