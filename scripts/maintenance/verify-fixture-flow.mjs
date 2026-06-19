import { createClient } from '@supabase/supabase-js';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const repoRoot = process.cwd();
const defaultFixturePath = path.join(repoRoot, 'scripts/fixtures/change-signals/storemgmt-product-soldout.json');
const defaultRealmeasureDir =
  '/Users/beaver_bin/Documents/Work_hub/Manual_automation/manual_builder_stg/data/realmeasure/storemgmt';
const outputDir = path.join(repoRoot, '.tmp/maintenance-harness');

function argValue(name, fallback) {
  const prefix = `${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

async function loadLocalEnv() {
  const envPath = path.join(repoRoot, '.env');
  if (!existsSync(envPath)) return;
  const text = await readFile(envPath, 'utf8');
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const equalIndex = trimmed.indexOf('=');
    if (equalIndex === -1) continue;
    const key = trimmed.slice(0, equalIndex).trim();
    const value = trimmed.slice(equalIndex + 1).trim();
    if (key && !process.env[key]) process.env[key] = value;
  }
}

function normalize(value) {
  return String(value ?? '')
    .replace(/[_()[\]{}.,/\\|:;'"`~!@#$%^&*+=?-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function compact(value) {
  return normalize(value).replace(/\s+/g, '');
}

function flattenStrings(value, acc = []) {
  if (typeof value === 'string') {
    acc.push(value);
  } else if (Array.isArray(value)) {
    for (const item of value) flattenStrings(item, acc);
  } else if (value && typeof value === 'object') {
    for (const item of Object.values(value)) flattenStrings(item, acc);
  }
  return acc;
}

function basenameWithoutExt(filePath) {
  return path.basename(filePath).replace(/\.json$/i, '');
}

function routeFromUrl(url) {
  try {
    return new URL(url).pathname;
  } catch {
    return null;
  }
}

function matchedTermsForScreen(screen, terms) {
  const haystack = compact(
    [
      screen.fileName,
      screen.coordinate.menu,
      screen.coordinate.submenu,
      screen.coordinate.page,
      screen.route,
      screen.allText,
    ].join(' '),
  );
  return terms.filter((term) => haystack.includes(compact(term)));
}

function scoreScreen(screen, fixture) {
  const keywords = fixture.hints?.keywords ?? [];
  const routeHints = fixture.hints?.routes ?? [];
  const matchedTerms = matchedTermsForScreen(screen, keywords);
  const matchedRoutes = routeHints.filter((route) => screen.route && screen.route.includes(route));
  const reasons = [];
  let score = 0;

  if (matchedRoutes.length > 0) {
    score += 0.45;
    reasons.push('route hint match');
  }
  if (matchedTerms.length > 0) {
    score += Math.min(0.35, matchedTerms.length * 0.08);
    reasons.push('keyword overlap');
  }
  if (compact(screen.coordinate.menu).includes('상품관리')) {
    score += 0.1;
    reasons.push('menu match');
  }
  if (compact(screen.coordinate.submenu).includes('판매상품관리')) {
    score += 0.1;
    reasons.push('submenu match');
  }

  return {
    ...screen,
    score: Number(Math.min(1, score).toFixed(4)),
    matchedTerms,
    matchedRoutes,
    reasons,
  };
}

async function loadRealmeasureScreens(realmeasureDir) {
  const names = await readdir(realmeasureDir);
  const jsonNames = names.filter((name) => name.endsWith('.json')).sort();
  const screens = [];

  for (const name of jsonNames) {
    const filePath = path.join(realmeasureDir, name);
    const raw = JSON.parse(await readFile(filePath, 'utf8'));
    const coordinate = raw.coordinate ?? {};
    const snapshot = raw.snapshot ?? {};
    const route = routeFromUrl(coordinate.url ?? snapshot.url);
    const strings = flattenStrings(raw);
    const tableColumns = Array.isArray(snapshot.table?.columns)
      ? snapshot.table.columns.map((column) => column.name).filter(Boolean)
      : [];

    screens.push({
      product: 'storemgmt',
      filePath,
      fileName: name,
      screenId: basenameWithoutExt(name),
      route,
      url: coordinate.url ?? snapshot.url ?? null,
      coordinate: {
        menu: coordinate.menu ?? '',
        submenu: coordinate.submenu ?? '',
        page: coordinate.page ?? basenameWithoutExt(name),
      },
      screenshotFile: snapshot.screenshotFile ?? null,
      tableColumns,
      allText: strings.join(' '),
      measuredAt: raw.measuredAt ?? snapshot.collectedAt ?? null,
    });
  }

  return screens;
}

