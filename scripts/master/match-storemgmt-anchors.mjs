import { createClient } from '@supabase/supabase-js';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeName } from '../worker/ppt-parse.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const workHubRoot = path.resolve(repoRoot, '../..');
const outputDir = path.join(workHubRoot, 'Manual/비버 가이드/작업파일/매장관리_마스터_인벤토리');
const normalizedPath = path.join(outputDir, 'storemgmt_normalized_manual_units.json');
const anchorJsonPath = path.join(outputDir, 'storemgmt_anchor_candidates.json');
const anchorMdPath = path.join(outputDir, 'storemgmt_anchor_candidates.md');
const realmeasureRoot = path.join(workHubRoot, 'Manual_automation/manual_builder_stg/data/realmeasure/storemgmt');
const kmsEnvPath = path.join(workHubRoot, 'BO/운영관리/운영관리 3.0/mvp-store-chatbot/.env.local');

function compact(value) {
  return normalizeName(String(value ?? '').replace(/프렌차이즈/g, '프랜차이즈'));
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function confidenceFromScore(score) {
  if (score >= 0.72) return 'high';
  if (score >= 0.45) return 'medium';
  return 'low';
}

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const env = {};
  const lines = fs.readFileSync(filePath, 'utf8').split('\n');
  for (const line of lines) {
    const match = line.match(/^([A-Za-z0-9_]+)=(.*)$/);
    if (!match) continue;
    env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
  }
  return env;
}

function screenText(screen) {
  const snapshot = screen.snapshot ?? {};
  const tableColumns = snapshot.table?.columns?.map((column) => column.name) ?? [];
  const toolbar = snapshot.toolbar?.map((item) => item.text) ?? [];
  const filters = snapshot.filters?.flatMap((item) => [item.label, item.currentValue, item.placeholder]) ?? [];
  const tabs = snapshot.tabs?.map((tab) => tab.label) ?? [];
  return unique([
    screen.coordinate?.menu,
    screen.coordinate?.submenu,
    screen.coordinate?.page,
    screen.coordinate?.url,
    ...tableColumns,
    ...toolbar,
    ...filters,
    ...tabs,
  ]).join(' ');
}

function screenLabel(screen) {
  return [screen.coordinate?.menu, screen.coordinate?.submenu, screen.coordinate?.page].filter(Boolean).join(' > ');
}

function sourceKeyFromFileName(fileName) {
  return fileName.replace(/\.json$/i, '');
}

async function loadRealmeasureScreens() {
  const fileNames = (await readdir(realmeasureRoot)).filter((fileName) => fileName.endsWith('.json')).sort();
  const screens = [];
  for (const fileName of fileNames) {
    const filePath = path.join(realmeasureRoot, fileName);
    try {
      const json = JSON.parse(await readFile(filePath, 'utf8'));
      screens.push({
        source_key: sourceKeyFromFileName(fileName),
        file_name: fileName,
        source_ref: path.relative(workHubRoot, filePath),
        ...json,
        text_blob: screenText(json),
      });
    } catch (error) {
      screens.push({
        source_key: sourceKeyFromFileName(fileName),
        file_name: fileName,
        source_ref: path.relative(workHubRoot, filePath),
        parse_error: error.message,
        text_blob: '',
      });
    }
  }
  return screens;
}

function unitTerms(unit) {
  const titleTerms = [
    unit.taxonomy.category_title,
    unit.taxonomy.normalized_category,
    unit.taxonomy.function_title,
    unit.taxonomy.normalized_function_title,
    ...unit.search.keywords,
  ];
  return unique(titleTerms.map(compact).filter((term) => term.length >= 2));
}

function evidenceFromScreen(screen, terms) {
  const snapshot = screen.snapshot ?? {};
  const tableColumns = snapshot.table?.columns?.map((column) => column.name).filter(Boolean) ?? [];
  const toolbar = snapshot.toolbar?.map((item) => item.text).filter(Boolean) ?? [];
  const filters = snapshot.filters?.flatMap((item) => [item.label, item.currentValue, item.placeholder]).filter(Boolean) ?? [];
  const tabs = snapshot.tabs?.map((tab) => tab.label).filter(Boolean) ?? [];
  const groups = { table_columns: tableColumns, toolbar, filters, tabs };
  const matchedEvidence = {};

  for (const [key, values] of Object.entries(groups)) {
    const matches = values.filter((value) => terms.some((term) => compact(value).includes(term) || term.includes(compact(value))));
    if (matches.length > 0) matchedEvidence[key] = unique(matches).slice(0, 12);
  }
  return { ...matchedEvidence, screenshot_file: snapshot.screenshotFile ?? null };
}

