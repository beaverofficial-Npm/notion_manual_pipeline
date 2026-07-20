// 크롭 게이트: 폴더 안 모든 덱의 모든 슬라이드에 대해
// "크롭 = 왼쪽 이미지박스 그 영역만, 우측 본문 텍스트 침범 0"을 기계 검사한다.
// 워커와 동일한 선택 로직(parseImageBoxes 왼쪽판 1개 → 덱 표준 판 폴백 → boxCropRect)을 사용.
// 사용: node scripts/verify-crop-gate.mjs "<덱 폴더>"   (종료코드 = FAIL 건수)
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readdir } from 'node:fs/promises';
import { parseImageBoxes, boxCropRect } from './worker/group-bake.mjs';
import { parseSlideShapes, classifyRole } from './worker/ppt-parse.mjs';

const ex = promisify(execFile);
const dir = process.argv[2];
if (!dir) { console.error('사용법: node scripts/verify-crop-gate.mjs <덱 폴더>'); process.exit(2); }

let totalFail = 0;
const rows = [];
for (const deck of (await readdir(dir)).filter((f) => f.endsWith('.pptx') && !f.startsWith('~$')).sort()) {
  const ppt = `${dir}/${deck}`;
  const un = async (e) => (await ex('unzip', ['-p', ppt, e], { maxBuffer: 1 << 26 })).stdout;
  const pres = await un('ppt/presentation.xml');
  const sz = { cx: Number(pres.match(/cx="(\d+)"/)?.[1]), cy: Number(pres.match(/cy="(\d+)"/)?.[1]) };
  const nums = (await ex('unzip', ['-l', ppt, 'ppt/slides/slide*.xml'], { maxBuffer: 1 << 24 })).stdout
    .split('\n').map((l) => l.trim().split(/\s+/).at(-1) ?? '').filter((e) => /slide\d+\.xml$/.test(e))
    .map((e) => Number(e.match(/slide(\d+)/)[1])).sort((a, b) => a - b);

  const layoutCache = new Map();
  const layoutFor = async (n) => {
    try {
      const rels = await un(`ppt/slides/_rels/slide${n}.xml.rels`);
      const t = rels.match(/Target="[^"]*slideLayouts\/([^"]+)"/)?.[1];
      if (!t) return null;
      if (!layoutCache.has(t)) layoutCache.set(t, await un(`ppt/slideLayouts/${t}`).catch(() => null));
      return layoutCache.get(t);
    } catch { return null; }
  };

  // pass A: 워커와 동일 — 박스 감지 + 덱 표준 판
  const info = [];
  const freq = new Map();
  for (const n of nums) {
    const xml = await un(`ppt/slides/slide${n}.xml`).catch(() => null);
    if (!xml) continue;
    const parsed = parseSlideShapes(xml, sz);
    const role = classifyRole(parsed, n);
    const hasPics = parsed.pics.some((p) => p.areaRatio >= 0.005);
    const rawBox = parseImageBoxes(xml, await layoutFor(n), sz)[0] ?? null;
    info.push({ n, parsed, role, hasPics, rawBox });
    if (rawBox) {
      const key = [rawBox.xFrac, rawBox.yFrac, rawBox.wFrac, rawBox.hFrac].map((v) => v.toFixed(3)).join(',');
      const cur = freq.get(key) ?? { count: 0, box: rawBox };
      cur.count += 1; freq.set(key, cur);
    }
  }
  let modeEntry = null;
  for (const v of freq.values()) if (v.count >= 3 && (!modeEntry || v.count > modeEntry.count)) modeEntry = v;
  const modeBox = modeEntry?.box ?? null;

  // pass B: 크롭 계산 + 침범 검사
  let content = 0, boxed = 0, legacy = 0;
  const fails = [];
  for (const it of info) {
    if (it.role !== 'content' || !it.hasPics) continue;
    content += 1;
    const box = it.rawBox ?? modeBox;
    if (!box) { legacy += 1; continue; } // 판 자체가 없는 옛 형식 — 게이트 대상 아님(그룹/존 경로)
    boxed += 1;
    const c = boxCropRect(box, it.parsed);
    const cropR = (c.xFrac + c.wFrac) * 100;
    const boxR = (box.xFrac + box.wFrac) * 100;
    // 침범 = 크롭이 판 오른쪽의 본문 텍스트(>20자) shape 와 겹침
    for (const s of it.parsed.shapes) {
      if (s.isGroupLabel || (s.text ?? '').length <= 20) continue;
      if (s.bbox.left <= boxR) continue; // 판 위/왼쪽 텍스트는 대상 아님
      if (cropR > s.bbox.left) { fails.push(`#${it.n} 침범 크롭R=${cropR.toFixed(1)} > 텍스트L=${s.bbox.left.toFixed(1)}`); break; }
    }
  }
  totalFail += fails.length;
  rows.push({ deck, slides: nums.length, content, boxed, legacy, fail: fails.length });
  console.log(`\n===== ${deck} =====`);
  console.log(`슬라이드 ${nums.length} | 검사대상(content+이미지) ${content} | 판 크롭 ${boxed} | 옛형식 ${legacy} | FAIL ${fails.length}`);
  for (const f of fails) console.log(`  ${f}`);
}

console.log('\n================ 게이트 결과 ================');
for (const r of rows) console.log(`${r.fail === 0 ? 'PASS' : 'FAIL'}  ${r.deck}  (검사 ${r.boxed}/${r.content}, 옛형식 ${r.legacy}, 위반 ${r.fail})`);
console.log(`총 위반: ${totalFail}건 → ${totalFail === 0 ? '✅ 게이트 통과' : '❌ 게이트 실패'}`);
process.exit(totalFail === 0 ? 0 : 1);