function toUnitKey(candidate) {
  return compact(
    [
      candidate.product,
      candidate.coordinate.menu,
      candidate.coordinate.submenu,
      candidate.coordinate.page,
      candidate.route,
    ].join(' '),
  );
}

function toCandidatePayload(candidate) {
  const unitKey = toUnitKey(candidate);
  const title = [candidate.coordinate.menu, candidate.coordinate.submenu, candidate.coordinate.page]
    .filter(Boolean)
    .join(' > ');

  return {
    unit: {
      product: candidate.product,
      unit_key: unitKey,
      title,
      granularity: 'screen',
      source_type: 'realmeasure',
      source_ref: {
        screen_id: candidate.screenId,
        file_path: candidate.filePath,
        measured_at: candidate.measuredAt,
      },
      status: 'active',
    },
    anchor: {
      product: candidate.product,
      route: candidate.route,
      screen_id: candidate.screenId,
      anchor_key: compact(`${candidate.route ?? ''} ${candidate.screenId}`),
      component_key: null,
      kms_class_code: null,
      figma_node_id: null,
      confidence: candidate.score,
      evidence: {
        source: 'realmeasure',
        url: candidate.url,
        file_path: candidate.filePath,
        screenshot_file: candidate.screenshotFile,
        coordinate: candidate.coordinate,
        table_columns: candidate.tableColumns,
        matched_terms: candidate.matchedTerms,
        matched_routes: candidate.matchedRoutes,
        reasons: candidate.reasons,
      },
      status: candidate.score >= 0.65 ? 'candidate' : 'candidate',
    },
    impact: {
      score: candidate.score,
      reasons: candidate.reasons,
      evidence_refs: [
        {
          type: 'realmeasure',
          screen_id: candidate.screenId,
          route: candidate.route,
          file_path: candidate.filePath,
          matched_terms: candidate.matchedTerms,
          table_columns: candidate.tableColumns,
        },
      ],
      decision: 'pending',
    },
    draft: {
      draft_type: 'mixed',
      current_content_ref: {
        anchor_source: 'realmeasure',
        screen_id: candidate.screenId,
        route: candidate.route,
      },
      proposed_content: {
        title: '품절 처리 UX 변경 갱신안 초안',
        summary: `${title} 화면에서 품절 관련 UI 변경 여부를 확인하고 매뉴얼 갱신안을 작성해야 합니다.`,
        required_review: [
          '품절 상태 표시 위치 확인',
          '품절 토글/컬럼명 변경 여부 확인',
          '기존 Notion 매뉴얼의 상품/판매상품/품절 설명 영향 여부 확인',
        ],
      },
      evidence_refs: [
        {
          type: 'realmeasure',
          screen_id: candidate.screenId,
          route: candidate.route,
          screenshot_file: candidate.screenshotFile,
          matched_terms: candidate.matchedTerms,
        },
      ],
      review_status: 'review_required',
      publish_status: 'not_ready',
    },
  };
}

function requireSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for --db mode.');
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

async function assertV2Tables(supabase) {
  const required = [
    'manual_anchor_units',
    'manual_product_anchors',
    'manual_change_signals',
    'manual_impact_candidates',
    'manual_update_drafts',
  ];

  for (const table of required) {
    const { error } = await supabase.from(table).select('id').limit(1);
    if (error) {
      throw new Error(`${table} is not available. Apply supabase/migrations/002_maintenance_v2.sql first. ${error.message}`);
    }
  }
}

