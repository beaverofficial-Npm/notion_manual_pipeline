import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();

const requiredDocs = [
  'docs/planning/V2_PRODUCT_OPERATING_SYSTEM.md',
  'docs/planning/V2_EXECUTION_HARNESS.md',
  'docs/planning/V2_ANCHOR_SCHEMA.md',
];

const requiredPhrases = new Map([
  [
    'docs/planning/V2_PRODUCT_OPERATING_SYSTEM.md',
    [
      '매뉴얼 유지보수 자동화 v2',
      '제품 변경',
      '변경신호(Asana/Figma)',
      '영향 단위 식별',
      'Playwright 실측',
      'KMS',
      'review_required 큐',
      '사람 승인',
      '성공지표',
    ],
  ],
  [
    'docs/planning/V2_EXECUTION_HARNESS.md',
    [
      '변경신호',
      '영향 단위 식별',
      '근거 수집',
      '갱신안 생성',
      'review_required 큐',
      'Publish Harness',
      'Deployment Harness',
    ],
  ],
  [
    'docs/planning/V2_ANCHOR_SCHEMA.md',
    [
      'manual unit',
      'product coordinate',
      'KMS',
      'Asana',
      'Figma',
      'manual_anchor_units',
      'manual_product_anchors',
      'manual_change_signals',
      'manual_impact_candidates',
      'manual_update_drafts',
    ],
  ],
]);

const forbiddenClaims = [
  {
    file: 'docs/planning/V2_PRODUCT_OPERATING_SYSTEM.md',
    phrase: '이 프로젝트의 목적은 `PPT -> Notion 변환기`',
    allowedOnlyIfFollowedBy: '가 아니다',
  },
];

const failures = [];

for (const rel of requiredDocs) {
  if (!existsSync(path.join(root, rel))) failures.push(`Missing required v2 product document: ${rel}`);
}

for (const [rel, phrases] of requiredPhrases.entries()) {
  const fullPath = path.join(root, rel);
  if (!existsSync(fullPath)) continue;
  const source = readFileSync(fullPath, 'utf8');
  for (const phrase of phrases) {
    if (!source.includes(phrase)) {
      failures.push(`"${phrase}" missing in ${rel}`);
    }
  }
}

for (const rule of forbiddenClaims) {
  const fullPath = path.join(root, rule.file);
  if (!existsSync(fullPath)) continue;
  const source = readFileSync(fullPath, 'utf8');
  const index = source.indexOf(rule.phrase);
  if (index !== -1) {
    const window = source.slice(index, index + rule.phrase.length + 40);
    if (!window.includes(rule.allowedOnlyIfFollowedBy)) {
      failures.push(`Forbidden narrowed purpose claim found in ${rule.file}: ${rule.phrase}`);
    }
  }
}

if (failures.length > 0) {
  console.error('V2 purpose harness failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('V2 purpose harness passed: product remains change-signal driven maintenance automation.');
