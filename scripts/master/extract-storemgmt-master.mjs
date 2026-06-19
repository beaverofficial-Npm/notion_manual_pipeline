import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import {
  buildFunctionBlocks,
  classifyRole,
  extractContentFunctionName,
  extractSection,
  normalizeName,
  parseSlideShapes,
  screenshotCandidates,
} from '../worker/ppt-parse.mjs';

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const workHubRoot = path.resolve(repoRoot, '../..');
const sourceFile = path.join(
  workHubRoot,
  'Manual/일반매장용 + 프랜차이즈 매뉴얼 /03 비버_매장관리_통합가이드ver1.0_260615.pptx',
);
const outputDir = path.join(workHubRoot, 'Manual/비버 가이드/작업파일/매장관리_마스터_인벤토리');

function firstNumber(source, pattern) {
  const match = source.match(pattern);
  return match ? Number(match[1]) : 0;
}

async function unzipText(pptPath, entry) {
  const { stdout } = await execFileAsync('unzip', ['-p', pptPath, entry], { maxBuffer: 1024 * 1024 * 32 });
  return stdout;
}

async function unzipSlideList(pptPath) {
  const { stdout } = await execFileAsync('unzip', ['-l', pptPath, 'ppt/slides/slide*.xml'], { maxBuffer: 1024 * 1024 * 16 });
  return stdout
    .split('\n')
    .map((line) => line.trim().split(/\s+/).at(-1) ?? '')
    .filter((entry) => /^ppt\/slides\/slide\d+\.xml$/.test(entry))
    .sort((a, b) => Number(a.match(/slide(\d+)/)[1]) - Number(b.match(/slide(\d+)/)[1]));
}

function textPreview(blocks, limit = 5) {
  return blocks
    .map((block) => block.text)
    .filter(Boolean)
    .slice(0, limit);
}

function distance(a, b) {
  const prev = Array.from({ length: b.length + 1 }, (_, index) => index);
  const curr = Array.from({ length: b.length + 1 }, () => 0);
  for (let i = 1; i <= a.length; i += 1) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    for (let j = 0; j <= b.length; j += 1) prev[j] = curr[j];
  }
  return prev[b.length];
}

function fuzzyMatch(functions, name) {
  const target = normalizeName(name);
  if (!target) return null;
  const exact = functions.find((fn) => normalizeName(fn.title) === target);
  if (exact) return exact;
  if (target.length < 4) return null;

  let best = null;
  for (const fn of functions) {
    const candidate = normalizeName(fn.title);
    if (candidate.length < 4) continue;
    const delta = distance(candidate, target);
    const threshold = Math.max(candidate.length, target.length) >= 8 ? 2 : 1;
    if (delta <= threshold && (!best || delta < best.delta)) best = { fn, delta };
  }
  return best?.fn ?? null;
}

function buildManualTree(slides) {
  const categories = [];
  let currentCategory = null;
  const functionByKey = new Map();

  function ensureFunction(categoryIndex, category, title) {
    const key = `${categoryIndex}::${normalizeName(title)}`;
    const matched = fuzzyMatch(category.functions, title);
    if (matched) {
      functionByKey.set(key, matched);
      return matched;
    }

    const fn = {
      id: `mu-${String(categories.length + 1).padStart(2, '0')}-${String(category.functions.length + 1).padStart(3, '0')}`,
      sort_order: category.functions.length,
      title,
      slides: [],
      block_count: 0,
      asset_candidate_count: 0,
      table_count: 0,
    };
    category.functions.push(fn);
    functionByKey.set(key, fn);
    return fn;
  }

  for (const slide of slides) {
    if (slide.role === 'cover' || slide.role === 'toc') continue;

    if (slide.role === 'section') {
      const { categoryTitle, functionTitles } = slide.section;
      currentCategory = {
        id: `cat-${String(categories.length + 1).padStart(2, '0')}`,
        sort_order: categories.length,
        title: categoryTitle,
        source_slide: slide.slide_number,
        functions: [],
      };
      categories.push(currentCategory);
      const categoryIndex = categories.length - 1;
      for (const title of functionTitles) ensureFunction(categoryIndex, currentCategory, title);
      continue;
    }

    if (!currentCategory) {
      currentCategory = {
        id: `cat-${String(categories.length + 1).padStart(2, '0')}`,
        sort_order: categories.length,
        title: '기본',
        source_slide: null,
        functions: [],
      };
      categories.push(currentCategory);
    }

    const categoryIndex = categories.indexOf(currentCategory);
    const functionTitle = slide.functionName || `슬라이드 ${slide.slide_number}`;
    const key = `${categoryIndex}::${normalizeName(functionTitle)}`;
    const fn = functionByKey.get(key) ?? ensureFunction(categoryIndex, currentCategory, functionTitle);
    fn.slides.push(slide.slide_number);
    fn.block_count += slide.blocks.length;
    fn.asset_candidate_count += slide.screenshots.length;
    fn.table_count += slide.tableCount;
  }

  return categories
    .map((category) => ({
      ...category,
      functions: category.functions.filter((fn) => fn.slides.length > 0),
    }))
    .filter((category) => category.functions.length > 0);
}