function scoreRealmeasureScreen(unit, screen) {
  if (screen.parse_error) return null;

  const terms = unitTerms(unit);
  const fn = compact(unit.taxonomy.normalized_function_title);
  const category = compact(unit.taxonomy.normalized_category);
  const menu = compact(screen.coordinate?.menu);
  const submenu = compact(screen.coordinate?.submenu);
  const page = compact(screen.coordinate?.page);
  const url = compact(screen.coordinate?.url);
  const blob = compact(screen.text_blob);
  const titleBlob = compact(`${unit.taxonomy.function_title} ${unit.taxonomy.normalized_function_title} ${unit.content_summary.text_blocks.join(' ')}`);

  let score = 0;
  const reasons = [];
  const matchedTerms = new Set();

  if (fn && page && (fn === page || page.includes(fn) || fn.includes(page))) {
    score += 0.45;
    reasons.push('function/page title match');
    matchedTerms.add(unit.taxonomy.normalized_function_title);
  }
  if (category && menu && (category === menu || category.includes(menu) || menu.includes(category))) {
    score += 0.18;
    reasons.push('category/menu match');
    matchedTerms.add(unit.taxonomy.normalized_category);
  }
  if (submenu && terms.some((term) => submenu.includes(term) || term.includes(submenu))) {
    score += 0.15;
    reasons.push('submenu keyword match');
    matchedTerms.add(screen.coordinate.submenu);
  }
  if (url && terms.some((term) => url.includes(term))) {
    score += 0.08;
    reasons.push('url keyword match');
  }

  const evidenceMatches = terms.filter((term) => term.length >= 2 && blob.includes(term)).slice(0, 10);
  if (evidenceMatches.length > 0) {
    score += Math.min(0.24, evidenceMatches.length * 0.04);
    reasons.push('screen evidence term match');
    evidenceMatches.forEach((term) => matchedTerms.add(term));
  }

  const screenHas = (needle) => blob.includes(compact(needle));
  if (titleBlob.includes('품절') && screenHas('품절여부')) {
    score += 0.25;
    reasons.push('soldout column evidence');
    matchedTerms.add('품절여부');
  }
  if (titleBlob.includes('노출') && screenHas('상품 노출여부 일괄 설정')) {
    score += 0.22;
    reasons.push('exposure column evidence');
    matchedTerms.add('상품 노출여부 일괄 설정');
  }
  if ((titleBlob.includes('기간') || titleBlob.includes('판매시간') || titleBlob.includes('판매요일')) && (screenHas('판매기간') || screenHas('판매시간') || screenHas('판매요일'))) {
    score += 0.22;
    reasons.push('sales period/time column evidence');
    ['판매기간', '판매시간', '판매요일'].forEach((term) => {
      if (screenHas(term)) matchedTerms.add(term);
    });
  }
  if (titleBlob.includes('거래내역') && submenu.includes('거래내역')) {
    score += 0.24;
    reasons.push('transaction submenu evidence');
    matchedTerms.add(screen.coordinate.submenu);
  }

  const normalizedScore = Math.min(0.99, Number(score.toFixed(3)));
  if (matchedTerms.size === 0 || normalizedScore < 0.2) return null;

  return {
    unit_id: unit.unit_id,
    candidate_id: `realmeasure:${screen.source_key}`,
    candidate_type: 'realmeasure_screen',
    label: screenLabel(screen),
    source_ref: screen.source_ref,
    url: screen.coordinate?.url ?? null,
    score: normalizedScore,
    confidence: confidenceFromScore(normalizedScore),
    matched_terms: unique([...matchedTerms]).slice(0, 12),
    match_reason: reasons,
    evidence: evidenceFromScreen(screen, [...matchedTerms]),
  };
}

function flattenRecord(record) {
  const parts = [];
  const visit = (value) => {
    if (value == null) return;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      parts.push(String(value));
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (typeof value === 'object') Object.values(value).forEach(visit);
  };
  visit(record);
  return parts.join(' ');
}