async function upsertDbRows({ supabase, fixture, candidates }) {
  const { data: signal, error: signalError } = await supabase
    .from('manual_change_signals')
    .upsert(
      {
        source_type: fixture.source_type,
        external_id: fixture.external_id,
        product: fixture.product,
        title: fixture.title,
        body: fixture.body,
        hints: fixture.hints ?? {},
        raw_payload: fixture,
        status: 'received',
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'source_type,external_id' },
    )
    .select('id')
    .single();
  if (signalError || !signal) throw new Error(signalError?.message ?? 'Failed to upsert manual_change_signals.');

  const inserted = [];

  for (const candidate of candidates) {
    const payload = toCandidatePayload(candidate);
    const { data: unit, error: unitError } = await supabase
      .from('manual_anchor_units')
      .upsert(
        {
          ...payload.unit,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'product,unit_key' },
      )
      .select('id')
      .single();
    if (unitError || !unit) throw new Error(unitError?.message ?? 'Failed to upsert manual_anchor_units.');

    const { data: anchor, error: anchorError } = await supabase
      .from('manual_product_anchors')
      .upsert(
        {
          ...payload.anchor,
          manual_unit_id: unit.id,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'manual_unit_id,anchor_key' },
      )
      .select('id')
      .single();
    if (anchorError || !anchor) throw new Error(anchorError?.message ?? 'Failed to upsert manual_product_anchors.');

    const { data: impact, error: impactError } = await supabase
      .from('manual_impact_candidates')
      .upsert(
        {
          ...payload.impact,
          change_signal_id: signal.id,
          manual_unit_id: unit.id,
          anchor_id: anchor.id,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'change_signal_id,manual_unit_id' },
      )
      .select('id')
      .single();
    if (impactError || !impact) throw new Error(impactError?.message ?? 'Failed to upsert manual_impact_candidates.');

    const { data: draft, error: draftError } = await supabase
      .from('manual_update_drafts')
      .upsert(
        {
          ...payload.draft,
          impact_candidate_id: impact.id,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'impact_candidate_id,draft_type' },
      )
      .select('id')
      .single();
    if (draftError || !draft) throw new Error(draftError?.message ?? 'Failed to upsert manual_update_drafts.');

    inserted.push({ unitId: unit.id, anchorId: anchor.id, impactCandidateId: impact.id, updateDraftId: draft.id });
  }

  return { changeSignalId: signal.id, rows: inserted };
}

await loadLocalEnv();

const fixturePath = argValue('--fixture', defaultFixturePath);
const realmeasureDir = argValue('--realmeasure-dir', process.env.REALMEASURE_DIR ?? defaultRealmeasureDir);
const topN = Number(argValue('--top', '5'));
const dbMode = hasFlag('--db');

const fixture = JSON.parse(await readFile(fixturePath, 'utf8'));
const screens = await loadRealmeasureScreens(realmeasureDir);
const candidates = screens
  .map((screen) => scoreScreen(screen, fixture))
  .filter((candidate) => candidate.score > 0)
  .sort((a, b) => b.score - a.score)
  .slice(0, topN);

if (candidates.length === 0) {
  throw new Error('Fixture harness failed: no impact candidates were generated from realmeasure evidence.');
}

const report = {
  mode: dbMode ? 'db' : 'local',
  fixture: {
    source_type: fixture.source_type,
    external_id: fixture.external_id,
    product: fixture.product,
    title: fixture.title,
  },
  realmeasureDir,
  screenCount: screens.length,
  candidateCount: candidates.length,
  candidates: candidates.map((candidate) => ({
    screenId: candidate.screenId,
    title: [candidate.coordinate.menu, candidate.coordinate.submenu, candidate.coordinate.page].filter(Boolean).join(' > '),
    route: candidate.route,
    score: candidate.score,
    reasons: candidate.reasons,
    matchedTerms: candidate.matchedTerms,
    evidence: {
      filePath: candidate.filePath,
      screenshotFile: candidate.screenshotFile,
      tableColumns: candidate.tableColumns,
    },
  })),
};

if (dbMode) {
  const supabase = requireSupabase();
  await assertV2Tables(supabase);
  report.db = await upsertDbRows({ supabase, fixture, candidates });
}

await mkdir(outputDir, { recursive: true });
const outputPath = path.join(outputDir, dbMode ? 'fixture-flow-db.json' : 'fixture-flow-local.json');
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);

console.log(
  JSON.stringify(
    {
      ok: true,
      mode: report.mode,
      screenCount: report.screenCount,
      candidateCount: report.candidateCount,
      topCandidate: report.candidates[0],
      outputPath,
      db: report.db ?? null,
    },
    null,
    2,
  ),
);