function buildManualUnits({ categories, slidesByNumber, sourceBaseName }) {
  return categories.flatMap((category) =>
    category.functions.map((fn) => {
      const slides = fn.slides.map((slideNumber) => slidesByNumber.get(slideNumber)).filter(Boolean);
      const text_blocks = slides.flatMap((slide) => textPreview(slide.blocks, 4));
      const title = fn.title;

      return {
        unit_id: fn.id,
        product: 'storemgmt',
        source_kind: 'ppt',
        source_file: sourceBaseName,
        category_title: category.title,
        function_title: title,
        slide_numbers: fn.slides,
        slide_count: fn.slides.length,
        text_blocks: text_blocks.slice(0, 12),
        block_count: fn.block_count,
        image_candidate_count: fn.asset_candidate_count,
        table_count: fn.table_count,
        anchor_candidates: [],
        review_status: 'candidate',
        review_notes: [],
      };
    }),
  );
}

function markdownReport({ sourceBaseName, slideSize, slides, categories, manualUnits }) {
  const roleCounts = slides.reduce((acc, slide) => {
    acc[slide.role] = (acc[slide.role] ?? 0) + 1;
    return acc;
  }, {});
  const emptyCategoryCount = categories.filter((category) => category.functions.length === 0).length;
  const lowTextUnits = manualUnits.filter((unit) => unit.block_count === 0);

  const lines = [];
  lines.push('# 매장관리 백오피스 마스터 매뉴얼 인벤토리');
  lines.push('');
  lines.push(`생성일: ${new Date().toISOString()}`);
  lines.push('');
  lines.push('## 1. 소스');
  lines.push('');
  lines.push(`- 파일: \`${sourceBaseName}\``);
  lines.push(`- 슬라이드 수: ${slides.length}`);
  lines.push(`- 슬라이드 크기(EMU): ${slideSize.cx} x ${slideSize.cy}`);
  lines.push('');
  lines.push('## 2. 역할 분포');
  lines.push('');
  lines.push('| 역할 | 수 |');
  lines.push('| --- | ---: |');
  for (const role of ['cover', 'toc', 'section', 'content']) {
    lines.push(`| ${role} | ${roleCounts[role] ?? 0} |`);
  }
  lines.push('');
  lines.push('## 3. ManualUnit 후보 요약');
  lines.push('');
  lines.push(`- 카테고리: ${categories.length}`);
  lines.push(`- 기능/ManualUnit 후보: ${manualUnits.length}`);
  lines.push(`- 빈 카테고리: ${emptyCategoryCount}`);
  lines.push(`- 본문 block 0개 후보: ${lowTextUnits.length}`);
  lines.push('');
  lines.push('## 4. 카테고리/기능 목록');
  lines.push('');
  for (const category of categories) {
    lines.push(`### ${category.title}`);
    lines.push('');
    lines.push('| 기능 | 슬라이드 | 블록 | 이미지 후보 | 표 |');
    lines.push('| --- | --- | ---: | ---: | ---: |');
    for (const fn of category.functions) {
      lines.push(`| ${fn.title} | ${fn.slides.join(', ')} | ${fn.block_count} | ${fn.asset_candidate_count} | ${fn.table_count} |`);
    }
    lines.push('');
  }
  lines.push('## 5. 확인 필요 후보');
  lines.push('');
  if (lowTextUnits.length === 0) {
    lines.push('- 본문 block이 0개인 ManualUnit 후보는 없다.');
  } else {
    for (const unit of lowTextUnits.slice(0, 30)) {
      lines.push(`- ${unit.category_title} > ${unit.function_title} (slides: ${unit.slide_numbers.join(', ')})`);
    }
  }
  lines.push('');
  lines.push('## 6. 다음 작업');
  lines.push('');
  lines.push('1. 사람이 카테고리/기능 묶음이 실제 매뉴얼 목차와 맞는지 검수한다.');
  lines.push('2. ManualUnit 후보와 storemgmt KMS page/feature/chunk 후보를 매칭한다.');
  lines.push('3. ManualUnit 후보와 Playwright realmeasure route/snapshot 후보를 매칭한다.');
  lines.push('4. 승인된 연결을 ManualAnchor로 저장하는 스키마를 설계한다.');
  lines.push('');
  return `${lines.join('\n')}\n`;
}

