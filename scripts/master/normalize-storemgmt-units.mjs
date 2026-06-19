import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeName } from '../worker/ppt-parse.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const workHubRoot = path.resolve(repoRoot, '../..');
const outputDir = path.join(workHubRoot, 'Manual/비버 가이드/작업파일/매장관리_마스터_인벤토리');
const inventoryPath = path.join(outputDir, 'storemgmt_master_inventory.json');
const normalizedJsonPath = path.join(outputDir, 'storemgmt_normalized_manual_units.json');
const normalizedMdPath = path.join(outputDir, 'storemgmt_normalized_manual_units.md');

const CHAPTER_RE = /^\s*(\d+(?:\s*-\s*\d+)?)\s*[.．]\s*/;
const FRANCHISE_RE = /프랜차이즈|프렌차이즈|대형\s*카페|⭐/;
const FRANCHISE_PREFIX_RE = /^\s*(?:⭐️?|★)?\s*\[[^\]]*(?:프랜차이즈|프렌차이즈|대형\s*카페)[^\]]*\]\s*/;

const KEYWORD_STOPWORDS = new Set([
  '기능',
  '관리',
  '설정',
  '방법',
  '전용',
  '대형',
  '카페',
  '프랜차이즈',
  '프렌차이즈',
  '기타',
]);