function labelFromKmsRecord(record) {
  return (
    record.title ??
    record.name ??
    record.label ??
    record.page_title ??
    record.feature_label ??
    record.screen_name ??
    record.screen_id ??
    record.class_code ??
    record.id ??
    'KMS record'
  );
}

function productLooksStoremgmt(record, blob) {
  const compactBlob = compact(blob);
  return (
    compactBlob.includes('storemgmt') ||
    compactBlob.includes('store') ||
    compactBlob.includes('매장관리') ||
    compactBlob.includes('sm') ||
    record.metadata?.product === 'storemgmt' ||
    record.product === 'storemgmt'
  );
}

function scoreKmsRecord(unit, table, record) {
  const terms = unitTerms(unit);
  const blob = flattenRecord(record);
  const cBlob = compact(blob);
  if (!productLooksStoremgmt(record, blob)) return null;

  let score = 0.1;
  const reasons = ['storemgmt product/domain evidence'];
  const matchedTerms = new Set();
  const label = labelFromKmsRecord(record);
  const cLabel = compact(label);
  const fn = compact(unit.taxonomy.normalized_function_title);

  if (fn && cLabel && (fn === cLabel || fn.includes(cLabel) || cLabel.includes(fn))) {
    score += 0.35;
    reasons.push('function/KMS label match');
    matchedTerms.add(unit.taxonomy.normalized_function_title);
  }

  const matches = terms.filter((term) => term.length >= 2 && cBlob.includes(term)).slice(0, 12);
  if (matches.length > 0) {
    score += Math.min(0.45, matches.length * 0.05);
    reasons.push('KMS text keyword overlap');
    matches.forEach((term) => matchedTerms.add(term));
  }

  if (matchedTerms.size === 0 || score < 0.2) return null;
  const normalizedScore = Math.min(0.98, Number(score.toFixed(3)));

  return {
    unit_id: unit.unit_id,
    candidate_id: `${table}:${record.id ?? record.feature_key ?? record.screen_id ?? label}`,
    candidate_type: table.replace('kms_', 'kms_').replace(/s$/, ''),
    label: String(label).slice(0, 160),
    source_ref: table,
    source_id: record.id ?? null,
    url: null,
    score: normalizedScore,
    confidence: confidenceFromScore(normalizedScore),
    matched_terms: unique([...matchedTerms]).slice(0, 12),
    match_reason: reasons,
    evidence: {
      preview: blob.slice(0, 360),
      class_code: record.class_code ?? null,
      screen_id: record.screen_id ?? null,
      chunk_type: record.chunk_type ?? record.fact_type ?? null,
    },
  };
}

async function loadKmsSnapshot() {
  const env = { ...loadEnvFile(kmsEnvPath), ...process.env };
  const url = env.KMS_SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || env.SUPABASE_URL;
  const key =
    env.KMS_SUPABASE_SERVICE_ROLE_KEY ||
    env.SUPABASE_SERVICE_ROLE_KEY ||
    env.SUPABASE_ANON_KEY ||
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    return { status: 'unavailable', reason: 'missing_supabase_env', records: {} };
  }

  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const tables = ['kms_pages', 'kms_features', 'kms_chunks'];
  const records = {};
  for (const table of tables) {
    const { data, error } = await client.from(table).select('*').limit(table === 'kms_chunks' ? 2500 : 3000);
    if (error) {
      return { status: 'unavailable', reason: `${table}: ${error.message}`, records };
    }
    records[table] = data ?? [];
  }
  return { status: 'available', reason: null, records };
}

function topCandidates(candidates, limit) {
  return candidates.sort((a, b) => b.score - a.score || a.label.localeCompare(b.label, 'ko')).slice(0, limit);
}

