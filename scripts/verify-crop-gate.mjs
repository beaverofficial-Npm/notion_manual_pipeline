// 고정 크롭 게이트: 폴더 안 모든 덱에서 이미지가 있는 content slide만
// 실측 공통 이미지 박스 하나를 padding 없이 사용하는지 기계 검사한다.
// 사용: node scripts/verify-crop-gate.mjs "<덱 폴더>"   (종료코드 = FAIL 건수)
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readdir } from 'node:fs/promises';
import { FIXED_CAPTURE_BOX, boxCropRect } from './worker/group-bake.mjs';
import { parseSlideShapes, classifyRole, screenshotCandidates } from './worker/ppt-parse.mjs';
import { isHiddenSlideXml } from './worker/slide-visibility.mjs';

const ex = promisify(execFile);
const dir = process.argv[2];
if (!dir) { console.error('사용법: node scripts/verify-crop-gate.mjs <덱 폴더>'); process.exit(2); }

function sameBox(left, right) {
  return ['xFrac', 'yFrac', 'wFrac', 'hFrac'].every((key) => left[key] === right[key]);
}

let totalFail = 0;
const rows = [];
const fixedCrop = boxCropRect(FIXED_CAPTURE_BOX);
for (const deck of (await readdir(dir)).filter((f) => f.endsWith('.pptx') && !f.startsWith('~$')).sort()) {
  const ppt = `${dir}/${deck}`;
  const un = async (entry) => (await ex('unzip', ['-p', ppt, entry], { maxBuffer: 1 << 26 })).stdout;
  const presentation = await un('ppt/presentation.xml');
  const slideSize = {
    cx: Number(presentation.match(/<p:sldSz[^>]*cx="(\d+)"/)?.[1]),
    cy: Number(presentation.match(/<p:sldSz[^>]*cy="(\d+)"/)?.[1]),
  };
  const nums = (await ex('unzip', ['-l', ppt, 'ppt/slides/slide*.xml'], { maxBuffer: 1 << 24 })).stdout
    .split('\n')
    .map((line) => line.trim().split(/\s+/).at(-1) ?? '')
    .filter((entry) => /slide\d+\.xml$/.test(entry))
    .map((entry) => Number(entry.match(/slide(\d+)/)[1]))
    .sort((a, b) => a - b);

  let content = 0;
  let captureEligible = 0;
  let textOnly = 0;
  let hidden = 0;
  const fails = [];
  for (const slideNumber of nums) {
    const xml = await un(`ppt/slides/slide${slideNumber}.xml`);
    if (isHiddenSlideXml(xml)) {
      hidden += 1;
      continue;
    }
    const parsed = parseSlideShapes(xml, slideSize);
    const role = classifyRole(parsed, slideNumber);
    if (role !== 'content') continue;
    content += 1;
    if (screenshotCandidates(parsed).length === 0) {
      textOnly += 1;
      continue;
    }
    captureEligible += 1;
    if (!sameBox(fixedCrop, FIXED_CAPTURE_BOX)) fails.push(`#${slideNumber} 고정 좌표가 padding/clamp로 변경됨`);
  }

  totalFail += fails.length;
  rows.push({ deck, slides: nums.length, content, captureEligible, textOnly, hidden, fail: fails.length });
  console.log(`\n===== ${deck} =====`);
  console.log(`슬라이드 ${nums.length} | 표시 content ${content} | 고정 크롭 ${captureEligible} | 이미지 없음 ${textOnly} | 숨김 ${hidden} | 제외(non-content) ${nums.length - hidden - content} | FAIL ${fails.length}`);
  for (const failure of fails) console.log(`  ${failure}`);
}

console.log('\n================ 게이트 결과 ================');
console.log(`고정 좌표 x=${fixedCrop.xFrac}, y=${fixedCrop.yFrac}, w=${fixedCrop.wFrac}, h=${fixedCrop.hFrac}, padding=0`);
for (const row of rows) console.log(`${row.fail === 0 ? 'PASS' : 'FAIL'}  ${row.deck}  (표시 content ${row.content}, 고정 크롭 ${row.captureEligible}, 이미지 없음 ${row.textOnly}, 숨김 ${row.hidden}, 위반 ${row.fail})`);
console.log(`총 위반: ${totalFail}건 → ${totalFail === 0 ? '✅ 게이트 통과' : '❌ 게이트 실패'}`);
process.exit(totalFail === 0 ? 0 : 1);