function cleanTitle(value) {
  return (value ?? '')
    .replace(/스템프/g, '스탬프')
    .replace(/프렌차이즈/g, '프랜차이즈')
    .replace(/\uFE0F/g, '')
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function compact(value) {
  return normalizeName(cleanTitle(value));
}

function extractChapterNo(title) {
  const match = cleanTitle(title).match(CHAPTER_RE);
  return match ? match[1].replace(/\s+/g, '') : null;
}

function stripChapter(title) {
  return cleanTitle(title).replace(CHAPTER_RE, '').trim();
}

function extractAudienceLabel(title) {
  const clean = cleanTitle(title);
  const prefix = clean.match(FRANCHISE_PREFIX_RE)?.[0]?.trim() ?? null;
  return {
    source_label: prefix ? clean : null,
    audience_prefix: prefix,
    title_without_audience: prefix ? clean.replace(FRANCHISE_PREFIX_RE, '').trim() : clean,
  };
}

function normalizeFunctionTitle(title) {
  const audience = extractAudienceLabel(title);
  return stripChapter(audience.title_without_audience);
}

function inferManualPart(unit) {
  const firstSlide = Math.min(...unit.slide_numbers);
  if (firstSlide >= 127) {
    return { value: 'appendix', reason: 'slide_range_appendix' };
  }
  if (firstSlide >= 75) {
    return { value: 'detailed_manual', reason: 'slide_range_detailed' };
  }
  return { value: 'general_summary', reason: 'slide_range_general' };
}

function inferAudienceScope(unit) {
  const source = `${unit.category_title} ${unit.function_title} ${unit.text_blocks.join(' ')}`;
  if (FRANCHISE_RE.test(source)) {
    return { value: 'franchise', reason: 'title_or_body_marker' };
  }
  return { value: 'common', reason: 'no_scope_marker' };
}

function wordsFrom(value) {
  return cleanTitle(value)
    .split(/[^0-9A-Za-z가-힣]+/)
    .map((word) => word.trim())
    .filter((word) => word.length >= 2)
    .filter((word) => !KEYWORD_STOPWORDS.has(word));
}

function buildSearchKeywords(unit, normalizedCategory, normalizedFunctionTitle) {
  const phrases = [
    unit.category_title,
    unit.function_title,
    normalizedCategory,
    normalizedFunctionTitle,
    ...unit.text_blocks.slice(0, 8),
  ];

  const keywords = new Set();
  for (const phrase of phrases) {
    const clean = cleanTitle(phrase);
    if (clean.length >= 2) keywords.add(clean);
    const normalized = compact(clean);
    if (normalized.length >= 2) keywords.add(normalized);
    for (const word of wordsFrom(clean)) keywords.add(word);
  }

  if (/품절/.test(unit.function_title) || unit.text_blocks.some((block) => /품절/.test(block))) {
    ['품절', '품절여부', '기간품절', '일시품절'].forEach((keyword) => keywords.add(keyword));
  }
  if (/노출/.test(unit.function_title) || unit.text_blocks.some((block) => /노출/.test(block))) {
    ['노출', '상품노출', '노출여부'].forEach((keyword) => keywords.add(keyword));
  }
  if (/판매\s*상품|판매상품/.test(unit.function_title)) {
    ['판매상품', '판매상품관리', '매장판매상품설정'].forEach((keyword) => keywords.add(keyword));
  }
  if (/거래\s*내역|거래내역/.test(unit.function_title)) {
    ['거래내역', '실시간매출내역', '실시간결제내역', '실시간상품매출'].forEach((keyword) => keywords.add(keyword));
  }
  if (/기간/.test(unit.function_title)) {
    ['기간', '판매기간', '판매시간', '판매요일'].forEach((keyword) => keywords.add(keyword));
  }

  return [...keywords].filter(Boolean).slice(0, 40);
}

function pilotPriority(unit, normalizedFunctionTitle) {
  const blob = compact(`${unit.category_title} ${unit.function_title} ${normalizedFunctionTitle}`);
  const isDetailedPart = Math.min(...unit.slide_numbers) >= 75;
  const pilots = [
    {
      priority: 1,
      test: () => blob.includes('상품관리') && blob.includes('매장판매상품설정') && !blob.includes('상품노출'),
      reason: '상품 판매 설정 대표 화면',
    },
    {
      priority: 2,
      test: () => blob.includes('상품노출설정'),
      reason: '판매상품설정 내부 노출 관리',
    },
    {
      priority: 3,
      test: () => blob.includes('품절기능고도화'),
      reason: '프랜차이즈 전용 품절 기능',
    },
    {
      priority: 4,
      test: () => blob.includes('기간품절방법'),
      reason: '기간 품절 절차/정책 후보',
    },
    {
      priority: 5,
      test: () => isDetailedPart && blob.includes('매출관리') && blob.includes('거래내역'),
      reason: '매출/거래 대표 기능',
    },
  ];
  return pilots.find((pilot) => pilot.test()) ?? null;
}

function stableKey(unit, normalizedCategory, normalizedFunctionTitle) {
  const slideKey = unit.slide_numbers.join('-');
  return ['storemgmt', 'ppt', unit.unit_id, slideKey, compact(normalizedCategory), compact(normalizedFunctionTitle)]
    .filter(Boolean)
    .join(':');
}

function normalizeUnit(unit) {
  const normalizedCategory = cleanTitle(unit.category_title);
  const audience = extractAudienceLabel(unit.function_title);
  const chapterNo = extractChapterNo(audience.title_without_audience);
  const normalizedFunctionTitle = normalizeFunctionTitle(unit.function_title);
  const manualPart = inferManualPart(unit);
  const audienceScope = inferAudienceScope(unit);
  const searchKeywords = buildSearchKeywords(unit, normalizedCategory, normalizedFunctionTitle);
  const pilot = pilotPriority(unit, normalizedFunctionTitle);

  return {
    unit_id: unit.unit_id,
    stable_key: stableKey(unit, normalizedCategory, normalizedFunctionTitle),
    product: unit.product,
    source: {
      kind: unit.source_kind,
      file_name: unit.source_file,
      slide_numbers: unit.slide_numbers,
      slide_count: unit.slide_count,
    },
    taxonomy: {
      manual_part: manualPart.value,
      audience_scope: audienceScope.value,
      category_title: unit.category_title,
      normalized_category: normalizedCategory,
      function_title: unit.function_title,
      normalized_function_title: normalizedFunctionTitle,
      chapter_no: chapterNo,
      is_franchise_only: audienceScope.value === 'franchise',
      source_label: audience.source_label,
      audience_prefix: audience.audience_prefix,
    },
    content_summary: {
      text_blocks: unit.text_blocks,
      block_count: unit.block_count,
      image_candidate_count: unit.image_candidate_count,
      table_count: unit.table_count,
    },
    search: {
      keywords: searchKeywords,
      normalized_blob: compact([unit.category_title, unit.function_title, normalizedFunctionTitle, ...unit.text_blocks].join(' ')),
    },
    pilot: pilot
      ? {
          priority: pilot.priority,
          reason: pilot.reason,
        }
      : null,
    evidence: {
      normalization_rules: [
        'preserve_original_category_and_function_title',
        'split_chapter_prefix',
        'split_franchise_prefix',
        'normalize_spacing_symbols_and_synonyms',
      ],
      manual_part_inference: manualPart.reason,
      scope_inference: audienceScope.reason,
    },
    original_unit: unit,
  };
}

function markdownReport({ inventory, manualUnits }) {
  const partCounts = manualUnits.reduce((acc, unit) => {
    acc[unit.taxonomy.manual_part] = (acc[unit.taxonomy.manual_part] ?? 0) + 1;
    return acc;
  }, {});
  const scopeCounts = manualUnits.reduce((acc, unit) => {
    acc[unit.taxonomy.audience_scope] = (acc[unit.taxonomy.audience_scope] ?? 0) + 1;
    return acc;
  }, {});
  const pilots = manualUnits.filter((unit) => unit.pilot).sort((a, b) => a.pilot.priority - b.pilot.priority);

  const lines = [];
  lines.push('# 매장관리 백오피스 ManualUnit Registry 후보');
  lines.push('');
  lines.push(`생성일: ${new Date().toISOString()}`);
  lines.push('');
  lines.push('## 1. 요약');
  lines.push('');
  lines.push(`- source: \`${inventory.source.file_name}\``);
  lines.push(`- 원본 ManualUnit 후보: ${inventory.manual_units.length}`);
  lines.push(`- 정규화 ManualUnit 후보: ${manualUnits.length}`);
  lines.push(`- pilot 후보: ${pilots.length}`);
  lines.push('');
  lines.push('## 2. manual_part 분포');
  lines.push('');
  lines.push('| manual_part | count |');
  lines.push('| --- | ---: |');
  for (const [part, count] of Object.entries(partCounts)) lines.push(`| ${part} | ${count} |`);
  lines.push('');
  lines.push('## 3. audience_scope 분포');
  lines.push('');
  lines.push('| audience_scope | count |');
  lines.push('| --- | ---: |');
  for (const [scope, count] of Object.entries(scopeCounts)) lines.push(`| ${scope} | ${count} |`);
  lines.push('');
  lines.push('## 4. 파일럿 후보');
  lines.push('');
  lines.push('| priority | ManualUnit | slides | scope | reason |');
  lines.push('| ---: | --- | --- | --- | --- |');
  for (const unit of pilots) {
    lines.push(
      `| ${unit.pilot.priority} | ${unit.taxonomy.category_title} > ${unit.taxonomy.function_title} | ${unit.source.slide_numbers.join(', ')} | ${unit.taxonomy.audience_scope} | ${unit.pilot.reason} |`,
    );
  }
  lines.push('');
  lines.push('## 5. 전체 후보');
  lines.push('');
  lines.push('| unit_id | part | scope | category | function | normalized | slides | keywords |');
  lines.push('| --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const unit of manualUnits) {
    lines.push(
      `| ${unit.unit_id} | ${unit.taxonomy.manual_part} | ${unit.taxonomy.audience_scope} | ${unit.taxonomy.category_title} | ${unit.taxonomy.function_title} | ${unit.taxonomy.normalized_function_title} | ${unit.source.slide_numbers.join(', ')} | ${unit.search.keywords.slice(0, 8).join(', ')} |`,
    );
  }
  lines.push('');
  return `${lines.join('\n')}\n`;
}

async function main() {
  const inventory = JSON.parse(await readFile(inventoryPath, 'utf8'));
  const manualUnits = inventory.manual_units.map(normalizeUnit);
  const payload = {
    generated_at: new Date().toISOString(),
    product: 'storemgmt',
    source: inventory.source,
    summary: {
      manual_unit_count: manualUnits.length,
      pilot_count: manualUnits.filter((unit) => unit.pilot).length,
      franchise_count: manualUnits.filter((unit) => unit.taxonomy.audience_scope === 'franchise').length,
    },
    manual_units: manualUnits,
  };

  await mkdir(outputDir, { recursive: true });
  await writeFile(normalizedJsonPath, `${JSON.stringify(payload, null, 2)}\n`);
  await writeFile(normalizedMdPath, markdownReport({ inventory, manualUnits }));

  console.log(
    JSON.stringify(
      {
        outputDir,
        manualUnits: manualUnits.length,
        pilotUnits: payload.summary.pilot_count,
        franchiseUnits: payload.summary.franchise_count,
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