function markdownReport({ units, realmeasureScreens, kms, anchorGroups }) {
  const pilotUnits = units.filter((unit) => unit.pilot).sort((a, b) => a.pilot.priority - b.pilot.priority);
  const lines = [];
  lines.push('# 매장관리 백오피스 Anchor 후보');
  lines.push('');
  lines.push(`생성일: ${new Date().toISOString()}`);
  lines.push('');
  lines.push('## 1. 요약');
  lines.push('');
  lines.push(`- ManualUnit: ${units.length}`);
  lines.push(`- 실측 화면 JSON: ${realmeasureScreens.length}`);
  lines.push(`- KMS 상태: ${kms.status}${kms.reason ? ` (${kms.reason})` : ''}`);
  lines.push(`- Anchor 후보 보유 ManualUnit: ${anchorGroups.filter((group) => group.candidates.length > 0).length}`);
  lines.push('');
  lines.push('## 2. 파일럿 후보 매칭');
  lines.push('');
  for (const unit of pilotUnits) {
    const group = anchorGroups.find((item) => item.unit_id === unit.unit_id);
    lines.push(`### P${unit.pilot.priority}. ${unit.taxonomy.category_title} > ${unit.taxonomy.function_title}`);
    lines.push('');
    lines.push(`- slides: ${unit.source.slide_numbers.join(', ')}`);
    lines.push(`- normalized: ${unit.taxonomy.normalized_function_title}`);
    lines.push(`- keywords: ${unit.search.keywords.slice(0, 12).join(', ')}`);
    lines.push('');
    if (!group || group.candidates.length === 0) {
      lines.push('- 후보 없음');
      lines.push('');
      continue;
    }
    lines.push('| type | confidence | score | label | matched_terms | reason |');
    lines.push('| --- | --- | ---: | --- | --- | --- |');
    for (const candidate of group.candidates.slice(0, 8)) {
      lines.push(
        `| ${candidate.candidate_type} | ${candidate.confidence} | ${candidate.score} | ${candidate.label} | ${candidate.matched_terms.join(', ')} | ${candidate.match_reason.join(', ')} |`,
      );
    }
    lines.push('');
  }
  lines.push('## 3. 전체 ManualUnit 후보 수');
  lines.push('');
  lines.push('| unit_id | ManualUnit | candidate count | top candidate |');
  lines.push('| --- | --- | ---: | --- |');
  for (const group of anchorGroups) {
    const unit = units.find((item) => item.unit_id === group.unit_id);
    const top = group.candidates[0];
    lines.push(
      `| ${group.unit_id} | ${unit.taxonomy.category_title} > ${unit.taxonomy.function_title} | ${group.candidates.length} | ${top ? `${top.candidate_type}: ${top.label} (${top.confidence}/${top.score})` : '-'} |`,
    );
  }
  lines.push('');
  return `${lines.join('\n')}\n`;
}

async function main() {
  const normalized = JSON.parse(await readFile(normalizedPath, 'utf8'));
  const units = normalized.manual_units;
  const realmeasureScreens = await loadRealmeasureScreens();
  const kms = await loadKmsSnapshot();

  const anchorGroups = units.map((unit) => {
    const realmeasureCandidates = topCandidates(
      realmeasureScreens.map((screen) => scoreRealmeasureScreen(unit, screen)).filter(Boolean),
      5,
    );
    const kmsCandidates =
      kms.status === 'available'
        ? topCandidates(
            Object.entries(kms.records)
              .flatMap(([table, records]) => records.map((record) => scoreKmsRecord(unit, table, record)).filter(Boolean))
              .filter(Boolean),
            6,
          )
        : [];
    const candidates = topCandidates([...realmeasureCandidates, ...kmsCandidates], 10);
    return {
      unit_id: unit.unit_id,
      stable_key: unit.stable_key,
      candidates,
    };
  });

  const payload = {
    generated_at: new Date().toISOString(),
    product: 'storemgmt',
    source: normalized.source,
    summary: {
      manual_unit_count: units.length,
      realmeasure_screen_count: realmeasureScreens.length,
      kms_status: kms.status,
      kms_reason: kms.reason,
      anchored_unit_count: anchorGroups.filter((group) => group.candidates.length > 0).length,
      pilot_anchored_count: anchorGroups.filter((group) => {
        const unit = units.find((item) => item.unit_id === group.unit_id);
        return unit?.pilot && group.candidates.length > 0;
      }).length,
    },
    kms: {
      status: kms.status,
      reason: kms.reason,
      table_counts:
        kms.status === 'available'
          ? Object.fromEntries(Object.entries(kms.records).map(([table, records]) => [table, records.length]))
          : {},
    },
    anchor_groups: anchorGroups,
  };

  await writeFile(anchorJsonPath, `${JSON.stringify(payload, null, 2)}\n`);
  await writeFile(anchorMdPath, markdownReport({ units, realmeasureScreens, kms, anchorGroups }));

  console.log(JSON.stringify(payload.summary, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
