import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { renderPdfWithGraph } from '../worker/graph-renderer.mjs';

const execFileAsync = promisify(execFile);

const repoRoot = process.cwd();
const pptPath = path.join(repoRoot, 'docs', '비버_매장관리 APP 통합가이드_ver1.0_260615.pptx');
const slideNumber = 14;
const outDir = path.join(repoRoot, 'public', 'generated', 'pilot', 'product-slide-14');
const tmpDir = path.join(repoRoot, '.tmp', 'pilot-product-slide-14');
const pdftoppm = process.env.PDFTOPPM_BIN ?? '/opt/homebrew/bin/pdftoppm';

function decodeXml(value) {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function attr(source, name) {
  const match = source.match(new RegExp(`${name}="([^"]*)"`));
  return match?.[1] ?? '';
}

function firstNumber(source, pattern) {
  const match = source.match(pattern);
  return match ? Number(match[1]) : 0;
}

async function unzipText(entry) {
  const { stdout } = await execFileAsync('unzip', ['-p', pptPath, entry], {
    maxBuffer: 1024 * 1024 * 8,
  });
  return stdout;
}

function extractText(block) {
  return [...block.matchAll(/<a:t>(.*?)<\/a:t>/g)]
    .map((match) => decodeXml(match[1]))
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractBox(block) {
  return {
    x: firstNumber(block, /<a:off[^>]*x="(\d+)"/),
    y: firstNumber(block, /<a:off[^>]*y="(\d+)"/),
    w: firstNumber(block, /<a:ext[^>]*cx="(\d+)"/),
    h: firstNumber(block, /<a:ext[^>]*cy="(\d+)"/),
  };
}

function percentBox(box, slideSize) {
  return {
    left: Number(((box.x / slideSize.cx) * 100).toFixed(2)),
    top: Number(((box.y / slideSize.cy) * 100).toFixed(2)),
    width: Number(((box.w / slideSize.cx) * 100).toFixed(2)),
    height: Number(((box.h / slideSize.cy) * 100).toFixed(2)),
  };
}

function extractBlocks(xml, tagName) {
  const blocks = [];
  const regex = new RegExp(`<p:${tagName}[\\s\\S]*?<\\/p:${tagName}>`, 'g');
  let match;
  while ((match = regex.exec(xml))) {
    blocks.push(match[0]);
  }
  return blocks;
}

async function renderSlide() {
  await rm(tmpDir, { recursive: true, force: true });
  await mkdir(tmpDir, { recursive: true });
  await mkdir(outDir, { recursive: true });

  const pdfPath = await renderPdfWithGraph({ sourcePath: pptPath, outputDir: tmpDir });
  const outputPrefix = path.join(tmpDir, 'slide');
  await execFileAsync(pdftoppm, ['-f', String(slideNumber), '-l', String(slideNumber), '-png', '-r', '144', pdfPath, outputPrefix], {
    maxBuffer: 1024 * 1024 * 16,
  });

  const rendered = (await readdir(tmpDir)).find((file) => /^slide-\d+\.png$/.test(file));
  if (!rendered) {
    throw new Error('Slide render failed.');
  }

  const finalPath = path.join(outDir, 'slide-14.png');
  await rename(path.join(tmpDir, rendered), finalPath);
  return finalPath;
}

async function buildManifest() {
  const presentationXml = await unzipText('ppt/presentation.xml');
  const slideXml = await unzipText(`ppt/slides/slide${slideNumber}.xml`);
  const slideSize = {
    cx: firstNumber(presentationXml, /<p:sldSz[^>]*cx="(\d+)"/),
    cy: firstNumber(presentationXml, /<p:sldSz[^>]*cy="(\d+)"/),
  };

  const textElements = extractBlocks(slideXml, 'sp')
    .map((block) => {
      const text = extractText(block);
      const box = extractBox(block);
      const name = decodeXml(attr(block, 'name'));
      return { kind: 'text', name, text, box, percentBox: percentBox(box, slideSize) };
    })
    .filter((element) => element.text && element.box.w > 0 && element.box.h > 0);

  const pictureElements = extractBlocks(slideXml, 'pic')
    .map((block) => {
      const box = extractBox(block);
      const name = decodeXml(attr(block, 'name'));
      const areaRatio = (box.w * box.h) / (slideSize.cx * slideSize.cy);
      return {
        kind: 'screenshot',
        name,
        label: areaRatio > 0.12 ? '대표 화면 이미지 후보' : '보조 이미지 후보',
        confidence: areaRatio > 0.12 ? 0.92 : 0.62,
        box,
        percentBox: percentBox(box, slideSize),
        areaRatio: Number(areaRatio.toFixed(4)),
      };
    })
    .filter((element) => element.box.w > 0 && element.box.h > 0)
    .sort((a, b) => b.areaRatio - a.areaRatio);

  const title = textElements.find((element) => element.text.includes('상품관리'))?.text ?? `슬라이드 ${slideNumber}`;
  const bodyTexts = textElements
    .map((element) => element.text)
    .filter((text) => text.length > 1)
    .filter((text, index, all) => all.indexOf(text) === index);

  return {
    sourceFile: path.basename(pptPath),
    slideNumber,
    title,
    slideImage: '/generated/pilot/product-slide-14/slide-14.png',
    slideSize,
    extractedAt: new Date().toISOString(),
    textCandidates: bodyTexts.map((text, index) => ({
      id: `text-${index + 1}`,
      text,
      status: index < 2 ? 'approve_ready' : 'review_required',
    })),
    imageCandidates: pictureElements.slice(0, 4).map((element, index) => ({
      id: `image-${index + 1}`,
      label: element.label,
      kind: element.kind,
      confidence: element.confidence,
      percentBox: element.percentBox,
      reviewReason: element.areaRatio > 0.65 ? 'large_crop_check' : 'screen_candidate',
    })),
    qualityWarnings: [
      {
        code: 'ARROW_DETECTED_REVIEW',
        label: '화살표/연결선은 기본 제외 대상',
        status: 'manual_review',
      },
    ],
  };
}

await renderSlide();
const manifest = await buildManifest();
await writeFile(path.join(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

const summary = {
  slideImage: manifest.slideImage,
  textCandidates: manifest.textCandidates.length,
  imageCandidates: manifest.imageCandidates.length,
  manifest: '/generated/pilot/product-slide-14/manifest.json',
};

console.log(JSON.stringify(summary, null, 2));