async function main() {
  const presentationXml = await unzipText(sourceFile, 'ppt/presentation.xml');
  const slideEntries = await unzipSlideList(sourceFile);
  const slideSize = {
    cx: firstNumber(presentationXml, /<p:sldSz[^>]*cx="(\d+)"/),
    cy: firstNumber(presentationXml, /<p:sldSz[^>]*cy="(\d+)"/),
  };

  const slides = [];
  const slidesByNumber = new Map();
  for (const entry of slideEntries) {
    const slideNumber = Number(entry.match(/slide(\d+)/)[1]);
    const slideXml = await unzipText(sourceFile, entry);
    const parsed = parseSlideShapes(slideXml, slideSize);
    const role = classifyRole(parsed, slideNumber);
    const section = role === 'section' ? extractSection(parsed) : null;
    const functionName = role === 'content' ? extractContentFunctionName(parsed) : null;
    const blocks = role === 'content' ? buildFunctionBlocks(parsed, functionName) : [];
    const screenshots = role === 'content' ? screenshotCandidates(parsed) : [];
    const title =
      section?.categoryTitle ??
      functionName ??
      parsed.shapes.find((shape) => !shape.isGroupLabel)?.text ??
      `슬라이드 ${slideNumber}`;
    const slide = {
      slide_number: slideNumber,
      role,
      title,
      section,
      functionName,
      text_shape_count: parsed.shapes.length,
      picture_count: parsed.pics.length,
      tableCount: parsed.tables.length,
      blocks,
      screenshots,
      text_preview: parsed.shapes.map((shape) => shape.text).slice(0, 10),
    };
    slides.push(slide);
    slidesByNumber.set(slideNumber, slide);
  }

  const categories = buildManualTree(slides);
  const sourceBaseName = path.basename(sourceFile);
  const manualUnits = buildManualUnits({ categories, slidesByNumber, sourceBaseName });
  const inventory = {
    generated_at: new Date().toISOString(),
    product: 'storemgmt',
    source: {
      kind: 'ppt',
      file_path: sourceFile,
      file_name: sourceBaseName,
      slide_count: slides.length,
      slide_size: slideSize,
    },
    slides,
    categories,
    manual_units: manualUnits,
    quality: {
      category_count: categories.length,
      manual_unit_count: manualUnits.length,
      role_counts: slides.reduce((acc, slide) => {
        acc[slide.role] = (acc[slide.role] ?? 0) + 1;
        return acc;
      }, {}),
      zero_block_unit_count: manualUnits.filter((unit) => unit.block_count === 0).length,
    },
  };

  await mkdir(outputDir, { recursive: true });
  await writeFile(path.join(outputDir, 'storemgmt_master_inventory.json'), `${JSON.stringify(inventory, null, 2)}\n`);
  await writeFile(
    path.join(outputDir, 'storemgmt_master_inventory.md'),
    markdownReport({ sourceBaseName, slideSize, slides, categories, manualUnits }),
  );

  console.log(
    JSON.stringify(
      {
        outputDir,
        source: sourceBaseName,
        slides: slides.length,
        categories: categories.length,
        manualUnits: manualUnits.length,
        zeroBlockUnits: inventory.quality.zero_block_unit_count,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
